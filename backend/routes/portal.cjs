const express = require('express');
const router = express.Router();
const { verifyPortalToken } = require('../middleware/portalAuth.cjs');
const portalService = require('../services/portalService.cjs');
const portalAuthService = require('../services/portalAuthService.cjs');

router.use(verifyPortalToken);

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

// ─── Quotations ───────────────────────────────────────────────
router.get('/quotations', async (req, res) => {
  try {
    const { customer_id, company_id } = req.portalUser;
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

router.put('/profile/password', async (req, res) => {
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

router.post('/support/tickets', async (req, res) => {
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

module.exports = router;
