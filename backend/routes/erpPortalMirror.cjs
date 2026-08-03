/**
 * ERP → Portal Bridge
 *
 * The ERP frontend is offline-first (IndexedDB → Supabase) and never calls the
 * backend REST layer. The customer Portal, however, reads from the backend
 * SQLite database and refreshes over SSE (`/api/portal/events`).
 *
 * This route lets the ERP side mirror the documents it creates (invoices,
 * sales orders, quotations, customer payments and wallet movements) into the
 * portal SQLite layer so the Portal auto-updates, and broadcasts the matching
 * SSE events + notifications.
 *
 * The endpoint is role-protected (Admin / Accountant / Manager) and writes are
 * idempotent upserts keyed on the ERP document id.
 */
const express = require('express');
const randomUUID = require('crypto').randomUUID;
const { db } = require('../db.cjs');
const { requireRole } = require('../middleware/auth.cjs');
const portalLifecycleService = require('../services/portalLifecycleService.cjs');
const workflowEngine = require('../services/workflowEngine.cjs');

const router = express.Router();

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function getOne(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pick(record, keys) {
  const out = {};
  for (const k of keys) {
    if (record[k] !== undefined && record[k] !== null) out[k] = record[k];
  }
  return out;
}

function normalizeItems(items) {
  if (Array.isArray(items)) {
    return JSON.stringify(items.map((it) => ({
      productId: it.productId || it.product_id || it.id || it.itemId || null,
      name: it.name || it.description || it.productName || 'Item',
      quantity: num(it.quantity || it.qty),
      unitPrice: num(it.unitPrice || it.price || it.sellingPrice || it.unit_price),
      lineTotal: num(it.lineTotal || it.total || it.line_total),
      type: it.type || null,
    })));
  }
  if (typeof items === 'string') return items;
  return JSON.stringify([]);
}

function emit(channel, payload) {
  try {
    portalLifecycleService.emitEntityChange(channel, payload);
  } catch (err) {
    console.error('[ERP Mirror] SSE emit failed:', err.message);
  }
}

async function notifyPortalCustomer({ customerId, type, title, body, link }) {
  if (!customerId) return;
  try {
    await portalLifecycleService.notifyCustomer({ customerId, type, title, body, link });
  } catch (err) {
    console.error('[ERP Mirror] notifyCustomer failed:', err.message);
  }
}

async function ensureCustomerRow(customerId, customerName, email, phone) {
  if (!customerId) return;
  await runQuery(
    `INSERT OR IGNORE INTO customers (id, name, email, phone)
     VALUES (?, ?, ?, ?)`,
    [customerId, customerName || customerId, email || null, phone || null]
  );
}

async function mirrorInvoice(record) {
  const erpId = String(record.id ?? record.invoiceId ?? randomUUID());
  const idempotencyKey = record.idempotencyKey ?? record.idempotency_key ?? erpId;
  const customerId = record.customerId ?? record.customer_id ?? null;
  const customerName = record.customerName ?? record.customer_name ?? null;
  const status = String(record.status ?? 'unpaid').toLowerCase();
  const invoiceNumber = record.invoiceNumber ?? record.invoice_number ?? null;
  const itemsJson = normalizeItems(record.items ?? record.lineItems ?? record.line_items);

  await ensureCustomerRow(customerId, customerName, record.customerEmail ?? record.customer_email, record.customerPhone ?? record.customer_phone);

  const existing = await getOne('SELECT id FROM invoices WHERE idempotency_key = ?', [idempotencyKey]);

  const baseParams = [
    customerId, customerName, num(record.subtotal), num(record.totalAmount ?? record.total), num(record.paidAmount ?? record.paid_amount),
    record.currency ?? 'MWK', status, record.paymentMethod ?? record.payment_method ?? null,
    record.paidAt ?? record.paid_at ?? null, record.dueDate ?? record.due_date ?? null, invoiceNumber,
    num(record.otherCharges ?? record.other_charges), itemsJson, record.notes ?? null,
    record.documentTitle ?? record.document_title ?? null, record.originModule ?? record.origin_module ?? 'erp', idempotencyKey
  ];

  let docId;
  if (existing) {
    await runQuery(
      `UPDATE invoices SET
         customer_id = ?, customer_name = ?, subtotal = ?, total_amount = ?, paid_amount = ?,
         currency = ?, status = ?, payment_method = ?, paid_at = ?, due_date = ?, invoice_number = ?,
         other_charges = ?, line_items_json = ?, notes = ?, document_title = ?, origin_module = ?,
         idempotency_key = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [...baseParams, existing.id]
    );
    docId = existing.id;
  } else {
    const res = await runQuery(
      `INSERT INTO invoices
         (customer_id, customer_name, subtotal, total_amount, paid_amount, currency, status,
          payment_method, paid_at, due_date, invoice_number, other_charges, line_items_json,
          notes, document_title, origin_module, idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      baseParams
    );
    docId = res.id;
  }

  const payload = { customerId, docType: 'invoice', docId, status, invoiceNumber };
  emit('portal', payload);
  emit('admin', payload);

  if (customerId && (status === 'paid' || status === 'partial')) {
    await notifyPortalCustomer({
      customerId,
      type: 'invoice',
      title: status === 'paid' ? 'Invoice paid' : 'Payment received',
      body: `Invoice ${invoiceNumber || erpId} has been updated to ${status}.`,
      link: `/invoices/${docId}`,
    });
  }

  return docId;
}

async function mirrorSalesOrder(record) {
  const id = String(record.id ?? record.orderId ?? randomUUID());
  const customerId = record.customerId ?? record.customer_id ?? null;
  const customerName = record.customerName ?? record.customer_name ?? null;
  const status = String(record.status ?? 'Draft');
  const orderNumber = record.orderNumber ?? record.order_number ?? null;
  const now = new Date().toISOString();

  await ensureCustomerRow(customerId, customerName, record.customerEmail ?? record.customer_email, record.customerPhone ?? record.customer_phone);

  await runQuery(
    `INSERT INTO sales_orders
       (id, quotation_id, order_number, source_request_id, source_request_number, reorder_of,
        reorder_of_number, approved_by, approved_at, erp_order_id, customer_id, orderDate,
        deliveryDate, status, items, subtotal, discounts, tax, other_charges, total, notes,
        created_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
        quotation_id = excluded.quotation_id,
        order_number = excluded.order_number,
        source_request_id = excluded.source_request_id,
        source_request_number = excluded.source_request_number,
        reorder_of = excluded.reorder_of,
        reorder_of_number = excluded.reorder_of_number,
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        erp_order_id = excluded.erp_order_id,
        customer_id = excluded.customer_id,
        orderDate = excluded.orderDate,
        deliveryDate = excluded.deliveryDate,
        status = excluded.status,
        items = excluded.items,
        subtotal = excluded.subtotal,
        discounts = excluded.discounts,
        tax = excluded.tax,
        other_charges = excluded.other_charges,
        total = excluded.total,
        notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP`,
    [id, record.quotationId ?? record.quotation_id ?? null, orderNumber,
     record.sourceRequestId ?? record.source_request_id ?? null, record.sourceRequestNumber ?? record.source_request_number ?? null,
     record.reorderOf ?? record.reorder_of ?? null, record.reorderOfNumber ?? record.reorder_of_number ?? null,
     record.approvedBy ?? record.approved_by ?? null, record.approvedAt ?? record.approved_at ?? null,
     record.erpOrderId ?? record.erp_order_id ?? null, customerId,
     record.orderDate ?? record.order_date ?? now, record.deliveryDate ?? record.delivery_date ?? null,
     status, normalizeItems(record.items),
     num(record.subtotal), num(record.discounts ?? record.discount), num(record.tax), num(record.otherCharges ?? record.other_charges),
     num(record.total), record.notes ?? null, record.createdBy ?? record.created_by ?? null]
  );

  const payload = { customerId, docType: 'order', docId: id, status, orderNumber };
  emit('portal', payload);
  emit('admin', payload);

  const confirmed = /^(confirmed|approved|completed)$/i.test(status);
  if (customerId && confirmed) {
    await notifyPortalCustomer({
      customerId,
      type: 'order',
      title: 'Order confirmed',
      body: `Order ${orderNumber || id} has been confirmed.`,
      link: `/orders/${id}`,
    });
  }

  return id;
}

async function mirrorQuotation(record) {
  const id = String(record.id ?? record.quotationId ?? randomUUID());
  const customerId = record.customerId ?? record.customer_id ?? null;
  const customerName = record.customerName ?? record.customer_name ?? null;
  const existing = await getOne('SELECT quotation_number FROM quotations WHERE id = ?', [id]);

  let quotationNumber = record.quotationNumber ?? record.quotation_number ?? existing?.quotation_number ?? null;
  if (!quotationNumber) {
    quotationNumber = await workflowEngine.nextYearScopedNumber('quotations', 'quotation_number', 'QT');
  }

  const statusMap = {
    draft: 'ready',
    ready: 'ready',
    sent: 'ready',
    accepted: 'accepted',
    rejected: 'rejected',
    revision_requested: 'revision_requested',
    converted: 'converted',
    expired: 'expired',
  };
  const status = statusMap[String(record.status ?? 'Draft').toLowerCase()] || 'ready';

  await ensureCustomerRow(customerId, customerName, record.customerEmail ?? record.customer_email, record.customerPhone ?? record.customer_phone);

  await runQuery(
    `INSERT INTO quotations
       (id, quotation_number, request_id, customer_id, customer_name, items, subtotal, discount,
        tax_rate, tax_amount, delivery_fee, total, currency, payment_terms, valid_until, status,
        version, order_id, erp_quotation_id, source_request_number, created_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
        quotation_number = excluded.quotation_number,
        request_id = excluded.request_id,
        customer_id = excluded.customer_id,
        customer_name = excluded.customer_name,
        items = excluded.items,
        subtotal = excluded.subtotal,
        discount = excluded.discount,
        tax_rate = excluded.tax_rate,
        tax_amount = excluded.tax_amount,
        delivery_fee = excluded.delivery_fee,
        total = excluded.total,
        currency = excluded.currency,
        payment_terms = excluded.payment_terms,
        valid_until = excluded.valid_until,
        status = excluded.status,
        version = excluded.version,
        order_id = excluded.order_id,
        erp_quotation_id = excluded.erp_quotation_id,
        updated_at = CURRENT_TIMESTAMP`,
    [id, quotationNumber, record.requestId ?? record.request_id ?? null, customerId || customerName || 'walkin',
     customerName, normalizeItems(record.items),
     num(record.subtotal), num(record.discount), num(record.taxRate ?? record.tax_rate),
     num(record.taxAmount ?? record.tax_amount), num(record.deliveryFee ?? record.delivery_fee),
     num(record.total), record.currency ?? 'MWK', record.paymentTerms ?? record.payment_terms ?? 'Net 7',
     record.validUntil ?? record.valid_until ?? null, status,
     num(record.version) || 1, record.orderId ?? record.order_id ?? null,
     record.erpQuotationId ?? record.erp_quotation_id ?? null,
     record.sourceRequestNumber ?? record.source_request_number ?? null,
     record.createdBy ?? record.created_by ?? null]
  );

  const payload = { customerId, docType: 'quotation', docId: id, status, quotationNumber };
  emit('portal', payload);
  emit('admin', payload);

  if (customerId && status === 'ready') {
    await notifyPortalCustomer({
      customerId,
      type: 'quotation',
      title: 'New quotation',
      body: `Quotation ${quotationNumber} is ready for your review.`,
      link: `/quotations/${id}`,
    });
  }

  return id;
}

async function mirrorCustomerPayment(record) {
  const id = String(record.id ?? record.paymentId ?? randomUUID());
  const customerId = record.customerId ?? record.customer_id ?? null;
  const customerName = record.customerName ?? record.customer_name ?? '';
  const amount = num(record.amount ?? record.totalAmount ?? record.total);
  const allocations = record.allocations ?? record.allocations_json ?? null;

  await ensureCustomerRow(customerId, customerName, record.customerEmail ?? record.customer_email, record.customerPhone ?? record.customer_phone);

  await runQuery(
    `INSERT INTO customer_payments
       (id, customer_id, customer_name, amount, date, method, account_id, reference,
        allocations_json, excess_amount, excess_handling, notes, status, reconciled,
        created_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
        customer_id = excluded.customer_id,
        customer_name = excluded.customer_name,
        amount = excluded.amount,
        date = excluded.date,
        method = excluded.method,
        account_id = excluded.account_id,
        reference = excluded.reference,
        allocations_json = excluded.allocations_json,
        excess_amount = excluded.excess_amount,
        excess_handling = excluded.excess_handling,
        notes = excluded.notes,
        status = excluded.status,
        reconciled = excluded.reconciled,
        updated_at = CURRENT_TIMESTAMP`,
    [id, customerId, customerName || '', amount,
     record.date ?? record.createdAt ?? new Date().toISOString(),
     record.method ?? record.paymentMethod ?? 'Cash', record.accountId ?? record.account_id ?? null,
     record.reference ?? null, Array.isArray(allocations) ? JSON.stringify(allocations) : (typeof allocations === 'string' ? allocations : JSON.stringify(allocations || [])),
     num(record.excessAmount ?? record.excess_amount), record.excessHandling ?? record.excess_handling ?? null,
     record.notes ?? null, record.status ?? 'Cleared',
     record.reconciled ? 1 : 0, record.createdBy ?? record.created_by ?? null]
  );

  const payload = { customerId, docType: 'payment', docId: id, event: 'payment_recorded', amount, method: record.method ?? record.paymentMethod ?? 'Cash' };
  emit('portal', payload);
  emit('admin', payload);

  if (customerId) {
    await notifyPortalCustomer({
      customerId,
      type: 'payment',
      title: 'Payment recorded',
      body: `A payment of ${amount.toFixed(2)} has been recorded on your account.`,
      link: null,
    });
  }

  return id;
}

async function mirrorWallet(record) {
  const customerId = record.customerId ?? record.customer_id;
  if (!customerId) throw new Error('Wallet mirror requires a customerId');
  const customerName = record.customerName ?? record.customer_name ?? customerId;
  const delta = num(record.delta ?? record.amount ?? 0);
  const absoluteBalance = record.balance !== undefined && record.balance !== null ? num(record.balance) : null;

  await ensureCustomerRow(customerId, customerName, record.customerEmail ?? record.customer_email, record.customerPhone ?? record.customer_phone);

  if (absoluteBalance !== null) {
    await runQuery('UPDATE customers SET walletBalance = ? WHERE id = ?', [absoluteBalance, customerId]);
  } else {
    await runQuery('UPDATE customers SET walletBalance = MAX(COALESCE(walletBalance, 0) + ?, 0) WHERE id = ?', [delta, customerId]);
  }

  const balanceRow = await getOne('SELECT walletBalance FROM customers WHERE id = ?', [customerId]);
  const balance = num(balanceRow?.walletBalance);

  if (delta !== 0) {
    await runQuery(
      `CREATE TABLE IF NOT EXISTS customer_wallet_transactions (
        id TEXT PRIMARY KEY,
        customer_id TEXT,
        amount REAL NOT NULL DEFAULT 0,
        type TEXT NOT NULL DEFAULT 'credit',
        reason TEXT,
        reference TEXT,
        balance_after REAL DEFAULT 0,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    );
    await runQuery(
      `INSERT INTO customer_wallet_transactions (id, customer_id, amount, type, reason, reference, balance_after, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), customerId, Math.abs(delta), delta >= 0 ? 'credit' : 'debit',
       record.reason ?? null, record.reference ?? null, balance, record.createdBy ?? record.created_by ?? null]
    );
  }

  const payload = { customerId, docType: 'wallet', event: 'balance_changed', balance, delta };
  emit('portal', payload);
  emit('admin', payload);

  if (delta !== 0) {
    await notifyPortalCustomer({
      customerId,
      type: 'payment',
      title: delta > 0 ? 'Wallet credited' : 'Wallet debited',
      body: `${delta > 0 ? 'Credit' : 'Debit'} of ${Math.abs(delta).toFixed(2)} (${record.reason || 'ERP adjustment'}).`,
      link: '/wallet',
    });
  }

  return customerId;
}

async function mirrorCustomer(record) {
  const id = String(record.id ?? record.customerId ?? randomUUID());
  const name = record.name ?? record.customerName ?? record.customer_name ?? null;
  const email = record.email ?? record.customerEmail ?? record.customer_email ?? null;
  const phone = record.phone ?? record.phoneNumber ?? record.customerPhone ?? record.customer_phone ?? null;
  const status = record.status ?? record.customerStatus ?? record.customer_status ?? 'Active';
  const creditLimit = num(record.creditLimit ?? record.credit_limit);
  const balance = num(record.balance ?? record.outstandingBalance ?? record.outstanding_balance);
  const walletBalance = num(record.walletBalance ?? record.wallet_balance);

  await runQuery(
    `INSERT INTO customers (id, name, email, phone, status, creditLimit, outstandingBalance, walletBalance, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        email = excluded.email,
        phone = excluded.phone,
        status = excluded.status,
        creditLimit = excluded.creditLimit,
        outstandingBalance = excluded.outstandingBalance,
        walletBalance = excluded.walletBalance,
        updated_at = CURRENT_TIMESTAMP`,
    [id, name || 'Customer', email, phone, status, creditLimit, balance, walletBalance]
  );

  const payload = { customerId: id, docType: 'customer_updated', docId: id, event: 'customer_updated', status };
  emit('portal', payload);
  emit('admin', payload);

  return id;
}

async function mirrorDeliveryNote(record) {
  const id = String(record.id ?? record.deliveryNoteId ?? randomUUID());
  const customerId = record.customerId ?? record.customer_id ?? null;
  const customerName = record.customerName ?? record.customer_name ?? null;
  const orderId = record.orderId ?? record.salesOrderId ?? record.sales_order_id ?? null;
  const status = String(record.status ?? record.deliveryStatus ?? record.delivery_status ?? 'pending');
  const trackingNumber = record.trackingNumber ?? record.tracking_number ?? null;
  const deliveryDate = record.deliveryDate ?? record.delivery_date ?? null;
  const items = record.items ?? record.lineItems ?? record.line_items ?? null;

  await ensureCustomerRow(customerId, customerName, record.customerEmail ?? record.customer_email, record.customerPhone ?? record.customer_phone);

  await runQuery(
    `CREATE TABLE IF NOT EXISTS delivery_notes (
      id TEXT PRIMARY KEY,
      order_id TEXT,
      customer_id TEXT,
      customer_name TEXT,
      status TEXT DEFAULT 'pending',
      tracking_number TEXT,
      delivery_date DATETIME,
      items_json TEXT,
      notes TEXT,
      created_by TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );

  await runQuery(
    `INSERT OR IGNORE INTO delivery_notes (id, order_id, customer_id, customer_name, status, tracking_number, delivery_date, items_json, notes, created_by, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [id, orderId, customerId, customerName, status, trackingNumber, deliveryDate,
     items ? (Array.isArray(items) ? JSON.stringify(items) : items) : null,
     record.notes ?? record.comments ?? null, record.createdBy ?? record.created_by ?? null]
  );

  if (trackingNumber || status !== 'pending') {
    await runQuery(
      `UPDATE sales_orders SET
         status = CASE
           WHEN ? = 'delivered' THEN 'Delivered'
           WHEN ? = 'in_transit' OR ? = 'shipped' THEN 'Shipped'
           ELSE status
         END,
         tracking_number = COALESCE(?, tracking_number),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, status, status, trackingNumber, orderId]
    );
  }

  const payload = { customerId, docType: 'shipment', docId: id, event: 'delivery_updated', status, trackingNumber, orderId };
  emit('portal', payload);
  emit('admin', payload);
  const orderPayload = { customerId, docType: 'order', docId: orderId || id, event: 'delivery_updated', status, trackingNumber, deliveryNoteId: id };
  emit('portal', orderPayload);
  emit('admin', orderPayload);

  if (customerId && trackingNumber) {
    await notifyPortalCustomer({
      customerId,
      type: 'order',
      title: 'Delivery update',
      body: status === 'delivered' ? 'Your order has been delivered.' : `Your order is ${status}. Tracking: ${trackingNumber}`,
      link: `/shipments/${orderId || id}`,
    });
  }

  return id;
}

async function mirrorShipment(record) {
  return mirrorDeliveryNote(record);
}

async function mirrorReceipt(record) {
  const id = String(record.id ?? record.receiptId ?? randomUUID());
  const customerId = record.customerId ?? record.customer_id ?? null;
  const customerName = record.customerName ?? record.customer_name ?? null;
  const amount = num(record.amount ?? record.totalAmount ?? record.total);
  const paymentId = record.paymentId ?? record.payment_id ?? null;
  const invoiceIds = record.invoiceIds ?? record.invoice_ids ?? null;
  const receiptNumber = record.receiptNumber ?? record.receipt_number ?? null;

  await ensureCustomerRow(customerId, customerName, record.customerEmail ?? record.customer_email, record.customerPhone ?? record.customer_phone);

  await runQuery(
    `CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      customer_name TEXT,
      amount REAL DEFAULT 0,
      receipt_number TEXT,
      payment_id TEXT,
      invoice_ids_json TEXT,
      date DATETIME,
      notes TEXT,
      created_by TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );

  await runQuery(
    `INSERT INTO receipts (id, customer_id, customer_name, amount, receipt_number, payment_id, invoice_ids_json, date, notes, created_by, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
        customer_id = excluded.customer_id,
        customer_name = excluded.customer_name,
        amount = excluded.amount,
        receipt_number = excluded.receipt_number,
        payment_id = excluded.payment_id,
        updated_at = CURRENT_TIMESTAMP`,
    [id, customerId, customerName || '', amount, receiptNumber, paymentId,
     invoiceIds ? (Array.isArray(invoiceIds) ? JSON.stringify(invoiceIds) : invoiceIds) : null,
     record.date ?? record.createdAt ?? new Date().toISOString(),
     record.notes ?? null, record.createdBy ?? record.created_by ?? null]
  );

  const payload = { customerId, docType: 'payment', docId: id, event: 'receipt_issued', amount, receiptNumber };
  emit('portal', payload);
  emit('admin', payload);

  if (customerId && amount > 0) {
    await notifyPortalCustomer({
      customerId,
      type: 'receipt',
      title: 'Receipt issued',
      body: `Receipt ${receiptNumber || id} for ${amount.toFixed(2)} is available.`,
      link: `/payments/${paymentId || id}`,
    });
  }

  return id;
}

async function mirrorCreditNote(record) {
  const id = String(record.id ?? record.creditNoteId ?? randomUUID());
  const customerId = record.customerId ?? record.customer_id ?? null;
  const customerName = record.customerName ?? record.customer_name ?? null;
  const amount = num(record.amount ?? record.totalAmount ?? record.total);
  const status = String(record.status ?? 'applied');
  const reason = record.reason ?? record.notes ?? null;

  await ensureCustomerRow(customerId, customerName, record.customerEmail ?? record.customer_email, record.customerPhone ?? record.customer_phone);

  await runQuery(
    `CREATE TABLE IF NOT EXISTS credit_notes (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      customer_name TEXT,
      amount REAL DEFAULT 0,
      status TEXT DEFAULT 'applied',
      reason TEXT,
      date DATETIME,
      invoice_id TEXT,
      created_by TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );

  await runQuery(
    `INSERT INTO credit_notes (id, customer_id, customer_name, amount, status, reason, date, invoice_id, created_by, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
        customer_id = excluded.customer_id,
        amount = excluded.amount,
        status = excluded.status,
        reason = excluded.reason,
        updated_at = CURRENT_TIMESTAMP`,
    [id, customerId, customerName || '', amount, status, reason,
     record.date ?? record.createdAt ?? new Date().toISOString(),
     record.invoiceId ?? record.invoice_id ?? null,
     record.createdBy ?? record.created_by ?? null]
  );

  if (customerId && amount > 0) {
    await runQuery('UPDATE customers SET outstandingBalance = MAX(COALESCE(outstandingBalance, 0) - ?, 0) WHERE id = ?', [amount, customerId]);
  }

  const payload = { customerId, docType: 'invoice', docId: id, event: 'credit_note', amount, status };
  emit('portal', payload);
  emit('admin', payload);

  if (customerId && amount > 0) {
    await notifyPortalCustomer({
      customerId,
      type: 'invoice',
      title: 'Credit note issued',
      body: `A credit note of ${amount.toFixed(2)} has been applied to your account.`,
      link: `/invoices`,
    });
  }

  return id;
}

async function mirrorDebitNote(record) {
  const id = String(record.id ?? record.debitNoteId ?? randomUUID());
  const customerId = record.customerId ?? record.customer_id ?? null;
  const customerName = record.customerName ?? record.customer_name ?? null;
  const amount = num(record.amount ?? record.totalAmount ?? record.total);
  const status = String(record.status ?? 'pending');
  const reason = record.reason ?? record.notes ?? null;

  await ensureCustomerRow(customerId, customerName, record.customerEmail ?? record.customer_email, record.customerPhone ?? record.customer_phone);

  await runQuery(
    `CREATE TABLE IF NOT EXISTS debit_notes (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      customer_name TEXT,
      amount REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      reason TEXT,
      date DATETIME,
      invoice_id TEXT,
      created_by TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );

  await runQuery(
    `INSERT INTO debit_notes (id, customer_id, customer_name, amount, status, reason, date, invoice_id, created_by, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
        customer_id = excluded.customer_id,
        amount = excluded.amount,
        status = excluded.status,
        reason = excluded.reason,
        updated_at = CURRENT_TIMESTAMP`,
    [id, customerId, customerName || '', amount, status, reason,
     record.date ?? record.createdAt ?? new Date().toISOString(),
     record.invoiceId ?? record.invoice_id ?? null,
     record.createdBy ?? record.created_by ?? null]
  );

  if (customerId && amount > 0) {
    await runQuery('UPDATE customers SET outstandingBalance = COALESCE(outstandingBalance, 0) + ? WHERE id = ?', [amount, customerId]);
  }

  const payload = { customerId, docType: 'invoice', docId: id, event: 'debit_note', amount, status };
  emit('portal', payload);
  emit('admin', payload);

  if (customerId && amount > 0) {
    await notifyPortalCustomer({
      customerId,
      type: 'invoice',
      title: 'Debit note issued',
      body: `A debit note of ${amount.toFixed(2)} has been applied to your account.`,
      link: `/invoices`,
    });
  }

  return id;
}

async function mirrorWalletTransaction(record) {
  const customerId = record.customerId ?? record.customer_id;
  if (!customerId) return null;
  const txnId = String(record.id ?? record.transactionId ?? record.walletTransactionId ?? randomUUID());
  const amount = num(record.amount ?? record.delta);
  const type = record.type ?? (amount >= 0 ? 'credit' : 'debit');
  const reason = record.reason ?? record.description ?? null;
  const reference = record.reference ?? record.ref ?? null;
  const balanceAfter = record.balanceAfter ?? record.balance_after ?? null;

  await ensureCustomerRow(customerId, record.customerName ?? record.customer_name,
    record.customerEmail ?? record.customer_email, record.customerPhone ?? record.customer_phone);

  await runQuery(
    `CREATE TABLE IF NOT EXISTS customer_wallet_transactions (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      amount REAL NOT NULL DEFAULT 0,
      type TEXT NOT NULL DEFAULT 'credit',
      reason TEXT,
      reference TEXT,
      balance_after REAL DEFAULT 0,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );

  await runQuery(
    `INSERT OR IGNORE INTO customer_wallet_transactions (id, customer_id, amount, type, reason, reference, balance_after, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [txnId, customerId, Math.abs(amount), type, reason, reference,
     balanceAfter !== null ? num(balanceAfter) : 0,
     record.createdBy ?? record.created_by ?? null,
     record.createdAt ?? record.date ?? new Date().toISOString()]
  );

  const payload = { customerId, docType: 'wallet', docId: txnId, event: 'wallet_transaction', amount, type };
  emit('portal', payload);
  emit('admin', payload);

  return txnId;
}

async function mirrorJobTicket(record) {
  const id = String(record.id ?? record.jobTicketId ?? randomUUID());
  const customerId = record.customerId ?? record.customer_id ?? null;
  const customerName = record.customerName ?? record.customer_name ?? null;
  const orderId = record.orderId ?? record.salesOrderId ?? record.sales_order_id ?? null;
  const status = String(record.status ?? record.ticketStatus ?? 'pending');
  const jobType = record.jobType ?? record.job_type ?? record.type ?? null;
  const progress = num(record.progress ?? record.completionPercent ?? record.completion_percent);

  await ensureCustomerRow(customerId, customerName, record.customerEmail ?? record.customer_email, record.customerPhone ?? record.customer_phone);

  await runQuery(
    `CREATE TABLE IF NOT EXISTS job_tickets (
      id TEXT PRIMARY KEY,
      order_id TEXT,
      customer_id TEXT,
      customer_name TEXT,
      status TEXT DEFAULT 'pending',
      job_type TEXT,
      progress REAL DEFAULT 0,
      notes TEXT,
      due_date DATETIME,
      created_by TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );

  await runQuery(
    `INSERT INTO job_tickets (id, order_id, customer_id, customer_name, status, job_type, progress, notes, due_date, created_by, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        progress = excluded.progress,
        notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP`,
    [id, orderId, customerId, customerName || '', status, jobType, progress,
     record.notes ?? null, record.dueDate ?? record.due_date ?? null,
     record.createdBy ?? record.created_by ?? null]
  );

  const payload = { customerId, docType: 'order', docId: orderId || id, event: 'production_update', status, progress, jobTicketId: id };
  emit('portal', payload);
  emit('admin', payload);

  return id;
}

async function mirrorWorkOrder(record) {
  const id = String(record.id ?? record.workOrderId ?? randomUUID());
  const customerId = record.customerId ?? record.customer_id ?? null;
  const orderId = record.orderId ?? record.salesOrderId ?? record.sales_order_id ?? record.sourceSalesOrder ?? null;
  const status = String(record.status ?? record.workOrderStatus ?? 'pending');
  const progress = num(record.progress ?? record.completionPercent);
  const finishedGoods = record.finishedGoods ?? record.finished_goods ?? [];

  const payload = { customerId, docType: 'order', docId: orderId || id, event: 'production_status', status, progress, workOrderId: id };
  emit('portal', payload);
  emit('admin', payload);

  if (customerId && status === 'completed') {
    await notifyPortalCustomer({
      customerId,
      type: 'order',
      title: 'Production completed',
      body: `Production for order ${orderId || id} has been completed.`,
      link: `/orders/${orderId || id}`,
    });
  }

  return id;
}

async function mirrorProductionBatch(record) {
  return mirrorWorkOrder(record);
}

async function mirrorInventoryTransaction(record) {
  const id = String(record.id ?? record.inventoryTransactionId ?? randomUUID());
  const type = record.type ?? record.txnType ?? record.transaction_type ?? null;
  const productId = record.productId ?? record.product_id ?? record.itemId ?? null;
  const quantity = num(record.quantity);
  const reference = record.reference ?? record.ref ?? record.orderId ?? null;

  const payload = { docType: 'inventory', docId: id, event: 'stock_changed', type, productId, quantity, reference };
  emit('admin', payload);

  return id;
}

async function mirrorLedgerEntry(record) {
  const id = String(record.id ?? record.ledgerEntryId ?? record.entryId ?? randomUUID());
  const customerId = record.customerId ?? record.customer_id ?? null;
  const accountId = record.accountId ?? record.account_id ?? null;
  const amount = num(record.amount ?? record.debit ?? record.credit);
  const debit = num(record.debit ?? record.debitAmount);
  const credit = num(record.credit ?? record.creditAmount);
  const description = record.description ?? record.narration ?? record.notes ?? null;

  if (customerId) {
    const delta = credit - debit || amount;
    if (delta !== 0) {
      await runQuery('UPDATE customers SET outstandingBalance = COALESCE(outstandingBalance, 0) - ? WHERE id = ?', [delta, customerId]);
    }

    const payload = { customerId, docType: 'statement', docId: id, event: 'ledger_updated', debit, credit, amount };
    emit('portal', payload);
    emit('admin', payload);
  }

  return id;
}

async function mirrorSupportTicket(record) {
  const id = String(record.id ?? record.ticketId ?? randomUUID());
  const customerId = record.customerId ?? record.customer_id ?? null;
  const customerName = record.customerName ?? record.customer_name ?? null;
  const subject = record.subject ?? record.title ?? null;
  const status = String(record.status ?? 'open');
  const priority = record.priority ?? 'normal';
  const message = record.message ?? record.initialMessage ?? record.description ?? null;

  await ensureCustomerRow(customerId, customerName, record.customerEmail ?? record.customer_email, record.customerPhone ?? record.customer_phone);

  await runQuery(
    `CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      customer_name TEXT,
      subject TEXT,
      message TEXT,
      status TEXT DEFAULT 'open',
      priority TEXT DEFAULT 'normal',
      assigned_to TEXT,
      created_by TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );

  await runQuery(
    `INSERT INTO support_tickets (id, customer_id, customer_name, subject, message, status, priority, assigned_to, created_by, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        priority = excluded.priority,
        assigned_to = excluded.assigned_to,
        updated_at = CURRENT_TIMESTAMP`,
    [id, customerId, customerName || '', subject, message, status, priority,
     record.assignedTo ?? record.assigned_to ?? null,
     record.createdBy ?? record.created_by ?? null]
  );

  const payload = { customerId, docType: 'ticket_updated', docId: id, event: 'ticket_updated', status, priority };
  emit('portal', payload);
  emit('admin', payload);
  const supportPayload = { customerId, docType: 'support', docId: id, event: 'ticket_updated', status, priority };
  emit('portal', supportPayload);
  emit('admin', supportPayload);

  if (customerId && (status === 'resolved' || status === 'closed')) {
    await notifyPortalCustomer({
      customerId,
      type: 'system',
      title: 'Support ticket updated',
      body: `Ticket "${subject || id}" status: ${status}.`,
      link: `/support`,
    });
  }

  return id;
}

async function mirrorNotification(record) {
  const id = String(record.id ?? record.notificationId ?? randomUUID());
  const customerId = record.customerId ?? record.customer_id ?? null;
  const portalUserId = record.portalUserId ?? record.portal_user_id ?? null;
  const type = record.type ?? record.notificationType ?? 'system';
  const title = record.title ?? record.subject ?? null;
  const body = record.body ?? record.message ?? record.description ?? null;
  const link = record.link ?? record.url ?? null;

  await notifyPortalCustomer({ customerId, type, title, body, link });

  return id;
}

async function mirrorEngagement(record) {
  const customerId = record.customerId ?? record.customer_id;
  if (!customerId) return null;
  const customerName = record.customerName ?? record.customer_name ?? null;
  const pointsEarned = num(record.pointsEarned ?? record.points_earned ?? record.points);
  const rewardType = record.rewardType ?? record.reward_type ?? record.type ?? null;

  await ensureCustomerRow(customerId, customerName, record.customerEmail ?? record.customer_email, record.customerPhone ?? record.customer_phone);

  const payload = { customerId, docType: 'loyalty', event: 'reward_earned', pointsEarned, rewardType };
  emit('portal', payload);
  emit('admin', payload);

  if (customerId && pointsEarned > 0) {
    await notifyPortalCustomer({
      customerId,
      type: 'system',
      title: 'Rewards earned',
      body: `You earned ${pointsEarned} reward points!`,
      link: '/loyalty',
    });
  }

  return customerId;
}

async function mirrorBulk(record) {
  const entities = record.entities ?? record.items ?? [];
  const results = [];
  for (const entry of entities) {
    try {
      const { entity, data } = entry;
      let id;
      switch (entity) {
        case 'invoice': id = await mirrorInvoice(data); break;
        case 'salesOrder': id = await mirrorSalesOrder(data); break;
        case 'quotation': id = await mirrorQuotation(data); break;
        case 'customerPayment': id = await mirrorCustomerPayment(data); break;
        case 'wallet': id = await mirrorWallet(data); break;
        case 'customer': id = await mirrorCustomer(data); break;
        case 'deliveryNote': id = await mirrorDeliveryNote(data); break;
        case 'shipment': id = await mirrorShipment(data); break;
        case 'receipt': id = await mirrorReceipt(data); break;
        case 'creditNote': id = await mirrorCreditNote(data); break;
        case 'debitNote': id = await mirrorDebitNote(data); break;
        case 'walletTransaction': id = await mirrorWalletTransaction(data); break;
        case 'jobTicket': id = await mirrorJobTicket(data); break;
        case 'workOrder': id = await mirrorWorkOrder(data); break;
        case 'productionBatch': id = await mirrorProductionBatch(data); break;
        case 'inventoryTransaction': id = await mirrorInventoryTransaction(data); break;
        case 'ledgerEntry': id = await mirrorLedgerEntry(data); break;
        case 'supportTicket': id = await mirrorSupportTicket(data); break;
        case 'notification': id = await mirrorNotification(data); break;
        case 'engagement': id = await mirrorEngagement(data); break;
        default: continue;
      }
      results.push({ entity, id, success: true });
    } catch (err) {
      results.push({ entity: entry.entity, success: false, error: err?.message || String(err) });
    }
  }
  return results;
}

// POST /api/erp-portal/mirror
router.post('/mirror', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
  try {
    const { entity, data } = req.body || {};
    if (!entity || !data || typeof data !== 'object') {
      return res.status(400).json({ error: 'entity and data are required' });
    }

    let id;
    switch (entity) {
      case 'invoice':
        id = await mirrorInvoice(data);
        break;
      case 'salesOrder':
        id = await mirrorSalesOrder(data);
        break;
      case 'quotation':
        id = await mirrorQuotation(data);
        break;
      case 'customerPayment':
        id = await mirrorCustomerPayment(data);
        break;
      case 'wallet':
        id = await mirrorWallet(data);
        break;
      case 'customer':
        id = await mirrorCustomer(data);
        break;
      case 'deliveryNote':
        id = await mirrorDeliveryNote(data);
        break;
      case 'shipment':
        id = await mirrorShipment(data);
        break;
      case 'receipt':
        id = await mirrorReceipt(data);
        break;
      case 'creditNote':
        id = await mirrorCreditNote(data);
        break;
      case 'debitNote':
        id = await mirrorDebitNote(data);
        break;
      case 'walletTransaction':
        id = await mirrorWalletTransaction(data);
        break;
      case 'jobTicket':
        id = await mirrorJobTicket(data);
        break;
      case 'workOrder':
        id = await mirrorWorkOrder(data);
        break;
      case 'productionBatch':
        id = await mirrorProductionBatch(data);
        break;
      case 'inventoryTransaction':
        id = await mirrorInventoryTransaction(data);
        break;
      case 'ledgerEntry':
        id = await mirrorLedgerEntry(data);
        break;
      case 'supportTicket':
        id = await mirrorSupportTicket(data);
        break;
      case 'notification':
        id = await mirrorNotification(data);
        break;
      case 'engagement':
        id = await mirrorEngagement(data);
        break;
      case 'bulk':
        id = await mirrorBulk(data);
        break;
      default:
        return res.status(400).json({ error: `Unknown entity: ${entity}` });
    }

    res.json({ success: true, entity, id });
  } catch (err) {
    console.error('[ERP Mirror] POST /mirror error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Mirror failed' });
  }
});

module.exports = router;
