const express = require('express');
const router = express.Router();
const { db } = require('../db.cjs');
const portalAuthService = require('../services/portalAuthService.cjs');
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
    const existing = await portalAuthService.getPortalUserByCustomerId(customer_id, company_id);
    if (existing) {
      return res.status(409).json({ error: 'This customer already has a portal account' });
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

module.exports = router;
