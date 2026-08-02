const crypto = require('crypto');
const BaseService = require('./baseService.cjs');

class ProcurementService extends BaseService {

  async _saveLedgerEntry(entry) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO ledger_entries (id, account_id, entry_type, amount, currency, description, reference_type, reference_id, entry_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ? )`,
        [id, entry.account_id, entry.entry_type, entry.amount, entry.currency || 'USD', entry.description || null, entry.reference_type || null, entry.reference_id || null, entry.entry_date || new Date().toISOString()],
        function(err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }

  async postGoodsReceiptLedger(grn, currency = 'USD') {
    const items = await this._all('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?', [grn.purchase_order_id]);
    const totalAmount = items.reduce((sum, item) => sum + (item.total_price || 0), 0);
    if (totalAmount <= 0) return;
    const inventoryAccount = await this._get(
      "SELECT * FROM chart_of_accounts WHERE type = 'asset' AND (name LIKE '%inventory%' OR code = '1200')",
      []
    );
    const apAccount = await this._get(
      "SELECT * FROM chart_of_accounts WHERE type = 'liability' AND (name LIKE '%payable%' OR code = '2000')",
      []
    );
    if (inventoryAccount && apAccount) {
      const po = await this._get('SELECT * FROM purchase_orders WHERE id = ?', [grn.purchase_order_id]);
      const poCurrency = po?.currency || currency;
      await this._saveLedgerEntry({
        account_id: inventoryAccount.id, entry_type: 'debit', amount: totalAmount,
        currency: poCurrency, description: 'Inventory receipt',
        reference_type: 'goods_receipt', reference_id: grn.id
      });
      await this._saveLedgerEntry({
        account_id: apAccount.id, entry_type: 'credit', amount: totalAmount,
        currency: poCurrency, description: 'AP accrual',
        reference_type: 'goods_receipt', reference_id: grn.id
      });
    }
  }

  // ── Suppliers ──────────────────────────────────────────────────────
  async getSuppliers() {
    return this._all(
      'SELECT * FROM suppliers ORDER BY name', []
    );
  }

  async getSupplierById(id) {
    return this._get(
      'SELECT * FROM suppliers WHERE id = ?', [id]
    );
  }

  async createSupplier(data) {
    const id = data.id || crypto.randomUUID();
    await this._run(
      `INSERT INTO suppliers (id, name, email, phone, address, city, status, category, payment_terms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ? )`,
      [id, data.name, data.email || null, data.phone || null, data.address || null, data.city || null, data.status || 'Active', data.category || null, data.payment_terms || null]
    );
    return this.getSupplierById(id);
  }

  async updateSupplier(id, data) {
    const fields = [];
    const params = [];
    const allowed = ['name', 'email', 'phone', 'address', 'city', 'status', 'category', 'payment_terms'];
    for (const field of allowed) {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        params.push(data[field] === null ? null : data[field]);
      }
    }
    if (!fields.length) return this.getSupplierById(id);
    params.push(id);
    await this._run(
      `UPDATE suppliers SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      params
    );
    return this.getSupplierById(id);
  }

  async deleteSupplier(id) {
    await this._run(
      'DELETE FROM suppliers WHERE id = ?', [id]
    );
    return { success: true };
  }

  // ── Purchase Orders ────────────────────────────────────────────────
  async getPurchases() {
    return this._all(
      `SELECT po.*, s.name as supplier_name
       FROM purchase_orders po
       LEFT JOIN suppliers s ON po.supplier_id = s.id ORDER BY po.created_at DESC`, []
    );
  }

  async getPurchaseById(id) {
    return this._get(
      `SELECT po.*, s.name as supplier_name
       FROM purchase_orders po
       LEFT JOIN suppliers s ON po.supplier_id = s.id
       WHERE po.id = ?`, [id]
    );
  }

  async getPurchaseItems(purchaseId) {
    return this._all(
      'SELECT * FROM purchase_order_items WHERE purchase_order_id = ?', [purchaseId]
    );
  }

  async createPurchase(data, userId) {
    const id = data.id || crypto.randomUUID();
    const items = data.items || [];
    try {
      await this._run("BEGIN TRANSACTION");
      await this._run(
        `INSERT INTO purchase_orders (id, supplier_id, order_date, expected_date, status, currency, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ? , ?)`,
        [id, data.supplier_id, data.order_date || new Date().toISOString(), data.expected_date || null, data.status || 'Draft', data.currency || 'USD', data.notes || null, userId]
      );
      for (const item of items) {
        await this._run(
          `INSERT INTO purchase_order_items (id, purchase_order_id, item_id, item_name, quantity, unit_price, total_price)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [item.id || crypto.randomUUID(), id, item.item_id || null, item.item_name || '',
           item.quantity || 0, item.unit_price || 0, (item.quantity || 0) * (item.unit_price || 0)]
        );
      }
      await this._run("COMMIT");
      return this.getPurchaseById(id);
    } catch (err) {
      await this._run("ROLLBACK");
      throw err;
    }
  }

  async updatePurchaseStatus(id, status) {
    await this._run(
      `UPDATE purchase_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, id]
    );
    return this.getPurchaseById(id);
  }

  // ── Goods Receipts ────────────────────────────────────────────────
  async getGoodsReceipts() {
    return this._all(
      `SELECT gr.*, po.supplier_id, s.name as supplier_name
       FROM goods_receipts gr
       LEFT JOIN purchase_orders po ON gr.purchase_order_id = po.id
       LEFT JOIN suppliers s ON po.supplier_id = s.id ORDER BY gr.created_at DESC`, []
    );
  }

  async createGoodsReceipt(data, userId, currency = 'USD') {
    const id = data.id || crypto.randomUUID();
    await this._run(
      `INSERT INTO goods_receipts (id, purchase_order_id, received_date, status, notes, created_by)
       VALUES (?, ?, ?, ?, ? , ?)`,
      [id, data.purchase_order_id, data.received_date || new Date().toISOString(), 'Received', data.notes || null, userId]
    );
    const grn = await this._get('SELECT * FROM goods_receipts WHERE id = ?', [id]);
    await this.postGoodsReceiptLedger(grn, currency);
    return grn;
  }
}

module.exports = ProcurementService;
