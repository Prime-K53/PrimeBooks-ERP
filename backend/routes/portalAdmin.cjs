const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { db } = require('../db.cjs');
const portalAuthService = require('../services/portalAuthService.cjs');
const portalLifecycleService = require('../services/portalLifecycleService.cjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { canUseHeaderAuth, getHeaderAuthUser } = require('../middleware/auth.cjs');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const verifyAdminAuth = async (req, res, next) => {
  const headerUser = getHeaderAuthUser(req);
  if (headerUser && canUseHeaderAuth(req)) {
    req.user = headerUser;
    req.authMode = 'header';
    return next();
  }

  // Fallback: if ALLOW_HEADER_AUTH is enabled, trust header auth without loopback check
  // (safe for dev — ALLOW_HEADER_AUTH is only set in development environments)
  if (headerUser && process.env.ALLOW_HEADER_AUTH === 'true') {
    req.user = headerUser;
    req.authMode = 'header';
    return next();
  }

  const authHeader = req.headers['authorization'];
  // EventSource (SSE) cannot send Authorization headers — the realtime stream
  // authenticates with a short-lived ticket issued by GET /events-ticket.
  if (req.path === '/events' && req.query.token) {
    try {
      const decoded = jwt.verify(req.query.token, process.env.JWT_SECRET);
      if (decoded.sse === true) {
        req.user = decoded;
        return next();
      }
    } catch { /* fall through to standard auth */ }
  }
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      return next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired', message: 'Please login again' });
      }
      // Try Supabase fallback
      if (SUPABASE_URL && SUPABASE_ANON_KEY && !SUPABASE_URL.includes('placeholder')) {
        try {
          const sbRes = await axios.get(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
            timeout: 5000
          });
          const sbUser = sbRes.data;
          if (sbUser && sbUser.id) {
            req.user = {
              id: sbUser.id,
              username: sbUser.email || sbUser.id,
              role: sbUser.user_metadata?.role || 'Admin',
              email: sbUser.email,
              isSuperAdmin: sbUser.user_metadata?.is_super_admin === true,
              permissions: sbUser.user_metadata?.is_super_admin ? ['*'] : []
            };
            req.authMode = 'supabase';
            return next();
          }
        } catch { /* Supabase fallback failed */ }
      }
    }
  }

  return res.status(403).json({ error: 'Authentication required', message: 'Valid admin auth required' });
};

router.use(verifyAdminAuth);

// Short-lived ticket so the browser EventSource stream can authenticate via
// query param (EventSource cannot send Authorization/custom headers).
router.get('/events-ticket', (req, res) => {
  try {
    const ticket = jwt.sign(
      { id: req.user.id, username: req.user.username || 'sales', role: req.user.role || 'admin', sse: true },
      process.env.JWT_SECRET,
      { expiresIn: '5m' }
    );
    res.json({ ticket, expiresIn: 300 });
  } catch (err) {
    console.error('[PortalAdmin] SSE ticket error:', err);
    res.status(500).json({ error: 'Failed to create realtime ticket' });
  }
});

function adminActor(req) {
  return {
    id: req.user.id,
    name: req.user.username || req.user.email || 'Sales',
    role: req.user.role || 'admin',
  };
}

function requestContext(req) {
  return {
    ip: req.ip || req.headers['x-forwarded-for'] || null,
    userAgent: req.headers['user-agent'] || null,
    method: req.method,
    path: req.originalUrl,
    correlationId: req.correlationId,
  };
}

// ─── Realtime events (SSE) — staff dashboard updates instantly ──────────────
router.get('/events', (req, res) => {
  const unsubscribe = portalLifecycleService.subscribeAdmin(req, res);
  res.on('close', unsubscribe);
});

// ─── Quotation Requests (review workspace) ───────────────────────────────────
router.get('/requests', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const { status } = req.query;
    const data = await portalLifecycleService.adminListRequests({ companyId: company_id, status });
    res.json(data);
  } catch (err) {
    console.error('[PortalAdmin] List requests error:', err);
    res.status(500).json({ error: 'Failed to load requests' });
  }
});

