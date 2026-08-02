const BaseService = require('./baseService.cjs');

class FinancialYearService extends BaseService {
  async getFinancialYears() {
    return this._all(
      'SELECT * FROM financial_years ORDER BY start_date DESC',
      []
    );
  }

  async getFinancialYearById(id) {
    return this._get(
      'SELECT * FROM financial_years WHERE id = ?',
      [id]
    );
  }

  async getDefaultFinancialYear() {
    let fy = await this._get(
      'SELECT * FROM financial_years WHERE is_default = 1 AND status = \'Active\' LIMIT 1',
      []
    );
    if (!fy) {
      fy = await this._get(
        'SELECT * FROM financial_years WHERE status = \'Active\' ORDER BY start_date DESC LIMIT 1',
        []
      );
    }

    if (fy) {
      const today = new Date().toISOString().slice(0, 10);
      if (today > fy.end_date) {
        const nextYear = new Date(fy.end_date).getFullYear() + 1;
        const nextStartDate = `${nextYear}-01-01`;
        const nextEndDate = `${nextYear}-12-31`;

        await this.closeFinancialYear(fy.id);

        fy = await this.createFinancialYear({
          name: String(nextYear),
          code: `FY${nextYear}`,
          start_date: nextStartDate,
          end_date: nextEndDate,
          is_default: true,
          status: 'Active',
          is_closed: false
        }, '');
      }
    }

    return fy || null;
  }

  async getFinancialYearByDate(date) {
    const row = await this._get(
      `SELECT * FROM financial_years WHERE date(?) >= date(start_date) AND date(?) <= date(end_date)
       LIMIT 1`,
      [date, date]
    );
    return row || null;
  }

  async createFinancialYear(data, userId) {
    const id = data.id || require('crypto').randomUUID();
    const existing = await this._get(
      'SELECT id FROM financial_years WHERE status = \'Active\' AND date(start_date) <= date(?) AND date(end_date) >= date(?)',
      [data.end_date, data.start_date]
    );
    if (existing) {
      throw new Error('Overlapping financial year already exists for this period');
    }
    const hasAny = await this._get(
      'SELECT id FROM financial_years LIMIT 1',
      []
    );
    const isDefault = data.is_default !== undefined ? (data.is_default ? 1 : 0) : (!hasAny ? 1 : 0);
    if (isDefault) {
      await this._run(
        'UPDATE financial_years SET is_default = 0',
        []
      );
    }
    await this._run(
      `INSERT INTO financial_years (id, name, code, start_date, end_date, is_default, is_closed, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ? , ?, datetime('now'), datetime('now'))`,
      [id, data.name, data.code || '', data.start_date, data.end_date, isDefault, data.is_closed ? 1 : 0, data.status || 'Active', userId || '']
    );
    return this.getFinancialYearById(id);
  }

  async updateFinancialYear(id, data) {
    const fy = await this.getFinancialYearById(id);
    if (!fy) throw new Error('Financial year not found');

    const fields = [];
    const params = [];

    if (data.name !== undefined) { fields.push('name = ?'); params.push(data.name); }
    if (data.code !== undefined) { fields.push('code = ?'); params.push(data.code); }
    if (data.start_date !== undefined) { fields.push('start_date = ?'); params.push(data.start_date); }
    if (data.end_date !== undefined) { fields.push('end_date = ?'); params.push(data.end_date); }
    if (data.status !== undefined) { fields.push('status = ?'); params.push(data.status); }
    if (data.is_closed !== undefined) { fields.push('is_closed = ?'); params.push(data.is_closed ? 1 : 0); }
    if (data.is_default !== undefined) {
      if (data.is_default) {
        await this._run('UPDATE financial_years SET is_default = 0', []);
      }
      fields.push('is_default = ?');
      params.push(data.is_default ? 1 : 0);
    }

    if (fields.length === 0) return fy;

    fields.push("updated_at = datetime('now')");
    params.push(id);

    await this._run(
      `UPDATE financial_years SET ${fields.join(', ')} WHERE id = ?`,
      params
    );
    return this.getFinancialYearById(id);
  }

  async closeFinancialYear(id) {
    const fy = await this.getFinancialYearById(id);
    if (!fy) throw new Error('Financial year not found');
    if (fy.is_closed) throw new Error('Financial year is already closed');

    const nextFy = await this._get(
      `SELECT * FROM financial_years WHERE date(start_date) = date(?, '+1 day') AND status = 'Active' LIMIT 1`,
      []
    );

    const carryForwardBalances = async () => {
      const balanceSheetAccounts = await this._all(
        `SELECT id, code, name, type, balance FROM chart_of_accounts WHERE type IN ('Asset', 'Liability', 'Equity') AND balance != 0`,
        []
      );

      if (balanceSheetAccounts.length > 0 && nextFy) {
        const entryDate = nextFy.start_date;
        for (const account of balanceSheetAccounts) {
          const isDebitNormal = account.type === 'Asset';
          const lineId = require('crypto').randomUUID();
          const absBalance = Math.abs(account.balance);
          const entryType = account.balance > 0
            ? (isDebitNormal ? 'debit' : 'credit')
            : (isDebitNormal ? 'credit' : 'debit');
          await this._run(
            `INSERT INTO ledger_entries (id, account_id, entry_type, amount, entry_date, description, created_at)
             VALUES (?, ?, ?, ?, ?, ? , datetime('now'))`,
            [lineId, account.id, entryType, absBalance, entryDate, `Opening balance - ${account.name} (carried forward from FY ${fy.name})`]
          );
        }
      }
    };

    await carryForwardBalances();

    await this._run(
      `UPDATE financial_years SET is_closed = 1, status = 'Closed', updated_at = datetime('now') WHERE id = ?`,
      [id]
    );
    return this.getFinancialYearById(id);
  }

  async deleteFinancialYear(id) {
    const fy = await this.getFinancialYearById(id);
    if (!fy) throw new Error('Financial year not found');
    if (fy.is_default) {
      throw new Error('Cannot delete the default financial year. Set another year as default first.');
    }
    await this._run(
      'DELETE FROM financial_years WHERE id = ?',
      [id]
    );
    return { success: true };
  }

  async getOrCreateDefaultFinancialYear( userId) {
    let fy = await this.getDefaultFinancialYear();
    if (fy) return fy;

    const now = new Date();
    const year = now.getFullYear();
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    fy = await this.createFinancialYear({
      name: `${year}`,
      code: `FY${year}`,
      start_date: startDate,
      end_date: endDate,
      is_default: true,
      status: 'Active',
      is_closed: false
    }, userId);

    return fy;
  }

  async validateTransactionDate(date) {
    const fy = await this.getFinancialYearByDate(date);
    if (!fy) {
      throw new Error(`Selected date does not belong to any active Financial Year. Please switch Financial Year or choose a valid date.`);
    }
    if (fy.is_closed) {
      throw new Error(`Financial Year "${fy.name}" is closed. No new transactions can be created.`);
    }
    return fy;
  }
}

module.exports = FinancialYearService;