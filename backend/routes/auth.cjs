const express = require('express');
const router = express.Router();
const authService = require('../services/authService.cjs');
const portalAuthService = require('../services/portalAuthService.cjs');
const { generateToken, verifyToken } = require('../middleware/auth.cjs');
const { validateBody, userSchemas } = require('../middleware/validation.cjs');

router.post('/register', validateBody(userSchemas.createUser), async (req, res) => {
  try {
    const { username, email, password, role, permissions } = req.body;
    // Do NOT accept companyId from request body — it must be set by an admin
    // after registration. This prevents attackers from joining arbitrary companies.
    const user = await authService.registerUser({ username, email, password, role, permissions, companyId: '' });
    const token = generateToken({ ...user, company_id: '' });
    res.status(201).json({ message: 'User registered successfully', user: { ...user, company_id: '' }, token });
  } catch (err) {
    if (err.message === 'Username already exists') {
      return res.status(409).json({ error: err.message });
    }
    console.error('[Auth] Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', validateBody(userSchemas.login), async (req, res) => {
  try {
    const { email, username, password, portal } = req.body;
    const requestedPortal = portal === 'customer' ? 'customer' : 'admin';
    const identifier = String(email || username || '').trim();

    // Same API serves both portals. Detect the account type (staff vs customer)
    // and enforce that the account is used from its own portal only.
    const staff = await authService.authenticateUser(identifier, password);
    const portalUser = await portalAuthService.authenticatePortalUser(identifier, password);

    if (!staff && !portalUser) {
      return res.status(401).json({ error: 'Invalid credentials', message: 'Email or password is incorrect' });
    }

    if (requestedPortal === 'customer') {
      if (portalUser) return loginCustomer(res, portalUser);
      if (staff) {
        return res.status(403).json({
          error: 'Wrong portal',
          code: 'ACCOUNT_BELONGS_TO_ADMIN',
          message: 'This account is an administrator account. Please sign in through the ERP.',
          role: 'admin'
        });
      }
    } else {
      if (staff) return loginStaff(res, staff);
      if (portalUser) {
        return res.status(403).json({
          error: 'Wrong portal',
          code: 'ACCOUNT_BELONGS_TO_CUSTOMER',
          message: 'This account belongs to the Customer Portal. Please sign in at portal.primeerp.com.',
          role: 'customer'
        });
      }
    }
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

async function loginStaff(res, user) {
  const { db } = require('../db.cjs');
  const userCompanies = await new Promise((resolve, reject) => {
    db.all('SELECT company_id, role, is_default FROM user_companies WHERE user_id = ?', [user.id], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
  const token = generateToken({ ...user, companies: userCompanies.map(c => c.company_id) });
  res.json({
    message: 'Login successful',
    userId: user.id,
    role: 'admin',
    user: {
      id: user.id, username: user.username, email: user.email,
      role: user.role, permissions: user.permissions,
      company_id: user.company_id || '',
      companies: userCompanies
    },
    token
  });
}

async function loginCustomer(res, user) {
  const crypto = require('crypto');
  const { generatePortalToken } = require('../middleware/portalAuth.cjs');
  const token = generatePortalToken(user);
  const refreshToken = crypto.randomBytes(48).toString('hex');
  await portalAuthService.createSession(user.id, user.company_id, refreshToken);
  const ip = res.req.ip || res.req.connection?.remoteAddress;
  const ua = res.req.headers['user-agent'];
  portalAuthService.recordLoginHistory(user.id, ip, ua).catch(() => {});
  res.json({
    message: 'Login successful',
    userId: user.id,
    role: 'customer',
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
}

router.post('/request-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const result = await (require('../services/emailVerificationService.cjs')).requestVerification({ email });
    res.json({ success: true, message: 'Verification code sent to email', expiresAt: result.expiresAt });
  } catch (err) {
    console.error('[Auth] request-verification error:', err);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

router.post('/verify-code', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'Email and code are required' });
    const result = await (require('../services/emailVerificationService.cjs')).verifyCode({ email, code });
    if (result.success) {
      res.json({ success: true, message: 'Email verified successfully' });
    } else {
      res.status(400).json({ success: false, error: result.error || 'Invalid or expired code' });
    }
  } catch (err) {
    console.error('[Auth] verify-code error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await authService.getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const { db } = require('../db.cjs');
    const companies = await new Promise((resolve, reject) => {
      db.all('SELECT company_id, role, is_default FROM user_companies WHERE user_id = ?', [user.id], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
    res.json({ ...user, companies });
  } catch (err) {
    console.error('[Auth] Get user error:', err);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

module.exports = router;
