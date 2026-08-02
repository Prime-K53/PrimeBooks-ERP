/**
 * VAT/Tax Management Service
 * Handles VAT calculation, tracking, and reporting
 */
const BaseService = require('./baseService.cjs');

class VATManagementService extends BaseService {

  /**
   * Calculate VAT for a transaction
   */
  calculateVAT(amount, vatRate, vatCategory = 'standard') {
    const rate = Number(vatRate) || 0;
    const netAmount = Number(amount) || 0;
    const vatAmount = netAmount * (rate / 100);
    const grossAmount = netAmount + vatAmount;

    return {
      netAmount: Number(netAmount.toFixed(2)),
      vatRate: rate,
      vatAmount: Number(vatAmount.toFixed(2)),
      grossAmount: Number(grossAmount.toFixed(2)),
      vatCategory
    };
  }

  /**
   * Record a VAT transaction
   */
  async recordVATTransaction(data) {
    return new Promise((resolve, reject) => {
      const id = data.id || `VAT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const period = data.period || new Date().toISOString().slice(0, 7); // YYYY-MM format
      
      this.db.run(
        `INSERT INTO vat_transactions (
          id, transaction_type, reference_id, reference_type, vat_rate, vat_amount,
          net_amount, gross_amount, vat_category, is_recoverable, period, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? )`,
        [
          id,
          data.transaction_type, // 'sale', 'purchase', 'adjustment'
          data.reference_id,
          data.reference_type, // 'invoice', 'expense', 'purchase_order'
          data.vat_rate,
          data.vat_amount,
          data.net_amount,
          data.gross_amount,
          data.vat_category || 'standard',
          data.is_recoverable !== undefined ? data.is_recoverable : 1,
          period,
          data.status || 'pending'],
        function (err) {
          if (err) return reject(err);
          resolve({ id, ...data, period });
        }
      );
    });
  }

  /**
   * Get VAT transactions for a period
   */
  async getVATTransactions( period, filters = {}) {
    return new Promise((resolve, reject) => {
      let sql = `SELECT * FROM vat_transactionsperiod = ?`;
      const params = [ period];

      if (filters.transaction_type) {
        sql += ' AND transaction_type = ?';
        params.push(filters.transaction_type);
      }
      if (filters.status) {
        sql += ' AND status = ?';
        params.push(filters.status);
      }
      if (filters.vat_category) {
        sql += ' AND vat_category = ?';
        params.push(filters.vat_category);
      }

      sql += ' ORDER BY created_at DESC';

      this.db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }

  /**
   * Update VAT transaction status
   */
  async updateVATStatus(id, status) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE vat_transactions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [status, id],
        function (err) {
          if (err) return reject(err);
          if (this.changes === 0) return resolve(null);
          resolve({ id, status });
        }
      );
    });
  }

  /**
   * Get VAT summary for a period
   */
  async getVATSummary( period) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          transaction_type,
          vat_category,
          COUNT(*) as count,
          SUM(net_amount) as total_net,
          SUM(vat_amount) as total_vat,
          SUM(gross_amount) as total_gross
        FROM vat_transactionsperiod = ?
        GROUP BY transaction_type, vat_category
        ORDER BY transaction_type, vat_category
      `;

      this.db.all(sql, [ period], (err, rows) => {
        if (err) return reject(err);

        const summary = {
          period,
          outputVAT: 0,
          inputVAT: 0,
          netVAT: 0,
          totalTransactions: 0,
          byCategory: {}
        };

        rows.forEach(row => {
          summary.totalTransactions += row.count;
          
          const netAmount = Number(row.total_net) || 0;
          const vatAmount = Number(row.total_vat) || 0;
          const grossAmount = Number(row.total_gross) || 0;

          if (row.transaction_type === 'sale') {
            summary.outputVAT += vatAmount;
          } else if (row.transaction_type === 'purchase') {
            summary.inputVAT += vatAmount;
          }

          const categoryKey = `${row.transaction_type}_${row.vat_category}`;
          if (!summary.byCategory[categoryKey]) {
            summary.byCategory[categoryKey] = {
              transaction_type: row.transaction_type,
              vat_category: row.vat_category,
              count: 0,
              total_net: 0,
              total_vat: 0,
              total_gross: 0
            };
          }
          summary.byCategory[categoryKey].count += row.count;
          summary.byCategory[categoryKey].total_net += netAmount;
          summary.byCategory[categoryKey].total_vat += vatAmount;
          summary.byCategory[categoryKey].total_gross += grossAmount;
        });

        summary.outputVAT = Number(summary.outputVAT.toFixed(2));
        summary.inputVAT = Number(summary.inputVAT.toFixed(2));
        summary.netVAT = Number((summary.outputVAT - summary.inputVAT).toFixed(2));

        resolve(summary);
      });
    });
  }

