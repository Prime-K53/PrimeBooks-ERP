const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { totp, authenticator } = require('otplib');
const { db } = require('../db.cjs');

const SALT_ROUNDS = 10;
const ACCESS_TOKEN_EXPIRY = '30m';
const REFRESH_TOKEN_EXPIRY_DAYS = 30;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || '';
const SUPABASE_ANON_KEY = SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

function genId(prefix = 'pusr') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

function generateEventTicket(userOrCustomerId, purpose = 'portal') {
  const JWT_SECRET = process.env.JWT_SECRET || process.env.VITE_JWT_SECRET || 'prime-erp-portal-secret';
  const user = typeof userOrCustomerId === 'object' && userOrCustomerId !== null
    ? userOrCustomerId
    : { customer_id: userOrCustomerId };
  return jwt.sign(
    {
      id: user.id || user.portal_user_id || null,
      customer_id: user.customer_id,
      email: user.email || null,
      role: 'portal_customer',
      purpose,
      sse: true
    },
    JWT_SECRET,
    { expiresIn: '5m' }
  );
}

const ensurePortalSchema = () => {
  return new Promise((resolve, reject) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS portal_users (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT,
        phone TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'invited')),
        last_login_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
};

const registerPortalUser = async ({ id, customer_id, email, password, full_name, phone, status = 'active' }) => {
  const portalUserId = id || genId('pusr');
  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO portal_users (id, customer_id, email, password_hash, full_name, phone, status)
       VALUES (?, ?, ?, ?, ?, ? , ?)`,
      [portalUserId, customer_id, email.toLowerCase().trim(), password_hash, full_name || null, phone || null, status],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE')) return reject(new Error('Email already registered'));
          return reject(err);
        }
        upsertSupabasePortalAuth(customer_id, { email: email.toLowerCase().trim(), password_hash, status }).catch(() => {});
        resolve({ id: portalUserId, customer_id, email, full_name, phone, status });
      }
    );
  });
};

const authenticatePortalUser = (email, password) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, customer_id, email, password_hash, full_name, phone, status
       FROM portal_users WHERE email = ?`,
      [email.toLowerCase().trim()],
      async (err, row) => {
        if (err) return reject(err);
        if (!row) {
          // SQLite portal_users may have been reset by a redeploy (ephemeral disk
          // on Render). Fall back to the account mirror in Supabase customers.data.
          return resolve(await authenticatePortalUserFromSupabase(email.toLowerCase().trim(), password));
        }
        if (row.status !== 'active') return resolve(null);
        const match = await bcrypt.compare(password, row.password_hash);
        if (!match) return resolve(null);
        db.run(`UPDATE portal_users SET last_login_at = datetime('now') WHERE id = ?`, [row.id]);
        resolve({
          id: row.id,
          customer_id: row.customer_id,
          email: row.email,
          full_name: row.full_name,
          phone: row.phone
        });
      }
    );
  });
};

// Authenticate against the account mirror stored in Supabase customers.data and,
// on success, restore the local SQLite row so sessions/refresh flows keep working
// for the remainder of this deployment.
const authenticatePortalUserFromSupabase = async (email, password) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('placeholder')) {
    console.warn(`[PortalAuth] Supabase fallback DISABLED for ${email}: URL=${SUPABASE_URL || '(unset)'} KEY=${SUPABASE_ANON_KEY ? '(set)' : '(unset)'} (secret=${process.env.SUPABASE_SECRET_KEY ? 'yes' : 'no'}, publishable=${process.env.SUPABASE_PUBLISHABLE_KEY ? 'yes' : 'no'})`);
    return null;
  }
  try {
    const { data } = await axios.get(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/customers`, {
      params: { select: 'id,data', 'data->>portalEmail': `eq.${email}`, limit: 1 },
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      timeout: 5000,
    });
    if (!Array.isArray(data) || data.length === 0) {
      console.warn(`[PortalAuth] Supabase fallback: no customer found for ${email}`);
      return null;
    }
    const row = data[0];
    const info = (row.data && typeof row.data === 'object') ? row.data : {};
    const hash = info.portalPasswordHash;
    if (!hash || !info.portalUserId) {
      console.warn(`[PortalAuth] Supabase fallback: no portal mirror for ${email} (customer ${row.id})`);
      return null;
    }
    if (info.portalStatus && info.portalStatus !== 'active') {
      console.warn(`[PortalAuth] Supabase fallback: account ${email} is not active (${info.portalStatus})`);
      return null;
    }
    const match = await bcrypt.compare(password, hash);
    if (!match) {
      console.warn(`[PortalAuth] Supabase fallback: password mismatch for ${email} (customer ${row.id})`);
      return null;
    }
    console.log(`[PortalAuth] Supabase fallback: authenticated ${email} (customer ${row.id})`);
    await new Promise((res) => {
      db.run(
        `INSERT OR IGNORE INTO portal_users (id, customer_id, email, password_hash, full_name, phone, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [info.portalUserId, row.id, email, hash, info.name || '', info.phone || '', 'active'],
        (e) => res(!e)
      );
    });
    return {
      id: info.portalUserId,
      customer_id: row.id,
      email,
      full_name: info.name || '',
      phone: info.phone || ''
    };
  } catch (err) {
    console.warn(`[PortalAuth] Supabase fallback ERROR for ${email}: ${err.message}`);
    return null;
  }
};

