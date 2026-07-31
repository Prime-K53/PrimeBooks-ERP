const { db } = require('../db.cjs');
const crypto = require('crypto');

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

  async getDashboard(portalUserId, customerId, companyId) {
    const customer = await getOne(
      'SELECT balance, walletBalance, outstandingBalance FROM customers WHERE id = ? AND company_id = ?',
      [customerId, companyId]
    );

    const invoiceCount = await getOne(
      "SELECT COUNT(*) as count FROM invoices WHERE customer_id = ? AND company_id = ? AND LOWER(COALESCE(status, '')) NOT IN ('paid', 'voided', 'cancelled')",
      [customerId, companyId]
    );

    const ordersRow = await getOne(
      'SELECT COUNT(*) as count FROM sales_orders WHERE customer_id = ? AND company_id = ?',
      [customerId, companyId]
    );

    const recentSales = await getAll(
      `SELECT date, total_amount as amount, customer_name as description, 'sale' as type
       FROM sales WHERE customer_id = ? AND company_id = ? AND status != 'Voided'
       ORDER BY date DESC LIMIT 5`,
      [customerId, companyId]
    );

    const recentPayments = await getAll(
      `SELECT date, amount, COALESCE(reference, 'Payment') as description, 'payment' as type
       FROM customer_payments WHERE customer_id = ? AND company_id = ?
       ORDER BY date DESC LIMIT 5`,
      [customerId, companyId]
    );

    const combined = [...recentSales, ...recentPayments]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5);

    return {
      balance: (customer && customer.balance) || 0,
      walletBalance: (customer && customer.walletBalance) || 0,
      outstandingBalance: (customer && customer.outstandingBalance) || 0,
      activeInvoiceCount: (invoiceCount && invoiceCount.count) || 0,
      totalOrders: (ordersRow && ordersRow.count) || 0,
      recentTransactions: combined
    };
  },

  async getOrders(customerId, companyId) {
    return getAll(
      `SELECT so.id, so.orderDate, c.name as customerName, so.total as totalAmount, so.status, so.items as items_json
       FROM sales_orders so
       LEFT JOIN customers c ON so.customer_id = c.id
       WHERE so.customer_id = ? AND so.company_id = ?
       ORDER BY so.orderDate DESC`,
      [customerId, companyId]
    );
  },

  async getOrderById(orderId, customerId, companyId) {
    const order = await getOne(
      `SELECT so.*, c.name as customerName
       FROM sales_orders so
       LEFT JOIN customers c ON so.customer_id = c.id
       WHERE so.id = ? AND so.customer_id = ? AND so.company_id = ?`,
      [orderId, customerId, companyId]
    );
    if (!order) return null;
    order.items = parseJson(order.items, []).map((item) => {
      const price = Number(item.price ?? item.unitPrice ?? item.unit_price ?? 0);
      const quantity = Number(item.quantity ?? 1);
      const lineTotal = Number(item.lineTotal ?? item.line_total ?? (price * quantity));
      return {
        name: item.name || item.productName || item.product_name || 'Item',
        quantity,
        unitPrice: price,
        lineTotal
      };
    });
    return order;
  },

  async getQuotations(customerId, companyId) {
    return [];
  },

  async getInvoices(customerId, companyId) {
    return getAll(
      `SELECT id, invoice_number, customer_name, total_amount, COALESCE(paid_amount, 0) as paid_amount, status, due_date, created_at
       FROM invoices
       WHERE customer_id = ? AND company_id = ?
       ORDER BY created_at DESC`,
      [customerId, companyId]
    );
  },

  async getInvoiceById(invoiceId, customerId, companyId) {
    const invoice = await getOne(
      'SELECT * FROM invoices WHERE id = ? AND customer_id = ? AND company_id = ?',
      [invoiceId, customerId, companyId]
    );
    if (!invoice) return null;
    invoice.line_items = parseJson(invoice.line_items_json, []);
    delete invoice.line_items_json;
    return invoice;
  },

  async getPayments(customerId, companyId) {
    return getAll(
      `SELECT id, amount, method as payment_method, date, reference
       FROM customer_payments
       WHERE customer_id = ? AND company_id = ?
       ORDER BY date DESC`,
      [customerId, companyId]
    );
  },

  async getPaymentById(paymentId, customerId, companyId) {
    const payment = await getOne(
      'SELECT * FROM customer_payments WHERE id = ? AND customer_id = ? AND company_id = ?',
      [paymentId, customerId, companyId]
    );
    if (!payment) return null;

    const allocations = await getAll(
      `SELECT pal.*, i.invoice_number, i.total_amount, COALESCE(i.paid_amount, 0) as paid_amount
       FROM payment_allocations pa
       JOIN payment_allocation_lines pal ON pal.allocation_id = pa.id
       LEFT JOIN invoices i ON pal.invoice_id = i.id
       WHERE pa.payment_id = ? AND pa.company_id = ?`,
      [paymentId, companyId]
    );
    payment.allocations = allocations || [];
    return payment;
  },

  async getStatements(customerId, companyId, startDate, endDate) {
    let openingBalance = 0;

    if (startDate) {
      const openingRow = await getOne(
        `SELECT COALESCE(SUM(amount), 0) as balance FROM (
          SELECT total_amount as amount FROM invoices
          WHERE customer_id = ? AND company_id = ? AND created_at < ?
          UNION ALL
          SELECT -amount as amount FROM customer_payments
          WHERE customer_id = ? AND company_id = ? AND date < ?
        )`,
        [customerId, companyId, startDate, customerId, companyId, startDate]
      );
      openingBalance = Number((openingRow && openingRow.balance) || 0);
    }

    let invoiceWhere = 'customer_id = ? AND company_id = ?';
    let paymentWhere = 'customer_id = ? AND company_id = ?';
    const params = [customerId, companyId, customerId, companyId];

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

  async getLoyalty(customerId, companyId) {
    const points = await getOne(
      'SELECT * FROM engagement_point_balances WHERE customer_id = ? AND company_id = ?',
      [customerId, companyId]
    );

    const cashback = await getAll(
      "SELECT * FROM engagement_cashback WHERE customer_id = ? AND company_id = ? AND status = 'approved'",
      [customerId, companyId]
    );

    const pointsHistory = await getAll(
      'SELECT * FROM engagement_points WHERE customer_id = ? AND company_id = ? ORDER BY created_at DESC LIMIT 20',
      [customerId, companyId]
    );

    const tier = await getOne(
      'SELECT * FROM engagement_customer_tiers WHERE customer_id = ? AND company_id = ?',
      [customerId, companyId]
    );

    const totalCashback = (cashback || []).reduce((sum, c) => sum + Number(c.amount || 0), 0);

    return {
      points: (points && points.balance) || 0,
      cashback: totalCashback,
      tier: (tier && tier.tier_name) || 'Standard',
      pointsHistory: pointsHistory || []
    };
  },

  async getWallet(customerId, companyId) {
    const customer = await getOne(
      'SELECT walletBalance FROM customers WHERE id = ? AND company_id = ?',
      [customerId, companyId]
    );

    const rewards = await getAll(
      `SELECT approved_at as date, amount, 'Referral reward' as reference
       FROM referral_rewards
       WHERE customer_id = ? AND company_id = ? AND status = 'approved'
       ORDER BY approved_at DESC`,
      [customerId, companyId]
    );

    const cashback = await getAll(
      `SELECT approved_at as date, amount, 'Cashback' as reference
       FROM engagement_cashback
       WHERE customer_id = ? AND company_id = ? AND status = 'approved'
       ORDER BY approved_at DESC`,
      [customerId, companyId]
    );

    const walletPayments = await getAll(
      `SELECT date, amount, COALESCE(reference, 'Wallet payment') as reference
       FROM customer_payments
       WHERE customer_id = ? AND company_id = ? AND LOWER(method) = 'wallet' AND status != 'Voided'
       ORDER BY date DESC`,
      [customerId, companyId]
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

  async getProfile(customerId, companyId) {
    return getOne(
      `SELECT id, name, email, phone, address, city, balance, walletBalance, creditLimit, outstandingBalance, status
       FROM customers WHERE id = ? AND company_id = ?`,
      [customerId, companyId]
    );
  },

  async getDocuments(customerId, companyId) {
    const invoices = await getAll(
      `SELECT id, invoice_number, created_at as date, status,
              COALESCE(total_amount, 0) as amount
       FROM invoices
       WHERE customer_id = ? AND company_id = ?
       ORDER BY created_at DESC`,
      [customerId, companyId]
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

  async getNotifications(portalUserId, companyId) {
    return getAll(
      'SELECT * FROM portal_notifications WHERE portal_user_id = ? AND company_id = ? ORDER BY created_at DESC',
      [portalUserId, companyId]
    );
  },

  async markNotificationRead(notificationId, portalUserId) {
    await runQuery(
      'UPDATE portal_notifications SET is_read = 1 WHERE id = ? AND portal_user_id = ?',
      [notificationId, portalUserId]
    );
  },

  async getSupportTickets(portalUserId, customerId, companyId) {
    return getAll(
      `SELECT pt.*,
        (SELECT message FROM portal_ticket_messages WHERE ticket_id = pt.id ORDER BY created_at DESC LIMIT 1) as latest_message
       FROM portal_tickets pt
       WHERE pt.portal_user_id = ? AND pt.customer_id = ? AND pt.company_id = ?
       ORDER BY pt.created_at DESC`,
      [portalUserId, customerId, companyId]
    );
  },

  async createSupportTicket(portalUserId, customerId, companyId, { subject, message, priority }) {
    const id = genId('ptkt');
    await runQuery(
      `INSERT INTO portal_tickets (id, portal_user_id, customer_id, subject, message, priority, company_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, portalUserId, customerId, subject, message, priority || 'normal', companyId]
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
  }

};

module.exports = portalService;
