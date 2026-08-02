/**
 * Banking Service - Manages bank accounts and transactions
 * Provides account management, transaction recording, and reconciliation
 */
const BaseService = require('./baseService.cjs');

class BankingService extends BaseService {

  // ==================== BANK ACCOUNTS ====================

  async getAccounts() {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM bank_accounts ORDER BY account_name`,
        [],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        }
      );
    });
  }

  async getAccountById(id) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM bank_accounts WHERE id = ?',
        [id],
        (err, row) => {
          if (err) return reject(err);
          resolve(row || null);
        }
      );
    });
  }

  async createAccount(data) {
    return new Promise((resolve, reject) => {
      const id = data.id || `BANK-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.db.run(
        `INSERT INTO bank_accounts (
          id, account_name, account_number, bank_name, branch_code,
          account_type, currency, opening_balance, current_balance,
          status, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ? , ?)`,
        [id, data.accountName || data.account_name, data.accountNumber || data.account_number, data.bankName || data.bank_name, data.branchCode || data.branch_code || null, data.accountType || data.account_type || 'checking', data.currency || 'USD', data.openingBalance || data.opening_balance || 0, data.openingBalance || data.opening_balance || 0, data.status || 'Active', data.createdBy || data.created_by || null],
        function (err) {
          if (err) return reject(err);
          resolve({ id, ...data });
        }
      );
    });
  }

  async updateAccount(id, data) {
    return new Promise((resolve, reject) => {
      const fields = [];
      const params = [];
      
      const allowed = [
        'accountName', 'account_name', 'accountNumber', 'account_number',
        'bankName', 'bank_name', 'branchCode', 'branch_code',
        'accountType', 'account_type', 'currency', 'status'
      ];
      
      allowed.forEach(field => {
        if (data[field] !== undefined) {
          const dbField = field.replace(/([A-Z])/g, '_$1').toLowerCase();
          fields.push(`${dbField} = ?`);
          params.push(data[field]);
        }
      });

      if (fields.length === 0) return reject(new Error('No fields to update'));

      params.push(id);
      this.db.run(
        `UPDATE bank_accounts SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        params,
        function (err) {
          if (err) return reject(err);
          if (this.changes === 0) return resolve(null);
          resolve({ id, ...data });
        }
      );
    });
  }

  async deleteAccount(id) {
    return new Promise((resolve, reject) => {
      // Check if account has transactions
      this.db.get(
        'SELECT COUNT(*) as count FROM bank_transactions WHERE account_id = ?',
        [id],
        (err, row) => {
          if (err) return reject(err);
          if (row && row.count > 0) {
            return reject(new Error('Cannot delete account with existing transactions'));
          }
          
          this.db.run(
            'DELETE FROM bank_accounts WHERE id = ?',
            [id],
            function (err) {
              if (err) return reject(err);
              resolve({ success: true });
            }
          );
        }
      );
    });
  }

  // ==================== BANK TRANSACTIONS ====================

  async getTransactions( filters = {}) {
    return new Promise((resolve, reject) => {
      let sql = `SELECT * FROM bank_transactions`;
      const params = [];

      if (filters.accountId) {
        sql += ' AND account_id = ?';
        params.push(filters.accountId);
      }
      if (filters.type) {
        sql += ' AND type = ?';
        params.push(filters.type);
      }
      if (filters.status) {
        sql += ' AND status = ?';
        params.push(filters.status);
      }
      if (filters.startDate) {
        sql += ' AND date >= ?';
        params.push(filters.startDate);
      }
      if (filters.endDate) {
        sql += ' AND date <= ?';
        params.push(filters.endDate);
      }

      sql += ' ORDER BY date DESC, created_at DESC LIMIT 500';

      this.db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }

  async getTransactionById(id) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM bank_transactions WHERE id = ?',
        [id],
        (err, row) => {
          if (err) return reject(err);
          resolve(row || null);
        }
      );
    });
  }

  async createTransaction(data) {
    return new Promise((resolve, reject) => {
      const id = data.id || `BT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const currency = data.currency || 'USD';
      
      this.db.run('BEGIN TRANSACTION', (err) => {
        if (err) return reject(err);

        // Insert transaction
        this.db.run(
          `INSERT INTO bank_transactions (
            id, account_id, date, type, amount, currency,
            description, reference_type, reference_id, status,
            reconciled, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? , ?)`,
          [
            id,
            data.accountId || data.account_id,
            data.date || new Date().toISOString().split('T')[0],
            data.type, // 'deposit', 'withdrawal', 'transfer'
            data.amount,
            currency,
            data.description,
            data.referenceType || data.reference_type || null,
            data.referenceId || data.reference_id || null,
            data.status || 'pending',
            data.reconciled || 0,
            data.createdBy || data.created_by || null
          ],
          function (err) {
            if (err) {
              this.db.run('ROLLBACK');
              return reject(err);
            }

            // Update account balance
            const balanceChange = data.type === 'deposit' ? data.amount : -data.amount;
            this.db.run(
              'UPDATE bank_accounts SET current_balance = COALESCE(current_balance, 0) + ? WHERE id = ?',
              [balanceChange, data.accountId || data.account_id],
              (err) => {
                if (err) {
                  this.db.run('ROLLBACK');
                  return reject(err);
                }

                this.db.run('COMMIT', (err) => {
                  if (err) {
                    this.db.run('ROLLBACK');
                    return reject(err);
                  }
                  resolve({ id, ...data });
                });
              }
            );
          }
        );
      });
    });
  }

  async updateTransaction(id, data) {
    return new Promise((resolve, reject) => {
      const fields = [];
      const params = [];
      
      const allowed = ['description', 'status', 'reconciled', 'reference_type', 'reference_id'];
      
      allowed.forEach(field => {
        if (data[field] !== undefined) {
          const dbField = field.replace(/([A-Z])/g, '_$1').toLowerCase();
          fields.push(`${dbField} = ?`);
          params.push(data[field]);
        }
      });

      if (fields.length === 0) return reject(new Error('No fields to update'));

      params.push(id);
      this.db.run(
        `UPDATE bank_transactions SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        params,
        function (err) {
          if (err) return reject(err);
          if (this.changes === 0) return resolve(null);
          resolve({ id, ...data });
        }
      );
    });
  }

  async deleteTransaction(id) {
    return new Promise((resolve, reject) => {
      // Get transaction details first to reverse balance
      this.db.get(
        'SELECT * FROM bank_transactions WHERE id = ?',
        [id],
        (err, row) => {
          if (err) return reject(err);
          if (!row) return resolve(null);

          this.db.run('BEGIN TRANSACTION', (err) => {
            if (err) return reject(err);

            // Reverse balance update
            const balanceChange = row.type === 'deposit' ? -row.amount : row.amount;
            this.db.run(
              'UPDATE bank_accounts SET current_balance = COALESCE(current_balance, 0) + ? WHERE id = ?',
              [balanceChange, row.account_id],
              (err) => {
                if (err) {
                  this.db.run('ROLLBACK');
                  return reject(err);
                }

                // Delete transaction
                this.db.run(
                  'DELETE FROM bank_transactions WHERE id = ?',
                  [id],
                  function (err) {
                    if (err) {
                      this.db.run('ROLLBACK');
                      return reject(err);
                    }

                    this.db.run('COMMIT', (err) => {
                      if (err) {
                        this.db.run('ROLLBACK');
                        return reject(err);
                      }
                      resolve({ success: true });
                    });
                  }
                );
              }
            );
          });
        }
      );
    });
  }

  // ==================== RECONCILIATION ====================

  async reconcileTransaction(id) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE bank_transactions SET reconciled = 1, reconciled_at = CURRENT_TIMESTAMP WHERE id = ?',
        [id],
        function (err) {
          if (err) return reject(err);
          if (this.changes === 0) return resolve(null);
          resolve({ success: true });
        }
      );
    });
  }

  async unreconcileTransaction(id) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE bank_transactions SET reconciled = 0, reconciled_at = NULL WHERE id = ?',
        [id],
        function (err) {
          if (err) return reject(err);
          if (this.changes === 0) return resolve(null);
          resolve({ success: true });
        }
      );
    });
  }

  async getReconciliationSummary(accountId, startDate, endDate) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          COUNT(*) as total_transactions,
          SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END) as total_deposits,
          SUM(CASE WHEN type = 'withdrawal' THEN amount ELSE 0 END) as total_withdrawals,
          SUM(CASE WHEN reconciled = 1 THEN amount ELSE 0 END) as reconciled_amount,
          SUM(CASE WHEN reconciled = 0 THEN amount ELSE 0 END) as unreconciled_amount
        FROM bank_transactions
        WHERE account_id = ?date >= ? AND date <= ?
      `;

      this.db.get(sql, [accountId, startDate, endDate], (err, row) => {
        if (err) return reject(err);
        resolve(row || {});
      });
    });
  }

  // ==================== TRANSFERS ====================

  async transferFunds(data) {
    return new Promise((resolve, reject) => {
      const fromAccountId = data.fromAccountId || data.from_account_id;
      const toAccountId = data.toAccountId || data.to_account_id;
      const amount = data.amount;
      const currency = data.currency || 'USD';

      if (fromAccountId === toAccountId) {
        return reject(new Error('Cannot transfer to the same account'));
      }

      this.db.run('BEGIN TRANSACTION', (err) => {
        if (err) return reject(err);

        // Create withdrawal from source account
        const withdrawalId = `BT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-OUT`;
        this.db.run(
          `INSERT INTO bank_transactions (
            id, account_id, date, type, amount, currency,
            description, reference_type, reference_id, status,
            reconciled, created_by
          ) VALUES (?, ?, ?, 'withdrawal', ?, ?, ?, 'transfer', ?, 'completed', 0, ?, ?)`,
          [
            withdrawalId,
            fromAccountId,
            data.date || new Date().toISOString().split('T')[0],
            amount,
            currency,
            `Transfer to ${data.toAccountName || data.to_account_name || 'another account'}`,
            `${Date.now()}`,
            data.createdBy || data.created_by || null
          ],
          function (err) {
            if (err) {
              this.db.run('ROLLBACK');
              return reject(err);
            }

            // Create deposit to destination account
            const depositId = `BT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-IN`;
            this.db.run(
              `INSERT INTO bank_transactions (
                id, account_id, date, type, amount, currency,
                description, reference_type, reference_id, status,
                reconciled, created_by
              ) VALUES (?, ?, ?, 'deposit', ?, ?, ?, 'transfer', ?, 'completed', 0, ?, ?)`,
              [
                depositId,
                toAccountId,
                data.date || new Date().toISOString().split('T')[0],
                amount,
                currency,
                `Transfer from ${data.fromAccountName || data.from_account_name || 'another account'}`,
                `${Date.now()}`,
                data.createdBy || data.created_by || null
              ],
              function (err) {
                if (err) {
                  this.db.run('ROLLBACK');
                  return reject(err);
                }

                // Update account balances
                this.db.run(
                  'UPDATE bank_accounts SET current_balance = COALESCE(current_balance, 0) - ? WHERE id = ?',
                  [amount, fromAccountId],
                  (err) => {
                    if (err) {
                      this.db.run('ROLLBACK');
                      return reject(err);
                    }

                    this.db.run(
                      'UPDATE bank_accounts SET current_balance = COALESCE(current_balance, 0) + ? WHERE id = ?',
                      [amount, toAccountId],
                      (err) => {
                        if (err) {
                          this.db.run('ROLLBACK');
                          return reject(err);
                        }

                        this.db.run('COMMIT', (err) => {
                          if (err) {
                            this.db.run('ROLLBACK');
                            return reject(err);
                          }
                          resolve({
                            withdrawalId,
                            depositId,
                            amount,
                            fromAccountId,
                            toAccountId
                          });
                        });
                      }
                    );
                  }
                );
              }
            );
          }
        );
      });
    });
  }

  // ==================== REPORTING ====================

  async getAccountBalance(accountId, asOfDate = null) {
    return new Promise((resolve, reject) => {
      let sql = `
        SELECT 
          COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN type = 'withdrawal' THEN amount ELSE 0 END), 0) as balance
        FROM bank_transactions
        WHERE account_id = ?`;
      const params = [accountId];

      if (asOfDate) {
        sql += ' AND date <= ?';
        params.push(asOfDate);
      }

      this.db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.balance : 0);
      });
    });
  }

  async getCashFlowSummary( startDate, endDate) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          type,
          COUNT(*) as count,
          SUM(amount) as total
        FROM bank_transactionsdate >= ?
          AND date <= ?
        GROUP BY type
      `;

      this.db.all(sql, [ startDate, endDate], (err, rows) => {
        if (err) return reject(err);
        
        const summary = {
          deposits: 0,
          withdrawals: 0,
          netCashFlow: 0,
          transactionCount: 0
        };

        rows.forEach(row => {
          summary.transactionCount += row.count;
          if (row.type === 'deposit') {
            summary.deposits = row.total;
          } else if (row.type === 'withdrawal') {
            summary.withdrawals = row.total;
          }
        });

        summary.netCashFlow = summary.deposits - summary.withdrawals;
        resolve(summary);
      });
    });
  }
}

module.exports = BankingService;