// Best-effort mirror of the portal account (email + bcrypt hash + status) into
// Supabase customers.data so portal login survives redeploys that wipe the
// ephemeral SQLite. SUPABASE_SECRET_KEY (when configured) bypasses RLS.
const upsertSupabasePortalAuth = async (customerId, { email, password_hash, status }) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('placeholder') || !customerId) return;
  try {
    const base = `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/customers`;
    const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' };
    const { data: rows } = await axios.get(base, {
      params: { id: `eq.${customerId}`, select: 'data' },
      headers,
      timeout: 5000,
    });
    if (!Array.isArray(rows) || rows.length === 0) return;
    const current = (rows[0].data && typeof rows[0].data === 'object') ? rows[0].data : {};
    const next = {
      ...current,
      portalEmail: email || current.portalEmail,
      portalPasswordHash: password_hash || current.portalPasswordHash,
      portalStatus: status || current.portalStatus,
    };
    await axios.patch(base, { data: next }, { params: { id: `eq.${customerId}` }, headers, timeout: 5000 });
  } catch (err) {
    console.warn('[PortalAuth] Supabase portal-auth sync failed:', err.message);
  }
};

const findCustomerInSupabase = async (customerId) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('placeholder')) return null;
  try {
    const { data } = await axios.get(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/customers`, {
      params: { id: `eq.${customerId}`, select: 'id,data' },
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      timeout: 5000,
    });
    if (!Array.isArray(data) || data.length === 0) return null;
    const row = data[0];
    const domain = (row.data && typeof row.data === 'object') ? row.data : {};
    return {
      id: row.id,
      name: domain.name || row.name || '',
      email: domain.email || row.email || '',
      phone: domain.phone || row.phone || '',
      address: domain.address || '',
      city: domain.city || '',
      state: domain.state || '',
      zip: domain.zip || '',
      country: domain.country || '',
      balance: domain.balance || 0,
      walletBalance: domain.walletBalance || 0,
      creditLimit: domain.creditLimit || 0,
      outstandingBalance: domain.outstandingBalance || 0,
      status: domain.status || row.status || '',
    };
  } catch {
    return null;
  }
};

const findCustomerByPortalUserId = async (portalUserId) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('placeholder')) return null;
  try {
    const { data } = await axios.get(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/customers`, {
      params: { select: 'id,data', 'data->>portalUserId': `eq.${portalUserId}`, limit: 1 },
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      timeout: 5000,
    });
    if (!Array.isArray(data) || data.length === 0) return null;
    return {
      id: data[0].id,
      data: (data[0].data && typeof data[0].data === 'object') ? data[0].data : {},
    };
  } catch {
    return null;
  }
};

const finishPortalLogin = (existing, customer, resolve) => {
  if (!existing) return resolve(null);
  if (existing.status !== 'active') return resolve(null);
  db.run(`UPDATE portal_users SET last_login_at = datetime('now') WHERE id = ?`, [existing.id]);
  resolve({
    id: existing.id,
    customer_id: existing.customer_id,
    email: existing.email || customer.email || '',
    full_name: existing.full_name || customer.name,
    phone: existing.phone || customer.phone || ''
  });
};

