const express = require('express');
const router = express.Router();
const { verifyPortalToken } = require('../middleware/portalAuth.cjs');
const portalService = require('../services/portalService.cjs');
const portalAuthService = require('../services/portalAuthService.cjs');
const portalLifecycleService = require('../services/portalLifecycleService.cjs');
const { sensitiveLimiter, apiLimiter } = require('../middleware/rateLimiter.cjs');

const GLOBAL_PORTAL_LIMIT = apiLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 200 });
const SENSITIVE_PORTAL_LIMIT = sensitiveLimiter({ windowMs: 60 * 60 * 1000, maxRequests: 30 });

router.use(verifyPortalToken);
router.use(GLOBAL_PORTAL_LIMIT);

function requestContext(req) {
  return {
    ip: req.ip || req.headers['x-forwarded-for'] || null,
    userAgent: req.headers['user-agent'] || null,
    method: req.method,
    path: req.originalUrl,
    correlationId: req.correlationId,
  };
}

// ─── Realtime events (SSE) — no manual refresh needed ────────────────────────
router.post('/events-ticket', SENSITIVE_PORTAL_LIMIT, async (req, res) => {
  try {
    const { id, customer_id, company_id, email } = req.portalUser;
    const ticket = portalAuthService.generateEventTicket({ id, customer_id, company_id, email }, 'portal');
    res.json({ ticket, expiresIn: 300 });
  } catch (err) {
    console.error('[Portal] events-ticket error:', err);
    res.status(500).json({ error: 'Failed to issue realtime ticket' });
  }
});
router.get('/events', (req, res) => {
  const unsubscribe = portalLifecycleService.subscribePortal(req, res);
  res.on('close', unsubscribe);
});

// ─── Quotation Requests (customer-submitted, NOT official documents) ────────
router.get('/requests', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const { page, pageSize, status, search } = req.query;
    const hasPagination = page || pageSize;
    if (hasPagination) {
      const data = await portalService.getRequestsPaginated(customer_id, company_id, {
        page: page ? parseInt(page, 10) : 1,
        pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
        status: status || undefined,
        search: search || undefined,
      });
      return res.json(data);
    }
    const data = await portalLifecycleService.getRequests({ customerId: customer_id, companyId: company_id });
    res.json(data);
  } catch (err) {
    console.error('[Portal] Requests error:', err);
    res.status(500).json({ error: 'Failed to load requests' });
  }
});

router.post('/requests', async (req, res) => {
  try {
    const { id, customer_id, company_id, email, full_name } = req.portalUser;
    const { requestType, items, notes, requestedDeliveryDate, attachments } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one line item is required' });
    }
    const result = await portalLifecycleService.createQuotationRequest({
      portalUserId: id,
      customerId: customer_id,
      customerName: full_name || email || 'Customer',
      companyId: company_id,
      requestType,
      items,
      notes,
      requestedDeliveryDate,
      attachments,
      context: requestContext(req),
    });
    res.status(201).json(result);
  } catch (err) {
    console.error('[Portal] Create request error:', err);
    res.status(400).json({ error: err.message || 'Failed to submit request' });
  }
});

router.get('/requests/:id', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const data = await portalLifecycleService.getRequestById(req.params.id, { customerId: customer_id, companyId: company_id });
    if (!data) return res.status(404).json({ error: 'Request not found' });
    res.json(data);
  } catch (err) {
    console.error('[Portal] Request detail error:', err);
    res.status(500).json({ error: 'Failed to load request' });
  }
});

router.post('/requests/:id/cancel', async (req, res) => {
  try {
    const { id, customer_id, company_id } = req.portalUser;
    const result = await portalLifecycleService.cancelRequest(req.params.id, {
      portalUserId: id,
      customerId: customer_id,
      companyId: company_id,
      context: requestContext(req),
    });
    res.json(result);
  } catch (err) {
    console.error('[Portal] Cancel request error:', err);
    res.status(400).json({ error: err.message || 'Failed to cancel request' });
  }
});

