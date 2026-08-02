const { randomUUID } = require('crypto');
const { getDatabase } = require('../db.cjs');

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getDb() {
  return getDatabase();
}

const idempotencyMiddleware = (options = {}) => {
  const {
    ttlMs = IDEMPOTENCY_TTL_MS,
    methods = ['POST', 'PATCH', 'PUT'],
    headerName = 'Idempotency-Key'
  } = options;

  return (req, res, next) => {
    if (!methods.includes(req.method)) {
      return next();
    }

    const key = req.headers[headerName.toLowerCase()] || req.headers[headerName];
    if (!key) {
      return next();
    }

    if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
      return res.status(400).json({
        error: 'Invalid idempotency key',
        message: 'Idempotency-Key must be a string between 8 and 128 characters'
      });
    }

    const db = getDb();

    // Check if this key was already processed
    db.get(
      'SELECT response_code, response_body, expires_at FROM idempotency_keys WHERE key = ?',
      [key],
      (err, row) => {
        if (err) return next(err);

        if (row) {
          if (new Date(row.expires_at) < new Date()) {
            // Expired key, delete it
            db.run('DELETE FROM idempotency_keys WHERE key = ?', [key]);
            return storeAndProceed();
          }
          // Return cached response
          res.status(row.response_code).json(JSON.parse(row.response_body));
          return;
        }

        storeAndProceed();

        function storeAndProceed() {
          const id = randomUUID();
          const expiresAt = new Date(Date.now() + ttlMs).toISOString();

          // Store the idempotency key before processing
          db.run(
            `INSERT INTO idempotency_keys (id, key, method, path, user_id, expires_at)
             VALUES (?, ?, ?, ?, ? , ?)`,
            [id, key, req.method, req.originalUrl || req.url, req.user?.id || null, expiresAt],
            (insertErr) => {
              if (insertErr) {
                // Key already exists (race condition) - re-check
                db.get(
                  'SELECT response_code, response_body FROM idempotency_keys WHERE key = ?',
                  [key],
                  (err2, row2) => {
                    if (row2) {
                      return res.status(row2.response_code).json(JSON.parse(row2.response_body));
                    }
                    return next();
                  }
                );
                return;
              }

              // Intercept res.json to store the response
              const originalJson = res.json.bind(res);
              res.json = function(body) {
                db.run(
                  'UPDATE idempotency_keys SET response_code = ?, response_body = ? WHERE key = ?',
                  [res.statusCode, JSON.stringify(body), key],
                  (updateErr) => {
                    if (updateErr) {
                      console.error('[Idempotency] Failed to store response:', updateErr.message);
                    }
                  }
                );
                return originalJson(body);
              };

              next();
            }
          );
        }
      }
    );
  };
};

module.exports = { idempotencyMiddleware };
