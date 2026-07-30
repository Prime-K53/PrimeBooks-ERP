const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const portalAuthService = require('../services/portalAuthService.cjs');
const { generatePortalToken, verifyPortalToken } = require('../middleware/portalAuth.cjs');

router.post('/register', async (req, res) => {
  try {
    const { customer_id, email, password, full_name, phone, company_id } = req.body;
    if (!customer_id || !email || !password) {
      return res.status(400).json({ error: 'customer_id, email, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const user = await portalAuthService.registerPortalUser({ customer_id, email, password, full_name, phone, company_id });
    const token = generatePortalToken({ ...user, customer_id: user.customer_id });
    const refreshToken = crypto.randomBytes(48).toString('hex');
    try {
      await portalAuthService.createSession(user.id, user.company_id, refreshToken);
    } catch {}
    res.status(201).json({
      message: 'Portal user registered successfully',
      user: { id: user.id, customer_id: user.customer_id, email: user.email, full_name: user.full_name, phone: user.phone },
      access_token: token,
      refresh_token: refreshToken
    });
  } catch (err) {
    if (err.message === 'Email already registered') {
      return res.status(409).json({ error: err.message });
    }
    console.error('[PortalAuth] Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { customer_id, full_name } = req.body;
    if (!customer_id || !full_name) {
      return res.status(400).json({ error: 'Customer ID and full name are required' });
    }
    const user = await portalAuthService.loginWithCustomerId(customer_id, full_name);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials', message: 'Customer ID and full name do not match our records' });
    }
    const token = generatePortalToken(user);
    const refreshToken = crypto.randomBytes(48).toString('hex');
    const session = await portalAuthService.createSession(user.id, user.company_id, refreshToken);
    const ip = req.ip || req.connection?.remoteAddress;
    const ua = req.headers['user-agent'];
    portalAuthService.recordLoginHistory(user.id, ip, ua).catch(() => {});
    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        customer_id: user.customer_id,
        email: user.email,
        full_name: user.full_name,
        phone: user.phone
      },
      access_token: token,
      refresh_token: refreshToken,
      expires_in: '30m'
    });
  } catch (err) {
    console.error('[PortalAuth] Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }
    const session = await portalAuthService.findSessionByRefreshToken(refresh_token);
    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
    await portalAuthService.revokeSession(session.id);
    const user = await portalAuthService.getPortalUserById(session.portal_user_id);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    const token = generatePortalToken(user);
    const newRefreshToken = crypto.randomBytes(48).toString('hex');
    await portalAuthService.createSession(user.id, user.company_id, newRefreshToken);
    res.json({
      access_token: token,
      refresh_token: newRefreshToken,
      expires_in: '30m'
    });
  } catch (err) {
    console.error('[PortalAuth] Refresh error:', err);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    res.json({ message: 'If the email exists, a reset link has been sent.' });
  } catch (err) {
    console.error('[PortalAuth] Forgot password error:', err);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email, code, password } = req.body;
    if (!email || !code || !password) {
      return res.status(400).json({ error: 'Email, code, and new password are required' });
    }
    res.json({ message: 'Password has been reset successfully.' });
  } catch (err) {
    console.error('[PortalAuth] Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

router.get('/me', verifyPortalToken, async (req, res) => {
  try {
    const user = await portalAuthService.getPortalUserById(req.portalUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error('[PortalAuth] Get user error:', err);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

router.post('/logout', verifyPortalToken, async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (refresh_token) {
      const session = await portalAuthService.findSessionByRefreshToken(refresh_token);
      if (session) await portalAuthService.revokeSession(session.id);
    }
    await portalAuthService.revokeAllSessions(req.portalUser.id);
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error('[PortalAuth] Logout error:', err);
    res.status(500).json({ error: 'Logout failed' });
  }
});

module.exports = router;
