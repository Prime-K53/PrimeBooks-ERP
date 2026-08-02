const bcrypt = require('bcryptjs');
const { db } = require('../db.cjs');

const SALT_ROUNDS = 10;

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

const authenticateUser = (usernameOrEmail, password) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, username, email, password_hash, role, permissions, is_active FROM users WHERE username = ? OR email = ?`,
      [usernameOrEmail, usernameOrEmail],
      async (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(null);
        if (!row.is_active) return resolve(null);

        const match = await bcrypt.compare(password, row.password_hash);
        if (!match) return resolve(null);

        resolve({
          id: row.id,
          username: row.username,
          email: row.email,
          role: row.role,
          permissions: JSON.parse(row.permissions || '[]')
        });
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
