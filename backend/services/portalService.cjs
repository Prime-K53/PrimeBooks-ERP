const repo = require('./supabaseRepository.cjs');
const supabaseStore = require('./supabaseStore.cjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const portalAuthService = require('./portalAuthService.cjs');
const portalLifecycleService = require('./portalLifecycleService.cjs');
const ReferralService = require('./referralService.cjs');
const referralService = new ReferralService();

const TICKET_ATTACHMENTS_DIR = path.join(__dirname, '..', 'storage', 'ticket-attachments');

async function getOne(query, params = []) {
  const trimmed = String(query || '').trim();
  const countMatch = trimmed.match(/SELECT\s+COUNT\s*\(\*\)\s+as\s+(\w+)\s+FROM\s+(\w+)/i);
  if (countMatch) {
    const table = countMatch[2];
    const rows = await repo.getAll(table);
    return { [countMatch[1]]: rows.length };
  }
  const byIdMatch = trimmed.match(/FROM\s+(\w+)\s+WHERE\s+.*\bid\s*=\s*\?/i);
  if (byIdMatch && params.length > 0) {
    return repo.getById(byIdMatch[1], String(params[0]));
  }
  const byFieldMatch = trimmed.match(/FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\?/i);
  if (byFieldMatch && params.length > 0) {
    const rows = await repo.getAll(byFieldMatch[1], { [`data->>${byFieldMatch[2]}`]: `eq.${params[0]}` });
    return rows[0] || null;
  }
  const fromMatch = trimmed.match(/FROM\s+(\w+)/i);
  if (fromMatch) {
    const rows = await repo.getAll(fromMatch[1]);
    return rows[0] || null;
  }
  return null;
}

async function getAll(query, params = []) {
  const trimmed = String(query || '').trim();
  const byFieldMatch = trimmed.match(/FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\?/i);
  if (byFieldMatch && params.length > 0) {
    return repo.getAll(byFieldMatch[1], { [`data->>${byFieldMatch[2]}`]: `eq.${params[0]}` });
  }
  const fromMatch = trimmed.match(/FROM\s+(\w+)/i);
  if (fromMatch) {
    return repo.getAll(fromMatch[1]);
  }
  return [];
}

async function runQuery(query, params = []) {
  const trimmed = String(query || '').trim();
  const deleteMatch = trimmed.match(/DELETE\s+FROM\s+(\w+)\s+WHERE\s+id\s*=\s*\?/i);
  if (deleteMatch) {
    await repo.softDelete(deleteMatch[1], String(params[0]));
    return { changes: 1 };
  }
  const updateMatch = trimmed.match(/UPDATE\s+(\w+)\s+SET/i);
  if (updateMatch) {
    const id = String(params[params.length - 1]);
    const row = await repo.getById(updateMatch[1], id);
    if (row) await repo.upsert(updateMatch[1], { ...row, ...(params[0] || {}) });
    return { changes: 1 };
  }
  const insertMatch = trimmed.match(/INSERT\s+INTO\s+(\w+)/i);
  if (insertMatch) {
    const id = String(params[0] || `gen_${Date.now()}`);
    await repo.upsert(insertMatch[1], { id });
    return { id, changes: 1 };
  }
  return { changes: 0 };
}

function genId(prefix = 'prt') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

async function getAllFrom(table, filters = {}) {
  return repo.getAll(table, filters);
}

async function getOneById(table, id) {
  return repo.getById(table, id);
}

const portalService = {

  async getDashboard(portalUserId, customerId) {
    const [customer, invoices, orders, requests, quotations, notifications] = await Promise.all([
      getOneById('customers', customerId),
      getAllFrom('invoices', { 'data->>customerId': `eq.${customerId}` }),
      getAllFrom('sales_orders', { 'data->>customerId': `eq.${customerId}` }),
      getAllFrom('quotation_requests', { 'data->>customerId': `eq.${customerId}` }),
      getAllFrom('quotations', { 'data->>customerId': `eq.${customerId}` }),
      getAllFrom('portal_notifications', { 'data->>portalUserId': `eq.${portalUserId}` }),
    ]);

    const unpaidCount = invoices.filter((i) => /unpaid|partial/i.test(String(i.status || ''))).length;
    const totalOrders = orders.length;
    const activeRequestCount = requests.filter((r) =>
      ['submitted', 'assigned', 'under_review', 'waiting_for_customer', 'ready_for_conversion'].includes(String(r.status || ''))
    ).length;
    const openQuotationCount = quotations.filter((q) =>
      ['ready', 'accepted', 'revision_requested'].includes(String(q.status || ''))
    ).length;
    const productionOrderCount = orders.filter((o) =>
      ['confirmed', 'processing', 'pending', 'shipped'].includes(String(o.status || '').toLowerCase())
    ).length;
    const unreadMessageCount = notifications.filter((n) => !n.isRead).length;

    const recentDocs = await this.getRecentDocuments(customerId, 5);
    const recentTransactions = await this.getRecentTransactions(customerId, 5);

    return {
      balance: (customer && customer.balance != null) ? customer.balance : 0,
      walletBalance: (customer && customer.walletBalance != null) ? customer.walletBalance : 0,
      outstandingBalance: (customer && customer.outstandingBalance != null) ? customer.outstandingBalance : (customer && customer.balance) || 0,
      unpaidInvoiceCount: unpaidCount,
      totalOrders,
      activeRequestCount,
      openQuotationCount,
      productionOrderCount,
      unreadMessageCount,
      recentDocuments: recentDocs,
      recentTransactions,
    };
  },

  async getCatalog(includeDeleted = false) {
    const cloud = await getAllFrom('inventory');
    let catalogItems = cloud;
    if (!includeDeleted) {
      catalogItems = catalogItems.filter((i) => String(i.status || '').toLowerCase() !== 'deleted');
    }
    catalogItems.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return catalogItems.map((item) => ({
      id: item.id,
      name: item.name,
      sku: item.sku,
      unit: item.unit || '',
      price: Number(item.sellingPrice ?? item.selling_price ?? item.price ?? 0),
      quantity: Number(item.stock ?? item.quantity ?? 0),
      category: item.category || item.type || 'General',
      status: item.status || 'Active',
    }));
  },

  async getRecentTransactions(customerId, limit = 5) {
    const entries = [];

    const [cloudInvoices, cloudSales] = await Promise.all([
      getAllFrom('invoices', { 'data->>customerId': `eq.${customerId}` }),
      getAllFrom('sales', { 'data->>customerId': `eq.${customerId}` }),
    ]);

    for (const inv of cloudInvoices) {
      entries.push({
        date: inv.created_at,
        description: `Invoice ${inv.invoice_number || inv.id}`,
        amount: inv.total_amount,
        type: 'invoice',
        status: inv.status,
        docType: 'invoice',
        docId: inv.id,
      });
    }

    for (const sale of cloudSales) {
      entries.push({
        date: sale.date,
        description: `Sale ${sale.id || ''}`.trim() || 'Sale',
        amount: sale.total_amount,
        type: 'sale',
        status: sale.status,
        docType: 'sale',
        docId: sale.id,
      });
    }

    const recentPayments = await getAllFrom('customer_payments', { 'data->>customerId': `eq.${customerId}` });
    for (const pay of recentPayments) {
      entries.push({
        date: pay.date,
        description: (pay.reference && String(pay.reference).trim()) ? String(pay.reference).trim() : 'Payment received',
        amount: pay.amount,
        type: 'payment',
        status: pay.status,
        docType: 'payment',
        docId: pay.id,
      });
    }

    const recentOrders = await getAllFrom('sales_orders', { 'data->>customerId': `eq.${customerId}` });
    for (const ord of recentOrders) {
      entries.push({
        date: ord.orderDate,
        description: `Order ${ord.order_number || ord.id} ${ord.status || ''}`.trim(),
        amount: null,
        type: 'order',
        status: ord.status,
        docType: 'order',
        docId: ord.id,
      });
    }

    const recentRequests = await getAllFrom('quotation_requests', { 'data->>customerId': `eq.${customerId}` });
    for (const req of recentRequests) {
      entries.push({
        date: req.created_at,
        description: `${req.request_type || 'Request'} ${req.request_number || req.id}`.trim(),
        amount: null,
        type: 'request',
        status: req.status,
        docType: 'request',
        docId: req.id,
      });
    }

    return entries
      .filter((e) => e.date)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, limit);
  },

  async getRecentDocuments(customerId, limit = 5) {
    const [requests, quotations, orders] = await Promise.all([
      getAllFrom('quotation_requests', { 'data->>customerId': `eq.${customerId}` }),
      getAllFrom('quotations', { 'data->>customerId': `eq.${customerId}` }),
      getAllFrom('sales_orders', { 'data->>customerId': `eq.${customerId}` }),
    ]);

    const mappedRequests = requests.map((r) => ({
      docType: 'request',
      id: r.id,
      docNumber: r.request_number || r.id,
      status: r.status,
      request_type: r.request_type,
      created_at: r.created_at,
    }));

    const mappedQuotations = quotations.map((q) => ({
      docType: 'quotation',
      id: q.id,
      docNumber: q.quotation_number || q.id,
      status: q.status,
      created_at: q.created_at,
    }));

    const mappedOrders = orders.map((o) => ({
      docType: 'order',
      id: o.id,
      docNumber: o.order_number || o.id,
      status: o.status,
      created_at: o.orderDate,
    }));

    return [...mappedRequests, ...mappedQuotations, ...mappedOrders]
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .slice(0, limit);
  },

  async getRequestsPaginated(customerId, { page = 1, pageSize = 20, status, search } = {}) {
    const offset = (page - 1) * pageSize;
    const conditions = ['q.customer_id = ?'];
    const params = [customerId];

    if (status) {
      conditions.push('LOWER(q.status) = ?');
      params.push(String(status).toLowerCase());
    }
    if (search) {
      conditions.push('(q.request_number LIKE ? OR q.customer_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = conditions.join(' AND ');
    const countRow = await getOne(`SELECT COUNT(*) as total FROM quotation_requests q WHERE ${whereClause}`, params);
    const total = countRow?.total || 0;

    const rows = await getAll(
      `SELECT q.*, c.name AS resolved_customer_name
       FROM quotation_requests q
       LEFT JOIN customers c ON c.id = q.customer_id
       WHERE ${whereClause}
       ORDER BY q.created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return {
      requests: rows.map((r) => ({
        ...r,
        status: r.quotation_id ? (r.status === 'quotation_ready' ? 'converted' : r.status) : r.status,
        customer_name: r.resolved_customer_name || r.customer_name,
        items: parseJson(r.items, []),
        attachments: parseJson(r.attachments, []),
      })),
      total, page, pageSize, totalPages: Math.ceil(total / pageSize) || 1,
    };
  },

  async getOrders(customerId) {
    const [orders, customers] = await Promise.all([
      getAllFrom('sales_orders', { 'data->>customerId': `eq.${customerId}` }),
      getAllFrom('customers'),
    ]);
    const customerMap = new Map(customers.map((c) => [c.id, c.name]));
    return orders.map((o) => ({
      ...o,
      customerName: customerMap.get(o.customerId) || '',
      totalAmount: o.total,
      items_json: o.items,
    }));
  },

  async getOrdersPaginated(customerId, { page = 1, pageSize = 20, status, search, dateFrom, dateTo } = {}) {
    const offset = (page - 1) * pageSize;
    const conditions = ['so.customer_id = ?'];
    const params = [customerId];

    if (status) {
      conditions.push('LOWER(so.status) = ?');
      params.push(String(status).toLowerCase());
    }
    if (search) {
      conditions.push('(so.order_number LIKE ? OR c.name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (dateFrom) {
      conditions.push('so.orderDate >= ?');
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push('so.orderDate <= ?');
      params.push(dateTo);
    }

    const whereClause = conditions.join(' AND ');
    const countRow = await getOne(`SELECT COUNT(*) as total FROM sales_orders so LEFT JOIN customers c ON so.customer_id = c.id WHERE ${whereClause}`, params);
    const total = countRow?.total || 0;

    const rows = await getAll(
      `SELECT so.id, so.order_number, so.orderDate, c.name as customerName, so.total as totalAmount, so.status,
              so.source_request_id, so.source_request_number, so.reorder_of, so.reorder_of_number,
              so.deliveryDate, so.approved_at, so.items as items_json,
              so.tracking_number, so.carrier, so.driver_name, so.vehicle_no,
              so.estimated_delivery, so.actual_arrival, so.current_location, so.proof_of_delivery, so.shipping_address
       FROM sales_orders so
       LEFT JOIN customers c ON so.customer_id = c.id
       WHERE ${whereClause}
       ORDER BY so.orderDate DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return { orders: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) || 1 };
  },

  async getOrderById(orderId, customerId) {
    const order = await getOne(
      `SELECT so.*, c.name as customerName
       FROM sales_orders so
       LEFT JOIN customers c ON so.customer_id = c.id
       WHERE so.id = ? AND so.customer_id = ?`,
      [orderId, customerId]
    );
    if (!order) return null;
    order.items = parseJson(order.items, []).map((item) => {
      const price = Number(item.price ?? item.unitPrice ?? item.unit_price ?? 0);
      const quantity = Number(item.quantity ?? 1);
      const lineTotal = Number(item.lineTotal ?? item.line_total ?? (price * quantity));
      return {
        name: item.name || item.productName || item.product_name || item.description || 'Item',
        quantity,
        unitPrice: price,
        lineTotal
      };
    });
    return order;
  },

  async getQuotations(customerId) {
    return portalLifecycleService.getQuotations({ customerId});
  },

  async getQuotationsPaginated(customerId, { page = 1, pageSize = 20, status, search } = {}) {
    const offset = (page - 1) * pageSize;
    const conditions = ['q.customer_id = ?'];
    const params = [customerId];

    if (status) {
      conditions.push('LOWER(q.status) = ?');
      params.push(String(status).toLowerCase());
    }
    if (search) {
      conditions.push('(q.quotation_number LIKE ? OR q.customer_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = conditions.join(' AND ');
    const countRow = await getOne(`SELECT COUNT(*) as total FROM quotations q WHERE ${whereClause}`, params);
    const total = countRow?.total || 0;

    const rows = await getAll(
      `SELECT q.*, c.name AS resolved_customer_name
       FROM quotations q
       LEFT JOIN customers c ON c.id = q.customer_id
       WHERE ${whereClause}
       ORDER BY q.created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return {
      quotations: rows.map((r) => ({
        ...r,
        customer_name: r.resolved_customer_name || r.customer_name,
        items: parseJson(r.items, []),
      })),
      total, page, pageSize, totalPages: Math.ceil(total / pageSize) || 1,
    };
  },

async getInvoices(customerId) {
    const invoices = await getAllFrom('invoices', { 'data->>customerId': `eq.${customerId}` });
    return invoices.map((i) => ({
      id: i.id,
      invoice_number: i.invoice_number,
      customer_name: i.customer_name,
      total_amount: i.total_amount,
      paid_amount: i.paid_amount,
      status: i.status,
      due_date: i.due_date,
      created_at: i.created_at,
    }));
  },

  async getInvoicesPaginated(customerId, { page = 1, pageSize = 20, status, search, dateFrom, dateTo } = {}) {
    const offset = (page - 1) * pageSize;

    try {
      const cloudInvoices = await supabaseStore.listInvoices(customerId);
      if (Array.isArray(cloudInvoices) && cloudInvoices.length > 0) {
        let filtered = cloudInvoices.map((i) => ({
          id: i.id,
          invoice_number: i.invoice_number,
          customer_name: i.customer_name,
          total_amount: i.total_amount,
          paid_amount: i.paid_amount,
          status: i.status,
          due_date: i.due_date,
          created_at: i.created_at,
        }));
        if (status) {
          const lowerStatus = String(status).toLowerCase();
          filtered = filtered.filter((inv) => String(inv.status || '').toLowerCase() === lowerStatus);
        }
        if (search) {
          const lowerSearch = String(search).toLowerCase();
          filtered = filtered.filter((inv) =>
            String(inv.invoice_number || '').toLowerCase().includes(lowerSearch) ||
            String(inv.customer_name || '').toLowerCase().includes(lowerSearch)
          );
        }
        return {
          invoices: filtered.slice(offset, offset + pageSize),
          total: filtered.length,
          page,
          pageSize,
          totalPages: Math.ceil(filtered.length / pageSize) || 1,
        };
      }
    } catch (err) {
      console.warn('[PortalService] Cloud invoices unavailable, using local:', err.message);
    }

    const conditions = ['i.customer_id = ?'];
    const params = [customerId];

    if (status) {
      conditions.push('LOWER(i.status) = ?');
      params.push(String(status).toLowerCase());
    }
    if (search) {
      conditions.push('(i.invoice_number LIKE ? OR i.customer_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (dateFrom) {
      conditions.push('i.created_at >= ?');
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push('i.created_at <= ?');
      params.push(dateTo);
    }

    const whereClause = conditions.join(' AND ');
    const countRow = await getOne(`SELECT COUNT(*) as total FROM invoices i WHERE ${whereClause}`, params);
    const total = countRow?.total || 0;

    const rows = await getAll(
      `SELECT id, invoice_number, customer_name, total_amount,
        COALESCE((SELECT SUM(pal.amount) FROM payment_allocation_lines pal JOIN payment_allocations pa ON pa.id = pal.allocation_id WHERE pal.invoice_id = i.id AND pa.reversed = 0), 0) as paid_amount,
        status, due_date, created_at
       FROM invoices i
       WHERE ${whereClause}
       ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return { invoices: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) || 1 };
  },

  async getInvoiceById(invoiceId, customerId) {
    try {
      const cloud = await supabaseStore.getInvoice(invoiceId, customerId);
      if (cloud) return cloud;
    } catch (err) {
      console.warn('[PortalService] Cloud invoice unavailable, using local:', err.message);
    }
    const invoice = await getOne(
      'SELECT * FROM invoices WHERE id = ? AND customer_id = ?',
      [invoiceId, customerId]
    );
    if (!invoice) return null;
    invoice.line_items = parseJson(invoice.line_items_json, []);
    delete invoice.line_items_json;
    return invoice;
  },

  async getPayments(customerId) {
    const payments = await getAllFrom('customer_payments', { 'data->>customerId': `eq.${customerId}` });
    return payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      payment_method: p.method,
      date: p.date,
      reference: p.reference,
    }));
  },

  async getPaymentsPaginated(customerId, { page = 1, pageSize = 20, search, dateFrom, dateTo } = {}) {
    const offset = (page - 1) * pageSize;
    const conditions = ['cp.customer_id = ?'];
    const params = [customerId];

    if (search) {
      conditions.push('(cp.reference LIKE ? OR cp.method LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (dateFrom) {
      conditions.push('cp.date >= ?');
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push('cp.date <= ?');
      params.push(dateTo);
    }

    const whereClause = conditions.join(' AND ');
    const countRow = await getOne(`SELECT COUNT(*) as total FROM customer_payments cp WHERE ${whereClause}`, params);
    const total = countRow?.total || 0;

    const rows = await getAll(
      `SELECT id, amount, method as payment_method, date, reference
       FROM customer_payments cp
       WHERE ${whereClause}
       ORDER BY cp.date DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return { payments: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) || 1 };
  },

  async getPaymentById(paymentId, customerId) {
    const payment = await getOne(
      'SELECT * FROM customer_payments WHERE id = ? AND customer_id = ?',
      [paymentId, customerId]
    );
    if (!payment) return null;

    const allocations = await getAll(
      `SELECT pal.*, i.invoice_number, i.total_amount
       FROM payment_allocations pa
       JOIN payment_allocation_lines pal ON pal.allocation_id = pa.id
       LEFT JOIN invoices i ON pal.invoice_id = i.id
       WHERE pa.payment_id = ?`,
      [paymentId]
    );
    payment.allocations = allocations || [];
    return payment;
  },

  async getStatements(customerId, startDate, endDate) {
    let openingBalance = 0;

    if (startDate) {
      const openingRow = await getOne(
        `SELECT COALESCE(SUM(amount), 0) as balance FROM (
          SELECT total_amount as amount FROM invoices
          WHERE customer_id = ? AND created_at < ?
          UNION ALL
          SELECT -amount as amount FROM customer_payments
          WHERE customer_id = ? AND date < ?
        )`,
        [customerId, startDate, customerId, startDate]
      );
      openingBalance = Number((openingRow && openingRow.balance) || 0);
    }

    let invoiceWhere = 'customer_id = ?';
    let paymentWhere = 'customer_id = ?';
    const params = [customerId, customerId];

    if (startDate) {
      invoiceWhere += ' AND created_at >= ?';
      paymentWhere += ' AND date >= ?';
      params.push(startDate, startDate);
    }
    if (endDate) {
      invoiceWhere += ' AND created_at <= ?';
      paymentWhere += ' AND date <= ?';
      params.push(endDate, endDate);
    }

    const transactions = await getAll(
      `SELECT date, description, debit, credit FROM (
        SELECT created_at as date, COALESCE(invoice_number, 'Invoice') as description, total_amount as debit, 0 as credit
        FROM invoices WHERE ${invoiceWhere}
        UNION ALL
        SELECT date, COALESCE(reference, 'Payment') as description, 0 as debit, amount as credit
        FROM customer_payments WHERE ${paymentWhere}
      ) ORDER BY date ASC`,
      params
    );

    // Merge real ERP invoices from Supabase so the statement reflects cloud data
    try {
      const cloudInvoices = await supabaseStore.listInvoices(customerId);
      if (Array.isArray(cloudInvoices) && cloudInvoices.length > 0) {
        for (const inv of cloudInvoices) {
          if (startDate && String(inv.created_at || '') < startDate) continue;
          if (endDate && String(inv.created_at || '') > endDate) continue;
          transactions.push({
            date: inv.created_at,
            description: `Invoice ${inv.invoice_number || inv.id}`,
            debit: inv.total_amount,
            credit: 0,
          });
        }
        transactions.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      }
    } catch (err) {
      console.warn('[PortalService] Cloud invoices unavailable for statement:', err.message);
    }

    let running = openingBalance;
    const mapped = (transactions || []).map(t => {
      const debit = Number(t.debit) || 0;
      const credit = Number(t.credit) || 0;
      running = running + debit - credit;
      return {
        date: t.date,
        description: t.description || '',
        debit,
        credit,
        balance: running
      };
    });

    return {
      opening_balance: openingBalance,
      closing_balance: mapped.length > 0 ? mapped[mapped.length - 1].balance : openingBalance,
      transactions: mapped
    };
  },

  async getLoyalty(customerId) {
    const [points, cashback, pointsHistory, tier] = await Promise.all([
      repo.getById('engagement_point_balances', customerId),
      getAllFrom('engagement_cashback', { 'data->>customerId': `eq.${customerId}`, 'data->>status': `eq.approved` }),
      getAllFrom('engagement_points', { 'data->>customerId': `eq.${customerId}` }),
      repo.getById('engagement_customer_tiers', customerId),
    ]);

    const totalCashback = (cashback || []).reduce((sum, c) => sum + Number(c.amount || 0), 0);

    return {
      points: (points && points.balance) || 0,
      cashback: totalCashback,
      tier: (tier && tier.tier_name) || 'Standard',
      pointsHistory: pointsHistory || []
    };
  },

  async getWallet(customerId) {
    const customer = await repo.getById('customers', customerId);
    const rewards = await getAllFrom('referral_rewards', { 'data->>customerId': `eq.${customerId}`, 'data->>status': `eq.approved` });
    const cashback = await getAllFrom('engagement_cashback', { 'data->>customerId': `eq.${customerId}`, 'data->>status': `eq.approved` });
    const walletPayments = await getAllFrom('customer_payments', { 'data->>customerId': `eq.${customerId}` });

    const transactions = [
      ...(rewards || []).map((r) => ({ date: r.approved_at, amount: Number(r.amount) || 0, type: 'credit', reference: 'Referral reward' })),
      ...(cashback || []).map((c) => ({ date: c.approved_at, amount: Number(c.amount) || 0, type: 'credit', reference: 'Cashback' })),
      ...(walletPayments || []).filter((p) => String(p.method || '').toLowerCase() === 'wallet' && String(p.status || '').toLowerCase() !== 'voided')
        .map((p) => ({ date: p.date, amount: -(Number(p.amount) || 0), type: 'debit', reference: p.reference || 'Wallet payment' })),
    ].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

    return {
      balance: (customer && customer.walletBalance != null) ? customer.walletBalance : 0,
      transactions
    };
  },

  async getProfile(customerId) {
    const cloud = await repo.getById('customers', customerId);
    if (!cloud) return null;
    return {
      id: cloud.id,
      full_name: cloud.name || '',
      email: cloud.email || '',
      phone: cloud.phone || '',
      address: cloud.address || '',
      city: cloud.city || '',
      state: cloud.state || '',
      zip: cloud.zip || '',
      country: cloud.country || '',
      balance: Number(cloud.balance) || 0,
      walletBalance: Number(cloud.walletBalance) || 0,
      creditLimit: Number(cloud.creditLimit) || 0,
      outstandingBalance: Number(cloud.outstandingBalance) || 0,
      status: cloud.status || ''
    };
  },

  async getDocuments(customerId) {
    const invoices = await getAllFrom('invoices', { 'data->>customerId': `eq.${customerId}` });
    return invoices.map((inv) => ({
      id: inv.id,
      type: inv.status && /paid|fulfilled/i.test(String(inv.status || '')) ? 'receipt' : 'invoice',
      title: `${inv.invoice_number || inv.id} (${inv.status || 'Draft'})`,
      date: inv.created_at,
      url: `#/portal/invoices/${inv.id}`,
      amount: inv.total_amount,
    }));
  },

  async getNotifications(portalUserId) {
    return getAllFrom('portal_notifications', { 'data->>portalUserId': `eq.${portalUserId}` });
  },

  async getUnreadNotificationCount(portalUserId) {
    const rows = await getAllFrom('portal_notifications', { 'data->>portalUserId': `eq.${portalUserId}`, 'data->>isRead': `eq.false` });
    return rows.length;
  },

  async markNotificationRead(notificationId, portalUserId) {
    const row = await repo.getById('portal_notifications', notificationId);
    if (row && row.portalUserId === portalUserId) {
      await repo.upsert('portal_notifications', { ...row, isRead: true });
    }
  },

  async markAllNotificationsRead(portalUserId) {
    const rows = await getAllFrom('portal_notifications', { 'data->>portalUserId': `eq.${portalUserId}`, 'data->>isRead': `eq.false` });
    for (const row of rows) {
      await repo.upsert('portal_notifications', { ...row, isRead: true });
    }
  },

  // ─── Referrals ──────────────────────────────────────────────────
  async getReferrals(portalUserId, customerId, { page = 1, pageSize = 20, status, search, sort = 'date_desc' } = {}) {
    const offset = (page - 1) * pageSize;
    const conditions = ['r.referred_by_id = ?', 'r.deleted_at IS NULL'];
    const params = [customerId];

    if (status) {
      conditions.push('r.status = ?');
      params.push(status);
    }

    if (search) {
      conditions.push('c.name LIKE ?');
      params.push(`%${search}%`);
    }

    const whereClause = conditions.join(' AND ');
    const allowedSorts = {
      date_desc: 'r.created_at DESC',
      date_asc: 'r.created_at ASC',
      status: 'r.status ASC',
    };
    const orderBy = allowedSorts[sort] || allowedSorts.date_desc;

    const countRow = await getOne(
      `SELECT COUNT(*) as total FROM customer_referrals r
       LEFT JOIN customers c ON c.id = r.customer_id
       WHERE ${whereClause}`,
      params
    );
    const total = countRow?.total || 0;

    const referrals = await getAll(
      `SELECT r.*, c.name as referred_customer_name, c.email as referred_customer_email
       FROM customer_referrals r
       LEFT JOIN customers c ON c.id = r.customer_id
       WHERE ${whereClause}
       ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return {
      referrals: referrals.map(r => ({
        id: r.id,
        referredCustomerId: r.customer_id,
        referredCustomerName: r.referred_customer_name || r.customer_id,
        referredCustomerEmail: r.referred_customer_email || null,
        status: r.status,
        pendingInvoiceId: r.pending_invoice_id,
        pendingInvoiceAmount: r.pending_invoice_amount || 0,
        convertedInvoiceId: r.converted_invoice_id,
        convertedAt: r.converted_at,
        notes: r.notes,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  },

  async getReferralById(id, portalUserId, customerId) {
    const referral = await getOne(
      `SELECT r.*, c.name as referred_customer_name, c.email as referred_customer_email
       FROM customer_referrals r
       LEFT JOIN customers c ON c.id = r.customer_id
       WHERE r.id = ?r.deleted_at IS NULL`,
      [id]
    );
    if (!referral || referral.referred_by_id !== customerId) return null;
    return {
      id: referral.id,
      referredCustomerId: referral.customer_id,
      referredCustomerName: referral.referred_customer_name || referral.customer_id,
      referredCustomerEmail: referral.referred_customer_email || null,
      status: referral.status,
      pendingInvoiceId: referral.pending_invoice_id,
      pendingInvoiceAmount: referral.pending_invoice_amount || 0,
      convertedInvoiceId: referral.converted_invoice_id,
      convertedAt: referral.converted_at,
      notes: referral.notes,
      createdAt: referral.created_at,
      updatedAt: referral.updated_at,
    };
  },

  async getReferralTimeline(referralId) {
    return getAll(
      'SELECT * FROM referral_timeline WHERE referral_id = ? ORDER BY timestamp ASC',
      [referralId]
    );
  },

  async getReferralRewards(portalUserId, customerId, { page = 1, pageSize = 20, status } = {}) {
    const offset = (page - 1) * pageSize;
    const conditions = ['rr.customer_id = ?'];
    const params = [customerId];

    if (status) {
      conditions.push('rr.status = ?');
      params.push(status);
    }

    const whereClause = conditions.join(' AND ');
    const countRow = await getOne(
      `SELECT COUNT(*) as total FROM referral_rewards rr WHERE ${whereClause}`,
      params
    );
    const total = countRow?.total || 0;

    const rewards = await getAll(
      `SELECT rr.*, r.referral_code, r.customer_id as referred_customer_id,
              c.name as referred_customer_name
       FROM referral_rewards rr
       JOIN customer_referrals r ON r.id = rr.referral_id
       LEFT JOIN customers c ON c.id = r.customer_id
       WHERE ${whereClause}
       ORDER BY rr.created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return {
      rewards: rewards.map(r => ({
        id: r.id,
        referralId: r.referral_id,
        referralCode: r.referral_code,
        referredCustomerId: r.referred_customer_id,
        referredCustomerName: r.referred_customer_name || r.referred_customer_id,
        invoiceId: r.invoice_id,
        invoiceAmount: r.invoice_amount || 0,
        amount: r.amount || 0,
        status: r.status,
        approvedAt: r.approved_at,
        cancelledAt: r.cancelled_at,
        cancelReason: r.cancel_reason,
        walletTransactionId: r.wallet_transaction_id,
        createdAt: r.created_at,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  },

  async getReferralSettings() {
    const settings = await referralService.getSettings();
    return {
      enabled: settings.enabled ?? true,
      rewardType: settings.rewardType || 'percentage',
      rewardValue: settings.rewardValue || 0,
      rewardPercentage: settings.rewardPercentage || 0,
      minimumPurchase: settings.minPurchaseAmount || 0,
      maxRewardAmount: settings.maxRewardAmount || 0,
      expiryDays: settings.expiryDays || 365,
      requireApproval: settings.requireApproval ?? true,
      shareMessage: 'Invite friends and earn rewards.',
    };
  },

  async createReferral(portalUserId, customerId, { referredCustomerId, notes }) {
    if (!referredCustomerId) {
      throw new Error('Referred customer is required');
    }
    if (referredCustomerId === customerId) {
      throw new Error('You cannot refer yourself');
    }

    const customer = await getOne(
      'SELECT id, name, email FROM customers WHERE id = ?',
      [referredCustomerId]
    );
    if (!customer) {
      throw new Error('Customer not found');
    }

    const existing = await getOne(
      'SELECT id FROM customer_referrals WHERE customer_id = ? AND referred_by_id = ? AND deleted_at IS NULL AND status IN (\'active\', \'converted\')',
      [referredCustomerId, customerId]
    );
    if (existing) {
      throw new Error('This customer has already been referred by you');
    }

    return referralService.register(
      {
        customer_id: referredCustomerId,
        referred_by_id: customerId,
        referred_by_name: customer.name,
        notes: notes || null,
      });
  },

  async searchCustomersForReferral( query, excludeCustomerId) {
    if (!query || query.trim().length < 2) return [];
    const like = `%${query.trim()}%`;
    return getAll(
      `SELECT id, name, email, phone FROM customers WHERE id != ? AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)
       ORDER BY name ASC LIMIT 20`,
      [excludeCustomerId, like, like, like]
    );
  },

  async getReferralFunnelStats(customerId) {
    const totalRow = await getOne(
      `SELECT COUNT(*) as count FROM customer_referrals WHERE referred_by_id = ? AND deleted_at IS NULL`,
      [customerId]
    );
    const total = totalRow?.count || 0;

    const activeRow = await getOne(
      `SELECT COUNT(*) as count FROM customer_referrals WHERE referred_by_id = ? AND status = 'active' AND deleted_at IS NULL`,
      [customerId]
    );
    const signedUp = activeRow?.count || 0;

    const qualifiedRow = await getOne(
      `SELECT COUNT(*) as count FROM customer_referrals WHERE referred_by_id = ? AND status = 'active' AND pending_invoice_id IS NOT NULL AND deleted_at IS NULL`,
      [customerId]
    );
    const qualified = qualifiedRow?.count || 0;

    const approvedRow = await getOne(
      `SELECT COUNT(*) as count FROM referral_rewards rr
       JOIN customer_referrals r ON r.id = rr.referral_id
       WHERE r.referred_by_id = ? AND rr.status IN ('approved', 'paid')`,
      [customerId]
    );
    const rewardApproved = approvedRow?.count || 0;

    const paidRow = await getOne(
      `SELECT COUNT(*) as count FROM referral_rewards rr
       JOIN customer_referrals r ON r.id = rr.referral_id
       WHERE r.referred_by_id = ? AND rr.status = 'paid'`,
      [customerId]
    );
    const paid = paidRow?.count || 0;

    const pendingAmountRow = await getOne(
      `SELECT COALESCE(SUM(rr.amount), 0) as amount FROM referral_rewards rr
       JOIN customer_referrals r ON r.id = rr.referral_id
       WHERE r.referred_by_id = ? AND rr.status = 'pending'`,
      [customerId]
    );
    const pendingRewardAmount = pendingAmountRow?.amount || 0;

    const totalEarnedRow = await getOne(
      `SELECT COALESCE(SUM(rr.amount), 0) as amount FROM referral_rewards rr
       JOIN customer_referrals r ON r.id = rr.referral_id
       WHERE r.referred_by_id = ? AND rr.status IN ('approved', 'paid')`,
      [customerId]
    );
    const totalEarned = totalEarnedRow?.amount || 0;

    return {
      total,
      signedUp,
      qualified,
      rewardApproved,
      paid,
      pendingRewardAmount,
      totalEarned,
      conversionRate: total > 0 ? Math.round((paid / total) * 100) : 0,
    };
  },

  async getSupportTickets(portalUserId, customerId) {
    return getAll(
      `SELECT pt.*,
        (SELECT message FROM portal_ticket_messages WHERE ticket_id = pt.id ORDER BY created_at DESC LIMIT 1) as latest_message
       FROM portal_tickets pt
       WHERE pt.portal_user_id = ? AND pt.customer_id = ?
       ORDER BY pt.created_at DESC`,
      [portalUserId, customerId]
    );
  },

  async createSupportTicket(portalUserId, customerId, { subject, message, priority }) {
    const id = genId('ptkt');
    await runQuery(
      `INSERT INTO portal_tickets (id, portal_user_id, customer_id, subject, message, priority)
       VALUES (?, ?, ?, ?, ?, ? )`,
      [id, portalUserId, customerId, subject, message, priority || 'normal']
    );

    const msgId = genId('pmsg');
    await runQuery(
      `INSERT INTO portal_ticket_messages (id, ticket_id, sender_type, message)
       VALUES (?, ?, 'customer', ?)`,
      [msgId, id, message]
    );

    return { id, subject, message, priority: priority || 'normal' };
  },

  async addTicketMessage(ticketId, portalUserId, message) {
    const id = genId('pmsg');
    await runQuery(
      `INSERT INTO portal_ticket_messages (id, ticket_id, sender_type, message)
       VALUES (?, ?, 'customer', ?)`,
      [id, ticketId, message]
    );

    await runQuery(
      "UPDATE portal_tickets SET updated_at = datetime('now') WHERE id = ?",
      [ticketId]
    );

    return { id, ticket_id: ticketId, message };
  },

  async updateTicketStatus(ticketId, portalUserId, status) {
    const result = await runQuery(
      `UPDATE portal_tickets SET status = ?, updated_at = datetime('now')
       WHERE id = ? AND portal_user_id = ?`,
      [status, ticketId, portalUserId]
    );
    if (result.changes === 0) {
      throw new Error('Ticket not found or access denied');
    }
    return { success: true, ticketId, status };
  },

  async uploadTicketAttachment(ticketId, portalUserId, file, messageId) {
    // Verify ticket belongs to this user
    const ticket = await getOne(
      'SELECT id, customer_id FROM portal_tickets WHERE id = ? AND portal_user_id = ?',
      [ticketId, portalUserId]
    );
    if (!ticket) {
      throw new Error('Ticket not found or access denied');
    }

    const id = genId('tatt');
    const storagePath = file.filename;
    await runQuery(
      `INSERT INTO ticket_attachments (id, ticket_id, message_id, filename, original_name, mime_type, size_bytes, storage_path, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, ticketId, messageId || null, storagePath, file.originalname, file.mimetype, file.size, storagePath, portalUserId]
    );

    return {
      id,
      ticket_id: ticketId,
      message_id: messageId || null,
      filename: storagePath,
      original_name: file.originalname,
      mime_type: file.mimetype,
      size_bytes: file.size,
      uploaded_by: portalUserId,
      created_at: new Date().toISOString(),
    };
  },

  async getTicketAttachment(attachmentId, customerId) {
    const attachment = await getOne(
      `SELECT ta.* FROM ticket_attachments ta
       JOIN portal_tickets pt ON pt.id = ta.ticket_id
       WHERE ta.id = ? AND pt.customer_id = ?`,
      [attachmentId, customerId]
    );
    return attachment || null;
  },

  async deleteTicketAttachment(attachmentId, portalUserId, customerId) {
    // Verify the attachment belongs to a ticket this customer owns
    const attachment = await getOne(
      `SELECT ta.id, ta.ticket_id, ta.filename, ta.uploaded_by
       FROM ticket_attachments ta
       JOIN portal_tickets pt ON pt.id = ta.ticket_id
       WHERE ta.id = ? AND pt.customer_id = ?`,
      [attachmentId, customerId]
    );
    if (!attachment) {
      throw new Error('Attachment not found or access denied');
    }

    // Delete the file from disk
    const filePath = path.join(TICKET_ATTACHMENTS_DIR, attachment.filename);
    try {
      await fs.promises.unlink(filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[Portal] Error deleting attachment file:', err.message);
      }
    }

    // Delete the database record
    await runQuery('DELETE FROM ticket_attachments WHERE id = ?', [attachmentId]);

    return { success: true, attachmentId };
  },

  async getShipments(customerId, { status, search } = {}) {
    let sql = `SELECT * FROM (
               SELECT so.id, so.order_number, so.orderDate, so.customer_id, so.status as order_status,
                      so.tracking_number, so.carrier, so.driver_name, so.vehicle_no,
                      so.estimated_delivery, so.actual_arrival, so.current_location,
                      so.proof_of_delivery, so.shipping_address, so.items as items_json,
                      c.name as customerName
               FROM sales_orders so
               LEFT JOIN customers c ON so.customer_id = c.id
               WHERE so.customer_id = ? AND so.tracking_number IS NOT NULL AND TRIM(so.tracking_number) != ''
               UNION ALL
               SELECT dn.id, NULL as order_number, dn.delivery_date as orderDate, dn.customer_id,
                      dn.status as order_status, dn.tracking_number, NULL as carrier, NULL as driver_name,
                      NULL as vehicle_no, NULL as estimated_delivery, NULL as actual_arrival,
                      NULL as current_location, NULL as proof_of_delivery, NULL as shipping_address,
                      dn.items_json, c2.name as customerName
               FROM delivery_notes dn
               LEFT JOIN customers c2 ON dn.customer_id = c2.id
               WHERE dn.customer_id = ? AND dn.tracking_number IS NOT NULL AND TRIM(dn.tracking_number) != ''
                 AND NOT EXISTS (SELECT 1 FROM sales_orders so2 WHERE so2.id = dn.order_id AND so2.tracking_number IS NOT NULL AND TRIM(so2.tracking_number) != '')
               ) t`;
    const params = [customerId, customerId];
    if (status) {
      sql += ` WHERE LOWER(t.order_status) = ?`;
      params.push(String(status).toLowerCase());
    }
    if (search) {
      sql += status ? ` AND` : ` WHERE`;
      sql += ` (t.order_number LIKE ? OR t.tracking_number LIKE ? OR t.customerName LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    sql += ` ORDER BY t.orderDate DESC`;
    return getAll(sql, params);
  },

  async getShipmentById(shipmentId, customerId) {
    const row = await getOne(
      `SELECT so.*, c.name as customerName
       FROM sales_orders so
       LEFT JOIN customers c ON so.customer_id = c.id
       WHERE so.id = ? AND so.customer_id = ? AND so.tracking_number IS NOT NULL AND TRIM(so.tracking_number) != ''`,
      [shipmentId, customerId]
    );
    if (row) return row;
    return getOne(
      `SELECT dn.id, dn.id as shipment_number, dn.customer_id, dn.customer_name as customerName,
              dn.status as order_status, dn.tracking_number, dn.delivery_date as estimated_delivery,
              dn.items_json as items_json, dn.notes
       FROM delivery_notes dn
       WHERE dn.id = ? AND dn.customer_id = ? AND dn.tracking_number IS NOT NULL AND TRIM(dn.tracking_number) != ''`,
      [shipmentId, customerId]
    );
  },

};

module.exports = portalService;