// ─── Quotations (official documents — read-only for customers) ──────────────
router.get('/quotations/:id', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const data = await portalLifecycleService.getQuotationById(req.params.id, { customerId: customer_id, companyId: company_id });
    if (!data) return res.status(404).json({ error: 'Quotation not found' });
    res.json(data);
  } catch (err) {
    console.error('[Portal] Quotation detail error:', err);
    res.status(500).json({ error: 'Failed to load quotation' });
  }
});

router.post('/quotations/:id/accept', async (req, res) => {
  try {
    const { id, customer_id, company_id, email, full_name } = req.portalUser;
    const result = await portalLifecycleService.acceptQuotation(req.params.id, {
      portalUserId: id,
      customerId: customer_id,
      companyId: company_id,
      signerName: full_name || email || null,
      signerEmail: email || null,
      context: requestContext(req),
    });
    res.json(result);
  } catch (err) {
    console.error('[Portal] Accept quotation error:', err);
    res.status(400).json({ error: err.message || 'Failed to accept quotation' });
  }
});

router.post('/quotations/:id/reject', async (req, res) => {
  try {
    const { id, customer_id, company_id, email, full_name } = req.portalUser;
    const { reason } = req.body || {};
    const result = await portalLifecycleService.rejectQuotation(req.params.id, {
      portalUserId: id,
      customerId: customer_id,
      companyId: company_id,
      reason,
      signerName: full_name || email || null,
      signerEmail: email || null,
      context: requestContext(req),
    });
    res.json(result);
  } catch (err) {
    console.error('[Portal] Reject quotation error:', err);
    res.status(400).json({ error: err.message || 'Failed to reject quotation' });
  }
});

router.post('/quotations/:id/revision', async (req, res) => {
  try {
    const { id, customer_id, company_id, email, full_name } = req.portalUser;
    const { comments } = req.body || {};
    const result = await portalLifecycleService.requestRevision(req.params.id, {
      portalUserId: id,
      customerId: customer_id,
      companyId: company_id,
      comments,
      signerName: full_name || email || null,
      signerEmail: email || null,
      context: requestContext(req),
    });
    res.json(result);
  } catch (err) {
    console.error('[Portal] Revision request error:', err);
    res.status(400).json({ error: err.message || 'Failed to request revision' });
  }
});

// ─── Quotation version history (Phase 3) ─────────────────────────────────────
router.get('/quotations/:id/versions', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const quotation = await portalLifecycleService.getQuotationById(req.params.id, { customerId: customer_id, companyId: company_id });
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    const data = await portalLifecycleService.listDocumentVersions('quotation', req.params.id, { companyId: company_id });
    res.json(data);
  } catch (err) {
    console.error('[Portal] Quotation versions error:', err);
    res.status(500).json({ error: 'Failed to load quotation versions' });
  }
});

router.get('/quotations/:id/versions/:version', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const quotation = await portalLifecycleService.getQuotationById(req.params.id, { customerId: customer_id, companyId: company_id });
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    const data = await portalLifecycleService.getDocumentVersion('quotation', req.params.id, Number(req.params.version), { companyId: company_id });
    if (!data) return res.status(404).json({ error: 'Version not found' });
    res.json(data);
  } catch (err) {
    console.error('[Portal] Quotation version detail error:', err);
    res.status(500).json({ error: 'Failed to load quotation version' });
  }
});

// ─── Quotation decision signatures (Phase 3) ─────────────────────────────────
router.get('/quotations/:id/signatures', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const quotation = await portalLifecycleService.getQuotationById(req.params.id, { customerId: customer_id, companyId: company_id });
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    const data = await portalLifecycleService.getDocumentSignatures('quotation', req.params.id, { companyId: company_id, customerId: customer_id });
    res.json(data);
  } catch (err) {
    console.error('[Portal] Quotation signatures error:', err);
    res.status(500).json({ error: 'Failed to load signatures' });
  }
});

// ─── Document discussions (Phase 4) ──────────────────────────────────────────
router.get('/comments', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const { docType, docId } = req.query;
    if (!docType || !docId) {
      return res.status(400).json({ error: 'docType and docId are required' });
    }
    const data = await portalLifecycleService.getComments({
      docType, docId, companyId: company_id, customerId: customer_id, view: 'customer',
    });
    res.json(data);
  } catch (err) {
    console.error('[Portal] Comments error:', err);
    res.status(500).json({ error: 'Failed to load comments' });
  }
});

