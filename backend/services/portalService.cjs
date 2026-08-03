const { db } = require('../db.cjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const portalAuthService = require('./portalAuthService.cjs');
const portalLifecycleService = require('./portalLifecycleService.cjs');
const ReferralService = require('./referralService.cjs');
const referralService = new ReferralService();

const TICKET_ATTACHMENTS_DIR = path.join(__dirname, '..', 'storage', 'ticket-attachments');

function getOne(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

function getAll(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function runQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function genId(prefix = 'prt') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

const portalService = {

  async getDashboard(portalUserId, customerId) {
    const customer = await getOne(
      'SELECT balance, walletBalance, outstandingBalance FROM customers WHERE id = ?',
      [customerId]
    );

    const unpaidInvoiceCount = await getOne(
      "SELECT COUNT(*) as count FROM invoices WHERE customer_id = ? AND LOWER(COALESCE(status, '')) = 'unpaid'",
      [customerId]
    );

    const ordersRow = await getOne(
      'SELECT COUNT(*) as count FROM sales_orders WHERE customer_id = ?',
      [customerId]
    );

    const requestRow = await getOne(
      "SELECT COUNT(*) as count FROM quotation_requests WHERE customer_id = ? AND status IN ('submitted', 'assigned', 'under_review', 'waiting_for_customer', 'ready_for_conversion')",
      [customerId]
    );

    // Dashboard widgets (complete request architecture)
    const openQuotationRow = await getOne(
      "SELECT COUNT(*) as count FROM quotations WHERE customer_id = ? AND status IN ('ready', 'accepted', 'revision_requested')",
      [customerId]
    );

    const productionRow = await getOne(
      "SELECT COUNT(*) as count FROM sales_orders WHERE customer_id = ? AND LOWER(COALESCE(status, '')) IN ('confirmed', 'processing', 'pending', 'shipped')",
      [customerId]
    );

    const unreadRow = await getOne(
      'SELECT COUNT(*) as count FROM portal_notifications WHERE portal_user_id = ? AND is_read = 0',
      [portalUserId]
    );

    const recentDocs = await this.getRecentDocuments(customerId, 5);
    const recentTransactions = await this.getRecentTransactions(customerId, 5);

    return {
      balance: (customer && customer.balance) || 0,
      walletBalance: (customer && customer.walletBalance) || 0,
      outstandingBalance: (customer && customer.outstandingBalance) || 0,
      unpaidInvoiceCount: (unpaidInvoiceCount && unpaidInvoiceCount.count) || 0,
      totalOrders: (ordersRow && ordersRow.count) || 0,
      activeRequestCount: (requestRow && requestRow.count) || 0,
      openQuotationCount: (openQuotationRow && openQuotationRow.count) || 0,
      productionOrderCount: (productionRow && productionRow.count) || 0,
      unreadMessageCount: (unreadRow && unreadRow.count) || 0,
      recentDocuments: recentDocs,
      recentTransactions,
    };
  },

  async getCatalog(includeDeleted = false) {
    let sql = `SELECT
      id,
      name,
      sku,
      unit,
      selling_price as price,
      quantity,
      COALESCE(NULLIF(category_id, ''), material, 'General') as category,
      status
    FROM inventory
    WHERE 1=1`;
    const params = [];
    if (!includeDeleted) {
      sql += ' AND (status IS NULL OR LOWER(status) != ?)';
      params.push('deleted');
    }
    sql += ' ORDER BY name ASC';
    return getAll(sql, params);
  },

  async getRecentTransactions(customerId, limit = 5) {
    const recentSales = await getAll(
      `SELECT date, total_amount as amount, customer_name as description, 'sale' as type
       FROM sales WHERE customer_id = ? AND status != 'Voided'
       ORDER BY date DESC LIMIT ?`,
      [customerId, limit]
    );

    const recentPayments = await getAll(
      `SELECT date, amount, COALESCE(reference, 'Payment') as description, 'payment' as type
       FROM customer_payments WHERE customer_id = ?
       ORDER BY date DESC LIMIT ?`,
      [customerId, limit]
    );

    return [...recentSales, ...recentPayments]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, limit);
  },

  // Latest documents across the whole chain (requests, quotations, orders)
  async getRecentDocuments(customerId, limit = 5) {
    const requests = await getAll(
      `SELECT 'request' as docType, id, request_number as docNumber, status, request_type, created_at
       FROM quotation_requests WHERE customer_id = ?
       ORDER BY created_at DESC LIMIT ?`,
      [customerId, limit]
    );
    const quotations = await getAll(
      `SELECT 'quotation' as docType, id, quotation_number as docNumber, status, created_at
       FROM quotations WHERE customer_id = ?
       ORDER BY created_at DESC LIMIT ?`,
      [customerId, limit]
    );
    const orders = await getAll(
      `SELECT 'order' as docType, id, COALESCE(order_number, id) as docNumber, status, orderDate as created_at
       FROM sales_orders WHERE customer_id = ?
       ORDER BY orderDate DESC LIMIT ?`,
      [customerId, limit]
    );
    return [...requests, ...quotations, ...orders]
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .slice(0, limit);
  },

  async getRequestsPaginated(customerId, { page = 1, pageSize = 20, status, search } = {}) {
    const offset = (page - 1) * pageSize;
    const conditions = ['q.customer_id = ?', 'q.'];
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
    return getAll(
      `SELECT so.id, so.order_number, so.orderDate, c.name as customerName, so.total as totalAmount, so.status,
              so.source_request_id, so.source_request_number, so.reorder_of, so.reorder_of_number,
              so.deliveryDate, so.approved_at, so.items as items_json,
              so.tracking_number, so.carrier, so.driver_name, so.vehicle_no,
              so.estimated_delivery, so.actual_arrival, so.current_location, so.proof_of_delivery, so.shipping_address
       FROM sales_orders so
       LEFT JOIN customers c ON so.customer_id = c.id
       WHERE so.customer_id = ?
       ORDER BY so.orderDate DESC`,
      [customerId]
    );
  },

  async getOrdersPaginated(customerId, { page = 1, pageSize = 20, status, search, dateFrom, dateTo } = {}) {
    const offset = (page - 1) * pageSize;
    const conditions = ['so.customer_id = ?', 'so.'];
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
    const conditions = ['q.customer_id = ?', 'q.'];
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
    return getAll(
      `SELECT id, invoice_number, customer_name, total_amount,
        COALESCE((SELECT SUM(pal.amount) FROM payment_allocation_lines pal JOIN payment_allocations pa ON pa.id = pal.allocation_id WHERE pal.invoice_id = invoices.id AND pa.reversed = 0), 0) as paid_amount,
        status, due_date, created_at
       FROM invoices
       WHERE customer_id = ?
       ORDER BY created_at DESC`,
      [customerId]
    );
  },

  async getInvoicesPaginated(customerId, { page = 1, pageSize = 20, status, search, dateFrom, dateTo } = {}) {
    const offset = (page - 1) * pageSize;
    const conditions = ['i.customer_id = ?', 'i.'];
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
    return getAll(
      `SELECT id, amount, method as payment_method, date, reference
       FROM customer_payments
       WHERE customer_id = ?
       ORDER BY date DESC`,
      [customerId]
    );
  },

  async getPaymentsPaginated(customerId, { page = 1, pageSize = 20, search, dateFrom, dateTo } = {}) {
    const offset = (page - 1) * pageSize;
    const conditions = ['cp.customer_id = ?', 'cp.'];
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
    const points = await getOne(
      'SELECT * FROM engagement_point_balances WHERE customer_id = ?',
      [customerId]
    );

    const cashback = await getAll(
      "SELECT * FROM engagement_cashback WHERE customer_id = ? AND status = 'approved'",
      [customerId]
    );

    const pointsHistory = await getAll(
      'SELECT * FROM engagement_points WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20',
      [customerId]
    );

    const tier = await getOne(
      'SELECT * FROM engagement_customer_tiers WHERE customer_id = ?',
      [customerId]
    );

    const totalCashback = (cashback || []).reduce((sum, c) => sum + Number(c.amount || 0), 0);

    return {
      points: (points && points.balance) || 0,
      cashback: totalCashback,
      tier: (tier && tier.tier_name) || 'Standard',
      pointsHistory: pointsHistory || []
    };
  },

  async getWallet(customerId) {
    const customer = await getOne(
      'SELECT walletBalance FROM customers WHERE id = ?',
      [customerId]
    );

    const rewards = await getAll(
      `SELECT approved_at as date, amount, 'Referral reward' as reference
       FROM referral_rewards
       WHERE customer_id = ? AND status = 'approved'
       ORDER BY approved_at DESC`,
      [customerId]
    );

    const cashback = await getAll(
      `SELECT approved_at as date, amount, 'Cashback' as reference
       FROM engagement_cashback
       WHERE customer_id = ? AND status = 'approved'
       ORDER BY approved_at DESC`,
      [customerId]
    );

    const walletPayments = await getAll(
      `SELECT date, amount, COALESCE(reference, 'Wallet payment') as reference
       FROM customer_payments
       WHERE customer_id = ? AND LOWER(method) = 'wallet' AND status != 'Voided'
       ORDER BY date DESC`,
      [customerId]
    );

    const transactions = [
      ...(rewards || []).map((r) => ({ date: r.date, amount: Number(r.amount) || 0, type: 'credit', reference: r.reference })),
      ...(cashback || []).map((c) => ({ date: c.date, amount: Number(c.amount) || 0, type: 'credit', reference: c.reference })),
      ...(walletPayments || []).map((p) => ({ date: p.date, amount: -(Number(p.amount) || 0), type: 'debit', reference: p.reference })),
    ].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

    return {
      balance: (customer && customer.walletBalance) || 0,
      transactions
    };
  },

  async getProfile(customerId) {
    const local = await getOne(
      `SELECT id, name, email, phone, address, city, balance, walletBalance, creditLimit, outstandingBalance, status
       FROM customers WHERE id = ?`,
      [customerId]
    );
    if (local) {
      return {
        id: local.id,
        full_name: local.name || '',
        email: local.email || '',
        phone: local.phone || '',
        address: local.address || '',
        city: local.city || '',
        state: '',
        zip: '',
        country: '',
        balance: local.balance || 0,
        walletBalance: local.walletBalance || 0,
        creditLimit: local.creditLimit || 0,
        outstandingBalance: local.outstandingBalance || 0,
        status: local.status || ''
      };
    }
    const cloud = await portalAuthService.findCustomerInSupabase(customerId);
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
    const invoices = await getAll(
      `SELECT id, invoice_number, created_at as date, status,
              COALESCE(total_amount, 0) as amount
       FROM invoices
       WHERE customer_id = ?
       ORDER BY created_at DESC`,
      [customerId]
    );

    return (invoices || []).map((inv) => ({
      id: inv.id,
      type: inv.status && /paid|fulfilled/i.test(String(inv.status)) ? 'receipt' : 'invoice',
      title: `${inv.invoice_number || inv.id} (${inv.status || 'Draft'})`,
      date: inv.date,
      url: `#/portal/invoices/${inv.id}`,
      amount: inv.amount
    }));
  },

  async getNotifications(portalUserId) {
    return getAll(
      'SELECT * FROM portal_notifications WHERE portal_user_id = ? ORDER BY created_at DESC',
      [portalUserId]
    );
  },

  async getUnreadNotificationCount(portalUserId) {
    const row = await getOne(
      'SELECT COUNT(*) as count FROM portal_notifications WHERE portal_user_id = ? AND is_read = 0',
      [portalUserId]
    );
    return (row && row.count) || 0;
  },

  async markNotificationRead(notificationId, portalUserId) {
    await runQuery(
      'UPDATE portal_notifications SET is_read = 1 WHERE id = ? AND portal_user_id = ?',
      [notificationId, portalUserId]
    );
  },

  async markAllNotificationsRead(portalUserId) {
    await runQuery(
      'UPDATE portal_notifications SET is_read = 1 WHERE portal_user_id = ? AND is_read = 0',
      [portalUserId]
    );
  },

  // ─── Referrals ──────────────────────────────────────────────────
  async getReferrals(portalUserId, customerId, { page = 1, pageSize = 20, status, search, sort = 'date_desc' } = {}) {
    const offset = (page - 1) * pageSize;
    const conditions = ['r.referred_by_id = ?', 'r.', 'r.deleted_at IS NULL'];
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
    const conditions = ['rr.customer_id = ?', 'rr.'];
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
    let sql = `SELECT so.id, so.order_number, so.orderDate, so.customer_id, so.status as order_status,
                    so.tracking_number, so.carrier, so.driver_name, so.vehicle_no,
                    so.estimated_delivery, so.actual_arrival, so.current_location,
                    so.proof_of_delivery, so.shipping_address, so.items as items_json,
                    c.name as customerName
             FROM sales_orders so
             LEFT JOIN customers c ON so.customer_id = c.id
             WHERE so.customer_id = ? AND so.tracking_number IS NOT NULL AND TRIM(so.tracking_number) != ''`;
    const params = [customerId];
    if (status) {
      sql += ` AND LOWER(so.status) = ?`;
      params.push(String(status).toLowerCase());
    }
    if (search) {
      sql += ` AND (so.order_number LIKE ? OR so.tracking_number LIKE ? OR c.name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    sql += ` ORDER BY so.orderDate DESC`;
    return getAll(sql, params);
  },

  async getShipmentById(shipmentId, customerId) {
    return getOne(
      `SELECT so.*, c.name as customerName
       FROM sales_orders so
       LEFT JOIN customers c ON so.customer_id = c.id
       WHERE so.id = ? AND so.customer_id = ? AND so.tracking_number IS NOT NULL AND TRIM(so.tracking_number) != ''`,
      [shipmentId, customerId]
    );
  },

};

module.exports = portalService;