  /**
   * Get VAT periods with activity
   */
  async getVATPeriods() {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          period,
          COUNT(*) as transaction_count,
          SUM(vat_amount) as total_vat,
          MAX(created_at) as last_updated
        FROM vat_transactions
        GROUP BY period
        ORDER BY period DESC
      `;

      this.db.all(sql, [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }

  /**
   * Reverse a VAT transaction
   */
  async reverseVATTransaction(id, reason) {
    return new Promise((resolve, reject) => {
      this.db.run('BEGIN TRANSACTION', (err) => {
        if (err) return reject(err);

        // Get original transaction
        this.db.get(
          'SELECT * FROM vat_transactions WHERE id = ?',
          [id],
          (err, transaction) => {
            if (err) {
              this.db.run('ROLLBACK');
              return reject(err);
            }
            if (!transaction) {
              this.db.run('ROLLBACK');
              return reject(new Error('VAT transaction not found'));
            }

            // Create reversal transaction
            const reversalId = `VAT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            this.db.run(
              `INSERT INTO vat_transactions (
                id, transaction_type, reference_id, reference_type, vat_rate, vat_amount,
                net_amount, gross_amount, vat_category, is_recoverable, period, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? )`,
              [reversalId, 'adjustment', transaction.reference_id, transaction.reference_type, transaction.vat_rate, -transaction.vat_amount, // Negative amount for reversal
                -transaction.net_amount, -transaction.gross_amount, transaction.vat_category, transaction.is_recoverable, transaction.period, 'pending'],
              (err) => {
                if (err) {
                  this.db.run('ROLLBACK');
                  return reject(err);
                }

                // Mark original as reversed
                this.db.run(
                  'UPDATE vat_transactions SET status = ? WHERE id = ?',
                  ['reversed', id],
                  (err) => {
                    if (err) {
                      this.db.run('ROLLBACK');
                      return reject(err);
                    }

                    this.db.run('COMMIT', (commitErr) => {
                      if (commitErr) {
                        this.db.run('ROLLBACK');
                        return reject(commitErr);
                      }
                      resolve({ 
                        success: true, 
                        originalId: id, 
                        reversalId,
                        reason 
                      });
                    });
                  }
                );
              }
            );
          }
        );
      });
    });
  }

  /**
   * Bulk import VAT transactions from invoices
   */
  async importFromInvoices( period) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          i.id as invoice_id,
          i.invoice_number,
          i.customer_id,
          i.customer_name,
          i.total_amount,
          i.subtotal,
          i.other_charges,
          i.created_at,
          i.line_items_json
        FROM invoices istrftime('%Y-%m', i.created_at) = ?
          AND i.status != 'cancelled'
          AND NOT EXISTS (
            SELECT 1 FROM vat_transactions vat 
            WHERE vat.reference_id = i.id 
              AND vat.reference_type = 'invoice'
      `;

      this.db.all(sql, [ period], (err, invoices) => {
        if (err) return reject(err);

        const results = {
          imported: 0,
          skipped: 0,
          errors: []
        };

        if (!invoices || invoices.length === 0) {
          return resolve(results);
        }

        const importNext = (index) => {
          if (index >= invoices.length) {
            return resolve(results);
          }

          const invoice = invoices[index];
          try {
            // Calculate VAT from invoice
            const subtotal = Number(invoice.subtotal) || 0;
            const total = Number(invoice.total_amount) || 0;
            const vatAmount = total - subtotal;
            const vatRate = subtotal > 0 ? (vatAmount / subtotal) * 100 : 0;

            if (vatAmount > 0) {
              this.recordVATTransaction({
                transaction_type: 'sale',
                reference_id: invoice.invoice_id,
                reference_type: 'invoice',
                vat_rate: vatRate,
                vat_amount: vatAmount,
                net_amount: subtotal,
                gross_amount: total,
                vat_category: 'standard',
                is_recoverable: 0,
                period,
                status: 'pending'
              })
              .then(() => {
                results.imported++;
                importNext(index + 1);
              })
              .catch(err => {
                results.errors.push({ invoice: invoice.invoice_number, error: err.message });
                results.skipped++;
                importNext(index + 1);
              });
            } else {
              results.skipped++;
              importNext(index + 1);
            }
          } catch (err) {
            results.errors.push({ invoice: invoice.invoice_number, error: err.message });
            results.skipped++;
            importNext(index + 1);
          }
        };

        importNext(0);
      });
    });
  }
}

module.exports = VATManagementService;