router.post('/comments', async (req, res) => {
  try {
    const { id, customer_id, company_id, email, full_name } = req.portalUser;
    const { docType, docId, body } = req.body || {};
    if (!docType || !docId || !body) {
      return res.status(400).json({ error: 'docType, docId and body are required' });
    }
    const data = await portalLifecycleService.addComment({
      docType, docId, companyId: company_id, customerId: customer_id,
      actor: { type: 'customer', id, name: full_name || email || 'Customer' },
      body,
      context: requestContext(req),
    });
    res.status(201).json(data);
  } catch (err) {
    console.error('[Portal] Add comment error:', err);
    res.status(400).json({ error: err.message || 'Failed to add comment' });
  }
});

// ─── Downloads (gated + audited) ─────────────────────────────────────────────
router.post('/downloads', SENSITIVE_PORTAL_LIMIT, async (req, res) => {
  try {
    const { id, customer_id, company_id } = req.portalUser;
    const { docType, docId } = req.body || {};
    if (!docType || !docId) {
      return res.status(400).json({ error: 'docType and docId are required' });
    }
    const result = await portalLifecycleService.recordDownload({
      docType,
      docId,
      portalUserId: id,
      customerId: customer_id,
      companyId: company_id,
      context: requestContext(req),
    });
    res.json(result);
  } catch (err) {
    console.error('[Portal] Download audit error:', err);
    res.status(400).json({ error: err.message || 'Download not permitted' });
  }
});

// ─── Timeline (merged chronological history per document) ────────────────────
router.get('/timeline', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const { docType, docId } = req.query;
    if (!docType || !docId) {
      return res.status(400).json({ error: 'docType and docId are required' });
    }
    const data = await portalLifecycleService.getTimeline({
      docType,
      docId,
      customerId: customer_id,
      companyId: company_id,
    });
    res.json(data);
  } catch (err) {
    console.error('[Portal] Timeline error:', err);
    res.status(500).json({ error: 'Failed to load timeline' });
  }
});

// ─── Dashboard ────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const { id, customer_id, company_id } = req.portalUser;
    const data = await portalService.getDashboard(id, customer_id, company_id);
    res.json(data);
  } catch (err) {
    console.error('[Portal] Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// ─── Orders ───────────────────────────────────────────────────
router.get('/orders', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const { page, pageSize, status, search, dateFrom, dateTo } = req.query;
    const hasPagination = page || pageSize;
    if (hasPagination) {
      const data = await portalService.getOrdersPaginated(customer_id, company_id, {
        page: page ? parseInt(page, 10) : 1,
        pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
        status: status || undefined,
        search: search || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      return res.json(data);
    }
    const data = await portalService.getOrders(customer_id, company_id);
    res.json(data);
  } catch (err) {
    console.error('[Portal] Orders error:', err);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

router.get('/orders/:id', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const data = await portalService.getOrderById(req.params.id, customer_id, company_id);
    if (!data) return res.status(404).json({ error: 'Order not found' });
    res.json(data);
  } catch (err) {
    console.error('[Portal] Order detail error:', err);
    res.status(500).json({ error: 'Failed to load order' });
  }
});

// Reorder an official sales order — creates a brand-new order request
// (ODR-YYYY-######) so the order goes through sales review again.
router.post('/orders/:id/reorder', async (req, res) => {
  try {
    const { id, customer_id, company_id } = req.portalUser;
    const result = await portalLifecycleService.reorderFromOrder(req.params.id, {
      portalUserId: id,
      customerId: customer_id,
      companyId: company_id,
      context: requestContext(req),
    });
    res.status(201).json(result);
  } catch (err) {
    console.error('[Portal] Reorder error:', err);
    res.status(400).json({ error: err.message || 'Failed to reorder' });
  }
});

// ─── Document chain (request → quotation → sales order) ────────────────────
router.get('/document-chain', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const { docType, docId } = req.query;
    if (!docType || !docId) {
      return res.status(400).json({ error: 'docType and docId are required' });
    }
    const data = await portalLifecycleService.getDocumentChain({
      docType,
      docId,
      customerId: customer_id,
      companyId: company_id,
    });
    res.json(data);
  } catch (err) {
    console.error('[Portal] Document chain error:', err);
    res.status(400).json({ error: err.message || 'Failed to load document chain' });
  }
});

// ─── Quotations ───────────────────────────────────────────────
router.get('/quotations', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const { page, pageSize, status, search } = req.query;
    const hasPagination = page || pageSize;
    if (hasPagination) {
      const data = await portalService.getQuotationsPaginated(customer_id, company_id, {
        page: page ? parseInt(page, 10) : 1,
        pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
        status: status || undefined,
        search: search || undefined,
      });
      return res.json(data);
    }
    const data = await portalService.getQuotations(customer_id, company_id);
    res.json(data);
  } catch (err) {
    console.error('[Portal] Quotations error:', err);
    res.status(500).json({ error: 'Failed to load quotations' });
  }
});

