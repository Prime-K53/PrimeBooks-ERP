const { sendEmail } = require('./emailService.cjs');
const { getDatabase } = require('../db.cjs');
const crypto = require('crypto');
const getDb = () => getDatabase();

const requestVerification = async ({ email, purpose = 'email_verification' }) => {
  const id = crypto.randomUUID();
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  await new Promise((resolve, reject) => {
    getDb().run(
      `INSERT INTO email_verifications (id, email, code, purpose, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, email, code, purpose, expiresAt],
      function(err) {
        if (err) reject(err);
        else resolve(id);
      }
    );
  });

  await sendEmail({
    to: email,
    subject: 'Verify your email — Prime ERP',
    text: `Your verification code is: ${code}\n\nThis code expires in 30 minutes.\n\n— Prime ERP System`,
    html: `<div style="font-family:system-ui;max-width:480px;margin:0 auto;padding:24px;">
      <h2 style="color:#1e293b;margin:0 0 16px;">Verify your email</h2>
      <p style="color:#475569;margin:0 0 24px;">Use the code below to verify your email address:</p>
      <div style="background:#f1f5f9;padding:16px 24px;border-radius:8px;text-align:center;font-size:28px;font-weight:700;letter-spacing:6px;color:#0f172a;">${code}</div>
      <p style="color:#94a3b8;font-size:13px;margin:16px 0 0;">This code expires in 30 minutes.</p>
    </div>`,
  });
  return { success: true, code, expiresAt };
};

const verifyCode = async ({ email, code }) => {
  return new Promise((resolve, reject) => {
    const params = [email, code];
    getDb().get(
      `SELECT * FROM email_verifications
       WHERE email = ? AND code = ? AND purpose = 'email_verification'
         AND verified = 0 AND expires_at > datetime('now')
       ORDER BY created_at DESC LIMIT 1`,
      params,
      (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve({ success: false, error: 'Invalid or expired code' });

        getDb().run(
          'UPDATE email_verifications SET verified = 1, verified_at = datetime(\'now\') WHERE id = ?',
          [row.id],
          (err) => {
            if (err) return reject(err);
            resolve({ success: true });
          }
        );
      }
    );
  });
};

const findLatestPending = async (email) => {
  return new Promise((resolve, reject) => {
    const params = [email];
    getDb().get(
      `SELECT * FROM email_verifications
       WHERE email = ? AND verified = 0 AND expires_at > datetime('now')
       ORDER BY created_at DESC LIMIT 1`,
      params,
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
};

const sendVerificationEmail = async (email) => requestVerification({ email });

module.exports = {
  requestVerification,
  verifyCode,
  findLatestPending,
  sendVerificationEmail,
};