const resolvePortalUserForCustomer = (customer, fullName) => {
  return new Promise((resolve, reject) => {
    if (String(customer.name || '').trim().toLowerCase() !== String(fullName || '').trim().toLowerCase()) {
      return resolve(null);
    }
    const customerId = customer.customer_id || customer.id;
    db.get(
      `SELECT id, customer_id, email, full_name, phone, status FROM portal_users WHERE customer_id = ?`,
      [customerId],
      (err, existing) => {
        if (err) return reject(err);
        finishPortalLogin(existing, customer, resolve);
      }
    );
  });
};

const loginWithCustomerId = (customerId, fullName) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, name, email, phone FROM customers WHERE id = ?`,
      [customerId],
      async (err, customer) => {
        if (err) return reject(err);
        if (customer) {
          try {
            return resolve(await resolvePortalUserForCustomer(customer, fullName));
          } catch (e) {
            return reject(e);
          }
        }
        // The ERP app is local-first and syncs real customer data to Supabase;
        // the backend customers table may be empty. Fall back to Supabase.
        try {
          const cloudCustomer = await findCustomerInSupabase(customerId);
          if (!cloudCustomer) return resolve(null);
          return resolve(await resolvePortalUserForCustomer({ ...cloudCustomer, customer_id: cloudCustomer.id }, fullName));
        } catch (e) {
          return reject(e);
        }
      }
    );
  });
};

const getPortalUserById = (id) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, customer_id, email, full_name, phone, status, last_login_at, created_at
       FROM portal_users WHERE id = ?`,
      [id],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
};

const getPortalUserByCustomerId = (customerId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, customer_id, email, full_name, phone, status, last_login_at, created_at
       FROM portal_users WHERE customer_id = ?`,
      [customerId],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
};

const getPortalUserByEmail = (email) => {
  return new Promise((resolve, reject) => {
    const params = [String(email || '').toLowerCase().trim()];
    db.get(
      `SELECT id, customer_id, email, full_name, phone, status, last_login_at, created_at
       FROM portal_users WHERE email = ?`,
      params,
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
};

const createPasswordReset = (portalUserId, code, expiresAt) => {
  const id = genId('prst');
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO portal_password_resets (id, portal_user_id, code, expires_at)
       VALUES (?, ?, ?, ?)`,
      [id, portalUserId, code, expiresAt],
      (err) => {
        if (err) return reject(err);
        resolve({ id, code });
      }
    );
  });
};

const findValidPasswordReset = (portalUserId, code) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM portal_password_resets
       WHERE portal_user_id = ? AND code = ? AND used_at IS NULL AND expires_at > datetime('now')
       ORDER BY created_at DESC LIMIT 1`,
      [portalUserId, code],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
};

const markPasswordResetUsed = (resetId) => {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE portal_password_resets SET used_at = datetime('now') WHERE id = ?`, [resetId], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
};

const revokeUserPasswordResets = (portalUserId) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE portal_password_resets SET used_at = datetime('now') WHERE portal_user_id = ? AND used_at IS NULL`,
      [portalUserId],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
};

const createInviteCode = async (portalUserId) => {
  const code = crypto.randomInt(100000, 1000000).toString();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await revokeUserPasswordResets(portalUserId);
  await createPasswordReset(portalUserId, code, expiresAt);
  return { code, expires_at: expiresAt };
};

const setPortalUserStatus = (id, status) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT customer_id FROM portal_users WHERE id = ?`, [id], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve();
      db.run(
        `UPDATE portal_users SET status = ?, updated_at = datetime('now') WHERE id = ?`,
        [status, id],
        (uerr) => {
          if (uerr) return reject(uerr);
          upsertSupabasePortalAuth(row.customer_id, { status }).catch(() => {});
          resolve();
        }
      );
    });
  });
};

const activatePortalUser = async ({ customer_id, code, password }) => {
  const user = await getPortalUserByCustomerId(customer_id);
  if (!user) {
    const err = new Error('Invalid customer ID or invite code');
    err.code = 'INVALID_INVITE';
    throw err;
  }
  if (user.status !== 'invited') {
    const err = new Error('This account has no pending invite. Please sign in or use forgot password.');
    err.code = 'NOT_INVITED';
    throw err;
  }
  const reset = await findValidPasswordReset(user.id, String(code).trim());
  if (!reset) {
    const err = new Error('Invalid or expired invite code');
    err.code = 'INVALID_CODE';
    throw err;
  }
  await updatePassword(user.id, password);
  await markPasswordResetUsed(reset.id);
  await setPortalUserStatus(user.id, 'active');
  await revokeAllSessions(user.id);
  return getPortalUserById(user.id);
};

