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
