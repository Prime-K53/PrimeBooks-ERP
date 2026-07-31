const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const axios = require('axios');
const { db } = require('../db.cjs');

const SALT_ROUNDS = 10;
const ACCESS_TOKEN_EXPIRY = '30m';
const REFRESH_TOKEN_EXPIRY_DAYS = 30;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

function genId(prefix = 'pusr') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
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
        company_id TEXT NOT NULL DEFAULT '',
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

const registerPortalUser = async ({ customer_id, email, password, full_name, phone, company_id }) => {
  const id = genId('pusr');
  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO portal_users (id, customer_id, email, password_hash, full_name, phone, company_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, customer_id, email.toLowerCase().trim(), password_hash, full_name || null, phone || null, company_id || ''],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE')) return reject(new Error('Email already registered'));
          return reject(err);
        }
        resolve({ id, customer_id, email, full_name, phone, company_id });
      }
    );
  });
};

const authenticatePortalUser = (email, password) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, customer_id, email, password_hash, full_name, phone, status, company_id
       FROM portal_users WHERE email = ?`,
      [email.toLowerCase().trim()],
      async (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(null);
        if (row.status !== 'active') return resolve(null);
        const match = await bcrypt.compare(password, row.password_hash);
        if (!match) return resolve(null);
        db.run(`UPDATE portal_users SET last_login_at = datetime('now') WHERE id = ?`, [row.id]);
        resolve({
          id: row.id,
          customer_id: row.customer_id,
          email: row.email,
          full_name: row.full_name,
          phone: row.phone,
          company_id: row.company_id || ''
        });
      }
    );
  });
};

const findCustomerInSupabase = async (customerId) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('placeholder')) return null;
  try {
    const { data } = await axios.get(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/customers`, {
      params: { id: `eq.${customerId}`, select: 'id,company_id,data' },
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
      company_id: row.company_id || domain.company_id || '',
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
    phone: existing.phone || customer.phone || '',
    company_id: existing.company_id || ''
  });
};

const resolvePortalUserForCustomer = (customer, fullName) => {
  return new Promise((resolve, reject) => {
    if (String(customer.name || '').trim().toLowerCase() !== String(fullName || '').trim().toLowerCase()) {
      return resolve(null);
    }
    const customerId = customer.customer_id || customer.id;
    const company_id = customer.company_id || '';
    db.get(
      `SELECT id, customer_id, email, full_name, phone, status, company_id FROM portal_users WHERE customer_id = ? AND company_id = ?`,
      [customerId, company_id],
      (err, existing) => {
        if (err) return reject(err);
        if (existing) return finishPortalLogin(existing, customer, resolve);
        // Fallback: match on customer_id alone when stored company_id differs
        db.get(
          `SELECT id, customer_id, email, full_name, phone, status, company_id FROM portal_users WHERE customer_id = ?`,
          [customerId],
          (err2, row) => {
            if (err2) return reject(err2);
            finishPortalLogin(row, customer, resolve);
          }
        );
      }
    );
  });
};

const loginWithCustomerId = (customerId, fullName) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, name, email, phone, company_id FROM customers WHERE id = ?`,
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
      `SELECT id, customer_id, email, full_name, phone, status, company_id, last_login_at, created_at
       FROM portal_users WHERE id = ?`,
      [id],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
};

const getPortalUserByCustomerId = (customerId, companyId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, customer_id, email, full_name, phone, status, company_id, last_login_at, created_at
       FROM portal_users WHERE customer_id = ? AND company_id = ?`,
      [customerId, companyId],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
};

const getPortalUserByEmail = (email, companyId) => {
  return new Promise((resolve, reject) => {
    const params = [String(email || '').toLowerCase().trim()];
    let where = 'email = ?';
    if (companyId !== undefined && companyId !== null) {
      where += ' AND company_id = ?';
      params.push(companyId);
    }
    db.get(
      `SELECT id, customer_id, email, full_name, phone, status, company_id, last_login_at, created_at
       FROM portal_users WHERE ${where}`,
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

const updatePortalUser = (id, fields) => {
  const allowed = ['full_name', 'phone', 'email'];
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
    db.run(`UPDATE portal_users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`, [password_hash, id], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
};

function createSession(portalUserId, companyId, refreshToken) {
  const id = genId('pses');
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO portal_sessions (id, portal_user_id, refresh_token_hash, expires_at, company_id)
       VALUES (?, ?, ?, ?, ?)`,
      [id, portalUserId, tokenHash, expiresAt, companyId || ''],
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
      `SELECT id, portal_user_id, company_id, expires_at, revoked_at
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

module.exports = {
  ensurePortalSchema,
  registerPortalUser,
  authenticatePortalUser,
  loginWithCustomerId,
  findCustomerInSupabase,
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
  createSession,
  findSessionByRefreshToken,
  revokeSession,
  revokeAllSessions,
  recordLoginHistory,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY_DAYS
};