router.get('/requests/:id', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const data = await portalLifecycleService.adminGetRequest(req.params.id, company_id);
    if (!data) return res.status(404).json({ error: 'Request not found' });
    res.json(data);
  } catch (err) {
    console.error('[PortalAdmin] Request detail error:', err);
    res.status(500).json({ error: 'Failed to load request' });
  }
});

router.put('/requests/:id', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const { items, notes } = req.body;
    const data = await portalLifecycleService.updateRequest(req.params.id, {
      admin: adminActor(req),
      companyId: company_id,
      items,
      notes,
      context: requestContext(req),
    });
    res.json(data);
  } catch (err) {
    console.error('[PortalAdmin] Update request error:', err);
    res.status(400).json({ error: err.message || 'Failed to update request' });
  }
});

router.post('/requests/:id/reject', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const { reason } = req.body || {};
    const data = await portalLifecycleService.rejectRequest(req.params.id, {
      admin: adminActor(req),
      companyId: company_id,
      reason,
      context: requestContext(req),
    });
    res.json(data);
  } catch (err) {
    console.error('[PortalAdmin] Reject request error:', err);
    res.status(400).json({ error: err.message || 'Failed to reject request' });
  }
});

router.post('/requests/:id/clarify', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const { note } = req.body || {};
    const data = await portalLifecycleService.requestClarification(req.params.id, {
      admin: adminActor(req),
      companyId: company_id,
      note,
      context: requestContext(req),
    });
    res.json(data);
  } catch (err) {
    console.error('[PortalAdmin] Clarify request error:', err);
    res.status(400).json({ error: err.message || 'Failed to request clarification' });
  }
});

// Sales opened the request (audit + timeline only)
router.post('/requests/:id/open', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const data = await portalLifecycleService.markRequestOpened(req.params.id, {
      admin: adminActor(req),
      companyId: company_id,
      context: requestContext(req),
    });
    res.json(data);
  } catch (err) {
    console.error('[PortalAdmin] Open request error:', err);
    res.status(400).json({ error: err.message || 'Failed to record request open' });
  }
});

// Assign a salesperson to the request
router.post('/requests/:id/assign', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const { assignTo, assignToName } = req.body || {};
    const data = await portalLifecycleService.assignRequest(req.params.id, {
      admin: adminActor(req),
      companyId: company_id,
      assignTo,
      assignToName,
      context: requestContext(req),
    });
    res.json(data);
  } catch (err) {
    console.error('[PortalAdmin] Assign request error:', err);
    res.status(400).json({ error: err.message || 'Failed to assign request' });
  }
});

// Start quotation generation: does NOT create a quotation and does NOT reserve
// a number. Records the event and returns the prefill payload for the standard
// ERP quotation editor.
router.post('/requests/:id/generate-quotation', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const data = await portalLifecycleService.startQuotationGeneration(req.params.id, {
      admin: adminActor(req),
      companyId: company_id,
      context: requestContext(req),
    });
    res.json(data);
  } catch (err) {
    console.error('[PortalAdmin] Generate quotation error:', err);
    res.status(400).json({ error: err.message || 'Failed to start quotation generation' });
  }
});

// Complete the conversion after the ERP quotation has been saved. This is the
// only point where the official quotation is linked to the request and the
// customer is notified.
router.post('/requests/:id/complete-quotation', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const { quotationNumber, erpQuotationId, quotationSnapshot } = req.body || {};
    const data = await portalLifecycleService.completeQuotation(req.params.id, {
      admin: adminActor(req),
      companyId: company_id,
      quotationNumber,
      erpQuotationId,
      quotationSnapshot,
      context: requestContext(req),
    });
    res.status(201).json(data);
  } catch (err) {
    console.error('[PortalAdmin] Complete quotation error:', err);
    res.status(400).json({ error: err.message || 'Failed to complete quotation' });
  }
});

