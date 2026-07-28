const { getDatabase } = require('../db.cjs');

const TENANT_TABLES = new Set([
  'users', 'customers', 'suppliers', 'products', 'inventory', 'inventory_transactions',
  'sales', 'invoices', 'sales_orders', 'sale_items', 'sales_exchanges',
  'sales_exchange_items', 'sales_exchange_approvals',
  'customer_payments', 'payment_allocations', 'payment_allocation_lines',
  'chart_of_accounts', 'ledger_entries',
  'budgets', 'transfers', 'expenses', 'income', 'bank_accounts', 'bank_transactions',
  'purchase_orders', 'purchase_order_items', 'goods_receipts', 'material_batches',
  'warehouse_inventory', 'warehouse_snapshots', 'financial_years', 'user_preferences',
  'notifications', 'audit_logs', 'documents', 'tasks', 'employees', 'payroll_runs',
  'payslips', 'departments', 'assets', 'settings', 'user_companies',
  'examinations', 'examination_batches', 'examination_classes', 'examination_subjects',
  'examination_bom_calculations', 'examination_class_adjustments', 'examination_pricing_audit',
  'examination_batch_notifications', 'notification_audit_logs', 'bom_default_materials',
  'profit_margin_settings', 'profit_margin_audit_logs', 'work_centers', 'production_resources',
  'work_orders', 'production_batches', 'material_categories', 'schools', 'classes', 'subjects',
  'market_adjustments', 'market_adjustment_transactions', 'transaction_adjustment_snapshots',
  'reprint_jobs', 'email_verifications', 'vat_transactions',
  'customer_referrals', 'referral_rewards', 'referral_timeline', 'referral_audit_logs',
  'referral_campaigns', 'referral_analytics', 'referral_reversals', 'referral_settings',
  'idempotency_keys',
  'engagement_membership_tiers', 'engagement_customer_tiers', 'engagement_gift_cards',
  'engagement_gift_card_transactions', 'engagement_promotions', 'engagement_cashback',
  'engagement_points', 'engagement_point_balances', 'engagement_affiliates',
  'engagement_affiliate_commissions', 'engagement_customer_rewards', 'engagement_timeline',
  'engagement_audit', 'engagement_analytics',
  'exchange_rates', 'currencies', 'accounts_payable', 'accounts_receivable', 'bill_of_materials'
]);

const TENANT_COLUMN = 'company_id';

class BaseService {
  constructor(db) {
    if (db) {
      this._db = db;
    }
  }

  get db() {
    return this._db || getDatabase();
  }

  /**
   * Inject WHERE company_id = ? into a SELECT query if it targets a tenant table
   * and the query doesn't already filter by company_id.
   */
  _scopeSql(sql, params, companyId) {
    if (companyId === null || companyId === undefined) return { sql, params };

    const upper = sql.trim().toUpperCase();
    if (!upper.startsWith('SELECT') && !upper.startsWith('UPDATE') && !upper.startsWith('DELETE')) {
      return { sql, params };
    }

    // Extract the first table name after FROM or UPDATE/DELETE
    const fromMatch = sql.match(/\bFROM\s+[`'"]?(\w+)[`'"]?\b/i);
    const updateMatch = sql.match(/\bUPDATE\s+[`'"]?(\w+)[`'"]?\b/i);
    const deleteMatch = sql.match(/\bDELETE\s+FROM\s+[`'"]?(\w+)[`'"]?\b/i);
    const tableName = fromMatch?.[1] || updateMatch?.[1] || deleteMatch?.[1];

    if (!tableName || !TENANT_TABLES.has(tableName)) {
      return { sql, params };
    }

    // Don't inject if the query already has a company_id filter
    if (/WHERE/i.test(sql) && /company_id\s*=\s*\?/i.test(sql)) {
      return { sql, params };
    }

    if (/WHERE/i.test(sql)) {
      return {
        sql: sql.replace(/\bWHERE\b/i, `WHERE ${TENANT_COLUMN} = ? AND `),
        params: [companyId, ...params]
      };
    } else {
      return {
        sql: `${sql} WHERE ${TENANT_COLUMN} = ?`,
        params: [companyId, ...params]
      };
    }
  }

  _run(sql, params = [], companyId) {
    const scoped = this._scopeSql(sql, params, companyId);
    return new Promise((resolve, reject) => {
      this.db.run(scoped.sql, scoped.params, function (err) {
        if (err) reject(err);
        else resolve({ changes: this.changes, lastID: this.lastID });
      });
    });
  }

  _get(sql, params = [], companyId) {
    const scoped = this._scopeSql(sql, params, companyId);
    return new Promise((resolve, reject) => {
      this.db.get(scoped.sql, scoped.params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  _all(sql, params = [], companyId) {
    const scoped = this._scopeSql(sql, params, companyId);
    return new Promise((resolve, reject) => {
      this.db.all(scoped.sql, scoped.params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  _transaction(callback) {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run("BEGIN TRANSACTION", (beginErr) => {
          if (beginErr) {
            return reject(beginErr);
          }
          try {
            const result = callback();
            if (result && typeof result.then === 'function') {
              result.then((val) => {
                this.db.run("COMMIT", (commitErr) => {
                  if (commitErr) {
                    this.db.run("ROLLBACK", () => reject(commitErr));
                  } else {
                    resolve(val);
                  }
                });
              }).catch((err) => {
                this.db.run("ROLLBACK", () => reject(err));
              });
            } else {
              this.db.run("COMMIT", (commitErr) => {
                if (commitErr) {
                  this.db.run("ROLLBACK", () => reject(commitErr));
                } else {
                  resolve(result);
                }
              });
            }
          } catch (err) {
            this.db.run("ROLLBACK", () => reject(err));
          }
        });
      });
    });
  }
}

module.exports = BaseService;
