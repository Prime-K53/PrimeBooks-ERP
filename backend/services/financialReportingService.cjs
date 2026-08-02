/**
 * Financial Reporting Service
 * Generates comprehensive financial reports including P&L, Balance Sheet, Cash Flow, etc.
 */
const BaseService = require('./baseService.cjs');

class FinancialReportingService extends BaseService {

  /**
   * Generate Profit & Loss Statement
   */
  async getProfitAndLoss( startDate, endDate, currency = 'USD') {
    try {
      // Revenue
      const revenue = await new Promise((resolve, reject) => {
        this.db.get(
          `SELECT COALESCE(SUM(total_amount), 0) as total_revenue
           FROM invoicesstatus != 'cancelled'
             AND date(created_at) >= ?
             AND date(created_at) <= ?
             AND currency = ?`,
          [startDate, endDate, currency],
          (err, row) => {
            if (err) reject(err);
            else resolve(row?.total_revenue || 0);
          }
        );
      });

      // Cost of Goods Sold
      const cogs = await new Promise((resolve, reject) => {
        this.db.get(
          `SELECT COALESCE(SUM(amount), 0) as total_cogs
           FROM ledger_entries WHERE entry_type = 'debit'
             AND account_id IN (
               SELECT id FROM chart_of_accounts WHERE code LIKE '5%'
             )
             AND date(entry_date) >= ?
             AND date(entry_date) <= ?
             AND currency = ?`,
          [startDate, endDate, currency],
          (err, row) => {
            if (err) reject(err);
            else resolve(row?.total_cogs || 0);
          }
        );
      });

      // Operating Expenses
      const operatingExpenses = await new Promise((resolve, reject) => {
        this.db.get(
          `SELECT COALESCE(SUM(amount), 0) as total_expenses
           FROM ledger_entries WHERE entry_type = 'debit'
             AND account_id IN (
               SELECT id FROM chart_of_accounts WHERE code LIKE '6%'
             )
             AND date(entry_date) >= ?
             AND date(entry_date) <= ?
             AND currency = ?`,
          [startDate, endDate, currency],
          (err, row) => {
            if (err) reject(err);
            else resolve(row?.total_expenses || 0);
          }
        );
      });

      const grossProfit = revenue - cogs;
      const netProfit = grossProfit - operatingExpenses;
      const profitMargin = revenue > 0 ? ((netProfit / revenue) * 100).toFixed(2) : 0;

      return {
        period: { startDate, endDate },
        revenue: Number(revenue.toFixed(2)),
        costOfGoodsSold: Number(cogs.toFixed(2)),
        grossProfit: Number(grossProfit.toFixed(2)),
        grossProfitMargin: revenue > 0 ? Number(((grossProfit / revenue) * 100).toFixed(2)) : 0,
        operatingExpenses: Number(operatingExpenses.toFixed(2)),
        netProfit: Number(netProfit.toFixed(2)),
        netProfitMargin: Number(profitMargin)
      };
    } catch (error) {
      console.error('[Reports] P&L error:', error);
      throw error;
    }
  }

