/**
 * Audit Service - Compliance-Grade Immutable Audit Trail
 *
 * Provides append-only, tamper-evident audit logging with:
 * - Field-level delta capture
 * - Correlation ID propagation
 * - Cryptographic hashing for integrity verification
 * - Full request context capture
 */

const { getDatabase } = require('./db.cjs');
const getDb = () => getDatabase();
const { randomUUID } = require('crypto');

// Enhanced audit event schema aligned with compliance requirements
class AuditEvent {
  constructor(data) {
    this.id = randomUUID();
    this.timestamp = new Date().toISOString();
    this.correlationId = data.correlationId || randomUUID();
    this.userId = data.userId || 'anonymous';
    this.userRole = data.userRole || 'unknown';
    this.sessionId = data.sessionId || null;

    // Action classification
    this.action = data.action;
    this.entityType = data.entityType;
    this.entityId = data.entityId;

    // Human-readable summary
    this.details = data.details || '';

    // Full state snapshots for delta computation
    this.oldValue = data.oldValue || null;
    this.newValue = data.newValue || null;

    // Computed delta (field-level changes)
    this.delta = this.computeDelta(this.oldValue, this.newValue);

    // Security context
    this.ipAddress = data.ipAddress || null;
    this.userAgent = data.userAgent || null;
    this.httpMethod = data.httpMethod || null;
    this.httpPath = data.httpPath || null;

    // Reason/justification (for sensitive operations)
    this.reason = data.reason || null;
    this.approvalChain = data.approvalChain || null;

    // Integrity hash (SHA-256 of event data)
    this.integrityHash = this.computeHash();
  }

  computeDelta(oldVal, newVal) {
    if (!oldVal && !newVal) return null;
    if (!oldVal) return { type: 'CREATION', fields: Object.keys(newVal || {}) };
    if (!newVal) return { type: 'DELETION', fields: Object.keys(oldVal || {}) };

    const changes = {};
    const allKeys = new Set([...Object.keys(oldVal || {}), ...Object.keys(newVal || {})]);

    for (const key of allKeys) {
      const oldV = oldVal[key];
      const newV = newVal[key];

      if (JSON.stringify(oldV) !== JSON.stringify(newV)) {
        changes[key] = {
          old: oldV,
          new: newV,
          changed: true
        };
      }
    }

    return Object.keys(changes).length > 0 ? { type: 'UPDATE', fields: changes } : null;
  }

  computeHash() {
    const crypto = require('crypto');
    const data = JSON.stringify({
      id: this.id,
      timestamp: this.timestamp,
      correlationId: this.correlationId,
      userId: this.userId,
      action: this.action,
      entityType: this.entityType,
      entityId: this.entityId,
      delta: this.delta
    });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  toDBObject() {
    return {
      id: this.id,
      timestamp: this.timestamp,
      correlation_id: this.correlationId,
      user_id: this.userId,
      user_role: this.userRole,
      session_id: this.sessionId,
      action: this.action,
      entity_type: this.entityType,
      entity_id: this.entityId,
      details: this.details,
      old_value: this.oldValue ? JSON.stringify(this.oldValue) : null,
      new_value: this.newValue ? JSON.stringify(this.newValue) : null,
      delta: this.delta ? JSON.stringify(this.delta) : null,
      integrity_hash: this.integrityHash,
      ip_address: this.ipAddress,
      user_agent: this.userAgent,
      http_method: this.httpMethod,
      http_path: this.httpPath,
      reason: this.reason,
      approval_chain: this.approvalChain ? JSON.stringify(this.approvalChain) : null
    };
  }
}

// Audit Service with append-only semantics
class AuditService {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    await this.createAuditTable();
    this.initialized = true;
    console.log('[AuditService] Initialized with compliance-grade schema');
  }