// ─── Invoices ─────────────────────────────────────────────────
router.get('/invoices', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const { page, pageSize, status, search, dateFrom, dateTo } = req.query;
    const hasPagination = page || pageSize;
    if (hasPagination) {
      const data = await portalService.getInvoicesPaginated(customer_id, company_id, {
        page: page ? parseInt(page, 10) : 1,
        pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
        status: status || undefined,
        search: search || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      return res.json(data);
    }
    const data = await portalService.getInvoices(customer_id, company_id);
    res.json(data);
  } catch (err) {
    console.error('[Portal] Invoices error:', err);
    res.status(500).json({ error: 'Failed to load invoices' });
  }
});

router.get('/invoices/:id', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const data = await portalService.getInvoiceById(req.params.id, customer_id, company_id);
    if (!data) return res.status(404).json({ error: 'Invoice not found' });
    res.json(data);
  } catch (err) {
    console.error('[Portal] Invoice detail error:', err);
    res.status(500).json({ error: 'Failed to load invoice' });
  }
});

// ─── Payments ─────────────────────────────────────────────────
router.get('/payments', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const { page, pageSize, search, dateFrom, dateTo } = req.query;
    const hasPagination = page || pageSize;
    if (hasPagination) {
      const data = await portalService.getPaymentsPaginated(customer_id, company_id, {
        page: page ? parseInt(page, 10) : 1,
        pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
        search: search || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      return res.json(data);
    }
    const data = await portalService.getPayments(customer_id, company_id);
    res.json(data);
  } catch (err) {
    console.error('[Portal] Payments error:', err);
    res.status(500).json({ error: 'Failed to load payments' });
  }
});

router.get('/payments/:id', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const data = await portalService.getPaymentById(req.params.id, customer_id, company_id);
    if (!data) return res.status(404).json({ error: 'Payment not found' });
    res.json(data);
  } catch (err) {
    console.error('[Portal] Payment detail error:', err);
    res.status(500).json({ error: 'Failed to load payment' });
  }
});

// ─── Statements ───────────────────────────────────────────────
router.get('/statements', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const { startDate, endDate } = req.query;
    const data = await portalService.getStatements(customer_id, company_id, startDate, endDate);
    res.json(data);
  } catch (err) {
    console.error('[Portal] Statements error:', err);
    res.status(500).json({ error: 'Failed to load statements' });
  }
});

// ─── Loyalty ──────────────────────────────────────────────────
router.get('/loyalty', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const data = await portalService.getLoyalty(customer_id, company_id);
    res.json(data);
  } catch (err) {
    console.error('[Portal] Loyalty error:', err);
    res.status(500).json({ error: 'Failed to load loyalty data' });
  }
});

// ─── Wallet ───────────────────────────────────────────────────
router.get('/wallet', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const data = await portalService.getWallet(customer_id, company_id);
    res.json(data);
  } catch (err) {
    console.error('[Portal] Wallet error:', err);
    res.status(500).json({ error: 'Failed to load wallet data' });
  }
});

