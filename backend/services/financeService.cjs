const crypto = require('crypto');

const { randomUUID } = require('crypto');
const BaseService = require('./baseService.cjs');

class FinanceService extends BaseService {

  // ── Chart of Accounts ──────────────────────────────────────────────
  async getAccounts() {
    return this._all(
      'SELECT * FROM chart_of_accounts ORDER BY code',
      []
    );
  }

  async getAccountById(id) {
    return this._get(
      'SELECT * FROM chart_of_accounts WHERE id = ?',
      [id]
    );
  }

  async createAccount(data) {
    this._validateCurrency(data.currency);
    const id = data.id || crypto.randomUUID();
    await this._run(
      `INSERT INTO chart_of_accounts (id, code, name, type, category, subtype, parent_id, is_active, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ? )`,
      [id, data.code, data.name, data.type, data.category || null, data.subtype || null, data.parent_id || null, data.is_active != null ? (data.is_active ? 1 : 0) : 1, data.description || null]
    );
    return this.getAccountById(id);
  }

  async updateAccount(id, data) {
    const fields = [];
    const params = [];
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      const col = { code: 'code', name: 'name', type: 'type', category: 'category',
        subtype: 'subtype', parent_id: 'parent_id', is_active: 'is_active',
        description: 'description' }[key];
      if (!col) continue;
      fields.push(`${col} = ?`);
      params.push(key === 'is_active' ? (value ? 1 : 0) : value);
    }
    if (!fields.length) return this.getAccountById(id);
    params.push(id);
    await this._run(
      `UPDATE chart_of_accounts SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      params
    );
    return this.getAccountById(id);
  }

  async deleteAccount(id) {
    await this._run(
      'DELETE FROM chart_of_accounts WHERE id = ?',
      [id]
    );
    return { success: true };
  }

  // ── Ledger ─────────────────────────────────────────────────────────
  async getLedger( accountId) {
    let sql = 'SELECT * FROM ledger_entries';
    const params = [];
    if (accountId) {
      sql += ' AND account_id = ?';
      params.push(accountId);
    }
    sql += ' ORDER BY entry_date DESC, created_at DESC';
    return this._all(sql, params);
  }

  async saveLedgerEntry(entry, currency = 'USD') {
    const id = entry.id || crypto.randomUUID();
    const entryCurrency = entry.currency || currency;
    await this._run(
      `INSERT INTO ledger_entries (id, account_id, account_code, account_name, entry_type, amount, currency, description, reference_type, reference_id, journal_id, entry_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? , ?)`,
      [id, entry.account_id, entry.account_code || null, entry.account_name || null, entry.entry_type, entry.amount, entryCurrency, entry.description || null, entry.reference_type || null, entry.reference_id || null, entry.journal_id || null, entry.entry_date, entry.created_by || null]
    );
    return this._get('SELECT * FROM ledger_entries WHERE id = ?', [id]);
  }

  // ── Expenses ───────────────────────────────────────────────────────
  async getExpenses() {
    return this._all(
      'SELECT * FROM expenses ORDER BY expense_date DESC',
      []
    );
  }

  async createExpense(data) {
    this._validateCurrency(data.currency);
    const id = data.id || crypto.randomUUID();
    await this._run(
      `INSERT INTO expenses (id, category, vendor_name, amount, currency, description, expense_date, account_id, payment_method, status, receipt_url, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? , ?)`,
      [id, data.category, data.vendor_name || null, data.amount, data.currency || 'USD', data.description || null, data.expense_date, data.account_id || null, data.payment_method || null, data.status || 'pending', data.receipt_url || null, data.created_by || null]
    );
    return this._get('SELECT * FROM expenses WHERE id = ?', [id]);
  }

  async updateExpense(id, data) {
    const fields = [];
    const params = [];
    const allowed = ['category', 'vendor_name', 'amount', 'currency', 'description',
      'expense_date', 'account_id', 'payment_method', 'status', 'receipt_url'];
    for (const field of allowed) {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        params.push(data[field] === null ? null : data[field]);
      }
    }
    if (!fields.length) return this._get('SELECT * FROM expenses WHERE id = ?', [id]);
    params.push(id);
    await this._run(
      `UPDATE expenses SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      params
    );
    if (data.status === 'cancelled') {
      await this.voidExpenseLedger(id);
    }
    return this._get('SELECT * FROM expenses WHERE id = ?', [id]);
  }

  _validateCurrency(currency) {
    const code = String(currency || 'USD').trim();
    const isoRegex = /^[A-Z]{3}$/;
    if (!isoRegex.test(code)) {
      throw new Error(`Invalid currency code: ${code}. Must be a 3-letter ISO code.`);
    }
  }

  async reverseLedgerEntriesByReference(referenceType, referenceId) {
    const entries = await this._all(
      'SELECT * FROM ledger_entries WHERE reference_type = ? AND reference_id = ?',
      [referenceType, referenceId]
    );
    const journalId = randomUUID();
    for (const entry of entries) {
      await this._run(
        `INSERT INTO ledger_entries (id, account_id, account_code, account_name, entry_type, amount, currency, description, reference_type, reference_id, journal_id, entry_date, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? , ?)`,
        [randomUUID(), entry.account_id, entry.account_code, entry.account_name, entry.entry_type === 'debit' ? 'credit' : 'debit', entry.amount, entry.currency, `Reversal of ${entry.description || entry.reference_id}`, 'reversal', referenceId, journalId, new Date().toISOString(), null]
      );
    }
    return journalId;
  }

  async voidExpenseLedger(id) {
    return this.reverseLedgerEntriesByReference('expense', id);
  }

  async voidIncomeLedger(id) {
    return this.reverseLedgerEntriesByReference('income', id);
  }

  async deleteIncome(id) {
    await this.voidIncomeLedger(id);
    await this._run('DELETE FROM income WHERE id = ?', [id]);
    return { success: true };
  }

  // ── Income ─────────────────────────────────────────────────────────
  async getIncome() {
    return this._all(
      'SELECT * FROM income ORDER BY income_date DESC',
      []
    );
  }

  async createIncome(data) {
    this._validateCurrency(data.currency);
    const id = data.id || crypto.randomUUID();
    await this._run(
      `INSERT INTO income (id, source, amount, currency, description, income_date, account_id, payment_method, reference, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ? , ?)`,
      [id, data.source, data.amount, data.currency || 'USD', data.description || null, data.income_date, data.account_id || null, data.payment_method || null, data.reference || null, data.created_by || null]
    );
    return this._get('SELECT * FROM income WHERE id = ?', [id]);
  }

  async deleteIncome(id) {
    await this._run('DELETE FROM income WHERE id = ?', [id]);
    return { success: true };
  }

  // ── Budgets ────────────────────────────────────────────────────────
  async getBudgets() {
    return this._all(
      'SELECT * FROM budgets ORDER BY fiscal_year DESC, name',
      []
    );
  }

  async createBudget(data) {
    this._validateCurrency(data.currency);
    const id = data.id || crypto.randomUUID();
    await this._run(
      `INSERT INTO budgets (id, name, account_id, fiscal_year, period, amount, notes)
       VALUES (?, ?, ?, ?, ?, ? , ?)`,
      [id, data.name, data.account_id || null, data.fiscal_year, data.period, data.amount, data.notes || null]
    );
    return this._get('SELECT * FROM budgets WHERE id = ?', [id]);
  }

  async updateBudget(id, data) {
    const fields = [];
    const params = [];
    const allowed = ['name', 'account_id', 'fiscal_year', 'period', 'amount', 'spent', 'notes'];
    for (const field of allowed) {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        params.push(data[field] === null ? null : data[field]);
      }
    }
    if (!fields.length) return this._get('SELECT * FROM budgets WHERE id = ?', [id]);
    params.push(id);
    await this._run(
      `UPDATE budgets SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      params
    );
    return this._get('SELECT * FROM budgets WHERE id = ?', [id]);
  }

  async deleteBudget(id) {
    await this.reverseLedgerEntriesByReference('budget', id);
    await this._run('DELETE FROM budgets WHERE id = ?', [id]);
    return { success: true };
  }

  // ── Transfers ──────────────────────────────────────────────────────
  async getTransfers() {
    return this._all(
      `SELECT t.*, fa.name as from_account_name, ta.name as to_account_name
       FROM transfers t
       LEFT JOIN chart_of_accounts fa ON t.from_account_id = fa.id
       LEFT JOIN chart_of_accounts ta ON t.to_account_id = ta.id ORDER BY t.created_at DESC`,
      []
    );
  }

  async createTransfer(data, userId) {
    this._validateCurrency(data.currency);
    const id = data.id || randomUUID();
    const amount = Number(data.amount);
    if (!amount || amount <= 0) {
      throw new Error('Transfer amount must be positive');
    }
    if (data.from_account_id === data.to_account_id) {
      throw new Error('Cannot transfer to the same account');
    }
    const fromAccount = await this._get(
      'SELECT balance FROM chart_of_accounts WHERE id = ?',
      [data.from_account_id]
    );
    if (!fromAccount) {
      throw new Error('Source account not found');
    }
    if (Number(fromAccount.balance || 0) < amount) {
      throw new Error('Insufficient account balance');
    }
    const journalId = randomUUID();
    await this._run(
      `INSERT INTO ledger_entries (id, account_id, account_code, account_name, entry_type, amount, currency, description, reference_type, reference_id, journal_id, entry_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? , ?)`,
      [randomUUID(), data.to_account_id, null, null, 'debit', amount, data.currency || 'USD', data.description || null, 'transfer', id, journalId, new Date().toISOString(), userId]
    );
    await this._run(
      `INSERT INTO ledger_entries (id, account_id, account_code, account_name, entry_type, amount, currency, description, reference_type, reference_id, journal_id, entry_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? , ?)`,
      [randomUUID(), data.from_account_id, null, null, 'credit', amount, data.currency || 'USD', data.description || null, 'transfer', id, journalId, new Date().toISOString(), userId]
    );
    await this._run(
      `INSERT INTO transfers (id, from_account_id, to_account_id, amount, currency, description, status, reference, created_by, executed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ? , ?, ?)`,
      [id, data.from_account_id, data.to_account_id, amount, data.currency || 'USD', data.description || null, 'completed', data.reference || null, userId, new Date().toISOString()]
    );
    return this._get(
      `SELECT t.*, fa.name as from_account_name, ta.name as to_account_name
       FROM transfers t
       LEFT JOIN chart_of_accounts fa ON t.from_account_id = fa.id
       LEFT JOIN chart_of_accounts ta ON t.to_account_id = ta.id
       WHERE t.id = ?`, [id]
    );
  }
}

module.exports = FinanceService;
