const bcrypt = require('bcryptjs');
const axios = require('axios');
const { db } = require('../db.cjs');

const SALT_ROUNDS = 10;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const ensureAuthSchema = () => {
  return new Promise((resolve, reject) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'Clerk',
        permissions TEXT DEFAULT '[]',
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
};

const registerUser = async ({ username, email, password, role = 'Clerk', permissions = []}) => {
  const id = `usr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
  const permissionsJson = JSON.stringify(permissions);

  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO users (id, username, email, password_hash, role, permissions)
       VALUES (?, ?, ?, ?, ?, ? )`,
      [id, username, email || null, password_hash, role, permissionsJson],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return reject(new Error('Username already exists'));
          }
          return reject(err);
        }
        resolve({ id, username, email, role, permissions });
      }
    );
  });
};

// Best-effort mirror of a Supabase Auth staff account into the local users
// table so /auth/me and the portal admin staff list work for web logins.
const upsertLocalStaffUser = (user) => {
  return new Promise((resolve) => {
    const permissionsJson = JSON.stringify(user.permissions || []);
    db.run(
      `INSERT INTO users (id, username, email, password_hash, role, permissions, is_active)
       VALUES (?, ?, ?, 'supabase-auth', ?, ?, 1)
       ON CONFLICT(username) DO UPDATE SET
         email = COALESCE(NULLIF(EXCLUDED.email, ''), users.email),
         role = EXCLUDED.role,
         permissions = EXCLUDED.permissions,
         is_active = 1`,
      [user.id, user.username, user.email || null, user.role || 'Clerk', permissionsJson],
      (err) => resolve(!err)
    );
  });
};

const authenticateUser = (usernameOrEmail, password) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, username, email, password_hash, role, permissions, is_active FROM users WHERE username = ? OR email = ?`,
      [usernameOrEmail, usernameOrEmail],
      async (err, row) => {
        if (err) return reject(err);
        if (row) {
          if (!row.is_active) return resolve(null);
          const match = await bcrypt.compare(password, row.password_hash);
          if (!match) return resolve(null);
          return resolve({
            id: row.id,
            username: row.username,
            email: row.email,
            role: row.role,
            permissions: JSON.parse(row.permissions || '[]')
          });
        }

        // Staff accounts are created in Supabase Auth by the ERP. The deployed
        // backend's SQLite users table may be empty (ephemeral disk on Render),
        // so fall back to authenticating against Supabase Auth directly.
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('placeholder')) {
          return resolve(null);
        }
        try {
          const { data } = await axios.post(
            `${SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/token?grant_type=password`,
            { email: String(usernameOrEmail).trim().toLowerCase(), password },
            {
              headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
              timeout: 8000
            }
          );
          if (!data?.user?.id) return resolve(null);
          const meta = data.user.user_metadata || {};
          const staff = {
            id: data.user.id,
            username: data.user.email || data.user.id,
            email: data.user.email || null,
            role: meta.role || 'Admin',
            permissions: Array.isArray(meta.permissions) ? meta.permissions : [],
            is_super_admin: meta.is_super_admin === true
          };
          upsertLocalStaffUser(staff).catch(() => {});
          return resolve(staff);
        } catch {
          return resolve(null);
        }
      }
    );
  });
};

const getUserById = (id) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, username, email, role, permissions, is_active, created_at FROM users WHERE id = ?`,
      [id],
      (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(null);
        resolve({
          ...row,
          permissions: JSON.parse(row.permissions || '[]')
        });
      }
    );
  });
};

module.exports = { ensureAuthSchema, registerUser, authenticateUser, getUserById };