// ─── Profile ──────────────────────────────────────────────────
router.get('/profile', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const data = await portalService.getProfile(customer_id, company_id);
    if (!data) return res.status(404).json({ error: 'Profile not found' });
    res.json(data);
  } catch (err) {
    console.error('[Portal] Profile error:', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

router.put('/profile', async (req, res) => {
  try {
    const { id } = req.portalUser;
    const { full_name, phone, email } = req.body;
    await portalAuthService.updatePortalUser(id, { full_name, phone, email });
    res.json({ message: 'Profile updated successfully' });
  } catch (err) {
    console.error('[Portal] Profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.put('/profile/password', SENSITIVE_PORTAL_LIMIT, async (req, res) => {
  try {
    const { id } = req.portalUser;
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    await portalAuthService.changePassword(id, currentPassword, newPassword);
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('[Portal] Password change error:', err);
    if (err.message === 'Current password is incorrect') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ─── Documents ────────────────────────────────────────────────
router.get('/documents', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const data = await portalService.getDocuments(customer_id, company_id);
    res.json(data);
  } catch (err) {
    console.error('[Portal] Documents error:', err);
    res.status(500).json({ error: 'Failed to load documents' });
  }
});

// ─── Notifications ────────────────────────────────────────────
router.get('/notifications', async (req, res) => {
  try {
    const { id, company_id } = req.portalUser;
    const data = await portalService.getNotifications(id, company_id);
    res.json(data);
  } catch (err) {
    console.error('[Portal] Notifications error:', err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

router.put('/notifications/:id/read', async (req, res) => {
  try {
    const { id } = req.portalUser;
    await portalService.markNotificationRead(req.params.id, id);
    res.json({ success: true });
  } catch (err) {
    console.error('[Portal] Mark notification read error:', err);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

router.get('/notifications/unread-count', async (req, res) => {
  try {
    const { id, company_id } = req.portalUser;
    const count = await portalService.getUnreadNotificationCount(id, company_id);
    res.json({ count });
  } catch (err) {
    console.error('[Portal] Unread count error:', err);
    res.status(500).json({ error: 'Failed to load unread count' });
  }
});

router.put('/notifications/read-all', async (req, res) => {
  try {
    const { id, company_id } = req.portalUser;
    await portalService.markAllNotificationsRead(id, company_id);
    res.json({ success: true });
  } catch (err) {
    console.error('[Portal] Mark all read error:', err);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

// ─── Referrals ────────────────────────────────────────────────
router.get('/referrals', async (req, res) => {
  try {
    const { id, customer_id, company_id } = req.portalUser;
    const { page, pageSize, status, search, sort } = req.query;
    const data = await portalService.getReferrals(id, customer_id, company_id, {
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
      status: status || undefined,
      search: search || undefined,
      sort: sort || 'date_desc',
    });
    res.json(data);
  } catch (err) {
    console.error('[Portal] Referrals error:', err);
    res.status(500).json({ error: err.message || 'Failed to load referrals' });
  }
});

router.get('/referrals/:id', async (req, res) => {
  try {
    const { id, customer_id, company_id } = req.portalUser;
    const data = await portalService.getReferralById(req.params.id, id, customer_id, company_id);
    if (!data) return res.status(404).json({ error: 'Referral not found' });
    res.json(data);
  } catch (err) {
    console.error('[Portal] Referral detail error:', err);
    res.status(500).json({ error: 'Failed to load referral' });
  }
});

router.get('/referrals/:id/timeline', async (req, res) => {
  try {
    const { company_id } = req.portalUser;
    const data = await portalService.getReferralTimeline(req.params.id, company_id);
    res.json(data);
  } catch (err) {
    console.error('[Portal] Referral timeline error:', err);
    res.status(500).json({ error: 'Failed to load timeline' });
  }
});

router.get('/referrals/rewards', async (req, res) => {
  try {
    const { id, customer_id, company_id } = req.portalUser;
    const { page, pageSize, status } = req.query;
    const data = await portalService.getReferralRewards(id, customer_id, company_id, {
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
      status: status || undefined,
    });
    res.json(data);
  } catch (err) {
    console.error('[Portal] Referral rewards error:', err);
    res.status(500).json({ error: 'Failed to load rewards' });
  }
});

router.get('/referrals/settings', async (req, res) => {
  try {
    const { company_id } = req.portalUser;
    const data = await portalService.getReferralSettings(company_id);
    res.json(data);
  } catch (err) {
    console.error('[Portal] Referral settings error:', err);
    res.status(500).json({ error: 'Failed to load referral settings' });
  }
});

router.get('/referrals/stats', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const data = await portalService.getReferralFunnelStats(customer_id, company_id);
    res.json(data);
  } catch (err) {
    console.error('[Portal] Referral stats error:', err);
    res.status(500).json({ error: 'Failed to load referral stats' });
  }
});

router.post('/referrals', async (req, res) => {
  try {
    const { id, customer_id, company_id } = req.portalUser;
    const { referredCustomerId, notes } = req.body || {};
    if (!referredCustomerId) {
      return res.status(400).json({ error: 'Referred customer is required' });
    }
    const data = await portalService.createReferral(id, customer_id, company_id, {
      referredCustomerId,
      notes,
    });
    res.status(201).json(data);
  } catch (err) {
    console.error('[Portal] Create referral error:', err);
    res.status(400).json({ error: err.message || 'Failed to create referral' });
  }
});

router.get('/referrals/customers/search', async (req, res) => {
  try {
    const { company_id, customer_id } = req.portalUser;
    const { q } = req.query;
    if (!q || String(q).trim().length < 2) {
      return res.json([]);
    }
    const data = await portalService.searchCustomersForReferral(company_id, String(q), customer_id);
    res.json(data);
  } catch (err) {
    console.error('[Portal] Customer search error:', err);
    res.status(500).json({ error: 'Failed to search customers' });
  }
});

// ─── Support Tickets ──────────────────────────────────────────
router.get('/support/tickets', async (req, res) => {
  try {
    const { id, customer_id, company_id } = req.portalUser;
    const data = await portalService.getSupportTickets(id, customer_id, company_id);
    res.json(data);
  } catch (err) {
    console.error('[Portal] Support tickets error:', err);
    res.status(500).json({ error: 'Failed to load tickets' });
  }
});

router.post('/support/tickets', SENSITIVE_PORTAL_LIMIT, async (req, res) => {
  try {
    const { id, customer_id, company_id } = req.portalUser;
    const { subject, message, priority } = req.body;
    if (!subject || !message) {
      return res.status(400).json({ error: 'Subject and message are required' });
    }
    const ticket = await portalService.createSupportTicket(id, customer_id, company_id, { subject, message, priority });
    res.status(201).json(ticket);
  } catch (err) {
    console.error('[Portal] Create ticket error:', err);
    res.status(500).json({ error: 'Failed to create ticket' });
  }
});

router.post('/support/tickets/:id/messages', async (req, res) => {
  try {
    const { id } = req.portalUser;
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    const msg = await portalService.addTicketMessage(req.params.id, id, message);
    res.status(201).json(msg);
  } catch (err) {
    console.error('[Portal] Add message error:', err);
    res.status(500).json({ error: 'Failed to add message' });
  }
});

// ─── Shipments / Tracking (customer-facing, read-only) ─────────────────────────
router.get('/shipments', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const { status, search } = req.query;
    const rows = await portalService.getShipments(customer_id, company_id, {
      status: status || undefined,
      search: search || undefined,
    });
    res.json(rows);
  } catch (err) {
    console.error('[Portal] Shipments list error:', err);
    res.status(500).json({ error: 'Failed to load shipments' });
  }
});

router.get('/shipments/:id', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
    const row = await portalService.getShipmentById(req.params.id, customer_id, company_id);
    if (!row) return res.status(404).json({ error: 'Shipment not found' });
    res.json(row);
  } catch (err) {
    console.error('[Portal] Shipment detail error:', err);
    res.status(500).json({ error: 'Failed to load shipment' });
  }
});

module.exports = router;
