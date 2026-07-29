try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch {}
console.log('--- SERVER SCRIPT STARTING ---');
console.log('Requiring express...');
const express = require('express');
let helmet, rateLimit;
try { helmet = require('helmet'); } catch { /* optional - not installed */ }
try { rateLimit = require('express-rate-limit'); } catch { /* optional - not installed */ }
console.log('Requiring cors...');
const cors = require('cors');
console.log('Requiring body-parser...');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { getFrontendDistPath } = require('./appRoot.cjs');
console.log('Requiring db...');
const { db } = require('./db.cjs');
console.log('Requiring bootstrap...');
const bootstrap = require('./bootstrap.cjs');
console.log('Imports done.');

const TONER_MG_PER_SHEET = 20; 

// Safe formula evaluator - replaces eval/new Function with controlled AST evaluation
const app = express();
let PORT = process.env.PORT || 3000;

// Trust proxy for Render/Heroku behind reverse proxy
app.set('trust proxy', 1);


const ensurePortAvailable = (candidatePort) => {
  const normalizedPort = Number(candidatePort);
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', (error) => {
      if (error?.code === 'EADDRINUSE') {
        reject(new Error(`Port ${normalizedPort} is already in use`));
        return;
      }
      reject(error);
    });
    probe.once('listening', () => {
      probe.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve();
      });
    });
    probe.listen(normalizedPort, '0.0.0.0');
  });
};

const closeDbAndExit = (code = 1) => {
  try {
    db.close(() => process.exit(code));
    setTimeout(() => process.exit(code), 1000);
  } catch {
    process.exit(code);
  }
};

const SQLITE_CONSTRAINT_CODES = new Set([
  'SQLITE_CONSTRAINT',
  'SQLITE_UNIQUE',
  'SQLITE_PRIMARYKEY',
]);

function handleInsertConstraintError(res, err, context = 'Create') {
  if (SQLITE_CONSTRAINT_CODES.has(err?.code)) {
    return res.status(409).json({
      error: `${context} failed: ID or unique constraint collision. Please try saving again.`
    });
  }
  return res.status(500).json({ error: err?.message || `Failed to ${context.toLowerCase()}` });
}

// Security Middleware
try {
  const helmet = require('helmet');
  app.use(helmet());
} catch (e) {
  console.warn('[Security] helmet is not available:', e && e.message);
}

// Rate Limiting
try {
  const rateLimit = require('express-rate-limit');
  const limiter = rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: Number(process.env.RATE_LIMIT_MAX) || 200, // Limit each IP
    standardHeaders: true,
    legacyHeaders: false
  });
  app.use(limiter);
} catch (e) {
  console.warn('[Security] express-rate-limit is not available:', e && e.message);
}

// Additional security headers applied to all responses
app.use((req, res, next) => {
  try {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Referrer-Policy', process.env.REFERRER_POLICY || 'no-referrer-when-downgrade');
    // HSTS enabled in production; configurable via env for dev
    if (process.env.ENABLE_HSTS === 'true' || process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    // Minimal CSP to mitigate inline script attacks; configurable via env
    const csp = process.env.CONTENT_SECURITY_POLICY || "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:;";
    res.setHeader('Content-Security-Policy', csp);
  } catch (err) {
    // Non-fatal: continue request handling
    console.warn('[Security] failed to set some headers:', err && err.message);
  }
  next();
});

app.use((req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] || randomUUID();
  req.correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'info',
    event: 'http_request',
    correlationId,
    method: req.method,
    path: req.url
  }));
  next();
});

// Audit middleware for correlation ID propagation and context capture
const { auditContextMiddleware, auditAuthMiddleware, auditCrudMiddleware } = require('./auditMiddleware.cjs');
const { validateTransactionPrice, calculateSellingPrice } = require('./services/pricingEngine.cjs');
const { verifyToken, requireRole, requirePermission } = require('./middleware/auth.cjs');
const { tenantContext } = require('./middleware/tenantContext.cjs');
const { injectFinancialYear, addFyDateFilter, requireFyNotClosed } = require('./middleware/financialYearMiddleware.cjs');
const { validateBody, sanitizeInput, inventorySchemas, salesSchemas, userSchemas, financialSchemas, productionSchemas, documentSchemas, exchangeSchemas, orderSchemas, classSchemas, subjectSchemas, notificationSchemas, accountSchemas, expenseSchemas, incomeSchemas, budgetSchemas, transferSchemas } = require('./middleware/validation.cjs');
const CurrencyMiddleware = require('./middleware/currencyMiddleware.cjs');
const { createLimiter, authLimiter, sensitiveLimiter } = require('./services/redisRateLimiter.cjs');
const authRoutes = require('./routes/auth.cjs');
app.use(auditContextMiddleware);

// CORS configuration - accepts all local/LAN origins for browser-based access
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) {
      return callback(null, true);
    }
    // Allow origins from CORS_ORIGIN env var (comma-separated list)
    const envOrigins = process.env.CORS_ORIGIN;
    if (envOrigins) {
      const allowed = envOrigins.split(',').map(s => s.trim()).filter(Boolean);
      if (allowed.includes(origin)) {
        return callback(null, true);
      }
    }
    const normalizedOrigin = normalizeCorsOrigin(origin);
    if (isDesktopLocalOrigin(normalizedOrigin)) {
      return callback(null, true);
    }
    try {
      const parsed = new URL(normalizedOrigin);
      const hostname = parsed.hostname;
      if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
          /^10\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
          /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname === '0.0.0.0') {
        return callback(null, true);
      }
    } catch {
      // Fall through to permissive echo
    }
    // Permissive fallback: echo back the origin so CORS works for any production domain
    return callback(null, origin);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-mode', 'x-correlation-id', 'x-company-id', 'x-idempotency-key', 'x-user-id', 'x-user-role', 'x-user-email', 'x-user-is-super-admin', 'x-dev-bypass'],
  credentials: true
};

// Apply CORS middleware before auth so preflight OPTIONS get proper headers
app.use(cors(corsOptions));

// Explicit credentials header (safety net)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Credentials', 'true');
  next();
});

// Handle preflight for all routes (safe global handler)
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    const origin = req.headers['origin'];
    // Echo back the origin for any valid request (permissive CORS)
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-auth-mode, x-user-id, x-user-role, x-user-email, x-correlation-id, x-dev-bypass, x-company-id, x-idempotency-key, x-financial-year-id, x-user-is-super-admin');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');
    return res.sendStatus(204);
  }
  next();
});

// Rate limiting for API routes (after CORS so 429 responses include CORS headers)
// 600 requests per 60s window = 10 req/s average; accommodates parallel refresh bursts
app.use('/api', createLimiter({ windowMs: 60 * 1000, maxRequests: 600 }));

app.use('/api/auth', auditAuthMiddleware, authLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 10 }), authRoutes);

// Apply JWT verification to all /api routes (auth routes are skipped by verifyToken internally)
app.use('/api', verifyToken);
// Attach tenant context from x-company-id header to all /api routes
app.use('/api', tenantContext);
// Inject company currency into requests
const CurrencyService = require('./services/currencyService.cjs');
const currencyService = new CurrencyService();
const currencyMiddleware = new CurrencyMiddleware(currencyService);
app.use('/api', currencyMiddleware.injectCurrency());

// Shared helper for pricing validation
async function validateItemsPricing(items) {
  if (!items || !Array.isArray(items)) return;
  for (const item of items) {
    if (item.price != null && item.cost != null) {
      await validateTransactionPrice({
        itemId: item.itemId || item.productId || item.id,
        categoryId: item.categoryId || item.category,
        cost: item.cost,
        price: item.price,
        quantity: item.quantity || 1,
        adjustmentSnapshots: item.adjustmentSnapshots || [],
        adjustmentTotal: item.adjustmentTotal
      });
    }
  }
}




const normalizeCorsOrigin = (value) => String(value || '').trim().replace(/\/$/, '');

const isDesktopLocalOrigin = (origin) => {
  const normalized = normalizeCorsOrigin(origin);
  if (!normalized) return true;
  if (normalized === 'null') return true;
  if (/^file:\/\//i.test(normalized)) return true;

  try {
    const parsed = new URL(normalized);
    const hostname = parsed.hostname;
    // Allow localhost, 127.0.0.1, 0.0.0.0 and any port on localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return true;
    }
  } catch {
    return false;
  }
  return false;
};




// Global request logging (audit trail)
app.use((req, res, next) => {
  console.log('[REQ]', {
    method: req.method,
    url: req.originalUrl,
    origin: req.headers.origin
  });
  next();
});

app.use(express.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ limit: '5mb', extended: true }));

// Global input sanitization to prevent XSS
app.use(sanitizeInput);

