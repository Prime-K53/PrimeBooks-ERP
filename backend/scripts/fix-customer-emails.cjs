/*
 * One-off data fix: normalize the ERP customer portal emails to the
 * recommended `{name-word}@primeportal.com` pattern.
 *
 * Updates backend SQLite:
 *   - portal_users.email   (the address the customer uses to log into the portal)
 *   - customers.email      (the ERP customer row mirrored to the portal DB)
 *
 * Run with the backend stopped (or the connection may contend on the SQLite
 * file):
 *   node scripts/fix-customer-emails.cjs
 */
const { getDbPath } = require('../runtimePaths.cjs');
const sqlite3 = require('sqlite3');

const FIX = {
  'CUST-0001': 'mtakataka@primeportal.com',
  'CUST-0002': 'msungo@primeportal.com',
  'CUST-0003': 'police@primeportal.com',
};

const dbPath = getDbPath();
console.log(`[FixEmails] Using database: ${dbPath}`);

const db = new sqlite3.Database(dbPath);
db.serialize(() => {
  db.run('PRAGMA busy_timeout = 10000');

  for (const [customerId, email] of Object.entries(FIX)) {
    db.run(
      `UPDATE portal_users SET email = ?, updated_at = datetime('now') WHERE customer_id = ?`,
      [email, customerId],
      function (err) {
        if (err) {
          console.error(`[FixEmails] portal_users ${customerId}:`, err.message);
        } else {
          console.log(`[FixEmails] portal_users customer ${customerId} -> ${email} (rows: ${this.changes})`);
        }
      }
    );
    db.run(
      `UPDATE customers SET email = ? WHERE id = ?`,
      [email, customerId],
      function (err) {
        if (err) {
          console.error(`[FixEmails] customers ${customerId}:`, err.message);
        } else {
          console.log(`[FixEmails] customers ${customerId} -> ${email} (rows: ${this.changes})`);
        }
      }
    );
  }
});

db.close((err) => {
  if (err) console.error('[FixEmails] close error:', err.message);
  console.log('[FixEmails] done');
});