// Start sales order generation for an ORDER request: does NOT create an order
// and does NOT reserve a number. Records the event and returns the prefill
// payload for the standard ERP sales order editor.
router.post('/requests/:id/generate-order', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const data = await portalLifecycleService.startOrderGeneration(req.params.id, {
      admin: adminActor(req),
      companyId: company_id,
      context: requestContext(req),
    });
    res.json(data);
  } catch (err) {
    console.error('[PortalAdmin] Generate order error:', err);
    res.status(400).json({ error: err.message || 'Failed to start sales order generation' });
  }
});

// Complete the conversion after the ERP sales order has been saved. This is
// the only point where the official sales order (SO-YYYY-######) is created,
// linked to the request, and the customer is notified.
router.post('/requests/:id/complete-order', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const { erpOrderId, orderSnapshot } = req.body || {};
    const data = await portalLifecycleService.completeSalesOrder(req.params.id, {
      admin: adminActor(req),
      companyId: company_id,
      erpOrderId,
      orderSnapshot,
      context: requestContext(req),
    });
    res.status(201).json(data);
  } catch (err) {
    console.error('[PortalAdmin] Complete order error:', err);
    res.status(400).json({ error: err.message || 'Failed to complete sales order' });
  }
});

// ─── Official Sales Orders (admin) ───────────────────────────────────────────
router.get('/orders', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const rows = await new Promise((resolve, reject) => {
      db.all(`
        SELECT so.id, so.order_number, so.status, so.total, so.orderDate, so.deliveryDate,
               so.source_request_id, so.source_request_number, so.reorder_of, so.reorder_of_number,
               c.name AS customer_name, so.created_at
        FROM sales_orders so
        LEFT JOIN customers c ON c.id = so.customer_id
        WHERE so.company_id = ?
        ORDER BY so.orderDate DESC
      `, [company_id], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
    res.json(rows);
  } catch (err) {
    console.error('[PortalAdmin] List orders error:', err);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

// ─── Official Quotations (admin) ─────────────────────────────────────────────
router.get('/quotations', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const { status } = req.query;
    const data = await portalLifecycleService.getQuotations({ companyId: company_id, status });
    res.json(data);
  } catch (err) {
    console.error('[PortalAdmin] List quotations error:', err);
    res.status(500).json({ error: 'Failed to load quotations' });
  }
});

router.get('/quotations/:id', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const data = await portalLifecycleService.getQuotationById(req.params.id, { companyId: company_id });
    if (!data) return res.status(404).json({ error: 'Quotation not found' });
    res.json(data);
  } catch (err) {
    console.error('[PortalAdmin] Quotation detail error:', err);
    res.status(500).json({ error: 'Failed to load quotation' });
  }
});

// Regenerate a quotation after a customer revision request
router.post('/quotations/:id/regenerate', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const { items, discount, taxRate, deliveryFee, paymentTerms, validUntil } = req.body || {};
    const data = await portalLifecycleService.regenerateQuotation(req.params.id, {
      admin: adminActor(req),
      companyId: company_id,
      items,
      discount,
      taxRate,
      deliveryFee,
      paymentTerms,
      validUntil,
      context: requestContext(req),
    });
    res.json(data);
  } catch (err) {
    console.error('[PortalAdmin] Regenerate quotation error:', err);
    res.status(400).json({ error: err.message || 'Failed to update quotation' });
  }
});

// Convert an accepted quotation into an official sales order
router.post('/quotations/:id/convert-to-order', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const { deliveryDate, notes } = req.body || {};
    const data = await portalLifecycleService.convertToOrder(req.params.id, {
      admin: adminActor(req),
      companyId: company_id,
      deliveryDate,
      notes,
      context: requestContext(req),
    });
    res.status(201).json(data);
  } catch (err) {
    console.error('[PortalAdmin] Convert to order error:', err);
    res.status(400).json({ error: err.message || 'Failed to convert to order' });
  }
});

