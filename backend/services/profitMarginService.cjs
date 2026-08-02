const { getDatabase } = require('../db.cjs');
const getDb = () => getDatabase();
const { randomUUID } = require('crypto');

/**
 * Service to manage profit margin settings and resolution.
 * Implements the hierarchy: line_item > category > global.
 */
const profitMarginService = {
  
  /**
   * Resolve the effective margin based on precedence logic.
   * @param {string} lineItemId - SKU or product ID
   * @param {string} categoryId - Category ID
   * @returns {Promise<Object>} Effective margin setting
   */
  getEffectiveMargin: async (lineItemId, categoryId) => {
    return new Promise((resolve, reject) => {
      // 1. Check line_item level
      if (lineItemId) {
        getDb().get(
          "SELECT margin_value, margin_type, scope, apply_volume_margins FROM profit_margin_settings WHERE scope = 'line_item' AND scope_ref_id = ? AND is_active = 1 AND deleted_at IS NULL",
          [lineItemId],
          (err, row) => {
            if (err) return reject(err);
            if (row) return resolve({ ...row, source: 'line_item' });
            
            // If no line override, proceed to category
            resolve(profitMarginService._checkCategory(categoryId));
          }
        );
      } else {
        resolve(profitMarginService._checkCategory(categoryId));
      }
    });
  },

  _checkCategory: (categoryId) => {
    return new Promise((resolve, reject) => {
      if (categoryId) {
        getDb().get(
          "SELECT margin_value, margin_type, scope, apply_volume_margins FROM profit_margin_settings WHERE scope = 'category' AND scope_ref_id = ? AND is_active = 1 AND deleted_at IS NULL",
          [categoryId],
          (err, row) => {
            if (err) return reject(err);
            if (row) return resolve({ ...row, source: 'category' });
            
            // If no category override, proceed to global
            resolve(profitMarginService._checkGlobal());
          }
        );
      } else {
        resolve(profitMarginService._checkGlobal());
      }
    });
  },

  _checkGlobal: () => {
    return new Promise((resolve, reject) => {
      getDb().get(
        "SELECT margin_value, margin_type, scope, apply_volume_margins FROM profit_margin_settings WHERE scope = 'global' AND is_active = 1 AND deleted_at IS NULL",
        [],
        (err, row) => {
          if (err) return reject(err);
          if (row) return resolve({ ...row, source: 'global' });
          
          // Fallback system default
          resolve({ margin_value: 0, margin_type: 'percentage', source: 'system' });
        }
      );
    });
  },

  /**
   * List all settings, optionally filtered by scope.
   */
  listSettings: (scope = null) => {
    return new Promise((resolve, reject) => {
      let query = "SELECT * FROM profit_margin_settings WHERE deleted_at IS NULL";
      const params = [];
      if (scope) {
        query += " AND scope = ?";
        params.push(scope);
      }
      query += " ORDER BY created_at DESC";
      getDb().all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },

  /**
   * Get a single setting by ID.
   */
  getById: (id) => {
    return new Promise((resolve, reject) => {
      getDb().get("SELECT * FROM profit_margin_settings WHERE id = ? AND deleted_at IS NULL", [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  /**
   * Create a new override setting with audit trail.
   */
  createSetting: async (data, userId) => {
    const { scope, scope_ref_id, margin_type, margin_value, reason } = data;
    
    // Bounds check
    if (margin_type === 'percentage' && (margin_value < 0 || margin_value > 100)) {
      throw new Error("Percentage margin must be between 0 and 100");
    }
    if (margin_type === 'fixed_amount' && margin_value < 0) {
      throw new Error("Fixed margin must be >= 0");
    }

    // Conflict check: only one active override per specific ref
    const existing = await new Promise((res) => {
      getDb().get(
        "SELECT id FROM profit_margin_settings WHERE scope = ? AND (scope_ref_id = ? OR (scope_ref_id IS NULL AND ? IS NULL)) AND is_active = 1 AND deleted_at IS NULL",
        [scope, scope_ref_id, scope_ref_id],
        (err, row) => res(row)
      );
    });

    if (existing) {
      throw new Error(`An active active override already exists for this ${scope}`);
    }

    return new Promise((resolve, reject) => {
      const id = randomUUID();
      getDb().serialize(() => {
        getDb().run("BEGIN TRANSACTION");
        getDb().run(
          `INSERT INTO profit_margin_settings (id, scope, scope_ref_id, margin_type, margin_value, reason, created_by, apply_volume_margins)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, scope, scope_ref_id, margin_type, margin_value, reason, userId, data.apply_volume_margins || 0],
          function(err) {
            if (err) {
              getDb().run("ROLLBACK");
              return reject(err);
            }
            
            // Log audit
            const auditId = randomUUID();
            getDb().run(
              `INSERT INTO profit_margin_audit_logs (id, setting_id, action, scope, new_value, reason, performed_by)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [auditId, id, 'CREATE', scope, JSON.stringify(data), reason, userId],
              (err) => {
                if (err) {
                  getDb().run("ROLLBACK");
                  return reject(err);
                }
                getDb().run("COMMIT");
                resolve({ id, ...data });
              }
            );
          }
        );
      });
    });
  },

  /**
   * Update an existing setting.
   */
  updateSetting: async (id, data, userId) => {
    const old = await profitMarginService.getById(id);
    if (!old) throw new Error("Setting not found");

    const { margin_value, margin_type, is_active, reason } = data;
    
    // Bounds check if provided
    if (margin_type === 'percentage' && (margin_value < 0 || margin_value > 100)) {
      throw new Error("Percentage margin must be between 0 and 100");
    }

    return new Promise((resolve, reject) => {
      getDb().serialize(() => {
        getDb().run("BEGIN TRANSACTION");
        
        const updates = [];
        const params = [];
        if (margin_value !== undefined) { updates.push("margin_value = ?"); params.push(margin_value); }
        if (margin_type !== undefined) { updates.push("margin_type = ?"); params.push(margin_type); }
        if (is_active !== undefined) { updates.push("is_active = ?"); params.push(is_active); }
        if (data.apply_volume_margins !== undefined) { updates.push("apply_volume_margins = ?"); params.push(data.apply_volume_margins); }
        if (reason !== undefined) { updates.push("reason = ?"); params.push(reason); }
        updates.push("updated_at = CURRENT_TIMESTAMP");
        
        params.push(id);
        
        getDb().run(
          `UPDATE profit_margin_settings SET ${updates.join(', ')} WHERE id = ?`,
          params,
          function(err) {
            if (err) {
              getDb().run("ROLLBACK");
              return reject(err);
            }
            
            // Log audit
            const auditId = randomUUID();
            getDb().run(
              `INSERT INTO profit_margin_audit_logs (id, setting_id, action, scope, old_value, new_value, reason, performed_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [auditId, id, 'UPDATE', old.scope, JSON.stringify(old), JSON.stringify({ ...old, ...data }), reason || data.reason, userId],
              (err) => {
                if (err) {
                  getDb().run("ROLLBACK");
                  return reject(err);
                }
                getDb().run("COMMIT");
                resolve({ id, ...old, ...data });
              }
            );
          }
        );
      });
    });
  },

  /**
   * Soft delete a setting.
   */
  deleteSetting: async (id, userId, reason) => {
    const old = await profitMarginService.getById(id);
    if (!old) throw new Error("Setting not found");

    return new Promise((resolve, reject) => {
      getDb().serialize(() => {
        getDb().run("BEGIN TRANSACTION");
        getDb().run(
          "UPDATE profit_margin_settings SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?",
          [id],
          (err) => {
            if (err) {
              getDb().run("ROLLBACK");
              return reject(err);
            }
            
            // Log audit
            const auditId = randomUUID();
            getDb().run(
              `INSERT INTO profit_margin_audit_logs (id, setting_id, action, scope, old_value, reason, performed_by)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [auditId, id, 'DELETE', old.scope, JSON.stringify(old), reason, userId],
              (err) => {
                if (err) {
                  getDb().run("ROLLBACK");
                  return reject(err);
                }
                getDb().run("COMMIT");
                resolve({ success: true });
              }
            );
          }
        );
      });
    });
  },

  /**
   * Bulk upload via CSV data.
   */
  bulkUpload: async (rows, userId) => {
    // rows: array of { sku, margin_type, margin_value, reason }
    const results = { success: 0, failed: 0, errors: [] };
    
    for (const row of rows) {
      try {
        await profitMarginService.createSetting({
          scope: 'line_item',
          scope_ref_id: row.sku,
          margin_type: row.margin_type,
          margin_value: parseFloat(row.margin_value),
          reason: row.reason || 'Bulk upload'
        }, userId);
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push({ sku: row.sku, error: err.message });
      }
    }
    return results;
  },

  /**
   * Get audit log.
   */
  getAuditLog: (filters = {}) => {
    let query = `
      SELECT a.*, p.id as setting_id, p.scope, p.scope_ref_id 
      FROM profit_margin_audit_logs a
      LEFT JOIN profit_margin_settings p ON a.setting_id = p.id
      WHERE 1=1
    `;
    const params = [];
    
    if (filters.scope) {
      query += " AND a.scope = ?";
      params.push(filters.scope);
    }
    if (filters.user) {
      query += " AND a.performed_by = ?";
      params.push(filters.user);
    }
    if (filters.startDate) {
      query += " AND a.timestamp >= ?";
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      query += " AND a.timestamp <= ?";
      params.push(filters.endDate);
    }
    
    query += " ORDER BY a.timestamp DESC LIMIT ? OFFSET ?";
    params.push(filters.limit || 100);
    params.push(filters.offset || 0);
    
    return new Promise((resolve, reject) => {
      getDb().all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
};

module.exports = profitMarginService;