const updatePortalUser = (id, fields) => {
  const allowed = ['full_name', 'phone', 'email', 'address', 'city', 'state', 'zip', 'country'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(key === 'email' ? String(fields[key]).toLowerCase().trim() : fields[key]);
    }
  }
  if (sets.length === 0) return Promise.resolve();
  sets.push(`updated_at = datetime('now')`);
  params.push(id);
  return new Promise((resolve, reject) => {
    db.run(`UPDATE portal_users SET ${sets.join(', ')} WHERE id = ?`, params, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
};

const changePassword = async (id, currentPassword, newPassword) => {
  const user = await new Promise((resolve, reject) => {
    db.get(`SELECT password_hash FROM portal_users WHERE id = ?`, [id], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
  if (!user) throw new Error('User not found');
  if (user.password_hash) {
    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) throw new Error('Current password is incorrect');
  }
  const password_hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  return new Promise((resolve, reject) => {
    db.run(`UPDATE portal_users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`, [password_hash, id], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
};

const updatePassword = async (id, newPassword) => {
  const password_hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  return new Promise((resolve, reject) => {
    db.get(`SELECT customer_id, email FROM portal_users WHERE id = ?`, [id], (err, row) => {
      if (err) return reject(err);
      if (!row) return reject(new Error('User not found'));
      db.run(
        `UPDATE portal_users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`,
        [password_hash, id],
        (uerr) => {
          if (uerr) return reject(uerr);
          upsertSupabasePortalAuth(row.customer_id, { email: row.email, password_hash }).catch(() => {});
          resolve();
        }
      );
    });
  });
};

function createSession(portalUserId, refreshToken, ipAddress, userAgent) {
  const id = genId('pses');
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO portal_sessions (id, portal_user_id, refresh_token_hash, expires_at, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, portalUserId, tokenHash, expiresAt, ipAddress || null, userAgent || null],
      (err) => {
        if (err) return reject(err);
        resolve({ id, expiresAt });
      }
    );
  });
}

function findSessionByRefreshToken(refreshToken) {
  const tokenHash = hashToken(refreshToken);
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, portal_user_id, expires_at, revoked_at
       FROM portal_sessions WHERE refresh_token_hash = ?`,
      [tokenHash],
      (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(null);
        if (row.revoked_at) return resolve(null);
        if (new Date(row.expires_at) < new Date()) return resolve(null);
        resolve(row);
      }
    );
  });
}

function revokeSession(sessionId) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE portal_sessions SET revoked_at = datetime('now') WHERE id = ?`, [sessionId], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function revokeAllSessions(portalUserId) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE portal_sessions SET revoked_at = datetime('now') WHERE portal_user_id = ? AND revoked_at IS NULL`, [portalUserId], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function revokeSessionById(sessionId, portalUserId) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE portal_sessions SET revoked_at = datetime('now') WHERE id = ? AND portal_user_id = ? AND revoked_at IS NULL`,
      [sessionId, portalUserId],
      function (err) {
        if (err) return reject(err);
        resolve(!!this.changes);
      }
    );
  });
}

function recordLoginHistory(portalUserId, ip, userAgent) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO portal_login_history (portal_user_id, ip_address, user_agent)
       VALUES (?, ?, ?)`,
      [portalUserId, ip || null, userAgent || null],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

function listSessions(portalUserId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, portal_user_id, expires_at, revoked_at, created_at, user_agent, ip_address
       FROM portal_sessions
       WHERE portal_user_id = ? AND revoked_at IS NULL AND expires_at > datetime('now')
       ORDER BY created_at DESC`,
      [portalUserId],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      }
    );
  });
}

// ─── Two-Factor Authentication (TOTP) ─────────────────────────────────────

const TOTP_WINDOW = 1; // Accept tokens within 30s window (1 step before/after)