  async createAuditTable() {
    return new Promise((resolve, reject) => {
      getDb().serialize(() => {
        // Enhanced audit_logs table with compliance features
        getDb().run(`CREATE TABLE IF NOT EXISTS audit_logs (
          id TEXT PRIMARY KEY,
          timestamp DATETIME NOT NULL,
          correlation_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          user_role TEXT NOT NULL,
          session_id TEXT,
          action TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          details TEXT,
          old_value TEXT,
          new_value TEXT,
          delta TEXT,
          integrity_hash TEXT NOT NULL,
          ip_address TEXT,
          user_agent TEXT,
          http_method TEXT,
          http_path TEXT,
          reason TEXT,
          approval_chain TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
          if (err) reject(err);
          else {
            getDb().run(`CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp)`);
            getDb().run(`CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_logs(correlation_id)`);
            getDb().run(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id)`);
            getDb().run(`CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id)`);
            getDb().run(`CREATE INDEX IF NOT EXISTS idx_audit_integrity ON audit_logs(integrity_hash)`);
            resolve();
          }
        });
      });
    });
  }

  async logEvent(eventData) {
    try {
      const auditEvent = new AuditEvent(eventData);
      const dbObj = auditEvent.toDBObject();

      await new Promise((resolve, reject) => {
        getDb().run(
          `INSERT INTO audit_logs (
            id, timestamp, correlation_id, user_id, user_role, session_id, action, entity_type, entity_id, details, old_value,
            new_value, delta, integrity_hash, ip_address, user_agent,
            http_method, http_path, reason, approval_chain
          ) VALUES (?, ?, ?, ?, ?, ? , ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [dbObj.id, dbObj.timestamp, dbObj.correlation_id, dbObj.user_id, dbObj.user_role, dbObj.session_id, dbObj.action, dbObj.entity_type, dbObj.entity_id, dbObj.details, dbObj.old_value, dbObj.new_value, dbObj.delta, dbObj.integrity_hash, dbObj.ip_address, dbObj.user_agent, dbObj.http_method, dbObj.http_path, dbObj.reason, dbObj.approval_chain],
          (err) => {
            if (err) reject(err);
            else resolve(dbObj.id);
          }
        );
      });

      return auditEvent;
    } catch (error) {
      console.error('[AuditService] Failed to log event:', error);
      throw error;
    }
  }

  // Convenience methods for common operations
  async logCreate(userId, userRole, entityType, entityId, newValue, details = '', context = {}) {
    return this.logEvent({
      userId,
      userRole,
      action: 'CREATE',
      entityType,
      entityId,
      newValue,
      details,
      ...context
    });
  }

  async logUpdate(userId, userRole, entityType, entityId, oldValue, newValue, details = '', context = {}) {
    return this.logEvent({
      userId,
      userRole,
      action: 'UPDATE',
      entityType,
      entityId,
      oldValue,
      newValue,
      details,
      ...context
    });
  }

  async logDelete(userId, userRole, entityType, entityId, oldValue, details = '', context = {}) {
    return this.logEvent({
      userId,
      userRole,
      action: 'DELETE',
      entityType,
      entityId,
      oldValue,
      details,
      ...context
    });
  }

  async logAuthEvent(userId, userRole, action, details = '', context = {}) {
    return this.logEvent({
      userId,
      userRole,
      action,
      entityType: 'AUTH',
      entityId: userId,
      details,
      ...context
    });
  }

  // Query methods
  async getEvents(options = {}) {
    const {
      limit = 100,
      offset = 0,
      entityType,
      entityId,
      userId,
      action,
      startDate,
      endDate,
      correlationId} = options;

    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const params = [];

    if (entityType) {
      query += ' AND entity_type = ?';
      params.push(entityType);
    }
    if (entityId) {
      query += ' AND entity_id = ?';
      params.push(entityId);
    }
    if (userId) {
      query += ' AND user_id = ?';
      params.push(userId);
    }
    if (action) {
      query += ' AND action = ?';
      params.push(action);
    }
    if (correlationId) {
      query += ' AND correlation_id = ?';
      params.push(correlationId);
    }
    if (startDate) {
      query += ' AND timestamp >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND timestamp <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return new Promise((resolve, reject) => {
      getDb().all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async getEntityHistory(entityType, entityId) {
    return this.getEvents({ entityType, entityId });
  }

  async getCorrelationTrail(correlationId) {
    return this.getEvents({ correlationId });
  }

  // Integrity verification
  async verifyIntegrity(eventId) {
    return new Promise((resolve, reject) => {
      getDb().get('SELECT * FROM audit_logs WHERE id = ?', [eventId], async (err, row) => {
        if (err) reject(err);
        if (!row) resolve({ valid: false, error: 'Event not found' });

        const storedHash = row.integrity_hash;
        const computedHash = new AuditEvent({
          id: row.id,
          timestamp: row.timestamp,
          correlationId: row.correlation_id,
          userId: row.user_id,
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          oldValue: row.old_value ? JSON.parse(row.old_value) : null,
          newValue: row.new_value ? JSON.parse(row.new_value) : null
        }).computeHash();

        resolve({
          valid: storedHash === computedHash,
          stored: storedHash,
          computed: computedHash
        });
      });
    });
  }

  // Statistics
  async getStats(startDate = null, endDate = null) {
    let query = `
      SELECT 
        COUNT(*) as total_events,
        COUNT(DISTINCT user_id) as unique_users,
        COUNT(DISTINCT entity_type) as entity_types,
        MIN(timestamp) as earliest_event,
        MAX(timestamp) as latest_event
      FROM audit_logs
      WHERE 1=1
    `;
    const params = [];

    if (startDate) {
      query += ' AND timestamp >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND timestamp <= ?';
      params.push(endDate);
    }

    return new Promise((resolve, reject) => {
      getDb().get(query, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }
}

// Singleton instance
const auditService = new AuditService();

module.exports = { auditService, AuditEvent };