  /**
   * Generate Balance Sheet
   */
  async getBalanceSheet( asOfDate, currency = 'USD') {
    try {
      // Assets
      const assets = await new Promise((resolve, reject) => {
        this.db.all(
          `SELECT coa.code, coa.name, coa.balance
           FROM chart_of_accounts coacoa.type = 'asset'
             AND coa.is_active = 1
           ORDER BY coa.code`,
          [],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      const totalAssets = assets.reduce((sum, acc) => sum + (Number(acc.balance) || 0), 0);

      // Liabilities
      const liabilities = await new Promise((resolve, reject) => {
        this.db.all(
          `SELECT coa.code, coa.name, coa.balance
           FROM chart_of_accounts coacoa.type = 'liability'
             AND coa.is_active = 1
           ORDER BY coa.code`,
          [],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      const totalLiabilities = liabilities.reduce((sum, acc) => sum + (Number(acc.balance) || 0), 0);

      // Equity
      const equity = await new Promise((resolve, reject) => {
        this.db.all(
          `SELECT coa.code, coa.name, coa.balance
           FROM chart_of_accounts coacoa.type = 'equity'
             AND coa.is_active = 1
           ORDER BY coa.code`,
          [],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      const totalEquity = equity.reduce((sum, acc) => sum + (Number(acc.balance) || 0), 0);

      return {
        asOfDate: asOfDate || new Date().toISOString().split('T')[0],
        assets: {
          details: assets,
          total: Number(totalAssets.toFixed(2))
        },
        liabilities: {
          details: liabilities,
          total: Number(totalLiabilities.toFixed(2))
        },
        equity: {
          details: equity,
          total: Number(totalEquity.toFixed(2))
        },
        balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01
      };
    } catch (error) {
      console.error('[Reports] Balance Sheet error:', error);
      throw error;
    }
  }

  /**
   * Generate Cash Flow Statement
   */
  async getCashFlowStatement( startDate, endDate) {
    try {
      // Operating Activities
      const operatingCashFlow = await new Promise((resolve, reject) => {
        this.db.get(
          `SELECT COALESCE(SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE -amount END), 0) as net_cash
           FROM ledger_entries WHERE account_id IN (
               SELECT id FROM chart_of_accounts WHERE code IN ('1200', '4000', '5000', '6000')
             )
             AND date(entry_date) >= ?
             AND date(entry_date) <= ?`,
          [startDate, endDate],
          (err, row) => {
            if (err) reject(err);
            else resolve(row?.net_cash || 0);
          }
        );
      });

      // Investing Activities
      const investingCashFlow = await new Promise((resolve, reject) => {
        this.db.get(
          `SELECT COALESCE(SUM(CASE WHEN entry_type = 'debit' THEN -amount ELSE amount END), 0) as net_cash
           FROM ledger_entries WHERE account_id IN (
               SELECT id FROM chart_of_accounts WHERE code LIKE '1%' AND code != '1200'
             )
             AND date(entry_date) >= ?
             AND date(entry_date) <= ?`,
          [startDate, endDate],
          (err, row) => {
            if (err) reject(err);
            else resolve(row?.net_cash || 0);
          }
        );
      });

      // Financing Activities
      const financingCashFlow = await new Promise((resolve, reject) => {
        this.db.get(
          `SELECT COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE -amount END), 0) as net_cash
           FROM ledger_entries WHERE account_id IN (
               SELECT id FROM chart_of_accounts WHERE type = 'equity'
             )
             AND date(entry_date) >= ?
             AND date(entry_date) <= ?`,
          [startDate, endDate],
          (err, row) => {
            if (err) reject(err);
            else resolve(row?.net_cash || 0);
          }
        );
      });

      const netCashFlow = operatingCashFlow + investingCashFlow + financingCashFlow;

      return {
        period: { startDate, endDate },
        operatingActivities: Number(operatingCashFlow.toFixed(2)),
        investingActivities: Number(investingCashFlow.toFixed(2)),
        financingActivities: Number(financingCashFlow.toFixed(2)),
        netCashFlow: Number(netCashFlow.toFixed(2))
      };
    } catch (error) {
      console.error('[Reports] Cash Flow error:', error);
      throw error;
    }
  }

  /**
   * Generate Accounts Receivable Aging Report
   */
  async getARAging( asOfDate) {
    try {
      const invoices = await new Promise((resolve, reject) => {
        this.db.all(
          `SELECT 
            id, invoice_number, customer_id, customer_name, 
            total_amount, paid_amount, due_date,
            (total_amount - COALESCE(paid_amount, 0)) as outstanding
           FROM invoicesstatus NOT IN ('Paid', 'Voided', 'Cancelled')
             AND outstanding > 0
           ORDER BY due_date ASC`,
          [],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      const agingBuckets = {
        current: { amount: 0, count: 0, invoices: [] },
        days1to30: { amount: 0, count: 0, invoices: [] },
        days31to60: { amount: 0, count: 0, invoices: [] },
        days61to90: { amount: 0, count: 0, invoices: [] },
        over90: { amount: 0, count: 0, invoices: [] }
      };

      const today = new Date(asOfDate || new Date().toISOString().split('T')[0]);

      invoices.forEach(inv => {
        const outstanding = Number(inv.outstanding) || 0;
        const dueDate = new Date(inv.due_date || today);
        const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));

        let bucket;
        if (daysOverdue <= 0) bucket = 'current';
        else if (daysOverdue <= 30) bucket = 'days1to30';
        else if (daysOverdue <= 60) bucket = 'days31to60';
        else if (daysOverdue <= 90) bucket = 'days61to90';
        else bucket = 'over90';

        agingBuckets[bucket].amount += outstanding;
        agingBuckets[bucket].count += 1;
        agingBuckets[bucket].invoices.push(inv);
      });

      const totalOutstanding = Object.values(agingBuckets).reduce((sum, b) => sum + b.amount, 0);

      return {
        asOfDate: asOfDate || new Date().toISOString().split('T')[0],
        totalOutstanding: Number(totalOutstanding.toFixed(2)),
        buckets: {
          current: { ...agingBuckets.current, amount: Number(agingBuckets.current.amount.toFixed(2)) },
          days1to30: { ...agingBuckets.days1to30, amount: Number(agingBuckets.days1to30.amount.toFixed(2)) },
          days31to60: { ...agingBuckets.days31to60, amount: Number(agingBuckets.days31to60.amount.toFixed(2)) },
          days61to90: { ...agingBuckets.days61to90, amount: Number(agingBuckets.days61to90.amount.toFixed(2)) },
          over90: { ...agingBuckets.over90, amount: Number(agingBuckets.over90.amount.toFixed(2)) }
        }
      };
    } catch (error) {
      console.error('[Reports] AR Aging error:', error);
      throw error;
    }
  }

  /**
   * Generate Accounts Payable Aging Report
   */
  async getAPAging( asOfDate) {
    try {
      const expenses = await new Promise((resolve, reject) => {
        this.db.all(
          `SELECT 
            id, category, vendor_name, amount, expense_date, due_date,
            status
           FROM expensesstatus NOT IN ('paid', 'cancelled')
           ORDER BY expense_date ASC`,
          [],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      const agingBuckets = {
        current: { amount: 0, count: 0 },
        days1to30: { amount: 0, count: 0 },
        days31to60: { amount: 0, count: 0 },
        days61to90: { amount: 0, count: 0 },
        over90: { amount: 0, count: 0 }
      };

      const today = new Date(asOfDate || new Date().toISOString().split('T')[0]);

      expenses.forEach(exp => {
        const amount = Number(exp.amount) || 0;
        const expenseDate = new Date(exp.expense_date || today);
        const daysOld = Math.floor((today - expenseDate) / (1000 * 60 * 60 * 24));

        let bucket;
        if (daysOld <= 0) bucket = 'current';
        else if (daysOld <= 30) bucket = 'days1to30';
        else if (daysOld <= 60) bucket = 'days31to60';
        else if (daysOld <= 90) bucket = 'days61to90';
        else bucket = 'over90';

        agingBuckets[bucket].amount += amount;
        agingBuckets[bucket].count += 1;
      });

      const totalPayable = Object.values(agingBuckets).reduce((sum, b) => sum + b.amount, 0);

      return {
        asOfDate: asOfDate || new Date().toISOString().split('T')[0],
        totalPayable: Number(totalPayable.toFixed(2)),
        buckets: {
          current: { ...agingBuckets.current, amount: Number(agingBuckets.current.amount.toFixed(2)) },
          days1to30: { ...agingBuckets.days1to30, amount: Number(agingBuckets.days1to30.amount.toFixed(2)) },
          days31to60: { ...agingBuckets.days31to60, amount: Number(agingBuckets.days31to60.amount.toFixed(2)) },
          days61to90: { ...agingBuckets.days61to90, amount: Number(agingBuckets.days61to90.amount.toFixed(2)) },
          over90: { ...agingBuckets.over90, amount: Number(agingBuckets.over90.amount.toFixed(2)) }
        }
      };
    } catch (error) {
      console.error('[Reports] AP Aging error:', error);
      throw error;
    }
  }

  /**
   * Generate Trial Balance
   */
  async getTrialBalance( asOfDate) {
    try {
      const accounts = await new Promise((resolve, reject) => {
        this.db.all(
          `SELECT id, code, name, type, balance
           FROM chart_of_accountsis_active = 1
           ORDER BY code`,
          [],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      const trialBalance = accounts.map(acc => ({
        id: acc.id,
        code: acc.code,
        name: acc.name,
        type: acc.type,
        balance: Number(acc.balance || 0)
      }));

      const totalDebits = trialBalance
        .filter(acc => acc.type === 'asset' || acc.type === 'expense')
        .reduce((sum, acc) => sum + acc.balance, 0);

      const totalCredits = trialBalance
        .filter(acc => acc.type === 'liability' || acc.type === 'equity' || acc.type === 'revenue')
        .reduce((sum, acc) => sum + acc.balance, 0);

      return {
        asOfDate: asOfDate || new Date().toISOString().split('T')[0],
        accounts: trialBalance,
        totalDebits: Number(totalDebits.toFixed(2)),
        totalCredits: Number(totalCredits.toFixed(2)),
        balanced: Math.abs(totalDebits - totalCredits) < 0.01
      };
    } catch (error) {
      console.error('[Reports] Trial Balance error:', error);
      throw error;
    }
  }

  /**
   * Generate Budget vs Actual Report
   */
  async getBudgetVsActual( fiscalYear, period) {
    try {
      const budgets = await new Promise((resolve, reject) => {
        this.db.all(
          `SELECT b.*, coa.name as account_name, coa.code as account_code
           FROM budgets b
           LEFT JOIN chart_of_accounts coa ON b.account_id = coa.idb.fiscal_year = ?
             AND b.period = ?`,
          [fiscalYear, period],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      const report = budgets.map(budget => {
        const budgetAmount = Number(budget.amount) || 0;
        const spent = Number(budget.spent) || 0;
        const variance = budgetAmount - spent;
        const variancePercent = budgetAmount > 0 ? ((variance / budgetAmount) * 100).toFixed(2) : 0;

        return {
          id: budget.id,
          accountId: budget.account_id,
          accountCode: budget.account_code,
          accountName: budget.account_name,
          budgetAmount,
          actualSpent: spent,
          variance: Number(variance.toFixed(2)),
          variancePercent: Number(variancePercent),
          status: variance >= 0 ? 'Under Budget' : 'Over Budget'
        };
      });

      return {
        fiscalYear,
        period,
        budgets: report
      };
    } catch (error) {
      console.error('[Reports] Budget vs Actual error:', error);
      throw error;
    }
  }

  /**
   * Generate VAT/Tax Report
   */
  async getVATReport( period) {
    try {
      const vatTransactions = await new Promise((resolve, reject) => {
        this.db.all(
          `SELECT 
            transaction_type,
            vat_rate,
            vat_amount,
            net_amount,
            gross_amount,
            is_recoverable,
            status
           FROM vat_transactionsperiod = ?`,
          [period],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      const outputVAT = vatTransactions
        .filter(t => t.transaction_type === 'sale')
        .reduce((sum, t) => sum + (Number(t.vat_amount) || 0), 0);

      const inputVAT = vatTransactions
        .filter(t => t.transaction_type === 'purchase' && t.is_recoverable)
        .reduce((sum, t) => sum + (Number(t.vat_amount) || 0), 0);

      const netVAT = outputVAT - inputVAT;

      return {
        period,
        outputVAT: Number(outputVAT.toFixed(2)),
        inputVAT: Number(inputVAT.toFixed(2)),
        netVAT: Number(netVAT.toFixed(2)),
        transactionCount: vatTransactions.length,
        transactions: vatTransactions
      };
    } catch (error) {
      console.error('[Reports] VAT Report error:', error);
      throw error;
    }
  }
}

module.exports = FinancialReportingService;