function generateTwoFactorSecret(portalUserId, email, serviceName) {
  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(email, serviceName || 'Prime ERP', email);
  return { secret, otpauth };
}

async function saveTwoFactorSecret(portalUserId, secret) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE portal_users SET two_factor_secret = ?, updated_at = datetime('now') WHERE id = ?`,
      [secret, portalUserId],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

async function verifyTwoFactorToken(secret, token) {
  try {
    return authenticator.check(token, secret, TOTP_WINDOW);
  } catch {
    return false;
  }
}

async function enableTwoFactor(portalUserId, token) {
  const user = await new Promise((resolve, reject) => {
    db.get(`SELECT two_factor_secret FROM portal_users WHERE id = ?`, [portalUserId], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
  if (!user || !user.two_factor_secret) {
    const err = new Error('No 2FA secret found');
    err.code = 'NO_SECRET';
    throw err;
  }
  if (!verifyTwoFactorToken(user.two_factor_secret, token)) {
    const err = new Error('Invalid verification code');
    err.code = 'INVALID_TOKEN';
    throw err;
  }
  await new Promise((resolve, reject) => {
    db.run(
      `UPDATE portal_users SET two_factor_enabled = 1, two_factor_confirmed = 1, updated_at = datetime('now') WHERE id = ?`,
      [portalUserId],
      (err) => { if (err) return reject(err); resolve(); }
    );
  });
}

async function disableTwoFactor(portalUserId, token) {
  const user = await new Promise((resolve, reject) => {
    db.get(`SELECT two_factor_secret, two_factor_enabled FROM portal_users WHERE id = ?`, [portalUserId], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
  if (!user || user.two_factor_enabled !== 1) {
    const err = new Error('Two-factor authentication is not enabled');
    err.code = 'NOT_ENABLED';
    throw err;
  }
  if (user.two_factor_secret && !verifyTwoFactorToken(user.two_factor_secret, token)) {
    const err = new Error('Invalid verification code');
    err.code = 'INVALID_TOKEN';
    throw err;
  }
  await new Promise((resolve, reject) => {
    db.run(
      `UPDATE portal_users SET two_factor_enabled = 0, two_factor_secret = NULL, two_factor_confirmed = 0, updated_at = datetime('now') WHERE id = ?`,
      [portalUserId],
      (err) => { if (err) return reject(err); resolve(); }
    );
  });
}

async function isTwoFactorEnabled(portalUserId) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT two_factor_enabled FROM portal_users WHERE id = ?`, [portalUserId], (err, row) => {
      if (err) return reject(err);
      resolve(row && row.two_factor_enabled === 1);
    });
  });
}

async function getTwoFactorStatus(portalUserId) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT two_factor_enabled, two_factor_confirmed FROM portal_users WHERE id = ?`, [portalUserId], (err, row) => {
      if (err) return reject(err);
      resolve({
        enabled: row?.two_factor_enabled === 1,
        confirmed: row?.two_factor_confirmed === 1,
      });
    });
  });
}

async function getTwoFactorSecret(portalUserId) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT two_factor_secret FROM portal_users WHERE id = ?`, [portalUserId], (err, row) => {
      if (err) return reject(err);
      resolve(row?.two_factor_secret || null);
    });
  });
}

module.exports = {
  ensurePortalSchema,
  registerPortalUser,
  authenticatePortalUser,
  loginWithCustomerId,
  findCustomerInSupabase,
  findCustomerByPortalUserId,
  getPortalUserById,
  getPortalUserByCustomerId,
  getPortalUserByEmail,
  createPasswordReset,
  findValidPasswordReset,
  markPasswordResetUsed,
  revokeUserPasswordResets,
  updatePortalUser,
  changePassword,
  updatePassword,
  createInviteCode,
  setPortalUserStatus,
  activatePortalUser,
  createSession,
  findSessionByRefreshToken,
  revokeSession,
  revokeAllSessions,
  revokeSessionById,
  recordLoginHistory,
  listSessions,
  generateTwoFactorSecret,
  saveTwoFactorSecret,
  verifyTwoFactorToken,
  enableTwoFactor,
  disableTwoFactor,
  isTwoFactorEnabled,
  getTwoFactorStatus,
  getTwoFactorSecret,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY_DAYS,
  generateEventTicket
};