// ─── Quotation version history (Phase 3) ─────────────────────────────────────
router.get('/quotations/:id/versions', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const quotation = await portalLifecycleService.getQuotationById(req.params.id, { companyId: company_id });
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    const data = await portalLifecycleService.listDocumentVersions('quotation', req.params.id, { companyId: company_id });
    res.json(data);
  } catch (err) {
    console.error('[PortalAdmin] Quotation versions error:', err);
    res.status(500).json({ error: 'Failed to load quotation versions' });
  }
});

router.get('/quotations/:id/versions/:version', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const quotation = await portalLifecycleService.getQuotationById(req.params.id, { companyId: company_id });
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    const data = await portalLifecycleService.getDocumentVersion('quotation', req.params.id, Number(req.params.version), { companyId: company_id });
    if (!data) return res.status(404).json({ error: 'Version not found' });
    res.json(data);
  } catch (err) {
    console.error('[PortalAdmin] Quotation version detail error:', err);
    res.status(500).json({ error: 'Failed to load quotation version' });
  }
});

// ─── Quotation decision signatures (Phase 3) ─────────────────────────────────
router.get('/quotations/:id/signatures', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const quotation = await portalLifecycleService.getQuotationById(req.params.id, { companyId: company_id });
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    const data = await portalLifecycleService.getDocumentSignatures('quotation', req.params.id, { companyId: company_id });
    res.json(data);
  } catch (err) {
    console.error('[PortalAdmin] Quotation signatures error:', err);
    res.status(500).json({ error: 'Failed to load signatures' });
  }
});

// ─── Sales order production status (Phase 4) ─────────────────────────────────
router.post('/orders/:id/status', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const { status, note } = req.body || {};
    if (!status) return res.status(400).json({ error: 'status is required' });
    const data = await portalLifecycleService.updateOrderStatus(req.params.id, {
      admin: adminActor(req),
      companyId: company_id,
      toStatus: status,
      note,
      context: requestContext(req),
    });
    res.json(data);
  } catch (err) {
    console.error('[PortalAdmin] Update order status error:', err);
    res.status(400).json({ error: err.message || 'Failed to update order status' });
  }
});

// ─── Document discussions (Phase 4) ──────────────────────────────────────────
router.get('/comments', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const { docType, docId } = req.query;
    if (!docType || !docId) {
      return res.status(400).json({ error: 'docType and docId are required' });
    }
    const data = await portalLifecycleService.getComments({
      docType, docId, companyId: company_id, view: 'admin',
    });
    res.json(data);
  } catch (err) {
    console.error('[PortalAdmin] Comments error:', err);
    res.status(500).json({ error: 'Failed to load comments' });
  }
});

router.post('/comments', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const { docType, docId, body, visibility } = req.body || {};
    if (!docType || !docId || !body) {
      return res.status(400).json({ error: 'docType, docId and body are required' });
    }
    const actor = adminActor(req);
    const data = await portalLifecycleService.addComment({
      docType, docId, companyId: company_id,
      actor: { type: 'admin', id: actor.id, name: actor.name || 'Sales', role: actor.role },
      body,
      visibility: visibility === 'customer' ? 'customer' : 'internal',
      context: requestContext(req),
    });
    res.status(201).json(data);
  } catch (err) {
    console.error('[PortalAdmin] Add comment error:', err);
    res.status(400).json({ error: err.message || 'Failed to add comment' });
  }
});

// ─── Admin notifications ─────────────────────────────────────────────────────
router.get('/notifications', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const data = await portalLifecycleService.getAdminNotifications(company_id, { limit });
    res.json(data);
  } catch (err) {
    console.error('[PortalAdmin] Notifications error:', err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

router.get('/notifications/unread-count', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const count = await portalLifecycleService.getAdminUnreadCount(company_id);
    res.json({ count });
  } catch (err) {
    console.error('[PortalAdmin] Unread count error:', err);
    res.status(500).json({ error: 'Failed to load unread count' });
  }
});