const applyDocumentResponseHeaders = (res, { contentType, filename, inline = true }) => {
  const safeFilename = String(filename || 'document').replace(/"/g, '');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeFilename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
};

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// Root route - serves frontend in production or status message in dev
app.get('/', (req, res) => {
  const frontendDistPath = getFrontendDistPath();
  const indexPath = path.join(frontendDistPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send('Backend Running');
  }
});

// Health check for monitoring and Docker orchestration
app.get('/health', (req, res) => {
  const checks = {
    status: 'ok',
    server: 'running',
    database: 'unknown',
    redis: 'not_configured',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    node: process.version,
    platform: process.platform,
  };
  try {
    db.get('SELECT 1 AS alive', (err, row) => {
      if (err) {
        checks.database = 'error';
        checks.status = 'degraded';
        return res.status(503).json({ ...checks, error: err.message });
      }
      checks.database = row?.alive === 1 ? 'connected' : 'error';
      checks.status = checks.database === 'connected' ? 'ok' : 'degraded';

      // Check Redis if configured
      if (process.env.REDIS_URL) {
        try {
          const { isRedisAvailable } = require('./services/redisRateLimiter.cjs');
          checks.redis = isRedisAvailable() ? 'connected' : 'disconnected';
        } catch {
          checks.redis = 'error';
        }
      }

      res.status(checks.status === 'ok' ? 200 : 503).json(checks);
    });
  } catch (err) {
    checks.database = 'error';
    checks.status = 'error';
    res.status(503).json({ ...checks, error: err.message });
  }
});

function validateEnv() {
  const required = ['JWT_SECRET', 'SESSION_SECRET'];
  const missing = required.filter(k => !process.env[k] || process.env[k] === 'your-secret-key-here');
  if (missing.length) {
    console.error(`[ENV] FATAL: Missing or default secrets: ${missing.join(', ')}`);
    console.error('[ENV] Set these in .env or environment before starting.');
    process.exit(1);
  }
  console.log('[ENV] All required secrets present.');
}

// Helper function to post ledger entries for a sale
async function postSaleLedgerEntries(saleId, totalAmount, materialTotal, customerId, customerName, companyId, userId) {
  try {
    const FinanceService = require('./services/financeService.cjs');
    const finance = new FinanceService();
    
    // Find AR and Revenue accounts
    const arAccount = await finance.getAccounts(companyId).then(accounts => accounts.find(a => a.code === '1200' || a.name.toLowerCase().includes('accounts receivable')));
    const revenueAccount = await finance.getAccounts(companyId).then(accounts => accounts.find(a => a.code === '4000' || a.name.toLowerCase().includes('sales')));
    const cogsAccount = await finance.getAccounts(companyId).then(accounts => accounts.find(a => a.code === '5000' || a.name.toLowerCase().includes('cost of goods')));
    
    if (!arAccount || !revenueAccount) {
      console.warn('[Ledger] AR or Revenue account not found, skipping ledger posting for sale', saleId);
      return;
    }
    
    const now = new Date().toISOString();
    const journalId = `JRN-${saleId}`;
    
    // Post AR debit
    await finance.saveLedgerEntry({
      account_id: arAccount.id,
      entry_type: 'debit',
      amount: totalAmount,
      currency: 'USD',
      description: `Sale #${saleId} - ${customerName}`,
      reference_type: 'sale',
      reference_id: saleId,
      journal_id: journalId,
      entry_date: now,
      created_by: userId
    }, companyId);
    
    // Post Revenue credit
    await finance.saveLedgerEntry({
      account_id: revenueAccount.id,
      entry_type: 'credit',
      amount: totalAmount,
      currency: 'USD',
      description: `Sale #${saleId} - Revenue`,
      reference_type: 'sale',
      reference_id: saleId,
      journal_id: journalId,
      entry_date: now,
      created_by: userId
    }, companyId);
    
    // Post COGS if we have material cost
    if (materialTotal > 0 && cogsAccount) {
      await finance.saveLedgerEntry({
        account_id: cogsAccount.id,
        entry_type: 'debit',
        amount: materialTotal,
        currency: 'USD',
        description: `Sale #${saleId} - COGS`,
        reference_type: 'sale',
        reference_id: saleId,
        journal_id: journalId,
        entry_date: now,
        created_by: userId
      }, companyId);
    }
    
    console.log(`[Ledger] Posted entries for sale #${saleId}`);
  } catch (error) {
    console.error(`[Ledger] Error posting entries for sale #${saleId}:`, error);
    throw error;
  }
}

// Helper function to update customer balance
async function updateCustomerBalance(customerId, amount, companyId) {
  try {
    if (!customerId || customerId === 'walk-in') return;
    
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE customers SET 
          balance = COALESCE(balance, 0) + ?,
          outstandingBalance = COALESCE(outstandingBalance, 0) + ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND company_id = ?`,
        [amount, amount, customerId, companyId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    
    console.log(`[Customer] Updated balance for customer ${customerId}: +${amount}`);
  } catch (error) {
    console.error(`[Customer] Error updating balance for ${customerId}:`, error);
    throw error;
  }
}

// Helper function to deduct inventory for a sale
async function deductInventoryForSale(items, saleId, companyId) {
  try {
    // Get default warehouse for company or use 'WH-MAIN' as fallback
    const warehouseId = await new Promise((resolve, reject) => {
      db.get(
        "SELECT warehouse_id FROM warehouse_inventory WHERE company_id = ? LIMIT 1",
        [companyId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row?.warehouse_id || 'WH-MAIN');
        }
      );
    });
    
    for (const item of items) {
      if (item.type === 'service') continue;
      
      const itemId = item.id || item.itemId;
      const quantity = item.quantity || 1;
      
      if (!itemId) continue;
      
      // Check if inventory exists
      const inventory = await new Promise((resolve, reject) => {
        db.get("SELECT * FROM inventory WHERE id = ? AND company_id = ?", [itemId, companyId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      
      if (!inventory) {
        console.warn(`[Inventory] Item ${itemId} not found, skipping deduction`);
        continue;
      }
      
      const currentQuantity = inventory.quantity || 0;
      const newQuantity = Math.max(0, currentQuantity - quantity);
      
      // Create transaction record
      const transactionId = `TXN-${saleId}-${itemId}`;
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO inventory_transactions 
            (id, item_id, warehouse_id, type, quantity, previous_quantity, new_quantity, 
              unit_cost, total_cost, reason, reference, reference_id, performed_by, timestamp, company_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            transactionId, itemId, warehouseId, 'OUT', -quantity, 
            currentQuantity, newQuantity, inventory.cost_per_unit || 0, 
            quantity * (inventory.cost_per_unit || 0),
            `POS Sale #${saleId}`, 'sale', saleId, 'system', new Date().toISOString(), companyId
          ],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      
      // Update inventory quantity
      await new Promise((resolve, reject) => {
        db.run(
          "UPDATE inventory SET quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?",
          [newQuantity, itemId, companyId],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      
      console.log(`[Inventory] Deducted ${quantity} units of ${itemId} for sale ${saleId}`);
    }
  } catch (error) {
    console.error(`[Inventory] Error deducting inventory for sale ${saleId}:`, error);
    throw error;
  }
}

async function startServer() {
  console.log('--- STARTING SERVER ---');
  validateEnv();

  if (process.env.NODE_ENV !== 'test') {
    try {
      await ensurePortAvailable(PORT);
    } catch (err) {
      console.error(`Startup aborted: ${err.message}`);
      process.exit(1);
    }
  }

  try {
    await bootstrap();
    console.log('Bootstrap finished');
  } catch (err) {
    console.error('Bootstrap failed:', err);
    process.exit(1);
  }

  // System & Licensing Endpoints
  const licenseService = require('./services/licenseService.cjs');

  // ── Financial Year validation helper ──────────────────────────────────
  const validateFyDate = async (dateField, body, companyId) => {
    if (!body[dateField]) return;
    const fySvc = new (require('./services/financialYearService.cjs'))();
    const fy = await fySvc.getFinancialYearByDate(body[dateField], companyId);
    if (!fy) {
      throw new Error(`Selected date (${body[dateField]}) does not belong to any active Financial Year. Please switch Financial Year or choose a valid date.`);
    }
    if (fy.is_closed) {
      throw new Error(`Financial Year "${fy.name}" is closed. No new transactions can be created in this period.`);
    }
  };

  app.get('/api/dashboard', injectFinancialYear, async (req, res) => {
    const daysRaw = Number(req.query?.days);
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 120) : 30;
    const financialYearId = req.query?.financial_year_id || req.financialYearId || '';

    const getOne = (query, params = []) => new Promise((resolve, reject) => {
      db.get(query, params, (error, row) => {
        if (error) reject(error);
        else resolve(row || {});
      });
    });

    const getAll = (query, params = []) => new Promise((resolve, reject) => {
      db.all(query, params, (error, rows) => {
        if (error) reject(error);
        else resolve(rows || []);
      });
    });

    try {
      const offset = `-${days - 1} days`;
      const companyId = req.companyId || '';

      let fyDateFilter = '';
      let fyParams = [];
      if (financialYearId) {
        const fy = await new Promise((resolve) => {
          db.get('SELECT start_date, end_date FROM financial_years WHERE id = ? AND company_id = ?',
            [financialYearId, companyId], (err, row) => resolve(row || null));
        });
        if (fy) {
          fyDateFilter = ' AND date(date) >= date(?) AND date(date) <= date(?)';
          fyParams = [fy.start_date, fy.end_date];
        }
      }

      const [revenueRow, todayRow, outstandingRow, chartRows, salesRows, invoiceRows] = await Promise.all([
        getOne(`SELECT SUM(total_amount) as revenue FROM sales WHERE company_id = ?${fyDateFilter}`, [companyId, ...fyParams]),
        getOne(`SELECT SUM(total_amount) as todaySales FROM sales WHERE date(date) = date('now') AND company_id = ?${fyDateFilter.replace(/AND date\(date\) >= date\(\?\) AND date\(date\) <= date\(\?\)/g, '')}`, [companyId, ...(fyParams.length ? [] : [])]),
        getOne(`SELECT COUNT(*) as outstandingInvoices FROM invoices WHERE lower(COALESCE(status, '')) != 'paid' AND company_id = ?`, [companyId]),
        getAll(
          `SELECT date(date) as day, SUM(total_amount) as total
           FROM sales
           WHERE date(date) >= date('now', ?) AND company_id = ?${fyDateFilter}
           GROUP BY date(date)
           ORDER BY day`,
          [offset, companyId, ...fyParams]
        ),
        getAll(
          `SELECT id, customer_id as customerId, customer_name as customerName, total_amount as totalAmount, date
           FROM sales
           WHERE company_id = ?${fyDateFilter}
           ORDER BY date DESC
           LIMIT 200`,
          [companyId, ...fyParams]
        ),
        getAll(
          `SELECT id, customer_id as customerId, customer_name as customerName, total_amount as totalAmount, status, created_at as createdAt
           FROM invoices
           WHERE company_id = ?${fyDateFilter}
           ORDER BY created_at DESC
           LIMIT 50`,
          [companyId, ...fyParams]
        )
      ]);

      const chartIndex = new Map(chartRows.map(row => [row.day, row.total || 0]));
      const chartData = [];
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const key = date.toISOString().slice(0, 10);
        chartData.push({
          day: key,
          total: chartIndex.get(key) || 0
        });
      }

      res.json({
        revenue: Number(revenueRow?.revenue || 0),
        todaySales: Number(todayRow?.todaySales || 0),
        outstandingInvoices: Number(outstandingRow?.outstandingInvoices || 0),
        chartData,
        sales: salesRows,
        invoices: invoiceRows
      });
    } catch (error) {
      console.error('[Dashboard] error:', error);
      res.status(500).json({ error: 'Failed to load dashboard data' });
    }
  });

  app.get('/api/sales', requireRole('Admin', 'Manager', 'Cashier', 'Accountant', 'Viewer'), injectFinancialYear, async (req, res) => {
    try {
      const companyId = req.companyId || '';
      let sql = `SELECT 
        id, date, customer_id as customerId, customer_name as customerName, sub_account_name as subAccountName,
        total_amount as totalAmount, material_total as materialTotal, adjustment_total as adjustmentTotal,
        profit_margin_total as profitMarginTotal, rounding_total as roundingTotal, other_charges as otherCharges,
        adjustment_snapshots_json as adjustmentSnapshots,
        status, payment_method as paymentMethod, source, items_json, payments_json,
        created_by, updated_by, void_reason, voided_at
       FROM sales
       WHERE company_id = ?`;
      const params = [companyId];
      const filtered = addFyDateFilter(sql, params, req, 'date');
      sql = filtered.sql + ' ORDER BY date DESC';
      const rows = await new Promise((resolve, reject) => {
        db.all(sql, filtered.params, (error, rows) => {
          if (error) reject(error);
          else resolve(rows || []);
        });
      });
      const sales = rows.map((row) => ({
        id: row.id,
        date: row.date,
        customerId: row.customerId,
        customerName: row.customerName,
        subAccountName: row.subAccountName,
        totalAmount: Number(row.totalAmount || 0),
        materialTotal: Number(row.materialTotal || 0),
        adjustmentTotal: Number(row.adjustmentTotal || 0),
        profitMarginTotal: Number(row.profitMarginTotal || 0),
        roundingTotal: Number(row.roundingTotal || 0),
        otherCharges: Number(row.otherCharges || 0),
        status: row.status,
        paymentMethod: row.paymentMethod,
        source: row.source,
        items: parseJsonArray(row.items_json),
        payments: parseJsonArray(row.payments_json),
        adjustmentSnapshots: parseJsonArray(row.adjustmentSnapshots)
      }));
      res.json(sales);
    } catch (error) {
      console.error('[Sales] GET error:', error);
      res.status(500).json({ error: 'Failed to retrieve sales' });
    }
  });

  app.post('/api/sales', requireRole('Admin', 'Manager', 'Cashier'), validateBody(salesSchemas.sale), async (req, res) => {
    const payload = req.body || {};
    
    // Idempotency check
    if (payload.idempotencyKey) {
      db.get(`SELECT id FROM sales WHERE idempotency_key = ? AND company_id = ?`, [payload.idempotencyKey, req.companyId || ''], (err, row) => {
        if (err) {
          console.error('[Backend] Idempotency check error:', err);
          return res.status(500).json({ error: 'Idempotency check failed' });
        }
        if (row) {
          console.log(`[Backend] Duplicate sale prevented by idempotency key: ${payload.idempotencyKey}`);
          return res.json({ id: row.id, message: 'Sale already processed', duplicate: true });
        }
      });
    }
    
    try {
      await validateFyDate('date', payload, req.companyId || '');
    } catch (fyError) {
      return res.status(400).json({ error: fyError.message });
    }

    try {
      await validateItemsPricing(payload.items);
    } catch (validationError) {
      console.error('[Backend] Pricing validation failed, returning generic error');
      return res.status(400).json({ error: 'Price validation failed. Please verify item pricing.', code: 'PRICE_VALIDATION_FAILED' });
    }

    const id = payload.id || randomUUID();
    const date = payload.date || new Date().toISOString();
    const totalAmount = Number(payload.totalAmount ?? payload.total ?? 0);
    const materialTotal = Number(payload.materialTotal ?? payload.material_total ?? 0);
    const adjustmentTotal = Number(payload.adjustmentTotal ?? payload.adjustment_total ?? 0);
    const profitMarginTotal = Number(payload.profitMarginTotal ?? payload.profit_margin_total ?? 0);
    const roundingTotal = Number(payload.roundingTotal ?? payload.rounding_total ?? payload.roundingDifference ?? 0);
    const otherCharges = Number(payload.otherCharges || 0);
    const subAccountName = payload.subAccountName || payload.sub_account_name || 'Main';
    
    const customerId = payload.customerId || payload.customer_id || 'walk-in';
    const customerName = payload.customerName || payload.customer_name || 'Walk-in';
    const status = payload.status || 'Paid';
    const paymentMethod = payload.paymentMethod || payload.payment_method || null;
    const source = payload.source || null;
    
    const itemsJson = JSON.stringify(payload.items || []);
    const paymentsJson = JSON.stringify(payload.payments || []);
    const snapshotsJson = JSON.stringify(payload.adjustmentSnapshots || []);
    const idempotencyKey = payload.idempotencyKey || `sale-${id}-${Date.now()}`;

    console.log(`[BACKEND] Creating POS sale #${id} for ${customerName}. Revenue: ${totalAmount}, Margin: ${profitMarginTotal}`);

    db.run("BEGIN TRANSACTION", (err) => {
      if (err) {
        console.error(`[BACKEND] Error beginning transaction for sale #${id}:`, err.message);
        return res.status(500).json({ error: 'Failed to begin transaction' });
      }
      
      // Insert sale
      db.run(
        `INSERT INTO sales (
          id, date, customer_id, customer_name, sub_account_name, 
          total_amount, material_total, adjustment_total, profit_margin_total, rounding_total, other_charges,
          adjustment_snapshots_json, status, payment_method, source, items_json, payments_json, 
          company_id, created_by, updated_by, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, date, customerId, customerName, subAccountName,
          totalAmount, materialTotal, adjustmentTotal, profitMarginTotal, roundingTotal, otherCharges,
          snapshotsJson, status, paymentMethod, source, itemsJson, paymentsJson, 
          req.companyId || '', req.user?.id || 'system', req.user?.id || 'system', idempotencyKey
        ],
        (error) => {
          if (error) {
            db.run("ROLLBACK");
            console.error(`[BACKEND] Error creating sale #${id}:`, error.message);
            return res.status(500).json({ error: 'Failed to create sale' });
          }
          
          // Insert sale items (normalized)
          const insertSaleItem = (index, items) => {
            if (index >= items.length) {
              // All items inserted, now post ledger entries and update inventory
              try {
                // Post ledger entries for the sale
                postSaleLedgerEntries(id, totalAmount, materialTotal, customerId, customerName, req.companyId || '', req.user?.id || 'system');
                
                // Update customer balance if not walk-in
                if (customerId && customerId !== 'walk-in') {
                  updateCustomerBalance(customerId, totalAmount, req.companyId || '');
                }
                
                // Deduct inventory for physical products
                const inventoryItems = payload.items.filter(item => item.type !== 'service');
                if (inventoryItems.length > 0) {
                  deductInventoryForSale(inventoryItems, id, req.companyId || '');
                }
              } catch (ledgerError) {
                console.error('[BACKEND] Error posting ledger/inventory for sale #${id}:', ledgerError);
                // Continue with commit - ledger errors are non-fatal for now
              }
              
              // All items inserted, commit transaction
              db.run("COMMIT", (commitErr) => {
                if (commitErr) {
                  db.run("ROLLBACK");
                  console.error(`[BACKEND] Error committing sale #${id}:`, commitErr.message);
                  return res.status(500).json({ error: 'Failed to commit sale' });
                }
                res.json({
                  id,
                  date,
                  customerId,
                  customerName,
                  subAccountName,
                  totalAmount,
                  materialTotal,
                  adjustmentTotal,
                  profitMarginTotal,
                  roundingTotal,
                  otherCharges,
                  status,
                  paymentMethod,
                  source,
                  items: payload.items || [],
                  payments: payload.payments || [],
                  adjustmentSnapshots: payload.adjustmentSnapshots || []
                });
              });
              return;
            }
            
            const item = items[index];
            const itemId = item.id || item.itemId || `item-${index}`;
            const itemName = item.name || item.productName || 'Unknown Item';
            const quantity = item.quantity || 1;
            const unitPrice = item.price || 0;
            const unitCost = item.cost || item.cost_price || 0;
            const lineTotal = unitPrice * quantity;
            const discount = item.discount || 0;
            const taxRate = item.taxRate || 0;
            const taxAmount = item.taxAmount || 0;
            const itemType = item.type || 'product';
            
            db.run(
              `INSERT INTO sale_items (
                id, sale_id, item_id, variant_id, item_name, quantity, unit_price, unit_cost, 
                line_total, discount, tax_rate, tax_amount, item_type, company_id
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                `${id}-item-${index}`, id, itemId, item.variantId || null, itemName, 
                quantity, unitPrice, unitCost, lineTotal, discount, taxRate, taxAmount, 
                itemType, req.companyId || ''
              ],
              (itemErr) => {
                if (itemErr) {
                  db.run("ROLLBACK");
                  console.error(`[BACKEND] Error inserting sale item #${index} for sale #${id}:`, itemErr.message);
                  return res.status(500).json({ error: 'Failed to create sale item' });
                }
                insertSaleItem(index + 1, items);
              }
            );
          };
          
          // Start inserting sale items
          insertSaleItem(0, payload.items || []);
        }
      );
    });
  });

  // --- Sales Update & Delete Routes ---
  app.put('/api/sales/:id', requireRole('Admin', 'Manager', 'Cashier'), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    const { id } = req.params;
    const payload = req.body || {};
    try {
      await validateFyDate('date', payload, req.companyId || '');
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const totalAmount = Number(payload.totalAmount ?? payload.total ?? 0);
    const materialTotal = Number(payload.materialTotal ?? payload.material_total ?? 0);
    const adjustmentTotal = Number(payload.adjustmentTotal ?? payload.adjustment_total ?? 0);
    const profitMarginTotal = Number(payload.profitMarginTotal ?? payload.profit_margin_total ?? 0);
    const roundingTotal = Number(payload.roundingTotal ?? payload.rounding_total ?? payload.roundingDifference ?? 0);
    const otherCharges = Number(payload.otherCharges || 0);
    const itemsJson = JSON.stringify(payload.items || []);
    const paymentsJson = JSON.stringify(payload.payments || []);
    const snapshotsJson = JSON.stringify(payload.adjustmentSnapshots || []);

    db.run(
      `UPDATE sales SET
        date = ?, customer_id = ?, customer_name = ?, sub_account_name = ?,
        total_amount = ?, material_total = ?, adjustment_total = ?, profit_margin_total = ?, rounding_total = ?, other_charges = ?,
        adjustment_snapshots_json = ?, status = ?, payment_method = ?, source = ?, items_json = ?, payments_json = ?
      WHERE id = ? AND company_id = ?`,
      [
        payload.date || new Date().toISOString(),
        payload.customerId || payload.customer_id || 'walk-in',
        payload.customerName || payload.customer_name || 'Walk-in',
        payload.subAccountName || payload.sub_account_name || 'Main',
        totalAmount, materialTotal, adjustmentTotal, profitMarginTotal, roundingTotal, otherCharges,
        snapshotsJson, payload.status || 'Paid', payload.paymentMethod || null, payload.source || null,
        itemsJson, paymentsJson, id, req.companyId || ''
      ],
      (error) => {
        if (error) {
          console.error(`[BACKEND] Error updating sale #${id}:`, error.message);
          return res.status(500).json({ error: 'Failed to update sale' });
        }
        res.json({ id, success: true });
      }
    );
  });

  app.delete('/api/sales/:id', injectFinancialYear, requireFyNotClosed, async (req, res) => {
    const { id } = req.params;
    try {
      const row = await new Promise((resolve, reject) => {
        db.get(`SELECT id, date FROM sales WHERE id = ? AND company_id = ?`, [id, req.companyId || ''], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      if (!row) return res.status(404).json({ error: 'Sale not found' });
      const fySvc = new (require('./services/financialYearService.cjs'))();
      await fySvc.validateTransactionDate(row.date, req.companyId || '');
      await new Promise((resolve, reject) => {
        db.run(`UPDATE sales SET status = 'Voided' WHERE id = ? AND company_id = ?`, [id, req.companyId || ''], (error) => {
          if (error) reject(error);
          else resolve(null);
        });
      });
      res.json({ id, success: true, status: 'Voided' });
    } catch (err) {
      console.error(`[BACKEND] Error voiding sale #${id}:`, err.message);
      if (err.message && err.message.includes('closed')) {
        return res.status(403).json({ error: err.message });
      }
      res.status(500).json({ error: 'Failed to void sale' });
    }
  });

  // --- Examination Module Endpoints ---
  // Apply checkPermission middleware to all examination routes that modify state
  // For GET routes, we might allow read-only access or apply granular permissions if needed
  const examinationRoutes = require('./routes/examination.cjs');
  app.use('/api/examination', (req, res, next) => {
      if (req.method !== 'GET' && !req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      next();
  }, auditCrudMiddleware('examination_batch'), examinationRoutes);

  // --- Profit Margin Settings Endpoints ---
  const settingsRoutes = require('./routes/settings.cjs');
  app.use('/api/settings', (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  }, settingsRoutes);

  // --- Tasks Endpoints ---
  const tasksRoutes = require('./routes/tasks.cjs');
  app.use('/api/tasks', (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  }, tasksRoutes);

  // --- System & Workspace Endpoints ---
  const systemRoutes = require('./routes/system.cjs');
  app.use('/api/system', verifyToken, systemRoutes);

  // --- WhatsApp Endpoints ---
  const whatsappRoutes = require('./routes/whatsapp.cjs');
  app.use('/api/whatsapp', verifyToken, whatsappRoutes);

  // --- Engagement (Loyalty, Cashback, Gift Cards, Promotions, etc.) ---
  const engagementRoutes = require('./routes/engagement.cjs');
  app.use('/api/engagement', verifyToken, engagementRoutes);

  const notificationsRoute = require('./routes/notifications.cjs');
  app.use('/api/notifications', verifyToken, notificationsRoute);

  const assetsRoute = require('./routes/assets.cjs');
  app.use('/api/assets', verifyToken, assetsRoute);

  // --- AI-Powered Features ---
  const aiRoutes = require('./routes/aiRoutes.cjs');
  app.use('/api/ai', verifyToken, aiRoutes);

  // --- Referral Management ---
  const referralRoutes = require('./routes/referralRoutes.cjs');
  app.use('/api/referrals', verifyToken, referralRoutes);

  // --- Finance / Accounting Endpoints ---
  const finance = new (require('./services/financeService.cjs'))();
  const banking = new (require('./services/bankingService.cjs'))();
  const reporting = new (require('./services/financialReportingService.cjs'))();
  const vatManagement = new (require('./services/vatManagementService.cjs'))();
  const currency = new (require('./services/currencyService.cjs'))();
  const financialYear = new (require('./services/financialYearService.cjs'))();

  // Chart of Accounts
  app.get('/api/accounts', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), async (req, res) => {
    try {
      const rows = await finance.getAccounts(req.companyId || '');
      res.json(rows);
    } catch (err) {
      console.error('[Finance] getAccounts error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch accounts' });
    }
  });

  app.get('/api/accounts/:id', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), async (req, res) => {
    try {
      const row = await finance.getAccountById(req.params.id, req.companyId || '');
      if (!row) return res.status(404).json({ error: 'Account not found' });
      res.json(row);
    } catch (err) {
      console.error('[Finance] getAccount error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch account' });
    }
  });

  app.post('/api/accounts', requireRole('Admin', 'Accountant', 'Manager'), validateBody(accountSchemas.create), async (req, res) => {
    try {
      const row = await finance.createAccount(req.body, req.companyId || '');
      res.status(201).json(row);
    } catch (err) {
      console.error('[Finance] createAccount error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create account' });
    }
  });

  app.put('/api/accounts/:id', requireRole('Admin', 'Accountant', 'Manager'), validateBody(accountSchemas.update), async (req, res) => {
    try {
      const row = await finance.updateAccount(req.params.id, req.body, req.companyId || '');
      if (!row) return res.status(404).json({ error: 'Account not found' });
      res.json(row);
    } catch (err) {
      console.error('[Finance] updateAccount error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to update account' });
    }
  });

  app.delete('/api/accounts/:id', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      await finance.deleteAccount(req.params.id, req.companyId || '');
      res.json({ success: true });
    } catch (err) {
      console.error('[Finance] deleteAccount error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to delete account' });
    }
  });

  // Ledger
  app.get('/api/ledger', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), injectFinancialYear, async (req, res) => {
    try {
      const accountId = req.query.account_id;
      const companyId = req.companyId || '';
      let { sql, params } = addFyDateFilter('SELECT * FROM ledger_entries WHERE company_id = ?', [companyId], req, 'entry_date');
      if (accountId) {
        sql += ' AND account_id = ?';
        params.push(accountId);
      }
      sql += ' ORDER BY entry_date DESC, created_at DESC';
      db.all(sql, params, (err, rows) => {
        if (err) { console.error('[Finance] getLedger error:', err); return res.status(500).json({ error: 'Failed to fetch ledger' }); }
        res.json(rows || []);
      });
    } catch (err) {
      console.error('[Finance] getLedger error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch ledger' });
    }
  });

  app.post('/api/ledger', requireRole('Admin', 'Accountant', 'Manager'), validateBody(financialSchemas.journalEntry), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      await validateFyDate('date', req.body, req.companyId || '');
      const { lines, ...meta } = req.body;
      const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
      const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        return res.status(400).json({ error: 'Unbalanced journal entry', totalDebit, totalCredit });
      }
      const companyId = req.companyId || '';
      const results = [];
      for (const line of lines) {
        const entry = await finance.saveLedgerEntry({
          ...meta,
          account_id: line.accountId,
          entry_type: line.debit > 0 ? 'debit' : 'credit',
          amount: line.debit > 0 ? line.debit : line.credit,
          entry_date: meta.date || new Date().toISOString()
        }, companyId);
        results.push(entry);
      }
      res.status(201).json(results);
    } catch (err) {
      console.error('[Finance] saveLedger error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to save ledger entry' });
    }
  });

  // Expenses
  app.get('/api/expenses', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), injectFinancialYear, async (req, res) => {
    try {
      const companyId = req.companyId || '';
      let { sql, params } = addFyDateFilter('SELECT * FROM expenses WHERE company_id = ?', [companyId], req, 'expense_date');
      sql += ' ORDER BY expense_date DESC';
      db.all(sql, params, (err, rows) => {
        if (err) { console.error('[Finance] getExpenses error:', err); return res.status(500).json({ error: 'Failed to fetch expenses' }); }
        res.json(rows || []);
      });
    } catch (err) {
      console.error('[Finance] getExpenses error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch expenses' });
    }
  });

  app.post('/api/expenses', requireRole('Admin', 'Accountant', 'Manager'), validateBody(expenseSchemas.create), async (req, res) => {
    try {
      await validateFyDate('expense_date', req.body, req.companyId || '');
      const row = await finance.createExpense({ ...req.body, created_by: req.user?.id }, req.companyId || '');
      res.status(201).json(row);
    } catch (err) {
      console.error('[Finance] createExpense error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create expense' });
    }
  });

  app.put('/api/expenses/:id', requireRole('Admin', 'Accountant', 'Manager'), validateBody(expenseSchemas.update), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      const row = await finance.updateExpense(req.params.id, req.body, req.companyId || '');
      if (!row) return res.status(404).json({ error: 'Expense not found' });
      res.json(row);
    } catch (err) {
      console.error('[Finance] updateExpense error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to update expense' });
    }
  });
  
  app.delete('/api/expenses/:id', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      await finance.deleteExpense(req.params.id, req.companyId || '');
      res.json({ success: true });
    } catch (err) {
      console.error('[Finance] deleteExpense error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to delete expense' });
    }
  });

  // Income
  app.get('/api/income', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), injectFinancialYear, async (req, res) => {
    try {
      const companyId = req.companyId || '';
      let { sql, params } = addFyDateFilter('SELECT * FROM income WHERE company_id = ?', [companyId], req, 'income_date');
      sql += ' ORDER BY income_date DESC';
      db.all(sql, params, (err, rows) => {
        if (err) { console.error('[Finance] getIncome error:', err); return res.status(500).json({ error: 'Failed to fetch income' }); }
        res.json(rows || []);
      });
    } catch (err) {
      console.error('[Finance] getIncome error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch income' });
    }
  });

  app.post('/api/income', requireRole('Admin', 'Accountant', 'Manager'), validateBody(incomeSchemas.create), async (req, res) => {
    try {
      await validateFyDate('income_date', req.body, req.companyId || '');
      const row = await finance.createIncome({ ...req.body, created_by: req.user?.id }, req.companyId || '');
      res.status(201).json(row);
    } catch (err) {
      console.error('[Finance] createIncome error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create income' });
    }
  });

  app.delete('/api/income/:id', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      await finance.deleteIncome(req.params.id, req.companyId || '');
      res.json({ success: true });
    } catch (err) {
      console.error('[Finance] deleteIncome error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to delete income' });
    }
  });

  // Budgets
  app.get('/api/budgets', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), async (req, res) => {
    try {
      const rows = await finance.getBudgets(req.companyId || '');
      res.json(rows);
    } catch (err) {
      console.error('[Finance] getBudgets error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch budgets' });
    }
  });

  app.post('/api/budgets', requireRole('Admin', 'Accountant', 'Manager'), validateBody(budgetSchemas.create), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      const row = await finance.createBudget(req.body, req.companyId || '');
      res.status(201).json(row);
    } catch (err) {
      console.error('[Finance] createBudget error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create budget' });
    }
  });
  
  app.put('/api/budgets/:id', requireRole('Admin', 'Accountant', 'Manager'), validateBody(budgetSchemas.update), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      const row = await finance.updateBudget(req.params.id, req.body, req.companyId || '');
      if (!row) return res.status(404).json({ error: 'Budget not found' });
      res.json(row);
    } catch (err) {
      console.error('[Finance] updateBudget error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to update budget' });
    }
  });
  
  app.delete('/api/budgets/:id', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      await finance.deleteBudget(req.params.id, req.companyId || '');
      res.json({ success: true });
    } catch (err) {
      console.error('[Finance] deleteBudget error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to delete budget' });
    }
  });

  // ── User Preferences Endpoints ──
  // Persist user-selected financial year (and other prefs) so the choice
  // follows the user across devices.
  app.get('/api/user/preferences/:key', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), async (req, res) => {
    try {
      const userId = req.user?.id || req.headers['x-user-id'] || '';
      const companyId = req.companyId || '';
      if (!userId) return res.status(200).json({ value: null });
      // Try the local SQLite preference store first, then fallback to no value
      const row = await db.get(
        `SELECT pref_value FROM user_preferences WHERE id = ?`,
        [`${userId}:${companyId}:${req.params.key}`]
      );
      res.json({ value: row?.pref_value || null });
    } catch (err) {
      console.error('[UserPrefs] Get failed:', err);
      res.status(200).json({ value: null });
    }
  });

  app.put('/api/user/preferences/:key', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), async (req, res) => {
    try {
      const userId = req.user?.id || req.headers['x-user-id'] || '';
      const companyId = req.companyId || '';
      const { value } = req.body || {};
      if (!userId) return res.status(400).json({ error: 'User ID required' });
      const prefId = `${userId}:${companyId}:${req.params.key}`;
      await db.run(
        `INSERT INTO user_preferences (id, user_id, company_id, pref_key, pref_value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET pref_value = excluded.pref_value, updated_at = datetime('now')`,
        [prefId, userId, companyId, req.params.key, value || '']
      );
      res.json({ success: true });
    } catch (err) {
      console.error('[UserPrefs] Save failed:', err);
      res.status(500).json({ error: err?.message || 'Failed to save preference' });
    }
  });

  // --- Financial Year Endpoints ---
  app.get('/api/financial-years', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), async (req, res) => {
    try {
      const rows = await financialYear.getFinancialYears(req.companyId || '');
      res.json(rows);
    } catch (err) {
      console.error('[FY] list error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch financial years' });
    }
  });

  app.get('/api/financial-years/default', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), async (req, res) => {
    try {
      let fy = await financialYear.getDefaultFinancialYear(req.companyId || '');
      if (!fy) {
        fy = await financialYear.getOrCreateDefaultFinancialYear(req.companyId || '', req.user?.id);
      }
      res.json(fy || {});
    } catch (err) {
      console.error('[FY] default error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch default financial year' });
    }
  });

  app.get('/api/financial-years/current', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), async (req, res) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      let fy = await financialYear.getFinancialYearByDate(today, req.companyId || '');
      if (!fy) {
        fy = await financialYear.getDefaultFinancialYear(req.companyId || '');
      }
      res.json(fy || {});
    } catch (err) {
      console.error('[FY] current error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch current financial year' });
    }
  });

  app.get('/api/financial-years/by-date', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), async (req, res) => {
    try {
      const date = req.query.date || new Date().toISOString().slice(0, 10);
      const fy = await financialYear.getFinancialYearByDate(date, req.companyId || '');
      res.json(fy || {});
    } catch (err) {
      console.error('[FY] by-date error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch financial year for date' });
    }
  });

  app.get('/api/financial-years/:id', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), async (req, res) => {
    try {
      const row = await financialYear.getFinancialYearById(req.params.id, req.companyId || '');
      if (!row) return res.status(404).json({ error: 'Financial year not found' });
      res.json(row);
    } catch (err) {
      console.error('[FY] get error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch financial year' });
    }
  });

  app.post('/api/financial-years', requireRole('Admin'), async (req, res) => {
    try {
      const row = await financialYear.createFinancialYear(req.body, req.companyId || '', req.user?.id);
      res.status(201).json(row);
    } catch (err) {
      console.error('[FY] create error:', err?.message || err);
      res.status(400).json({ error: err?.message || 'Failed to create financial year' });
    }
  });

  app.put('/api/financial-years/:id', requireRole('Admin'), async (req, res) => {
    try {
      const row = await financialYear.updateFinancialYear(req.params.id, req.body, req.companyId || '');
      if (!row) return res.status(404).json({ error: 'Financial year not found' });
      res.json(row);
    } catch (err) {
      console.error('[FY] update error:', err?.message || err);
      res.status(400).json({ error: err?.message || 'Failed to update financial year' });
    }
  });

  app.post('/api/financial-years/:id/close', requireRole('Admin'), async (req, res) => {
    try {
      const row = await financialYear.closeFinancialYear(req.params.id, req.companyId || '');
      res.json(row);
    } catch (err) {
      console.error('[FY] close error:', err?.message || err);
      res.status(400).json({ error: err?.message || 'Failed to close financial year' });
    }
  });

  app.delete('/api/financial-years/:id', requireRole('Admin'), async (req, res) => {
    try {
      await financialYear.deleteFinancialYear(req.params.id, req.companyId || '');
      res.json({ success: true });
    } catch (err) {
      console.error('[FY] delete error:', err?.message || err);
      res.status(400).json({ error: err?.message || 'Failed to delete financial year' });
    }
  });

  // Transfers
  app.get('/api/transfers', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), injectFinancialYear, async (req, res) => {
    try {
      const companyId = req.companyId || '';
      let sql = 'SELECT * FROM transfers WHERE company_id = ?';
      const params = [companyId];
      const filtered = addFyDateFilter(sql, params, req, 'transfer_date');
      const rows = await new Promise((resolve, reject) => {
        db.all(filtered.sql, filtered.params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });
      res.json(rows);
    } catch (err) {
      console.error('[Finance] getTransfers error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch transfers' });
    }
  });

  app.post('/api/transfers', requireRole('Admin', 'Accountant', 'Manager'), validateBody(transferSchemas.create), async (req, res) => {
    try {
      await validateFyDate('transfer_date', req.body, req.companyId || '');
      const row = await finance.createTransfer(req.body, req.companyId || '', req.user?.id);
      res.status(201).json(row);
    } catch (err) {
      console.error('[Finance] createTransfer error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create transfer' });
    }
  });

  // --- Banking Endpoints ---
  app.get('/api/bank-accounts', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      const rows = await banking.getAccounts(req.companyId || '');
      res.json(rows);
    } catch (err) {
      console.error('[Banking] getAccounts error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch bank accounts' });
    }
  });

  app.post('/api/bank-accounts', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      const row = await banking.createAccount(req.body, req.companyId || '');
      res.status(201).json(row);
    } catch (err) {
      console.error('[Banking] createAccount error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create bank account' });
    }
  });

  app.put('/api/bank-accounts/:id', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      const row = await banking.updateAccount(req.params.id, req.body, req.companyId || '');
      if (!row) return res.status(404).json({ error: 'Bank account not found' });
      res.json(row);
    } catch (err) {
      console.error('[Banking] updateAccount error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to update bank account' });
    }
  });

  app.delete('/api/bank-accounts/:id', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      await banking.deleteAccount(req.params.id, req.companyId || '');
      res.json({ success: true });
    } catch (err) {
      console.error('[Banking] deleteAccount error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to delete bank account' });
    }
  });

  app.get('/api/bank-transactions', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), injectFinancialYear, async (req, res) => {
    try {
      const filters = {
        accountId: req.query.account_id,
        type: req.query.type,
        status: req.query.status,
        startDate: req.fyStartDate || req.query.start_date,
        endDate: req.query.end_date
      };
      const rows = await banking.getTransactions(req.companyId || '', filters);
      res.json(rows);
    } catch (err) {
      console.error('[Banking] getTransactions error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch bank transactions' });
    }
  });

  app.post('/api/bank-transactions', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      await validateFyDate('date', req.body, req.companyId || '');
      const row = await banking.createTransaction(req.body, req.companyId || '');
      res.status(201).json(row);
    } catch (err) {
      console.error('[Banking] createTransaction error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create bank transaction' });
    }
  });
  
  app.post('/api/bank-transfers', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      await validateFyDate('date', req.body, req.companyId || '');
      const row = await banking.transferFunds(req.body, req.companyId || '');
      res.status(201).json(row);
    } catch (err) {
      console.error('[Banking] transferFunds error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to process transfer' });
    }
  });

  app.get('/api/bank-accounts/:id/balance', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), async (req, res) => {
    try {
      const asOfDate = req.query.as_of_date || null;
      const balance = await banking.getAccountBalance(req.params.id, req.companyId || '', asOfDate);
      res.json({ accountId: req.params.id, balance, asOfDate });
    } catch (err) {
      console.error('[Banking] getBalance error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch account balance' });
    }
  });

  app.get('/api/bank-accounts/:id/reconciliation', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      const startDate = req.query.start_date;
      const endDate = req.query.end_date;
      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'start_date and end_date are required' });
      }
      const summary = await banking.getReconciliationSummary(req.params.id, req.companyId || '', startDate, endDate);
      res.json(summary);
    } catch (err) {
      console.error('[Banking] reconciliation error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch reconciliation summary' });
    }
  });

  // --- Financial Reporting Endpoints ---
  app.get('/api/reports/profit-and-loss', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, async (req, res) => {
    try {
      const startDate = req.query.start_date || req.fyStartDate;
      const endDate = req.query.end_date || req.fyEndDate;
      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'start_date and end_date are required. Select a Financial Year or provide date range.' });
      }
      const report = await reporting.getProfitAndLoss(req.companyId || '', startDate, endDate);
      res.json(report);
    } catch (err) {
      console.error('[Reports] P&L error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to generate P&L report' });
    }
  });

  app.get('/api/reports/balance-sheet', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, async (req, res) => {
    try {
      const asOfDate = req.query.as_of_date || req.fyEndDate;
      const report = await reporting.getBalanceSheet(req.companyId || '', asOfDate);
      res.json(report);
    } catch (err) {
      console.error('[Reports] Balance Sheet error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to generate Balance Sheet' });
    }
  });

  app.get('/api/reports/cash-flow', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, async (req, res) => {
    try {
      const startDate = req.query.start_date || req.fyStartDate;
      const endDate = req.query.end_date || req.fyEndDate;
      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'start_date and end_date are required. Select a Financial Year or provide date range.' });
      }
      const report = await reporting.getCashFlowStatement(req.companyId || '', startDate, endDate);
      res.json(report);
    } catch (err) {
      console.error('[Reports] Cash Flow error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to generate Cash Flow statement' });
    }
  });

  app.get('/api/reports/ar-aging', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, async (req, res) => {
    try {
      const asOfDate = req.query.as_of_date || req.fyEndDate;
      const report = await reporting.getARAging(req.companyId || '', asOfDate);
      res.json(report);
    } catch (err) {
      console.error('[Reports] AR Aging error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to generate AR Aging report' });
    }
  });

  app.get('/api/reports/ap-aging', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, async (req, res) => {
    try {
      const asOfDate = req.query.as_of_date || req.fyEndDate;
      const report = await reporting.getAPAging(req.companyId || '', asOfDate);
      res.json(report);
    } catch (err) {
      console.error('[Reports] AP Aging error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to generate AP Aging report' });
    }
  });

  app.get('/api/reports/trial-balance', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, async (req, res) => {
    try {
      const asOfDate = req.query.as_of_date || req.fyEndDate;
      const report = await reporting.getTrialBalance(req.companyId || '', asOfDate);
      res.json(report);
    } catch (err) {
      console.error('[Reports] Trial Balance error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to generate Trial Balance' });
    }
  });

  app.get('/api/reports/budget-vs-actual', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, async (req, res) => {
    try {
      const fiscalYear = req.query.fiscal_year;
      const period = req.query.period;
      if (!fiscalYear || !period) {
        return res.status(400).json({ error: 'fiscal_year and period are required' });
      }
      const report = await reporting.getBudgetVsActual(req.companyId || '', fiscalYear, period);
      res.json(report);
    } catch (err) {
      console.error('[Reports] Budget vs Actual error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to generate Budget vs Actual report' });
    }
  });

  app.get('/api/reports/vat', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, async (req, res) => {
    try {
      const period = req.query.period;
      if (!period) {
        return res.status(400).json({ error: 'period is required (format: YYYY-MM)' });
      }
      const report = await reporting.getVATReport(req.companyId || '', period);
      res.json(report);
    } catch (err) {
      console.error('[Reports] VAT error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to generate VAT report' });
    }
  });

  // --- VAT Management Endpoints ---
  app.get('/api/vat/transactions', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, async (req, res) => {
    try {
      const companyId = req.companyId || '';
      let sql = 'SELECT * FROM vat_transactions WHERE company_id = ?';
      const params = [companyId];
      const filtered = addFyDateFilter(sql, params, req, 'created_at');
      sql = filtered.sql + ' ORDER BY created_at DESC';
      const rows = await new Promise((resolve, reject) => {
        db.all(sql, filtered.params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });
      res.json(rows);
    } catch (err) {
      console.error('[VAT] getTransactions error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch VAT transactions' });
    }
  });

  app.post('/api/vat/transactions', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      const transaction = await vatManagement.recordVATTransaction(req.body, req.companyId || '');
      res.status(201).json(transaction);
    } catch (err) {
      console.error('[VAT] recordTransaction error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to record VAT transaction' });
    }
  });

  app.put('/api/vat/transactions/:id/status', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      const { status } = req.body;
      const result = await vatManagement.updateVATStatus(req.params.id, status, req.companyId || '');
      if (!result) return res.status(404).json({ error: 'VAT transaction not found' });
      res.json(result);
    } catch (err) {
      console.error('[VAT] updateStatus error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to update VAT status' });
    }
  });

  app.get('/api/vat/summary', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      const period = req.query.period;
      if (!period) {
        return res.status(400).json({ error: 'period is required (format: YYYY-MM)' });
      }
      const summary = await vatManagement.getVATSummary(req.companyId || '', period);
      res.json(summary);
    } catch (err) {
      console.error('[VAT] getSummary error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch VAT summary' });
    }
  });

  app.get('/api/vat/periods', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      const periods = await vatManagement.getVATPeriods(req.companyId || '');
      res.json(periods);
    } catch (err) {
      console.error('[VAT] getPeriods error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch VAT periods' });
    }
  });

  app.post('/api/vat/transactions/:id/reverse', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      const { reason } = req.body;
      const result = await vatManagement.reverseVATTransaction(req.params.id, req.companyId || '', reason);
      res.json(result);
    } catch (err) {
      console.error('[VAT] reverse error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to reverse VAT transaction' });
    }
  });
  
  app.post('/api/vat/import-from-invoices', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, async (req, res) => {
    try {
      const period = req.body.period;
      if (!period) {
        return res.status(400).json({ error: 'period is required (format: YYYY-MM)' });
      }
      const result = await vatManagement.importFromInvoices(req.companyId || '', period);
      res.json(result);
    } catch (err) {
      console.error('[VAT] import error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to import VAT from invoices' });
    }
  });

  // --- Currency Management Endpoints ---
  app.get('/api/currencies', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      const currencies = await currency.getCurrencies();
      res.json(currencies);
    } catch (err) {
      console.error('[Currency] getCurrencies error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch currencies' });
    }
  });

  app.post('/api/currencies', requireRole('Admin'), async (req, res) => {
    try {
      const { code, name, symbol, decimalPlaces } = req.body;
      if (!code || !name || !symbol) {
        return res.status(400).json({ error: 'Code, name, and symbol are required' });
      }
      const result = await currency.addCurrency(code, name.toUpperCase(), symbol, decimalPlaces);
      res.status(201).json(result);
    } catch (err) {
      console.error('[Currency] addCurrency error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to add currency' });
    }
  });

  app.get('/api/currencies/rates', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      const fromCurrency = req.query.from_currency;
      const toCurrency = req.query.to_currency;
      if (!fromCurrency || !toCurrency) {
        return res.status(400).json({ error: 'from_currency and to_currency are required' });
      }
      const rate = await currency.getExchangeRate(fromCurrency, toCurrency);
      res.json({ fromCurrency, toCurrency, rate });
    } catch (err) {
      console.error('[Currency] getExchangeRate error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch exchange rate' });
    }
  });

  app.post('/api/currencies/rates', requireRole('Admin'), async (req, res) => {
    try {
      const { fromCurrency, toCurrency, rate, date } = req.body;
      if (!fromCurrency || !toCurrency || !rate) {
        return res.status(400).json({ error: 'fromCurrency, toCurrency, and rate are required' });
      }
      const result = await currency.updateExchangeRate(fromCurrency, toCurrency, rate, date);
      res.status(201).json(result);
    } catch (err) {
      console.error('[Currency] updateExchangeRate error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to update exchange rate' });
    }
  });

  app.get('/api/companies/currency', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      const companyCurrency = await currency.getCompanyCurrency(req.companyId || '');
      res.json({ currency: companyCurrency });
    } catch (err) {
      console.error('[Currency] getCompanyCurrency error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch company currency' });
    }
  });

  // --- Invoice Endpoints ---
  app.get('/api/invoices', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), injectFinancialYear, async (req, res) => {
    try {
      const status = req.query.status;
      const companyId = req.companyId || '';
      let { sql, params } = addFyDateFilter('SELECT i.*, c.name as customer_name FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.company_id = ?', [companyId], req, 'i.created_at');
      if (status) {
        sql += ` AND LOWER(i.status) = ?`;
        params.push(status.toLowerCase());
      }
      sql += ` ORDER BY i.created_at DESC LIMIT 500`;
      db.all(sql, params, (err, rows) => {
        if (err) { console.error('[Invoices] GET error:', err); return res.status(500).json({ error: 'Failed to retrieve invoices' }); }
        res.json(rows || []);
      });
    } catch (err) {
      console.error('[Invoices] GET error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch invoices' });
    }
  });

  app.post('/api/invoices', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      await validateFyDate('invoice_date', req.body, req.companyId || '');
      const { body } = req;
      const id = body.id || randomUUID();
      db.run(
        `INSERT INTO invoices (id, customer_id, customer_name, subtotal, total_amount, currency, status, payment_method, due_date, invoice_number, other_charges, line_items_json, notes, document_title, company_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, body.customer_id || null, body.customer_name || null, body.subtotal || 0,
         body.total_amount || 0, body.currency || 'MWK', body.status || 'unpaid',
         body.payment_method || null, body.due_date || null, body.invoice_number || null,
         body.other_charges || 0, JSON.stringify(body.line_items || []), body.notes || null, body.document_title || null,
         req.companyId || '', req.user?.id || null],
        function (err) {
          if (err) { return handleInsertConstraintError(res, err, 'Create invoice'); }
          res.status(201).json({ id, ...body });
        }
      );
    } catch (err) {
      console.error('[Invoices] POST error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create invoice' });
    }
  });

  app.put('/api/invoices/:id', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      const { id } = req.params;
      const { body } = req;
      const fields = [];
      const params = [];
      const allowed = ['customer_id', 'customer_name', 'subtotal', 'total_amount', 'currency', 'status', 'payment_method', 'paid_amount', 'due_date', 'invoice_number', 'other_charges', 'notes', 'document_title', 'line_items_json'];
      for (const field of allowed) {
        if (body[field] !== undefined) {
          fields.push(`${field} = ?`);
          params.push(body[field]);
        }
      }
      if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
      params.push(id, req.companyId || '');
      db.run(`UPDATE invoices SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?`, params, function (err) {
        if (err) { console.error('[Invoices] PUT error:', err); return res.status(500).json({ error: 'Failed to update invoice' }); }
        if (this.changes === 0) return res.status(404).json({ error: 'Invoice not found' });
        res.json({ success: true, id });
      });
    } catch (err) {
      console.error('[Invoices] PUT error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to update invoice' });
    }
  });
  
  app.delete('/api/invoices/:id', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      const { id } = req.params;
      db.get('SELECT status FROM invoices WHERE id = ? AND company_id = ?', [id, req.companyId || ''], (err, row) => {
        if (err) { console.error('[Invoices] DELETE error:', err); return res.status(500).json({ error: 'Failed to void invoice' }); }
        if (!row) return res.status(404).json({ error: 'Invoice not found' });
        db.run('UPDATE invoices SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', ['Voided', id, req.companyId || ''], (err) => {
          if (err) { console.error('[Invoices] DELETE error:', err); return res.status(500).json({ error: 'Failed to void invoice' }); }
          // Reverse ledger entries if present
          try {
            finance.reverseLedgerEntriesByReference('invoice', id, req.companyId || '');
          } catch (reversalErr) {
            console.warn('[Invoices] Ledger reversal skipped:', reversalErr?.message);
          }
          res.json({ success: true, status: 'Voided' });
        });
      });
    } catch (err) {
      console.error('[Invoices] DELETE error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to void invoice' });
    }
  });

  // --- Customer Payment Endpoints ---
  app.get('/api/customer-payments', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), injectFinancialYear, async (req, res) => {
    try {
      const companyId = req.companyId || '';
      let { sql, params } = addFyDateFilter('SELECT * FROM customer_payments WHERE company_id = ?', [companyId], req, 'date');
      sql += ' ORDER BY date DESC LIMIT 500';
      db.all(sql, params, (err, rows) => {
        if (err) { console.error('[CustomerPayments] GET error:', err); return res.status(500).json({ error: 'Failed to retrieve payments' }); }
        res.json(rows || []);
      });
    } catch (err) {
      console.error('[CustomerPayments] GET error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch payments' });
    }
  });

  app.post('/api/customer-payments', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      await validateFyDate('date', req.body, req.companyId || '');
      const { body } = req;
      const id = body.id || randomUUID();
      const companyId = req.companyId || '';
      db.run(
        `INSERT INTO customer_payments (id, date, customer_id, customer_name, amount, payment_method, account_id, reference, notes, status, company_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, body.date || new Date().toISOString(), body.customer_id || body.customerId || null,
         body.customer_name || body.customerName || null, body.amount || 0,
         body.payment_method || body.paymentMethod || 'Cash', body.account_id || body.accountId || null,
         body.reference || null, body.notes || null, body.status || 'Cleared', companyId, req.user?.id || null],
        function (err) {
          if (err) { return handleInsertConstraintError(res, err, 'Create customer payment'); }
          res.status(201).json({ id, ...body });
        }
      );
    } catch (err) {
      console.error('[CustomerPayments] POST error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create payment' });
    }
  });

  // --- Payment Allocation Endpoints ---
  const paymentAllocation = new (require('./services/paymentAllocationService.cjs'))();

  app.post('/api/payments/allocate', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      const { paymentId, allocations } = req.body;
      const companyId = req.companyId || '';
      
      // Get payment details
      const payment = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM customer_payments WHERE id = ? AND company_id = ?', [paymentId, companyId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!payment) {
        return res.status(404).json({ error: 'Payment not found' });
      }

      const result = await paymentAllocation.allocatePayment(payment, allocations, companyId);
      res.status(201).json(result);
    } catch (err) {
      console.error('[PaymentAllocation] allocate error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to allocate payment' });
    }
  });

  app.get('/api/payments/:paymentId/allocations', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), async (req, res) => {
    try {
      const allocations = await paymentAllocation.getPaymentAllocations(req.params.paymentId, req.companyId || '');
      res.json(allocations);
    } catch (err) {
      console.error('[PaymentAllocation] get error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch allocations' });
    }
  });

  app.get('/api/customers/:customerId/outstanding-invoices', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), async (req, res) => {
    try {
      const invoices = await paymentAllocation.getOutstandingInvoices(req.params.customerId, req.companyId || '');
      res.json(invoices);
    } catch (err) {
      console.error('[PaymentAllocation] outstanding error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch outstanding invoices' });
    }
  });

  app.post('/api/payments/suggest-allocation', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      const { customerId, amount } = req.body;
      const suggestion = await paymentAllocation.suggestAllocation(customerId, amount, req.companyId || '');
      res.json(suggestion);
    } catch (err) {
      console.error('[PaymentAllocation] suggest error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to generate allocation suggestion' });
    }
  });

  app.post('/api/payments/allocations/:allocationId/reverse', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      const result = await paymentAllocation.reverseAllocation(req.params.allocationId, req.companyId || '');
      res.json(result);
    } catch (err) {
      console.error('[PaymentAllocation] reverse error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to reverse allocation' });
    }
  });

  // --- Procurement / Purchases Endpoints ---
  const procurement = new (require('./services/procurementService.cjs'))();

  // Suppliers
  app.get('/api/suppliers', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), async (req, res) => {
    try {
      const rows = await procurement.getSuppliers(req.companyId || '');
      res.json(rows);
    } catch (err) {
      console.error('[Procurement] getSuppliers error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch suppliers' });
    }
  });

  app.get('/api/suppliers/:id', async (req, res) => {
    try {
      const row = await procurement.getSupplierById(req.params.id, req.companyId || '');
      if (!row) return res.status(404).json({ error: 'Supplier not found' });
      res.json(row);
    } catch (err) {
      console.error('[Procurement] getSupplier error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch supplier' });
    }
  });

  app.post('/api/suppliers', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      const row = await procurement.createSupplier(req.body, req.companyId || '');
      res.status(201).json(row);
    } catch (err) {
      console.error('[Procurement] createSupplier error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create supplier' });
    }
  });

  app.put('/api/suppliers/:id', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      const row = await procurement.updateSupplier(req.params.id, req.body, req.companyId || '');
      if (!row) return res.status(404).json({ error: 'Supplier not found' });
      res.json(row);
    } catch (err) {
      console.error('[Procurement] updateSupplier error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to update supplier' });
    }
  });

  app.delete('/api/suppliers/:id', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      await procurement.deleteSupplier(req.params.id, req.companyId || '');
      res.json({ success: true });
    } catch (err) {
      console.error('[Procurement] deleteSupplier error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to delete supplier' });
    }
  });

  // Purchase Orders
  app.get('/api/purchases', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), injectFinancialYear, async (req, res) => {
    try {
      const companyId = req.companyId || '';
      let { sql, params } = addFyDateFilter(`SELECT po.*, s.name as supplier_name FROM purchase_orders po LEFT JOIN suppliers s ON po.supplier_id = s.id WHERE po.company_id = ?`, [companyId], req, 'po.order_date');
      sql += ' ORDER BY po.created_at DESC';
      db.all(sql, params, (err, rows) => {
        if (err) { console.error('[Procurement] getPurchases error:', err); return res.status(500).json({ error: 'Failed to fetch purchases' }); }
        res.json(rows || []);
      });
    } catch (err) {
      console.error('[Procurement] getPurchases error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch purchases' });
    }
  });

  app.get('/api/purchases/:id', async (req, res) => {
    try {
      const po = await procurement.getPurchaseById(req.params.id, req.companyId || '');
      if (!po) return res.status(404).json({ error: 'Purchase order not found' });
      const items = await procurement.getPurchaseItems(req.params.id, req.companyId || '');
      res.json({ ...po, items });
    } catch (err) {
      console.error('[Procurement] getPurchase error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch purchase order' });
    }
  });

  app.post('/api/purchases', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      await validateFyDate('order_date', req.body, req.companyId || '');
      const row = await procurement.createPurchase(req.body, req.companyId || '', req.user?.id);
      res.status(201).json(row);
    } catch (err) {
      console.error('[Procurement] createPurchase error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create purchase order' });
    }
  });

  app.put('/api/purchases/:id/status', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      const row = await procurement.updatePurchaseStatus(req.params.id, req.body.status, req.companyId || '');
      if (!row) return res.status(404).json({ error: 'Purchase order not found' });
      res.json(row);
    } catch (err) {
      console.error('[Procurement] updatePurchaseStatus error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to update purchase status' });
    }
  });

  // Goods Receipts
  app.get('/api/grn', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), injectFinancialYear, async (req, res) => {
    try {
      const companyId = req.companyId || '';
      let { sql, params } = addFyDateFilter(`SELECT gr.*, po.supplier_id, s.name as supplier_name FROM goods_receipts gr LEFT JOIN purchase_orders po ON gr.purchase_order_id = po.id LEFT JOIN suppliers s ON po.supplier_id = s.id WHERE gr.company_id = ?`, [companyId], req, 'gr.received_date');
      sql += ' ORDER BY gr.created_at DESC';
      db.all(sql, params, (err, rows) => {
        if (err) { console.error('[Procurement] getGRNs error:', err); return res.status(500).json({ error: 'Failed to fetch goods receipts' }); }
        res.json(rows || []);
      });
    } catch (err) {
      console.error('[Procurement] getGRNs error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch goods receipts' });
    }
  });

  app.post('/api/grn', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      await validateFyDate('received_date', req.body, req.companyId || '');
      const row = await procurement.createGoodsReceipt(req.body, req.companyId || '', req.user?.id);
      res.status(201).json(row);
    } catch (err) {
      console.error('[Procurement] createGRN error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create goods receipt' });
    }
  });

  // Helper: ensure production tables exist
  const createProductionTables = () => new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS work_centers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        hourly_rate REAL DEFAULT 0,
        capacity_per_day INTEGER DEFAULT 8,
        status TEXT DEFAULT 'Active',
        location TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS production_resources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        work_center_id TEXT NOT NULL,
        status TEXT DEFAULT 'Active',
        resource_type TEXT,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (work_center_id) REFERENCES work_centers(id) ON DELETE CASCADE
      )`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  // Production fallback endpoint: return a basic set of work centers/resources
  // Production: fetch real work centers from database
  app.get('/api/production/work-centers', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), async (req, res) => {
    try {
      const companyId = req.companyId || '';
      const rows = await new Promise((resolve, reject) => {
        db.all('SELECT id, name, description, hourly_rate as hourlyRate, capacity_per_day as capacityPerDay, status FROM work_centers WHERE status = ? AND company_id = ? ORDER BY name', ['Active', companyId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });
      res.json(rows);
    } catch (err) {
      console.error('[Production] work-centers query error:', err?.message || err);
      if (err?.message?.includes?.('no such table')) {
        try { await createProductionTables(); } catch { /* ignore */ }
        return res.json([]);
      }
      res.status(500).json({ error: err?.message || 'Unknown database error' });
    }
  });

  // Production: fetch real resources from database
  app.get('/api/production/resources', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), async (req, res) => {
    try {
      const companyId = req.companyId || '';
      const rows = await new Promise((resolve, reject) => {
        db.all('SELECT id, name, work_center_id as workCenterId, status FROM production_resources WHERE status = ? AND company_id = ? ORDER BY name', ['Active', companyId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });
      res.json(rows);
    } catch (err) {
      console.error('[Production] resources query error:', err?.message || err);
      if (err?.message?.includes?.('no such table')) {
        try { await createProductionTables(); } catch { /* ignore */ }
        return res.json([]);
      }
      res.status(500).json({ error: err?.message || 'Unknown database error' });
    }
  });

  // --- Production CRUD Endpoints ---
  const ProductionService = require('./services/productionService.cjs');
  const production = ProductionService.getInstance();

  app.post('/api/production/work-centers', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      const row = await production.createWorkCenter(req.body, req.companyId || '');
      res.status(201).json(row);
    } catch (err) {
      console.error('[Production] createWorkCenter error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create work center' });
    }
  });

  app.post('/api/production/resources', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      const row = await production.createResource(req.body, req.companyId || '');
      res.status(201).json(row);
    } catch (err) {
      console.error('[Production] createResource error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create resource' });
    }
  });

  app.get('/api/production/work-orders', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), injectFinancialYear, async (req, res) => {
    try {
      const companyId = req.companyId || '';
      let sql = 'SELECT * FROM work_orders WHERE company_id = ?';
      const params = [companyId];
      const filtered = addFyDateFilter(sql, params, req, 'date');
      const rows = await new Promise((resolve, reject) => {
        db.all(filtered.sql, filtered.params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });
      res.json(rows);
    } catch (err) {
      console.error('[Production] getWorkOrders error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch work orders' });
    }
  });

  app.get('/api/production/work-orders/:id', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), async (req, res) => {
    try {
      const row = await production.getWorkOrderById(req.params.id, req.companyId || '');
      if (!row) return res.status(404).json({ error: 'Work order not found' });
      res.json(row);
    } catch (err) {
      console.error('[Production] getWorkOrder error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch work order' });
    }
  });

  app.post('/api/production/work-orders', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      await validateFyDate('start_date', req.body, req.companyId || '');
      const row = await production.createWorkOrder(req.body, req.companyId || '', req.user?.id);
      res.status(201).json(row);
    } catch (err) {
      console.error('[Production] createWorkOrder error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create work order' });
    }
  });

  app.put('/api/production/work-orders/:id', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      const row = await production.updateWorkOrder(req.params.id, req.body, req.companyId || '');
      if (!row) return res.status(404).json({ error: 'Work order not found' });
      res.json(row);
    } catch (err) {
      console.error('[Production] updateWorkOrder error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to update work order' });
    }
  });
  
  app.delete('/api/production/work-orders/:id', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      await production.deleteWorkOrder(req.params.id, req.companyId || '');
      res.json({ success: true });
    } catch (err) {
      console.error('[Production] deleteWorkOrder error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to delete work order' });
    }
  });

  app.get('/api/production/batches', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), injectFinancialYear, async (req, res) => {
    try {
      const companyId = req.companyId || '';
      let sql = 'SELECT * FROM production_batches WHERE company_id = ?';
      const params = [companyId];
      const filtered = addFyDateFilter(sql, params, req, 'created_at');
      const rows = await new Promise((resolve, reject) => {
        db.all(filtered.sql, filtered.params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });
      res.json(rows);
    } catch (err) {
      console.error('[Production] getBatches error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch batches' });
    }
  });

  app.post('/api/production/batches', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      const fyService = new (require('./services/financialYearService.cjs'))();
      await fyService.validateTransactionDate(new Date().toISOString().slice(0, 10), req.companyId || '');
      const row = await production.createBatch(req.body, req.companyId || '');
      res.status(201).json(row);
    } catch (err) {
      console.error('[Production] createBatch error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create batch' });
    }
  });

  // --- HR Endpoints ---
  const hr = new (require('./services/hrService.cjs'))();

  app.get('/api/employees', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), async (req, res) => {
    try {
      const rows = await hr.getEmployees(req.companyId || '');
      res.json(rows);
    } catch (err) {
      console.error('[HR] getEmployees error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch employees' });
    }
  });

  app.post('/api/employees', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      const row = await hr.createEmployee(req.body, req.companyId || '');
      res.status(201).json(row);
    } catch (err) {
      console.error('[HR] createEmployee error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create employee' });
    }
  });

  app.put('/api/employees/:id', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      if (req.body.salary !== undefined && (Number(req.body.salary) < 0)) {
        return res.status(400).json({ error: 'Salary cannot be negative' });
      }
      const existing = await hr._get('SELECT id, salary FROM employees WHERE id = ?', [req.params.id], req.companyId || '');
      if (!existing) return res.status(404).json({ error: 'Employee not found' });
      const row = await hr.updateEmployee(req.params.id, req.body, req.companyId || '');
      if (req.body.salary !== undefined && Number(req.body.salary) !== Number(existing.salary)) {
        const { randomUUID } = require('crypto');
        db.run(
          `INSERT INTO audit_logs (id, timestamp, correlation_id, user_id, user_role, action, entity_type, entity_id, details, old_value, new_value, delta, integrity_hash, company_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            randomUUID(), new Date().toISOString(), req.headers['x-correlation-id'] || '',
            req.user?.id || 'system', req.user?.role || 'UNKNOWN', 'SALARY_UPDATE',
            'Employee', req.params.id,
            `Salary updated for employee ${req.params.id}`,
            JSON.stringify({ salary: existing.salary }),
            JSON.stringify({ salary: req.body.salary }),
            JSON.stringify({ from: existing.salary, to: req.body.salary }),
            '',
            req.companyId || ''
          ]
        );
      }
      res.json(row);
    } catch (err) {
      console.error('[HR] updateEmployee error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to update employee' });
    }
  });

  app.delete('/api/employees/:id', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      await hr.deleteEmployee(req.params.id, req.companyId || '');
      res.json({ success: true });
    } catch (err) {
      console.error('[HR] deleteEmployee error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to delete employee' });
    }
  });

  app.get('/api/payroll-runs', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), injectFinancialYear, async (req, res) => {
    try {
      const companyId = req.companyId || '';
      let sql = 'SELECT * FROM payroll_runs WHERE company_id = ?';
      const params = [companyId];
      const filtered = addFyDateFilter(sql, params, req, 'period_start');
      const rows = await new Promise((resolve, reject) => {
        db.all(filtered.sql, filtered.params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });
      res.json(rows);
    } catch (err) {
      console.error('[HR] getPayrollRuns error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch payroll runs' });
    }
  });

  app.post('/api/payroll-runs', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      await validateFyDate('period_start', req.body, req.companyId || '');
      const row = await hr.createPayrollRun(req.body, req.companyId || '');
      res.status(201).json(row);
    } catch (err) {
      console.error('[HR] createPayrollRun error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create payroll run' });
    }
  });

  app.get('/api/payslips', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), injectFinancialYear, async (req, res) => {
    try {
      const companyId = req.companyId || '';
      let sql = 'SELECT * FROM payslips WHERE company_id = ?';
      const params = [companyId];
      const filtered = addFyDateFilter(sql, params, req, 'created_at');
      const rows = await new Promise((resolve, reject) => {
        db.all(filtered.sql, filtered.params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });
      res.json(rows);
    } catch (err) {
      console.error('[HR] getPayslips error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to fetch payslips' });
    }
  });

  app.post('/api/payslips', requireRole('Admin', 'Accountant', 'Manager'), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      const row = await hr.createPayslip(req.body, req.companyId || '');
      res.status(201).json(row);
    } catch (err) {
      console.error('[HR] createPayslip error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create payslip' });
    }
  });

  // --- Document Engine Integration Endpoints ---
  const documentService = require('./services/documentService.cjs');

  // Pre-initialize the persistent PDF browser to eliminate launch latency
  console.log('[System] Pre-initializing Document Engine services...');
  /*
  pdfService.init().catch(err => {
    console.error('[System] Critical: PDF Service pre-initialization failed:', err);
  });
  */

  /**
   * Standardized error responder to ensure valid JSON and consistent fields.
   * Enforces mandatory diagnostic metadata for the document preview pipeline.
   */
  const safeErrorMessage = (code) => {
    const safe = {
      'REGISTRATION_FAILED': 'Failed to register document.',
      'CREATE_FAILED': 'Failed to create resource.',
      'UPDATE_FAILED': 'Failed to update resource.',
      'VOID_FAILED': 'Failed to void document.',
      'FINALIZE_FAILED': 'Failed to finalize document.',
      'PREVIEW_PIPELINE_ERROR': 'Failed to generate preview.',
      'EXPORT_FAILED': 'Failed to export document.',
      'BATCH_FINALIZE_FAILED': 'Failed to finalize batch.',
      'BATCH_EXPORT_FAILED': 'Failed to export batch.',
      'FETCH_EXCHANGES_FAILED': 'Failed to retrieve exchanges.',
      'FETCH_EXCHANGE_FAILED': 'Failed to retrieve exchange.',
      'CREATE_EXCHANGE_FAILED': 'Failed to create exchange.',
      'APPROVE_EXCHANGE_FAILED': 'Failed to approve exchange.',
      'FETCH_SALES_ORDERS_FAILED': 'Failed to retrieve sales orders.',
      'FETCH_SALES_ORDER_FAILED': 'Failed to retrieve sales order.',
      'CREATE_SALES_ORDER_FAILED': 'Failed to create sales order.',
      'UPDATE_SALES_ORDER_FAILED': 'Failed to update sales order.',
      'DELETE_SALES_ORDER_FAILED': 'Failed to delete sales order.',
      'FETCH_REPRINTS_FAILED': 'Failed to retrieve reprints.',
      'UPDATE_REPRINT_FAILED': 'Failed to update reprint.',
      'VERIFICATION_FAILED': 'Verification failed.',
      'AUDIT_FETCH_FAILED': 'Failed to retrieve audit log.',
      'DISPATCH_FAILED': 'Failed to dispatch document.',
      'PDF_GENERATION_FAILED': 'Failed to generate PDF.',
      'PRICE_VALIDATION_FAILED': 'Price validation failed. Please verify item pricing.',
      'ACCESS_DENIED': 'You do not have permission to perform this action.',
      'INVALID_DISPATCH_REQUEST': 'Invalid dispatch request.',
      'INVALID_BATCH_REQUEST': 'Invalid batch request.',
      'MISSING_FIELDS': 'Required fields are missing.',
      'MISSING_HTML': 'HTML content is required.',
      'MISSING_BLUEPRINT': 'Layout blueprint is required.',
      'NOT_FOUND': 'The requested resource was not found.',
    };
    return safe[code] || 'An unexpected error occurred.';
  };

  const sendError = (res, statusCode, message, code = 'INTERNAL_ERROR', diagnostic = null) => {
    const safeMsg = safeErrorMessage(code);
    const finalDiagnostic = diagnostic && diagnostic.trim() !== "" 
      ? diagnostic 
      : null;

    res.status(statusCode).json({
      status: 'error',
      error: safeMsg,
      code: code,
      ...(finalDiagnostic ? { diagnostic: finalDiagnostic } : {})
    });
  };

  // Middleware for simple "permission" check (uses JWT from verifyToken)
  const ADMIN_ACTIONS = new Set(['admin_access', 'admin_settings', 'admin_users', 'delete_document', 'approve_exchange']);
  const checkPermission = (action) => (req, res, next) => {
    if (!req.user) {
       return res.status(401).json({ error: 'Unauthorized' });
    }

    if (ADMIN_ACTIONS.has(action) && String(req.user.role || '').toLowerCase() !== 'admin') {
       return sendError(res, 403, 'Forbidden: Admin access required', 'ACCESS_DENIED');
    }

    req.userId = req.user.id;
    req.userRole = req.user.role;
    next();
  };

  /**
   * Create/Edit Documents
   */
  app.post('/api/documents/register', checkPermission('create_document'), validateBody(documentSchemas.register), auditCrudMiddleware('document'), async (req, res) => {
    try {
      const { type, payload, id } = req.body;
      if (!type || !payload) {
        return sendError(res, 400, 'Document type and payload are required', 'MISSING_FIELDS');
      }
      const companyId = req.companyId || '';
      const result = await documentService.registerDocument(type, payload, req.userId, companyId, id);
      try {
        await documentService.logAudit(req.userId, result.isNew ? 'CREATE' : 'UPDATE', 'document', result.id, { type, auto_registered: true }, companyId);
      } catch (auditErr) {
        console.error('[Documents] Audit log failed (non-fatal):', auditErr);
      }
      res.status(result.isNew ? 201 : 200).json(result);
    } catch (err) {
      sendError(res, 500, err.message, 'REGISTRATION_FAILED');
    }
  });

  app.post('/api/documents', checkPermission('create_document'), validateBody(documentSchemas.create), auditCrudMiddleware('document'), async (req, res) => {
    try {
      const { type, payload } = req.body;
      const companyId = req.companyId || '';
      const result = await documentService.createDocument(type, payload, req.userId, companyId);
      await documentService.logAudit(req.userId, 'CREATE', 'document', result.id, { type }, companyId);
      res.status(201).json(result);
    } catch (err) {
      sendError(res, 500, err.message, 'CREATE_FAILED');
    }
  });

  app.put('/api/documents/:id', checkPermission('edit_document'), validateBody(documentSchemas.update), async (req, res) => {
    try {
      const { payload } = req.body;
      const companyId = req.companyId || '';
      const result = await documentService.updateDocument(req.params.id, payload, req.userId, companyId);
      await documentService.logAudit(req.userId, 'UPDATE', 'document', req.params.id, { payload_updated: true }, companyId);
      res.json(result);
    } catch (err) {
      sendError(res, 400, err.message, 'UPDATE_FAILED');
    }
  });

  /**
   * Workflow: Finalize/Void
   */
  app.post('/api/documents/:id/finalize', checkPermission('finalize_document'), validateBody(documentSchemas.finalize), async (req, res) => {
    try {
      const { blueprint } = req.body;
      if (!blueprint) {
        return sendError(res, 400, 'Layout blueprint is required for finalization', 'MISSING_BLUEPRINT');
      }
      
      const companyId = req.companyId || '';
      const result = await documentService.finalizeDocument(req.params.id, blueprint, req.userId, companyId);
      await documentService.logAudit(req.userId, 'FINALIZE', 'document', req.params.id, { fingerprint: result.fingerprint }, companyId);
      res.json(result);
    } catch (err) {
      sendError(res, 422, err.message, 'FINALIZE_FAILED');
    }
  });

  app.post('/api/documents/:id/void', checkPermission('void_document'), async (req, res) => {
    try {
      const companyId = req.companyId || '';
      const result = await documentService.voidDocument(req.params.id, req.userId, companyId);
      await documentService.logAudit(req.userId, 'VOID', 'document', req.params.id, {}, companyId);
      res.json(result);
    } catch (err) {
      sendError(res, 500, err.message, 'VOID_FAILED');
    }
  });

  /**
   * Preview/Export
   */
  app.get('/api/documents/:identifier/preview', checkPermission('view_document'), async (req, res) => {
    try {
      const purpose = req.query.purpose || 'preview';
      const { identifier } = req.params;
      
      // POLICY: Ensure document is registered if payload is available in session or provided
      // For GET previews, we primarily resolve. If it fails, we check if we can register.
      // However, the PreviewButton now handles the 'register-then-preview' flow via POST /register.
      // We still keep this robust by ensuring the resolver is context-aware.
      
      const companyId = req.companyId || '';
      const renderModel = await documentService.getPreview(identifier, { purpose }, companyId);
      res.json(renderModel);
    } catch (err) {
      if (err.name === 'ResolutionError') {
        return sendError(
          res, 
          err.code === 'ACCESS_DENIED' ? 403 : 404, 
          err.message, 
          err.code, 
          err.diagnostic
        );
      }
      sendError(res, 500, err.message, 'PREVIEW_PIPELINE_ERROR');
    }
  });

  app.get('/api/documents/:id/export', checkPermission('export_document'), async (req, res) => {
    try {
      const companyId = req.companyId || '';
      const doc = await documentService.resolveDocument(req.params.id, companyId);
      if (!doc) return sendError(res, 404, 'Document not found', 'NOT_FOUND');

      const pdfBytes = await documentService.exportPdf(req.params.id);
      
      // Standardized filename generation
      const type = doc.type || 'Document';
      const id = doc.logical_number || doc.id;
      const customerName = doc.payload?.customerName || doc.payload?.clientName || 'Customer';
      
      const cleanCustomer = customerName.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_');
      const filename = `${type.toUpperCase()}-${id}_${cleanCustomer}.pdf`;

      const pdfBuffer = Buffer.from(pdfBytes);
      const isStream = req.query.stream === 'true';

      if (!isStream) {
        // Define Export Directory (User's Documents/ERP_Exports)
        const exportDir = path.join(os.homedir(), 'Documents', 'ERP_Exports');
        if (!fs.existsSync(exportDir)) {
          fs.mkdirSync(exportDir, { recursive: true });
        }

        const filePath = path.join(exportDir, filename);

        // Write to Disk
        fs.writeFileSync(filePath, pdfBuffer);
        console.log(`[Export] PDF saved to: ${filePath}`);

        // Automatically open the file using OS-specific shell
        try {
          const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
          const args = process.platform === 'win32' ? [filePath] : [filePath];
          spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
          console.log(`[Export] Opened file: ${filePath}`);
        } catch (openErr) {
          console.error(`[Export] Failed to open file: ${openErr.message}`);
        }
      }

      // Send back to client
      applyDocumentResponseHeaders(res, {
        contentType: 'application/pdf',
        filename,
        inline: isStream
      });
      res.send(pdfBuffer);
      
      await documentService.logAudit(req.userId, 'EXPORT_PDF', 'document', req.params.id, {
        filename,
        streamed: isStream,
        savedToDisk: !isStream
      }, req.companyId || '');
    } catch (err) {
      sendError(res, 500, err.message, 'EXPORT_FAILED');
    }
  });

  /**
   * Batch Operations
   */
  app.post('/api/documents/batch/finalize', checkPermission('batch_finalize'), validateBody(documentSchemas.batchFinalize), async (req, res) => {
    try {
      const { ids, blueprint } = req.body;
      if (!Array.isArray(ids) || !blueprint) {
        return sendError(res, 400, 'IDs array and blueprint are required', 'INVALID_BATCH_REQUEST');
      }
      const companyId = req.companyId || '';
      const results = await documentService.batchFinalize(ids, blueprint, req.userId, companyId);
      await documentService.logAudit(req.userId, 'BATCH_FINALIZE', 'document_batch', null, { count: ids.length }, companyId);
      res.json(results);
    } catch (err) {
      sendError(res, 500, err.message, 'BATCH_FINALIZE_FAILED');
    }
  });

  app.post('/api/documents/batch/export', checkPermission('batch_export'), validateBody(documentSchemas.batchExport), async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids)) {
        return sendError(res, 400, 'IDs array is required', 'INVALID_BATCH_REQUEST');
      }
      
      const pdfs = await documentService.batchExport(ids);
      // In a real system, you might ZIP these or return a multipart response
      // For this implementation, we'll return metadata and base64 for demo purposes
      const results = pdfs.map(p => ({
        id: p.id,
        pdfBase64: Buffer.from(p.pdfBytes).toString('base64')
      }));
      
      await documentService.logAudit(req.userId, 'BATCH_EXPORT', 'document_batch', null, { count: ids.length }, req.companyId || '');
      res.json(results);
    } catch (err) {
      sendError(res, 500, err.message, 'BATCH_EXPORT_FAILED');
    }
  });

  /**
   * Sales Exchange Module Endpoints
   */
  app.get('/api/sales-exchanges', checkPermission('view_exchanges'), injectFinancialYear, (req, res) => {
    const companyId = req.companyId || '';
    let { sql, params } = addFyDateFilter('SELECT * FROM sales_exchanges WHERE company_id = ?', [companyId], req, 'exchange_date');
    sql += ' ORDER BY exchange_date DESC';
    db.all(sql, params, (err, rows) => {
      if (err) return sendError(res, 500, err.message, 'FETCH_EXCHANGES_FAILED');
      res.json(rows);
    });
  });

  app.get('/api/sales-exchanges/:id', checkPermission('view_exchanges'), async (req, res) => {
    try {
      const exchangeId = req.params.id;
      const companyId = req.companyId || '';
      const exchange = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM sales_exchanges WHERE id = ? AND company_id = ?', [exchangeId, companyId], (err, row) => {
          if (err) return reject(err);
          resolve(row);
        });
      });
      if (!exchange) return sendError(res, 404, 'Exchange not found', 'NOT_FOUND');

      const [items, reprints, approvals] = await Promise.all([
        new Promise((resolve, reject) => {
          db.all('SELECT * FROM sales_exchange_items WHERE exchange_id = ? AND company_id = ?', [exchangeId, companyId], (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
          });
        }),
        new Promise((resolve, reject) => {
          db.all('SELECT * FROM reprint_jobs WHERE exchange_id = ? AND company_id = ?', [exchangeId, companyId], (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
          });
        }),
        new Promise((resolve, reject) => {
          db.all('SELECT * FROM sales_exchange_approvals WHERE exchange_id = ? AND company_id = ?', [exchangeId, companyId], (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
          });
        })
      ]);

      res.json({
        ...exchange,
        items,
        reprint_jobs: reprints,
        approvals
      });
    } catch (err) {
      sendError(res, 500, err.message, 'FETCH_EXCHANGE_FAILED');
    }
  });

  app.post('/api/sales-exchanges', checkPermission('create_exchange'), validateBody(exchangeSchemas.create), async (req, res) => {
    try {
      await validateFyDate('exchange_date', req.body, req.companyId || '');
      const { 
        invoice_id, customer_id, customer_name, reason, remarks, items 
      } = req.body;

      if (!invoice_id || !reason || !items || !items.length) {
        return sendError(res, 400, 'Invoice ID, reason, and items are required', 'MISSING_FIELDS');
      }

      const exchange_number = `SE-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`;

      const exchangeId = await new Promise((resolve, reject) => {
        db.run("BEGIN TRANSACTION", (err) => {
          if (err) return reject(err);

          db.run(
            `INSERT INTO sales_exchanges (exchange_number, invoice_id, customer_id, customer_name, reason, remarks, created_by, company_id) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [exchange_number, invoice_id, customer_id, customer_name, reason, remarks, req.userId, req.companyId || ''],
            function(err) {
              if (err) {
                db.run("ROLLBACK");
                return reject(err);
              }
              const newId = this.lastID;
              const itemStmt = db.prepare(
                `INSERT INTO sales_exchange_items (exchange_id, product_id, product_name, qty_returned, qty_replaced, price_difference, item_condition, company_id) 
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
              );

              let itemError = null;
              for (const item of items) {
                itemStmt.run([
                  newId, item.product_id, item.product_name, item.qty_returned, 
                  item.qty_replaced, item.price_difference || 0, item.condition, req.companyId || ''
                ], (err) => {
                  if (err) itemError = err;
                });
              }

              itemStmt.finalize((err) => {
                if (err || itemError) {
                  db.run("ROLLBACK");
                  return reject(err || itemError);
                }
                db.run("COMMIT", (commitErr) => {
                  if (commitErr) {
                    db.run("ROLLBACK");
                    return reject(commitErr);
                  }
                  resolve(newId);
                });
              });
            }
          );
        });
      });

      await documentService.logAudit(req.userId, 'CREATE', 'sales_exchange', exchangeId, { exchange_number }, req.companyId || '');

      res.status(201).json({ id: exchangeId, exchange_number });
    } catch (err) {
      sendError(res, 500, err.message, 'CREATE_EXCHANGE_FAILED');
    }
  });  app.post('/api/sales-exchanges/:id/approve', checkPermission('approve_exchange'), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      const exchangeId = req.params.id;
      const { comments } = req.body;

      const companyId = req.companyId || '';
      await new Promise((resolve, reject) => {
        db.run(
          "UPDATE sales_exchanges SET status = 'approved' WHERE id = ? AND company_id = ?",
          [exchangeId, companyId],
          function(err) {
            if (err) return reject(err);
            resolve();
          }
        );
      });

      await new Promise((resolve, reject) => {
        db.run(
          "INSERT INTO sales_exchange_approvals (exchange_id, approved_by, comments, status, company_id) VALUES (?, ?, ?, ?, ?)",
          [exchangeId, req.userId, comments, 'approved', companyId],
          (err) => {
            if (err) return reject(err);
            resolve();
          }
        );
      });

      // Auto-generate reprint job
      const exchangeRow = await new Promise((resolve, reject) => {
        db.get("SELECT * FROM sales_exchanges WHERE id = ? AND company_id = ?", [exchangeId, companyId], (err, row) => {
          if (err) return reject(err);
          resolve(row);
        });
      });

      if (exchangeRow) {
        await new Promise((resolve, reject) => {
          db.run(
            "INSERT INTO reprint_jobs (exchange_id, job_description, company_id) VALUES (?, ?, ?)",
            [exchangeId, `Reprint for Exchange ${exchangeRow.exchange_number}: ${exchangeRow.reason}`, companyId],
            (err) => {
              if (err) return reject(err);
              resolve();
            }
          );
        });
      }

      res.json({ status: 'approved' });
    } catch (err) {
      sendError(res, 500, err.message, 'APPROVE_EXCHANGE_FAILED');
    }
  });

  /**
   * Sales Orders Endpoints
   */
  app.get('/api/sales-orders', checkPermission('view_sales_orders'), injectFinancialYear, (req, res) => {
    const companyId = req.companyId || '';
    let { sql, params } = addFyDateFilter('SELECT * FROM sales_orders WHERE company_id = ?', [companyId], req, 'orderDate');
    sql += ' ORDER BY orderDate DESC';
    db.all(sql, params, (err, rows) => {
      if (err) return sendError(res, 500, err.message, 'FETCH_SALES_ORDERS_FAILED');
      res.json(rows);
    });
  });

  app.get('/api/sales-orders/:id', checkPermission('view_sales_orders'), (req, res) => {
    const id = req.params.id;
    db.get('SELECT * FROM sales_orders WHERE id = ? AND company_id = ?', [id, req.companyId || ''], (err, row) => {
      if (err) return sendError(res, 500, err.message, 'FETCH_SALES_ORDER_FAILED');
      if (!row) return sendError(res, 404, 'Sales order not found', 'NOT_FOUND');
      res.json(row);
    });
  });

  app.post('/api/sales-orders', checkPermission('create_sales_order'), validateBody(orderSchemas.create), async (req, res) => {
    try {
      await validateFyDate('orderDate', req.body, req.companyId || '');
      const o = req.body || {};
      if (!o.id || !o.items || !Array.isArray(o.items) || o.items.length === 0) {
        return sendError(res, 400, 'Order id and items are required', 'MISSING_FIELDS');
      }

      try {
        await validateItemsPricing(o.items);
      } catch (validationError) {
        console.error('[Pricing Validation Failed]', validationError.message);
        return sendError(res, 400, validationError.message, 'PRICE_VALIDATION_FAILED');
      }

      const now = new Date().toISOString();
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO sales_orders (id, quotation_id, customer_id, orderDate, deliveryDate, status, items, subtotal, discounts, tax, other_charges, total, notes, created_by, created_at, company_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [o.id, o.quotationId || null, o.customerId || null, o.orderDate || now, o.deliveryDate || null, o.status || 'Draft', JSON.stringify(o.items), o.subtotal || 0, o.discounts || 0, o.tax || 0, o.otherCharges || 0, o.total || 0, o.notes || '', req.userId, now, req.companyId || ''],
          function(err) {
            if (err) return reject(err);
            resolve();
          }
        );
      });
      await documentService.logAudit(req.userId, 'CREATE', 'sales_order', o.id, { created: true }, req.companyId || '');
      res.status(201).json({ id: o.id });
    } catch (err) {
      sendError(res, 500, err.message, 'CREATE_SALES_ORDER_FAILED');
    }
  });

  app.put('/api/sales-orders/:id', checkPermission('edit_sales_order'), validateBody(orderSchemas.update), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      const id = req.params.id;
      const o = req.body || {};
      await validateFyDate('orderDate', o, req.companyId || '');
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE sales_orders SET quotation_id = ?, customer_id = ?, orderDate = ?, deliveryDate = ?, status = ?, items = ?, subtotal = ?, discounts = ?, tax = ?, other_charges = ?, total = ?, notes = ?, updated_by = ?, updated_at = ? WHERE id = ? AND company_id = ?`,
          [o.quotationId || null, o.customerId || null, o.orderDate || null, o.deliveryDate || null, o.status || 'Draft', JSON.stringify(o.items || []), o.subtotal || 0, o.discounts || 0, o.tax || 0, o.otherCharges || 0, o.total || 0, o.notes || '', req.userId, new Date().toISOString(), id, req.companyId || ''],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      res.json({ status: 'updated' });
    } catch (err) {
      sendError(res, 500, err.message, 'UPDATE_SALES_ORDER_FAILED');
    }
  });
  
  app.delete('/api/sales-orders/:id', checkPermission('delete_sales_order'), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      const id = req.params.id;
      await new Promise((resolve, reject) => {
        db.run('DELETE FROM sales_orders WHERE id = ? AND company_id = ?', [id, req.companyId || ''], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });
      res.json({ status: 'deleted' });
    } catch (err) {
      sendError(res, 500, err.message, 'DELETE_SALES_ORDER_FAILED');
    }
  });

  app.get('/api/reprint-jobs', checkPermission('view_reprints'), (req, res) => {
    db.all('SELECT * FROM reprint_jobs WHERE company_id = ? ORDER BY created_at DESC', [req.companyId || ''], (err, rows) => {
      if (err) return sendError(res, 500, err.message, 'FETCH_REPRINTS_FAILED');
      res.json(rows);
    });
  });

  app.put('/api/reprint-jobs/:id', checkPermission('edit_reprint'), (req, res) => {
    const { status, paper_used, ink_used, finishing_cost, total_reprint_cost } = req.body;
    const completed_at = status === 'completed' ? new Date().toISOString() : null;

    db.run(
      `UPDATE reprint_jobs 
       SET status = ?, paper_used = ?, ink_used = ?, finishing_cost = ?, total_reprint_cost = ?, completed_at = ?
       WHERE id = ? AND company_id = ?`,
      [status, paper_used, ink_used, finishing_cost, total_reprint_cost, completed_at, req.params.id, req.companyId || ''],
      function(err) {
        if (err) return sendError(res, 500, err.message, 'UPDATE_REPRINT_FAILED');
        res.json({ status: 'updated' });
      }
    );
  });

  app.get('/api/documents/:id/verify', checkPermission('verify_document'), async (req, res) => {
    try {
      const result = await documentService.verifySignature(req.params.id, req.companyId || '');
      res.json(result);
    } catch (err) {
      sendError(res, 404, err.message, 'VERIFICATION_FAILED');
    }
  });

  app.get('/api/documents/:id/audit', checkPermission('view_audit'), (req, res) => {
    db.all("SELECT * FROM audit_logs WHERE entity_id = ? AND company_id = ? ORDER BY timestamp DESC", [req.params.id, req.companyId || ''], (err, rows) => {
      if (err) return sendError(res, 500, err.message, 'AUDIT_FETCH_FAILED');
      res.json(rows);
    });
  });

  /**
   * PDF Generation Endpoint
   */
  /*
  app.post('/api/pdf/generate', async (req, res) => {
    try {
      const { html } = req.body;
      const isStream = req.query.stream === 'true';

      if (!html) {
        return sendError(res, 400, 'HTML content is required', 'MISSING_HTML');
      }

      const pdfBuffer = await pdfService.generatePdfFromHtml(html);

      res.setHeader('Content-Type', 'application/pdf');
      const disposition = isStream ? 'inline' : 'attachment';
      res.setHeader('Content-Disposition', `${disposition}; filename=document.pdf`);
      res.send(pdfBuffer);
    } catch (err) {
      console.error('PDF generation endpoint error:', err);
      sendError(res, 500, 'Failed to generate PDF', 'PDF_GENERATION_FAILED');
    }
  });
  */

  /**
   * Universal Dispatcher Endpoint
   * Takes document data and generates a styled PDF regardless of type.
   */
  /*
  app.post('/api/documents/dispatch', async (req, res) => {
    try {
      const { docType, data, id } = req.body;
      const isStream = req.query.stream === 'true';

      let finalData = data;
      let finalType = docType;

      // If an ID is provided, resolve the document first
      if (id) {
        const doc = await documentService.resolveDocument(id, req.companyId || '');
        if (!doc) return sendError(res, 404, 'Document not found', 'NOT_FOUND');
        finalData = JSON.parse(doc.payload);
        finalType = doc.type || finalType;
        // Include ID and logical number in final data for the generator
        finalData.id = doc.id;
        finalData.logical_number = doc.logical_number;
      }

      if (!finalType || !finalData) {
        return sendError(res, 400, 'docType and data (or id) are required', 'INVALID_DISPATCH_REQUEST');
      }

      console.log(`[Dispatcher] Generating ${finalType} PDF...`);
      const pdfBytes = await documentGenerator.generate(finalType, finalData);
      const pdfBuffer = Buffer.from(pdfBytes);

      const filename = `${finalType.toUpperCase()}-${finalData.logical_number || 'TEMP'}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      const disposition = isStream ? 'inline' : 'attachment';
      res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
      res.send(pdfBuffer);

      if (id) {
        await documentService.logAudit(req.userId || 'system', 'DISPATCH_PDF', 'document', id, {
          type: finalType,
          streamed: isStream
        });
      }
    } catch (err) {
      console.error('[Dispatcher] Error:', err);
      sendError(res, 500, err.message, 'DISPATCH_FAILED');
    }
  });
  */

  // --- End of Document Engine Endpoints ---
  app.get('/api/classes', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), (req, res) => {
    db.all("SELECT * FROM classes WHERE company_id = ? ORDER BY name", [req.companyId || ''], (err, rows) => {
      if (err) { console.error('[Classes] GET error:', err); return res.status(500).json({ error: 'Failed to retrieve classes' }); }
      res.json(rows);
    });
  });

  app.post('/api/classes', requireRole('Admin', 'Accountant', 'Manager'), validateBody(classSchemas.create), (req, res) => {
    const { name } = req.body;
    db.run("INSERT INTO classes (name, company_id) VALUES (?, ?)", [name, req.companyId || ''], function(err) {
      if (err) { console.error('[Classes] POST error:', err); return res.status(500).json({ error: 'Failed to create class' }); }
      res.json({ id: this.lastID, name });
    });
  });

  app.delete('/api/classes/:id', requireRole('Admin', 'Accountant', 'Manager'), (req, res) => {
    db.run("DELETE FROM classes WHERE id = ? AND company_id = ?", [req.params.id, req.companyId || ''], (err) => {
      if (err) { console.error('[Classes] DELETE error:', err); return res.status(500).json({ error: 'Failed to delete class' }); }
      res.json({ success: true });
    });
  });

  // --- Subjects Endpoints ---
  app.get('/api/subjects', (req, res) => {
    db.all("SELECT * FROM subjects WHERE company_id = ? ORDER BY name", [req.companyId || ''], (err, rows) => {
      if (err) { console.error('[Subjects] GET error:', err); return res.status(500).json({ error: 'Failed to retrieve subjects' }); }
      res.json(rows);
    });
  });

  app.post('/api/subjects', requireRole('Admin', 'Accountant', 'Manager'), validateBody(subjectSchemas.create), (req, res) => {
    const { name, code } = req.body;
    db.run("INSERT INTO subjects (name, code, company_id) VALUES (?, ?, ?)", [name, code, req.companyId || ''], function(err) {
      if (err) { console.error('[Subjects] POST error:', err); return res.status(500).json({ error: 'Failed to create subject' }); }
      res.json({ id: this.lastID, name, code });
    });
  });

  app.delete('/api/subjects/:id', requireRole('Admin', 'Accountant', 'Manager'), (req, res) => {
    db.run("DELETE FROM subjects WHERE id = ? AND company_id = ?", [req.params.id, req.companyId || ''], (err) => {
      if (err) { console.error('[Subjects] DELETE error:', err); return res.status(500).json({ error: 'Failed to delete subject' }); }
      res.json({ success: true });
    });
  });

  // 1. GET Schools
  app.get('/api/schools', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), checkPermission('view_schools'), (req, res) => {
    db.all("SELECT * FROM schools WHERE company_id = ?", [req.companyId || ''], (err, rows) => {
    if (err) { console.error('[Schools] GET error:', err); return res.status(500).json({ error: 'Failed to retrieve schools' }); }
    res.json(rows);
  });
});

  // 2. GET Inventory
  app.get('/api/inventory', checkPermission('view_inventory'), async (req, res) => {
    try {
      const companyId = req.companyId || '';
      const includeDeleted = ['1', 'true', 'yes'].includes(
        String(req.query?.include_deleted ?? req.query?.includeDeleted ?? '').trim().toLowerCase()
      );
      let sql = 'SELECT * FROM inventory WHERE company_id = ?';
      const params = [companyId];
      if (!includeDeleted) {
        sql += ' AND (status IS NULL OR status != ?)';
        params.push('Deleted');
      }
      sql += ' ORDER BY name ASC';
      db.all(sql, params, (err, rows) => {
        if (err) { console.error('[Inventory] GET error:', err); return res.status(500).json({ error: 'Failed to retrieve inventory' }); }
        res.json(rows);
      });
    } catch (err) {
      console.error('[Inventory] GET error:', err?.message || err);
      res.status(500).json({ error: 'Failed to retrieve inventory' });
    }
  });

  // 2b. POST Inventory (Create)
  app.post('/api/inventory', requireRole('Admin', 'Accountant', 'Manager', 'Clerk'), async (req, res) => {
    try {
      const { body } = req;
      
      // Validation: Name is required
      if (!body.name || !String(body.name).trim()) {
        return res.status(400).json({ error: 'Item name is required' });
      }

      // Enterprise SaaS Best Practice: Backend generates primary key and controls tenant metadata
      // Ignore any client-supplied id, company_id, created_by, created_at, updated_at
      const id = randomUUID();
      const companyId = req.companyId || '';
      const createdBy = req.user?.id || req.user?.username || 'system';

      const name = String(body.name).trim();
      const sku = body.sku ? String(body.sku).trim() : (body.code ? String(body.code).trim() : null);
      const material = body.material || body.category || null;
      const type = (body.type || 'material').toLowerCase();
      const quantity = Number(body.quantity) || 0;
      const costPerUnit = Number(body.cost_per_unit ?? body.cost ?? body.costPrice ?? body.cost_price ?? 0);
      const sellingPrice = Number(body.selling_price ?? body.sellingPrice ?? body.price ?? 0);
      const unit = body.unit || 'units';
      const category_id = body.category_id || null;
      const minStockLevel = Number(body.min_stock_level ?? body.minStockLevel ?? 0);
      const maxStockLevel = Number(body.max_stock_level ?? body.maxStockLevel ?? 0);
      const reorderPoint = Number(body.reorder_point ?? body.reorderPoint ?? 0);
      const warehouseId = body.warehouse_id || null;
      const reserved = Number(body.reserved) || 0;
      const isProtected = body.is_protected ? 1 : 0;
      const now = new Date().toISOString();

      // Business Uniqueness Check: SKU must be unique per company
      if (sku) {
        const existing = await new Promise((resolve, reject) => {
          db.get(
            'SELECT id FROM inventory WHERE company_id = ? AND sku = ? LIMIT 1',
            [companyId, sku],
            (err, row) => (err ? reject(err) : resolve(row))
          );
        });
        if (existing) {
          return res.status(409).json({ 
            error: `Inventory item with SKU '${sku}' already exists in this company.`,
            code: 'SKU_ALREADY_EXISTS',
            sku 
          });
        }
      }

      // Perform clean INSERT
      db.run(
        `INSERT INTO inventory (
          id, company_id, name, sku, material, type, quantity, cost_per_unit, selling_price, 
          unit, category_id, min_stock_level, max_stock_level, reorder_point, warehouse_id, 
          reserved, is_protected, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, companyId, name, sku, material, type, quantity, costPerUnit, sellingPrice,
          unit, category_id, minStockLevel, maxStockLevel, reorderPoint, warehouseId,
          reserved, isProtected, createdBy, now, now
        ],
        function (err) {
          if (err) {
            if (err.message && (err.message.includes('UNIQUE constraint failed') || err.message.includes('idx_inventory_company_sku'))) {
              return res.status(409).json({ 
                error: `Inventory item with SKU '${sku}' already exists in this company.`,
                code: 'SKU_ALREADY_EXISTS',
                sku 
              });
            }
            return handleInsertConstraintError(res, err, 'Create inventory item');
          }
          // Return complete created record
          res.status(201).json({
            id,
            company_id: companyId,
            name,
            sku,
            material,
            type,
            quantity,
            cost_per_unit: costPerUnit,
            selling_price: sellingPrice,
            unit,
            category_id,
            min_stock_level: minStockLevel,
            max_stock_level: maxStockLevel,
            reorder_point: reorderPoint,
            warehouse_id: warehouseId,
            reserved,
            is_protected: Boolean(isProtected),
            created_by: createdBy,
            created_at: now,
            updated_at: now
          });
        }
      );
    } catch (err) {
      console.error('[Inventory] POST error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create inventory item' });
    }
  });

  // 2c. PUT Inventory (Update)
  app.put('/api/inventory/:id', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      const { id } = req.params;
      const { body } = req;
      const companyId = req.companyId || '';
      const fields = [];
      const params = [];
      const allowed = ['name', 'sku', 'material', 'type', 'quantity', 'cost_per_unit', 'selling_price', 'unit', 'category_id', 'min_stock_level', 'max_stock_level', 'reorder_point', 'warehouse_id', 'reserved', 'is_protected'];
      
      for (const field of allowed) {
        if (body[field] !== undefined) {
          fields.push(`${field} = ?`);
          params.push(body[field]);
        }
      }
      if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
      
      // SKU conflict check on update if sku is supplied
      if (body.sku) {
        const skuTrimmed = String(body.sku).trim();
        const existing = await new Promise((resolve, reject) => {
          db.get(
            'SELECT id FROM inventory WHERE company_id = ? AND sku = ? AND id != ? LIMIT 1',
            [companyId, skuTrimmed, id],
            (err, row) => (err ? reject(err) : resolve(row))
          );
        });
        if (existing) {
          return res.status(409).json({
            error: `Inventory item with SKU '${skuTrimmed}' already exists in this company.`,
            code: 'SKU_ALREADY_EXISTS',
            sku: skuTrimmed
          });
        }
      }

      fields.push('updated_at = CURRENT_TIMESTAMP');
      fields.push('last_updated = CURRENT_TIMESTAMP');
      params.push(id, companyId);

      db.run(`UPDATE inventory SET ${fields.join(', ')} WHERE id = ? AND company_id = ?`, params, function (err) {
        if (err) { 
          if (err.message && (err.message.includes('UNIQUE constraint failed') || err.message.includes('idx_inventory_company_sku'))) {
            return res.status(409).json({ error: `Inventory item with SKU '${body.sku}' already exists in this company.`, code: 'SKU_ALREADY_EXISTS' });
          }
          console.error('[Inventory] PUT error:', err); 
          return res.status(500).json({ error: 'Failed to update inventory item' }); 
        }
        if (this.changes === 0) return res.status(404).json({ error: 'Inventory item not found' });
        res.json({ success: true, id });
      });
    } catch (err) {
      console.error('[Inventory] PUT error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to update inventory item' });
    }
  });

  // 2d. DELETE Inventory (Soft Delete)
  app.delete('/api/inventory/:id', requireRole('Admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const companyId = req.companyId || '';
      db.get('SELECT * FROM inventory WHERE id = ? AND company_id = ?', [id, companyId], (err, row) => {
        if (err) { console.error('[Inventory] DELETE error:', err); return res.status(500).json({ error: 'Failed to delete inventory item' }); }
        if (!row) return res.status(404).json({ error: 'Inventory item not found' });
        if (row.is_protected) return res.status(403).json({ error: 'Cannot delete protected item' });
        const voidedBy = req.user?.id || req.user?.username || 'system';
        db.run("UPDATE inventory SET status = 'Deleted', deleted_at = CURRENT_TIMESTAMP, void_reason = 'Manually deleted', voided_by = ?, updated_at = CURRENT_TIMESTAMP, last_updated = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?", [voidedBy, id, companyId], (err) => {
          if (err) { console.error('[Inventory] DELETE error:', err); return res.status(500).json({ error: 'Failed to delete inventory item' }); }
          res.json({ success: true, id, status: 'Deleted' });
        });
      });
    } catch (err) {
      console.error('[Inventory] DELETE error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to delete inventory item' });
    }
  });

// 11. Delete Examination Batch
app.delete('/api/examinations/batch/:batch_id', (req, res) => {
  const { batch_id } = req.params;
  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    db.run("DELETE FROM examination_bom_calculations WHERE batch_id = ? AND company_id = ?", [batch_id, req.companyId || '']);
    db.run("DELETE FROM examination_subjects WHERE batch_id = ? AND company_id = ?", [batch_id, req.companyId || '']);
    db.run("DELETE FROM examination_classes WHERE batch_id = ? AND company_id = ?", [batch_id, req.companyId || '']);
    db.run("DELETE FROM examinations WHERE batch_id = ? AND company_id = ?", [batch_id, req.companyId || ''], (err) => {
      if (err) {
        console.error('[Examination] delete batch error:', err);
        db.run("ROLLBACK");
        return res.status(500).json({ error: 'Failed to delete batch' });
      }
      db.run("DELETE FROM examination_batches WHERE id = ? AND company_id = ?", [batch_id, req.companyId || ''], (err) => {
        if (err) {
          console.error('[Examination] delete batch error:', err);
          db.run("ROLLBACK");
          return res.status(500).json({ error: 'Failed to delete batch' });
        }
        db.run("COMMIT");
        res.json({ success: true });
      });
    });
  });
});

// 13. Toggle Recurring Status
app.post('/api/examinations/batch/:batch_id/recurring', (req, res) => {
  const { batch_id } = req.params;
  const { is_recurring } = req.body;
  db.run("UPDATE examinations SET is_recurring = ? WHERE batch_id = ? AND company_id = ?", [is_recurring ? 1 : 0, batch_id, req.companyId || ''], (err) => {
    if (err) { console.error('[Examination] toggle recurring error:', err); return res.status(500).json({ error: 'Failed to update recurring status' }); }
    res.json({ success: true });
  });
});

// 12. Get Invoice Details
app.get('/api/invoices/:id/details', (req, res) => {
  const { id } = req.params;
  db.all(`SELECT class, SUM(candidates) as learner_count, AVG(charge_per_learner) as charge_per_learner, SUM(selling_price) as total
          FROM examinations 
          WHERE invoice_id = ? AND company_id = ?
          GROUP BY class`, [id, req.companyId || ''], (err, rows) => {
    if (err) { console.error('[Invoices] details error:', err); return res.status(500).json({ error: 'Failed to retrieve invoice details' }); }
    res.json(rows);
  });
});

  // 10. Get Examination Stats
  app.get('/api/stats/examination', checkPermission('view_stats'), injectFinancialYear, (req, res) => {
    const companyId = req.companyId || '';
    const fyStart = req.fyStartDate;
    const fyEnd = req.fyEndDate;
    const stats = {};
    
    db.get("SELECT COUNT(*) as count FROM examinations WHERE status = 'pending' AND company_id = ? AND date(created_at) >= date(?) AND date(created_at) <= date(?)", [companyId, fyStart, fyEnd], (err, row) => {
      if (err) { console.error('[Stats] pending count error:', err); return res.status(500).json({ error: 'Failed to load stats' }); }
      stats.pending_jobs = row?.count || 0;
      
      db.get("SELECT COALESCE(SUM(total_amount), 0) as total FROM invoices WHERE LOWER(status) = 'paid' AND company_id = ? AND date(created_at) >= date(?) AND date(created_at) <= date(?)", [companyId, fyStart, fyEnd], (err, row) => {
        if (err) { console.error('[Stats] revenue error:', err); return res.status(500).json({ error: 'Failed to load stats' }); }
        stats.total_revenue = row?.total || 0;
        
        db.get("SELECT COALESCE(SUM(total_amount), 0) as total FROM invoices WHERE LOWER(status) = 'unpaid' AND company_id = ? AND date(created_at) >= date(?) AND date(created_at) <= date(?)", [companyId, fyStart, fyEnd], (err, row) => {
          if (err) { console.error('[Stats] outstanding error:', err); return res.status(500).json({ error: 'Failed to load stats' }); }
          stats.outstanding_amount = row?.total || 0;
          
          db.get("SELECT SUM(actual_waste_sheets) as waste FROM examinations WHERE company_id = ? AND date(created_at) >= date(?) AND date(created_at) <= date(?)", [companyId, fyStart, fyEnd], (err, row) => {
            if (err) { console.error('[Stats] waste error:', err); return res.status(500).json({ error: 'Failed to load stats' }); }
            stats.total_waste = row?.waste || 0;
            
            db.get("SELECT SUM(total_sheets_used) as total, SUM(internal_cost) as cost FROM examinations WHERE company_id = ? AND date(created_at) >= date(?) AND date(created_at) <= date(?)", [companyId, fyStart, fyEnd], (err, row) => {
              if (err) { console.error('[Stats] sheets/cost error:', err); return res.status(500).json({ error: 'Failed to load stats' }); }
              stats.total_sheets = row?.total || 0;
              stats.total_cost = row?.cost || 0;
              res.json(stats);
            });
          });
        });
      });
    });
  });

  // 14. Get Monthly Examination Data for Dashboard
  app.get('/api/stats/monthly-data', checkPermission('view_stats'), injectFinancialYear, (req, res) => {
    const companyId = req.companyId || '';
    const fyStart = req.fyStartDate;
    const fyEnd = req.fyEndDate;
    
    const query = `
      SELECT 
        m.month,
        COALESCE(i.revenue, 0) as revenue,
        COALESCE(e.month_cost, 0) as cost
      FROM (
        SELECT '01' as month UNION SELECT '02' UNION SELECT '03' UNION SELECT '04' 
        UNION SELECT '05' UNION SELECT '06' UNION SELECT '07' UNION SELECT '08' 
        UNION SELECT '09' UNION SELECT '10' UNION SELECT '11' UNION SELECT '12'
      ) m
      LEFT JOIN (
        SELECT strftime('%m', created_at) as month, SUM(total_amount) as revenue
        FROM invoices 
        WHERE date(created_at) >= date(?) AND date(created_at) <= date(?) AND status != 'cancelled' AND company_id = ?
        GROUP BY month
      ) i ON m.month = i.month
      LEFT JOIN (
        SELECT strftime('%m', created_at) as month, SUM(internal_cost) as month_cost
        FROM examinations
        WHERE date(created_at) >= date(?) AND date(created_at) <= date(?) AND company_id = ?
        GROUP BY month
      ) e ON m.month = e.month
      ORDER BY m.month
    `;

    db.all(query, [fyStart, fyEnd, companyId, fyStart, fyEnd, companyId], (err, rows) => {
      if (err) { console.error('[Stats] monthly-data error:', err); return res.status(500).json({ error: 'Failed to load monthly data' }); }
      res.json(rows);
    });
  });
  // --- End of Monthly Data ---

  // === Inventory Transaction API Endpoints ===
  
  // Create inventory transaction (deduction)
  app.post('/api/inventory/transactions', checkPermission('create_transaction'), validateBody(inventorySchemas.stockAdjustment), injectFinancialYear, requireFyNotClosed, async (req, res) => {
    try {
      await validateFyDate('transaction_date', req.body, req.companyId || '');
      const { itemId, warehouseId, quantity, batchId, reason, reference, referenceId, performedBy, type } = req.body;
      const transactionDate = req.body.transaction_date;

      // Resolve performer: prefer body value, fall back to authenticated user
      const resolvedPerformer = performedBy || req.user?.id || req.user?.username || '';

      // Capture IP and user agent for audit trail
      const ipAddress = req.ip || req.connection?.remoteAddress || null;
      const userAgent = req.get('User-Agent') || null;

      // Get current inventory
      const item = await new Promise((resolve, reject) => {
        db.get("SELECT * FROM inventory WHERE id = ? AND company_id = ?", [itemId, req.companyId || ''], (err, row) => {
          if (err) return reject(err);
          resolve(row);
        });
      });

      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }

      const currentQuantity = item.quantity || 0;
      const transactionType = type || 'OUT';
      const effectiveQuantity = transactionType === 'OUT' ? -Math.abs(quantity) : Math.abs(quantity);

      // Check if sufficient quantity for deductions
      if (effectiveQuantity < 0 && currentQuantity < Math.abs(quantity)) {
        return res.status(400).json({ 
          error: `Insufficient stock. Available: ${currentQuantity}, Requested: ${Math.abs(quantity)}` 
        });
      }

      const newQuantity = Math.max(0, currentQuantity + effectiveQuantity);
      const unitCost = item.cost_per_unit || item.cost || 0;
      const totalCost = Math.abs(quantity) * unitCost;
      const transactionId = `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Create transaction record and update inventory atomically
      await new Promise((resolve, reject) => {
        db.run("BEGIN TRANSACTION", (err) => {
          if (err) return reject(err);

          db.run(`INSERT INTO inventory_transactions 
            (id, item_id, warehouse_id, batch_id, type, quantity, previous_quantity, new_quantity, 
              unit_cost, total_cost, reason, reference, reference_id, performed_by, ip_address, user_agent, timestamp, company_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
            [transactionId, itemId, warehouseId || null, batchId || null, transactionType,
              quantity, currentQuantity, newQuantity, unitCost, totalCost,
              reason, reference || null, referenceId || null, resolvedPerformer, ipAddress, userAgent, transactionDate, req.companyId || ''],
            (err) => {
            if (err) {
              db.run("ROLLBACK");
              return reject(err);
            }

            // Update inventory
            db.run("UPDATE inventory SET quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?", [newQuantity, itemId, req.companyId || ''], (err) => {
              if (err) {
                db.run("ROLLBACK");
                return reject(err);
              }

              db.run("COMMIT", (err) => {
                if (err) return reject(err);
                resolve();
              });
            });
          });
        });
      });

      res.json({ 
        success: true, 
        transactionId,
        previousQuantity: currentQuantity,
        newQuantity,
        remainingQuantity: newQuantity
      });
    } catch (err) {
      console.error('Error creating inventory transaction:', err);
      const message = err?.message || 'Failed to create transaction';
      const status = message.includes('closed') ? 403 : (message.includes('Financial Year') || message.includes('Selected date') ? 400 : 500);
      res.status(status).json({ error: status === 500 ? 'Failed to create transaction' : message });
    }
  });
  
  // Get transaction history for item
  app.get('/api/inventory/:itemId/transactions', checkPermission('view_inventory'), injectFinancialYear, async (req, res) => {
    try {
      const { itemId } = req.params;
      const limit = parseInt(req.query.limit) || 50;
      const companyId = req.companyId || '';
      let sql = 'SELECT * FROM inventory_transactions WHERE item_id = ? AND company_id = ?';
      const params = [itemId, companyId];
      const filtered = addFyDateFilter(sql, params, req, 'timestamp');
      sql = filtered.sql + ' ORDER BY timestamp DESC LIMIT ?';
      filtered.params.push(limit);
      const rows = await new Promise((resolve, reject) => {
        db.all(sql, filtered.params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });
      res.json(rows);
    } catch (err) {
      console.error('[Inventory] transactions error:', err);
      res.status(500).json({ error: 'Failed to load transactions' });
    }
  });
  
  // Get warehouse inventory
  app.get('/api/inventory/warehouse/:warehouseId', checkPermission('view_inventory'), (req, res) => {
    const { warehouseId } = req.params;
    const companyId = req.companyId || '';
    
    db.all(`SELECT wi.*, i.name as item_name, i.material, i.cost_per_unit, i.unit
            FROM warehouse_inventory wi
            LEFT JOIN inventory i ON wi.item_id = i.id
            WHERE wi.warehouse_id = ? AND wi.company_id = ? AND i.company_id = ?`, [warehouseId, companyId, companyId], (err, rows) => {
      if (err) { console.error('[Inventory] warehouse error:', err); return res.status(500).json({ error: 'Failed to load warehouse inventory' }); }
      res.json(rows || []);
    });
  });

  // Get all warehouses (distinct warehouse IDs with aggregated stock)
  app.get('/api/warehouses', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), (req, res) => {
    const companyId = req.companyId || '';
    db.all(`SELECT wi.warehouse_id,
                   COALESCE(SUM(wi.quantity), 0) as total_stock,
                   COALESCE(SUM(wi.reserved), 0) as total_reserved,
                   COUNT(DISTINCT wi.item_id) as item_count,
                   MAX(wi.last_updated) as last_updated
            FROM warehouse_inventory wi
            WHERE wi.company_id = ?
            GROUP BY wi.warehouse_id
            ORDER BY wi.warehouse_id`, [companyId], (err, rows) => {
      if (err) { console.error('[Warehouses] GET error:', err); return res.status(500).json({ error: 'Failed to load warehouses' }); }
      res.json(rows || []);
    });
  });

  // Save a warehouse snapshot
  app.post('/api/warehouses/snapshot', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    try {
      const { id, snapshot_data, snapshot_type, notes, created_by } = req.body;
      const snapshotId = id || `SNAP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const companyId = req.companyId || '';
      db.run(`INSERT INTO warehouse_snapshots (id, snapshot_data, snapshot_type, notes, created_by, company_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [snapshotId, JSON.stringify(snapshot_data), snapshot_type || 'manual', notes || '', created_by || req.user?.id || '', companyId, new Date().toISOString()],
        (err) => {
          if (err) { return handleInsertConstraintError(res, err, 'Save warehouse snapshot'); }
          res.status(201).json({ success: true, id: snapshotId });
        });
    } catch (err) {
      console.error('[Warehouses] snapshot error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to save snapshot' });
    }
  });

  // Fetch warehouse snapshots
  app.get('/api/warehouses/snapshot', requireRole('Admin', 'Accountant', 'Manager', 'Clerk', 'Viewer'), (req, res) => {
    const companyId = req.companyId || '';
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    db.all(`SELECT * FROM warehouse_snapshots WHERE company_id = ? ORDER BY created_at DESC LIMIT ?`,
      [companyId, limit], (err, rows) => {
        if (err) { console.error('[Warehouses] snapshot get error:', err); return res.status(500).json({ error: 'Failed to load snapshots' }); }
        res.json((rows || []).map(r => ({ ...r, snapshot_data: typeof r.snapshot_data === 'string' ? JSON.parse(r.snapshot_data) : r.snapshot_data })));
      });
  });

  // Sync master inventory from warehouse totals
  app.post('/api/warehouses/sync-master', requireRole('Admin', 'Accountant', 'Manager'), async (req, res) => {
    const companyId = req.companyId || '';
    const { itemId } = req.body;
    try {
      if (itemId) {
        // Sync single item
        const whItems = await new Promise((resolve, reject) => {
          db.all(`SELECT item_id, SUM(quantity) as total_qty, SUM(reserved) as total_reserved
                  FROM warehouse_inventory WHERE item_id = ? AND company_id = ? GROUP BY item_id`,
            [itemId, companyId], (err, rows) => {
              if (err) reject(err); else resolve(rows || []);
            });
        });
        if (whItems.length > 0) {
          const row = whItems[0];
          db.run('UPDATE inventory SET quantity = ?, reserved = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?',
            [row.total_qty, row.total_reserved, itemId, companyId], (err) => {
              if (err) return res.status(500).json({ error: 'Failed to sync item' });
              res.json({ success: true, itemId, syncedQuantity: row.total_qty, syncedReserved: row.total_reserved });
            });
        } else {
          res.json({ success: true, itemId, syncedQuantity: 0, syncedReserved: 0 });
        }
      } else {
        // Sync all items
        const updated = await new Promise((resolve, reject) => {
          db.all(`SELECT wi.item_id, SUM(wi.quantity) as total_qty, SUM(wi.reserved) as total_reserved
                  FROM warehouse_inventory wi WHERE wi.company_id = ? GROUP BY wi.item_id`,
            [companyId], (err, rows) => {
              if (err) reject(err); else resolve(rows || []);
            });
        });
        let count = 0;
        const stmt = db.prepare('UPDATE inventory SET quantity = ?, reserved = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?');
        for (const row of updated) {
          stmt.run([row.total_qty, row.total_reserved, row.item_id, companyId]);
          count++;
        }
        stmt.finalize();
        res.json({ success: true, syncedCount: count });
      }
    } catch (err) {
      console.error('[Warehouses] sync-master error:', err);
      res.status(500).json({ error: 'Failed to sync master inventory' });
    }
  });
  
  // Get active batches for item
  app.get('/api/inventory/:itemId/batches', checkPermission('view_inventory'), (req, res) => {
    const { itemId } = req.params;
    
    db.all(`SELECT * FROM material_batches 
            WHERE item_id = ? AND status = 'active' AND remaining_quantity > 0 AND company_id = ?
            ORDER BY received_date ASC`, [itemId, req.companyId || ''], (err, rows) => {
      if (err) { console.error('[Inventory] item batches error:', err); return res.status(500).json({ error: 'Failed to load batches' }); }
      res.json(rows || []);
    });
  });

  // --- File serving API endpoints (browser platform support) ---
  const { storageDir, tempDir } = require('./runtimePaths.cjs');

  const ALLOWED_FILE_DIRS = [
    path.resolve(storageDir || './storage'),
    path.resolve(tempDir || './temp'),
  ];

  const isPathAllowed = (requestedPath) => {
    if (!requestedPath || typeof requestedPath !== 'string') return false;
    const resolved = path.resolve(requestedPath);
    const realPath = fs.realpathSync(resolved);
    return ALLOWED_FILE_DIRS.some(allowed => realPath.startsWith(allowed));
  };

  const getTenantFileDir = (companyId) => {
    const cid = String(companyId || '').trim();
    if (!cid) return null;
    return path.resolve(storageDir, 'company', cid);
  };

  const isPathTenantIsolated = (filePath, companyId) => {
    if (!companyId) return false;
    const tenantDir = getTenantFileDir(companyId);
    if (!tenantDir) return false;
    const resolved = path.resolve(filePath);
    const realPath = fs.realpathSync(resolved);
    return realPath.startsWith(tenantDir);
  };

  const validateFileOwnership = (filePath, companyId) => {
    if (!companyId) return false;
    if (isPathTenantIsolated(filePath, companyId)) return true;
    return false;
  };

  app.get('/api/read-file', (req, res) => {
    const filePath = req.query.path;
    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing path parameter' });
    }
    if (!isPathAllowed(filePath)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const companyId = req.companyId || '';
    if (!validateFileOwnership(filePath, companyId)) {
      return res.status(403).json({ success: false, error: 'Access denied: file does not belong to your company' });
    }
    try {
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: 'File not found' });
      }
      const data = fs.readFileSync(filePath);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(data);
    } catch (err) {
      console.error('[File] read-file error:', err);
      res.status(500).json({ success: false, error: 'Failed to read file' });
    }
  });

  app.post('/api/write-temp-pdf', verifyToken, async (req, res) => {
    try {
      const { data, filename } = req.body;
      if (!data || !Array.isArray(data)) {
        return res.status(400).json({ success: false, error: 'Invalid data' });
      }
      if (data.length > 50 * 1024 * 1024) {
        return res.status(413).json({ success: false, error: 'File size exceeds 50MB limit' });
      }
      const safeName = String(filename || `gen_${Date.now()}.pdf`).replace(/[^a-zA-Z0-9._-]/g, '_');
      if (!safeName.toLowerCase().endsWith('.pdf')) {
        return res.status(400).json({ success: false, error: 'Filename must end with .pdf' });
      }
      const buffer = Buffer.from(data);
      if (buffer.length > 0 && buffer[0] !== 0x25 && buffer[1] !== 0x50) {
        console.warn('[File] write-temp-pdf: data does not start with PDF magic bytes');
      }
      const companyId = req.companyId || '';
      const tenantDir = getTenantFileDir(companyId);
      const targetDir = tenantDir ? path.join(tenantDir, 'temp') : tempDir;
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const filePath = path.join(targetDir, safeName);
      fs.writeFileSync(filePath, buffer);
      res.json({ success: true, path: filePath, size: buffer.length });
    } catch (err) {
      console.error('[File] write-temp-pdf error:', err);
      res.status(500).json({ success: false, error: 'Failed to write PDF' });
    }
  });

  app.get('/api/serve-file', (req, res) => {
    const filePath = req.query.path;
    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing path parameter' });
    }
    if (!isPathAllowed(filePath)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const companyId = req.companyId || '';
    if (!validateFileOwnership(filePath, companyId)) {
      return res.status(403).json({ success: false, error: 'Access denied: file does not belong to your company' });
    }
    try {
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: 'File not found' });
      }
      const ext = path.extname(filePath).toLowerCase();
      const mimeMap = {
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.html': 'text/html',
        '.json': 'application/json',
      };
      const contentType = mimeMap[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'private, max-age=300');
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
    } catch (err) {
      console.error('[File] serve-file error:', err);
      res.status(500).json({ success: false, error: 'Failed to serve file' });
    }
  });

  // --- Static file serving for production frontend ---
  const frontendDistPath = getFrontendDistPath();
  if (fs.existsSync(frontendDistPath)) {
    console.log(`[BACKEND] Serving static frontend from: ${frontendDistPath}`);
    app.use(express.static(frontendDistPath, {
      maxAge: '1d',
      etag: true,
      lastModified: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
        if (filePath.endsWith('.js')) {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        }
      }
    }));

    // SPA fallback: serve index.html for all non-API routes
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/') || req.path === '/health' || req.path === '/api') {
        return next();
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return next();
      }
      if (path.extname(req.path)) {
        return res.status(404).type('text/plain').send('Not found');
      }
      const acceptsHtml = String(req.headers.accept || '').includes('text/html');
      if (!acceptsHtml) {
        return next();
      }
      const indexPath = path.join(frontendDistPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        next();
      }
    });
  } else {
    console.log('[BACKEND] No frontend dist found at:', frontendDistPath);
    console.log('[BACKEND] Run "npm run build" to build the frontend for production.');
  }

  // Catch-all for unknown API routes to ensure JSON response
  app.use('/api', (req, res) => {
    return sendError(res, 404, 'API endpoint not found', 'NOT_FOUND');
  });

  app.use((req, res) => {
    res.status(404).json({ message: 'Route not found' });
  });

app.use((err, req, res, next) => {
  console.error('[ERROR]', {
    message: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl
  });
  const origin = req.headers && req.headers['origin'];
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  res.status(500).json({ error: 'Internal Server Error', message: 'An unexpected error occurred. Please try again later.' });
});


  let server;
  let attempts = 0;
  const maxAttempts = 10;

  if (process.env.NODE_ENV === 'test') {
    console.log('[BACKEND] Running in test mode - skipping network socket binding.');
    return app;
  }

  while (attempts < maxAttempts) {
    try {
      console.log(`[BACKEND] Attempting to start server on port ${PORT} (Attempt ${attempts + 1}/${maxAttempts})...`);
      server = await new Promise((resolve, reject) => {
        const s = app.listen(PORT, '0.0.0.0', () => {
          console.log(`[BACKEND] Server successfully bound to port ${PORT}`);
          resolve(s);
        });
        
        s.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            console.warn(`[BACKEND] Port ${PORT} is already in use.`);
            reject(err);
          } else {
            console.error(`[BACKEND] Failed to listen on port ${PORT}:`, err.message);
            reject(err);
          }
        });
      });
      break; 
    } catch (err) {
      if (err.code === 'EADDRINUSE') {
        PORT++;
        attempts++;
      } else {
        console.error('[BACKEND] Fatal startup error:', err.message);
        throw err;
      }
    }
  }

  if (!server) {
    throw new Error(`[BACKEND] Failed to start server after ${maxAttempts} attempts.`);
  }

  // Keep-alive mechanism
  const keepAliveId = setInterval(() => {
    // Just to keep the event loop busy
  }, 60000);

  const shutdown = async () => {
    console.log('[BACKEND] Shutdown signal received. Cleaning up...');
    clearInterval(keepAliveId);
    
    // Close the database connection
    try {
      console.log('[BACKEND] Closing database connection...');
      db.close((err) => {
        if (err) console.error('[BACKEND] Error closing database:', err.message);
        else console.log('[BACKEND] Database connection closed.');
      });
    } catch (dbErr) {
      console.error('[BACKEND] Failed to close database:', dbErr.message);
    }

    server.close(() => {
      console.log('[BACKEND] Server closed.');
      process.exit(0);
    });
    
    // Force exit if server.close hangs
    setTimeout(() => {
      console.error('[BACKEND] Shutdown timed out, forcing exit.');
      process.exit(1);
    }, 5000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

process.on('exit', (code) => {
  console.log(`Process about to exit with code: ${code}`);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

if (require.main === module) {
  startServer().catch(err => {
    console.error('Failed to start server:', err);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
} else {
  startServer().catch(err => {
    console.error('Failed to initialize routes in test mode:', err);
  });
}

module.exports = app;
