/**
 * Payment Allocation Service
 * Handles intelligent payment allocation to invoices and orders
 * Supports partial payments, overpayments, and excess handling
 */
const BaseService = require('./baseService.cjs');

class PaymentAllocationService extends BaseService {

  /**
   * Allocate a payment to one or more invoices/orders
   * @param {Object} payment - The payment record
   * @param {Array} allocations - Array of {invoiceId, amount}
   */
  async allocatePayment(payment, allocations, currency = 'USD') {
    if (!allocations || allocations.length === 0) {
      throw new Error('At least one allocation is required');
    }

    const totalAllocated = allocations.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
    const paymentAmount = Number(payment.amount) || 0;
    const paymentCurrency = payment.currency || currency;

    if (totalAllocated > paymentAmount) {
      throw new Error(`Total allocated (${totalAllocated}) exceeds payment amount (${paymentAmount})`);
    }

    const allocationId = `ALLOC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const results = [];

    await new Promise((resolve, reject) => {
      this.db.run('BEGIN TRANSACTION', (err) => {
        if (err) return reject(err);

        try {
          // Create allocation record
          this.db.run(
            `INSERT INTO payment_allocations (id, payment_id, total_allocated, excess_amount, excess_handling, created_at)
             VALUES (?, ? , ?, ?, ?, ?)`,
            [allocationId, payment.id, totalAllocated, paymentAmount - totalAllocated, payment.excess_handling || 'credit_to_customer', new Date().toISOString()],
            (err) => {
              if (err) {
                this.db.run('ROLLBACK');
                return reject(err);
              }

              // Allocate to each invoice/order
              const allocateNext = (index) => {
                if (index >= allocations.length) {
                  // All allocations complete, commit
                  this.db.run('COMMIT', (commitErr) => {
                    if (commitErr) {
                      this.db.run('ROLLBACK');
                      return reject(commitErr);
                    }
                    resolve();
                  });
                  return;
                }

                const alloc = allocations[index];
                this.db.run(
                  `UPDATE invoices 
                   SET paid_amount = COALESCE(paid_amount, 0) + ?,
                       status = CASE 
                         WHEN COALESCE(paid_amount, 0) + ? >= total_amount THEN 'Paid'
                         WHEN COALESCE(paid_amount, 0) + ? > 0 THEN 'Partially Paid'
                         ELSE status
                       END,
                       updated_at = CURRENT_TIMESTAMP
                   WHERE id = ?`,
                  [alloc.amount, alloc.amount, alloc.amount, alloc.invoiceId],
                  (err) => {
                    if (err) {
                      this.db.run('ROLLBACK');
                      return reject(err);
                    }

                    // Record allocation line
                    this.db.run(
                      `INSERT INTO payment_allocation_lines (id, allocation_id, invoice_id, amount, currency, created_at)
                       VALUES (?, ?, ?, ?, ?, ?)`,
                      [
                        `ALLOC-LINE-${Date.now()}-${index}`,
                        allocationId,
                        alloc.invoiceId,
                        alloc.amount,
                        paymentCurrency,
                        new Date().toISOString()
                      ],
                      (err) => {
                        if (err) {
                          this.db.run('ROLLBACK');
                          return reject(err);
                        }
                        allocateNext(index + 1);
                      }
                    );
                  }
                );
              };

              allocateNext(0);
            }
          );
        } catch (error) {
          this.db.run('ROLLBACK');
          reject(error);
        }
      });
    });

    return {
      allocationId,
      totalAllocated,
      excess: paymentAmount - totalAllocated,
      allocations: allocations.map(a => ({
        invoiceId: a.invoiceId,
        amount: a.amount
      }))
    };
  }

  /**
   * Get payment allocations for a specific payment
   */
  async getPaymentAllocations(paymentId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT pal.*, pal_inv.invoice_id, i.invoice_number, i.customer_name, i.total_amount, i.paid_amount
         FROM payment_allocations pal
         LEFT JOIN payment_allocation_lines pal_inv ON pal.id = pal_inv.allocation_id
         LEFT JOIN invoices i ON pal_inv.invoice_id = i.id
         WHERE pal.payment_id = ?
         ORDER BY pal.created_at DESC`,
        [paymentId],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        }
      );
    });
  }

  /**
   * Get outstanding invoices for a customer
   */
  async getOutstandingInvoices(customerId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT id, invoice_number, total_amount, paid_amount, 
                (total_amount - COALESCE(paid_amount, 0)) as outstanding,
                status, due_date
         FROM invoices
         WHERE customer_id = ? AND status NOT IN ('Paid', 'Voided', 'Cancelled')
         ORDER BY due_date ASC`,
        [customerId],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        }
      );
    });
  }

  /**
   * Suggest payment allocation based on outstanding amounts
   */
  async suggestAllocation(customerId, paymentAmount) {
    const outstanding = await this.getOutstandingInvoices(customerId);
    const suggestions = [];
    let remaining = paymentAmount;

    // Prioritize by due date (oldest first) and overdue status
    const sorted = outstanding.sort((a, b) => {
      const aOverdue = a.due_date && new Date(a.due_date) < new Date();
      const bOverdue = b.due_date && new Date(b.due_date) < new Date();
      if (aOverdue && !bOverdue) return -1;
      if (!aOverdue && bOverdue) return 1;
      return new Date(a.due_date || 0) - new Date(b.due_date || 0);
    });

    for (const inv of sorted) {
      if (remaining <= 0) break;

      const invOutstanding = Number(inv.outstanding) || 0;
      const allocateAmount = Math.min(remaining, invOutstanding);

      if (allocateAmount > 0) {
        suggestions.push({
          invoiceId: inv.id,
          invoiceNumber: inv.invoice_number,
          outstanding: invOutstanding,
          suggestedAmount: allocateAmount,
          remainingAfter: invOutstanding - allocateAmount
        });
        remaining -= allocateAmount;
      }
    }

    return {
      customerId,
      paymentAmount,
      totalOutstanding: outstanding.reduce((sum, inv) => sum + (Number(inv.outstanding) || 0), 0),
      suggestions,
      excess: remaining
    };
  }

  /**
   * Reverse a payment allocation
   */
  async reverseAllocation(allocationId) {
    return new Promise((resolve, reject) => {
      this.db.run('BEGIN TRANSACTION', (err) => {
        if (err) return reject(err);

        // Get allocation details
        this.db.get(
          'SELECT * FROM payment_allocations WHERE id = ?',
          [allocationId],
          (err, allocation) => {
            if (err) {
              this.db.run('ROLLBACK');
              return reject(err);
            }
            if (!allocation) {
              this.db.run('ROLLBACK');
              return reject(new Error('Allocation not found'));
            }

            // Reverse each allocation line
            this.db.all(
              'SELECT * FROM payment_allocation_lines WHERE allocation_id = ?',
              [allocationId],
              (err, lines) => {
                if (err) {
                  this.db.run('ROLLBACK');
                  return reject(err);
                }

                const reverseNext = (index) => {
                  if (index >= lines.length) {
                    // Mark allocation as reversed
                    this.db.run(
                      'UPDATE payment_allocations SET reversed = 1, reversed_at = ? WHERE id = ?',
                      [new Date().toISOString(), allocationId],
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
                          resolve({ success: true, allocationId, reversedLines: lines.length });
                        });
                      }
                    );
                    return;
                  }

                  const line = lines[index];
                  this.db.run(
                    `UPDATE invoices 
                     SET paid_amount = COALESCE(paid_amount, 0) - ?,
                         status = CASE 
                           WHEN COALESCE(paid_amount, 0) - ? <= 0 THEN 'Unpaid'
                           ELSE 'Partially Paid'
                         END,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [line.amount, line.amount, line.invoice_id],
                    (err) => {
                      if (err) {
                        this.db.run('ROLLBACK');
                        return reject(err);
                      }
                      reverseNext(index + 1);
                    }
                  );
                };

                reverseNext(0);
              }
            );
          }
        );
      });
    });
  }
}

module.exports = PaymentAllocationService;