router.put('/notifications/:id/read', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    await portalLifecycleService.markAdminNotificationRead(req.params.id, company_id);
    res.json({ success: true });
  } catch (err) {
    console.error('[PortalAdmin] Mark notification read error:', err);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

router.put('/notifications/read-all', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    await portalLifecycleService.markAllAdminNotificationsRead(company_id);
    res.json({ success: true });
  } catch (err) {
    console.error('[PortalAdmin] Mark all read error:', err);
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
});

// ─── Activity feed + analytics ───────────────────────────────────────────────
router.get('/activity', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const data = await portalLifecycleService.getActivity(company_id, { limit });
    res.json(data);
  } catch (err) {
    console.error('[PortalAdmin] Activity error:', err);
    res.status(500).json({ error: 'Failed to load activity' });
  }
});

router.get('/analytics', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const data = await portalLifecycleService.getAnalytics(company_id);
    res.json(data);
  } catch (err) {
    console.error('[PortalAdmin] Analytics error:', err);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const rows = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          c.id AS customer_id,
          c.name AS customer_name,
          c.email AS customer_email,
          c.phone AS customer_phone,
          c.status AS customer_status,
          pu.id AS portal_user_id,
          pu.email AS portal_email,
          pu.full_name,
          pu.phone AS portal_phone,
          pu.status AS portal_status,
          pu.last_login_at,
          pu.created_at AS portal_created_at
        FROM customers c
        LEFT JOIN portal_users pu ON pu.customer_id = c.id AND pu.company_id = ?
        WHERE c.company_id = ? OR (c.company_id IS NULL AND ? = '')
        ORDER BY c.name ASC
      `, [company_id, company_id, company_id], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
    res.json(rows);
  } catch (err) {
    console.error('[PortalAdmin] List users error:', err);
    res.status(500).json({ error: 'Failed to list portal users' });
  }
});

router.post('/users', async (req, res) => {
  try {
    const { customer_id, email, password, full_name, phone } = req.body;
    if (!customer_id || !email || !password) {
      return res.status(400).json({ error: 'customer_id, email, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const company_id = req.user.company_id || '';
    const existing = await portalAuthService.getPortalUserByEmail(email, company_id);
    if (existing) {
      return res.status(409).json({ error: 'A portal account with this email already exists' });
    }
    const user = await portalAuthService.registerPortalUser({
      customer_id,
      email,
      password,
      full_name: full_name || '',
      phone: phone || '',
      company_id
    });
    res.status(201).json({ message: 'Portal user created', user });
    } catch (err) {
      if (err.message === 'Email already registered') {
        return res.status(409).json({ error: err.message });
      }
      console.error('[PortalAdmin] Create user error:', err);
      res.status(500).json({ error: 'Failed to create portal user', detail: err.message });
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    const { status, full_name, phone, email } = req.body;
    const company_id = req.user.company_id || '';
    const user = await portalAuthService.getPortalUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Portal user not found' });
    if (user.company_id !== company_id) return res.status(403).json({ error: 'Access denied' });

    if (status && !['active', 'disabled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    if (status) {
      await new Promise((resolve, reject) => {
        db.run(`UPDATE portal_users SET status = ?, updated_at = datetime('now') WHERE id = ?`, [status, req.params.id], (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }
    const updateFields = {};
    if (full_name !== undefined) updateFields.full_name = full_name;
    if (phone !== undefined) updateFields.phone = phone;
    if (email !== undefined) updateFields.email = email;
    if (Object.keys(updateFields).length > 0) {
      await portalAuthService.updatePortalUser(req.params.id, updateFields);
    }
    res.json({ message: 'Portal user updated' });
  } catch (err) {
    console.error('[PortalAdmin] Update user error:', err);
    res.status(500).json({ error: 'Failed to update portal user' });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const user = await portalAuthService.getPortalUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Portal user not found' });
    if (user.company_id !== company_id) return res.status(403).json({ error: 'Access denied' });

    await new Promise((resolve, reject) => {
      db.run(`UPDATE portal_users SET status = 'disabled', updated_at = datetime('now') WHERE id = ?`, [req.params.id], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    await portalAuthService.revokeAllSessions(req.params.id);
    res.json({ message: 'Portal user disabled' });
  } catch (err) {
    console.error('[PortalAdmin] Delete user error:', err);
    res.status(500).json({ error: 'Failed to disable portal user' });
  }
});

router.post('/users/:id/reset-password', async (req, res) => {
  try {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    const company_id = req.user.company_id || '';
    const user = await portalAuthService.getPortalUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Portal user not found' });
    if (user.company_id !== company_id) return res.status(403).json({ error: 'Access denied' });

    await portalAuthService.updatePassword(req.params.id, new_password);
    await portalAuthService.revokeAllSessions(req.params.id);
    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('[PortalAdmin] Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

router.post('/users/auto-create', async (req, res) => {
  try {
    const { customer_id, name, email, phone, full_name } = req.body;
    if (!customer_id) {
      return res.status(400).json({ error: 'customer_id is required' });
    }
    const company_id = req.user.company_id || '';

    const existing = await portalAuthService.getPortalUserByCustomerId(customer_id, company_id);
    if (existing) {
      return res.json({ existing: true, user: existing, generated_password: null });
    }

    // Upsert the customer into the backend customers table so the portal admin
    // user list and customer login resolution work for local-first customers.
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO customers (id, name, email, phone, company_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = COALESCE(NULLIF(EXCLUDED.name, ''), customers.name),
           email = COALESCE(NULLIF(EXCLUDED.email, ''), customers.email),
           phone = COALESCE(NULLIF(EXCLUDED.phone, ''), customers.phone),
           company_id = EXCLUDED.company_id`,
        [customer_id, name || '', email || '', phone || '', company_id],
        (err) => (err ? reject(err) : resolve())
      );
    });

    const password = crypto.randomBytes(9).toString('base64url');
    const user = await portalAuthService.registerPortalUser({
      customer_id,
      email: email || `${customer_id.toLowerCase()}.portal@prime.local`,
      password,
      full_name: full_name || name || '',
      phone: phone || '',
      company_id
    });
    res.status(201).json({ user, generated_password: password });
  } catch (err) {
    if (err.message === 'Email already registered') {
      return res.status(409).json({ error: err.message });
    }
    console.error('[PortalAdmin] Auto-create user error:', err);
    res.status(500).json({ error: 'Failed to create portal user', detail: err.message });
  }
});

router.post('/users/:id/regenerate-password', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const user = await portalAuthService.getPortalUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Portal user not found' });
    if (user.company_id !== company_id) return res.status(403).json({ error: 'Access denied' });

    const new_password = crypto.randomBytes(9).toString('base64url');
    await portalAuthService.updatePassword(req.params.id, new_password);
    await portalAuthService.revokeAllSessions(req.params.id);
    res.json({ generated_password: new_password });
  } catch (err) {
    console.error('[PortalAdmin] Regenerate password error:', err);
    res.status(500).json({ error: 'Failed to regenerate password' });
  }
});

// Staff (sales users) available for request assignment
router.get('/staff', async (req, res) => {
  try {
    const company_id = req.user.company_id || '';
    const rows = await new Promise((resolve, reject) => {
      db.all(`
        SELECT id, username, email, role, company_id, is_active
        FROM users
        WHERE is_active = 1
        ORDER BY username ASC
      `, [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
    res.json(rows);
  } catch (err) {
    console.error('[PortalAdmin] List staff error:', err);
    res.status(500).json({ error: 'Failed to load staff' });
  }
});

module.exports = router;
