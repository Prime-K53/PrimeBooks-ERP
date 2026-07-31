/**
 * Portal Lifecycle Service
 *
 * Centralized, backend-authoritative document lifecycle for the customer portal.
 * Every state transition, download, notification, timeline event and audit log
 * flows through this service — components must never duplicate this logic.
 *
 * Realms:
 *   portal  → customer-side SSE channel (customer is signed in to the portal)
 *   admin   → staff-side SSE channel (admin ERP is signed in)
 */

const crypto = require('crypto');
const { db } = require('../db.cjs');
const { auditService } = require('../auditService.cjs');
const emailService = require('./emailService.cjs');

// ─── Centralized status enums ────────────────────────────────────────────────
const REQUEST_STATUS = Object.freeze({
  SUBMITTED: 'submitted',
  UNDER_REVIEW: 'under_review',
  QUOTATION_READY: 'quotation_ready',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
});

const QUOTATION_STATUS = Object.freeze({
  READY: 'ready',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  REVISION_REQUESTED: 'revision_requested',
  CONVERTED: 'converted',
});

const EVENT_TYPES = Object.freeze({
  REQUEST_SUBMITTED: 'request_submitted',
  REQUEST_CANCELLED: 'request_cancelled',
  REQUEST_REVIEWED: 'request_reviewed',
  REQUEST_CLARIFICATION: 'request_clarification',
  REQUEST_REJECTED: 'request_rejected',
  QUOTATION_GENERATED: 'quotation_generated',
  QUOTATION_DOWNLOADED: 'document_downloaded',
  QUOTATION_ACCEPTED: 'quotation_accepted',
  QUOTATION_REJECTED: 'quotation_rejected',
  REVISION_REQUESTED: 'revision_requested',
  REVISION_REGENERATED: 'quotation_regenerated',
  ORDER_CONVERTED: 'order_converted',
});

const NOTIFICATION_TYPES = Object.freeze({
  REQUEST: 'request',
  QUOTATION: 'quotation',
  ORDER: 'order',
  DOWNLOAD: 'download',
  DECISION: 'decision',
  SYSTEM: 'system',
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getOne(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

function getAll(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function runQuery(query, params = []) {
  const placeholders = (query.match(/\?/g) || []).length;
  if (placeholders !== params.length) {
    return Promise.reject(
      new Error(`SQL binding mismatch: ${placeholders} placeholders vs ${params.length} params in: ${query.slice(0, 140)}`)
    );
  }
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function genId(prefix = 'plc') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const quantity = Math.max(1, Number(item.quantity ?? item.qty ?? 1) || 1);
    const unitPrice = round2(item.unitPrice ?? item.price ?? item.unit_price ?? 0);
    return {
      productId: item.productId || item.product_id || item.id || null,
      name: String(item.name || item.description || item.productName || 'Item'),
      quantity,
      unitPrice,
      lineTotal: round2(quantity * unitPrice),
    };
  }).filter((item) => item.name && item.quantity > 0);
}

function computeTotals(items, discount = 0, taxRate = 0, deliveryFee = 0) {
  const subtotal = round2(items.reduce((sum, i) => sum + (Number(i.lineTotal) || 0), 0));
  const taxAmount = round2(subtotal * (Number(taxRate) || 0) / 100);
  const total = round2(subtotal - round2(discount) + taxAmount + round2(deliveryFee));
  return { subtotal, taxAmount, total };
}

async function nextSequentialNumber(table, column, prefix) {
  const rows = await getAll(`SELECT ${column} FROM ${table} WHERE ${column} LIKE ?`, [`${prefix}-%`]);
  let maxSeq = 0;
  for (const row of rows) {
    const suffix = String(row[column] || '').slice(prefix.length + 1);
    const num = parseInt(suffix, 10);
    if (Number.isFinite(num) && num > maxSeq) maxSeq = num;
  }
  return `${prefix}-${String(maxSeq + 1).padStart(4, '0')}`;
}

// ─── Realtime (SSE) hub ──────────────────────────────────────────────────────
const subscribers = { portal: new Map(), admin: new Map() };

function subscribe(channel, res, req) {
  const key = crypto.randomUUID();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 15000\n\n');
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* connection dropped */ }
  }, 25000);

  const entry = { res, req, cleanup: null };
  subscribers[channel].set(key, entry);

  const cleanup = () => {
    clearInterval(heartbeat);
    subscribers[channel].delete(key);
    req.removeListener('close', cleanup);
  };
  entry.cleanup = cleanup;
  req.on('close', cleanup);

  return () => cleanup();
}

function broadcast(channel, eventName, payload) {
  const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const entry of subscribers[channel].values()) {
    try { entry.res.write(data); } catch { /* connection dropped */ }
  }
}

// ─── Shared recording primitives (single source of truth) ──────────────────
async function addTimeline(companyId, customerId, docType, docId, eventType, title, description, actor, metadata = {}) {
  const id = genId('ptl');
  await runQuery(
    `INSERT INTO portal_timeline_events
       (id, company_id, customer_id, doc_type, doc_id, event_type, title, description, actor_type, actor_id, actor_name, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, companyId, customerId || null, docType, docId, eventType,
      title, description || null,
      actor.type || 'system', actor.id || null, actor.name || null,
      Object.keys(metadata).length ? JSON.stringify(metadata) : null,
    ]
  );
  return id;
}

async function logAudit({ actor, companyId, action, entityType, entityId, details, oldValue, newValue, context = {} }) {
  try {
    await auditService.logEvent({
      userId: actor.id || actor.name || 'portal',
      userRole: actor.role || 'portal_customer',
      companyId,
      action,
      entityType,
      entityId,
      details,
      oldValue,
      newValue,
      ipAddress: context.ip,
      userAgent: context.userAgent,
      httpMethod: context.method,
      httpPath: context.path,
      correlationId: context.correlationId,
    });
  } catch (err) {
    console.error('[Lifecycle] Audit log failed:', err.message);
  }
}

async function notifyCustomer({ companyId, customerId, type, title, body, link, actorName }) {
  const users = await getAll(
    'SELECT id, email, full_name FROM portal_users WHERE customer_id = ? AND company_id = ? AND status = ?',
    [customerId, companyId, 'active']
  );
  for (const user of users) {
    await runQuery(
      `INSERT INTO portal_notifications (id, portal_user_id, type, title, body, link, company_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [genId('pnt'), user.id, type, title, body || null, link || null, companyId]
    );
  }
  broadcast('portal', 'notification', {
    companyId, customerId, type, title, body, link, actorName, createdAt: nowIso(),
  });
}

async function notifyAdmin({ companyId, type, title, body, link, customerId, customerName }) {
  await runQuery(
    `INSERT INTO admin_notifications (id, company_id, type, title, body, link, customer_id, customer_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [genId('ant'), companyId, type, title, body || null, link || null, customerId || null, customerName || null]
  );
  broadcast('admin', 'notification', {
    companyId, type, title, body, link, customerId, customerName, createdAt: nowIso(),
  });
}

async function sendEmailBestEffort({ to, subject, text }) {
  if (!to) return;
  try {
    await emailService.sendEmail({ to, subject, text, companyName: 'Prime ERP' });
  } catch (err) {
    console.warn('[Lifecycle] Email skipped (best-effort):', err.message);
  }
}

// Emits a data-changed event over the relevant SSE channel so connected clients
// refetch the affected document/entity immediately (no manual refresh needed).
function emitEntityChange(channel, payload) {
  broadcast(channel, 'entity_changed', payload);
}

// ─── Lifecycle state machine ─────────────────────────────────────────────────
function assertRequestTransition(request, toStatus) {
  const allowed = {
    [REQUEST_STATUS.SUBMITTED]: [REQUEST_STATUS.UNDER_REVIEW, REQUEST_STATUS.REJECTED, REQUEST_STATUS.CANCELLED],
    [REQUEST_STATUS.UNDER_REVIEW]: [REQUEST_STATUS.QUOTATION_READY, REQUEST_STATUS.REJECTED, REQUEST_STATUS.CANCELLED],
    [REQUEST_STATUS.QUOTATION_READY]: [],
    [REQUEST_STATUS.REJECTED]: [],
    [REQUEST_STATUS.CANCELLED]: [],
  };
  if (!(allowed[request.status] || []).includes(toStatus)) {
    throw new Error(`Invalid request transition: ${request.status} → ${toStatus}`);
  }
}

function assertQuotationTransition(quotation, toStatus) {
  const allowed = {
    [QUOTATION_STATUS.READY]: [QUOTATION_STATUS.ACCEPTED, QUOTATION_STATUS.REJECTED, QUOTATION_STATUS.REVISION_REQUESTED, QUOTATION_STATUS.CONVERTED],
    [QUOTATION_STATUS.REVISION_REQUESTED]: [QUOTATION_STATUS.READY, QUOTATION_STATUS.ACCEPTED, QUOTATION_STATUS.REJECTED, QUOTATION_STATUS.REVISION_REQUESTED],
    [QUOTATION_STATUS.ACCEPTED]: [QUOTATION_STATUS.CONVERTED],
    [QUOTATION_STATUS.REJECTED]: [],
    [QUOTATION_STATUS.CONVERTED]: [],
  };
  if (!(allowed[quotation.status] || []).includes(toStatus)) {
    throw new Error(`Invalid quotation transition: ${quotation.status} → ${toStatus}`);
  }
}

// ─── Customer: requests ──────────────────────────────────────────────────────
const portalLifecycleService = {

  REQUEST_STATUS,
  QUOTATION_STATUS,
  EVENT_TYPES,
  NOTIFICATION_TYPES,

  subscribePortal(req, res) { return subscribe('portal', res, req); },
  subscribeAdmin(req, res) { return subscribe('admin', res, req); },

  async createQuotationRequest({ portalUserId, customerId, customerName, companyId, requestType, items, notes, context = {} }) {
    const normalized = normalizeItems(items);
    if (normalized.length === 0) throw new Error('At least one line item is required');
    const requestTypeValue = requestType === 'order' ? 'order' : 'quotation';
    const { subtotal } = computeTotals(normalized);

    const id = genId('req');
    const requestNumber = await nextSequentialNumber('quotation_requests', 'request_number', 'REQ');
    await runQuery(
      `INSERT INTO quotation_requests
         (id, request_number, customer_id, customer_name, company_id, request_type, items, subtotal, notes, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, requestNumber, customerId, customerName, companyId, requestTypeValue,
        JSON.stringify(normalized), subtotal, notes || null, REQUEST_STATUS.SUBMITTED, portalUserId]
    );

    await addTimeline(companyId, customerId, 'request', id, EVENT_TYPES.REQUEST_SUBMITTED,
      'Request submitted', `${customerName} submitted a ${requestTypeValue} request (${requestNumber}).`,
      { type: 'customer', id: portalUserId, name: customerName },
      { requestNumber, itemCount: normalized.length, subtotal });

    await logAudit({
      actor: { id: portalUserId, name: customerName, role: 'portal_customer' },
      companyId,
      action: 'PORTAL_REQUEST_CREATE',
      entityType: 'quotation_request',
      entityId: id,
      details: `${requestNumber} created via customer portal`,
      newValue: { requestNumber, requestType: requestTypeValue, items: normalized, subtotal },
      context,
    });

    await notifyAdmin({
      companyId,
      type: NOTIFICATION_TYPES.REQUEST,
      title: 'New quotation request',
      body: `Customer: ${customerName} — Request: ${requestNumber} — Submitted just now.`,
      link: '#/sales-flow/requests',
      customerId,
      customerName,
    });

    emitEntityChange('portal', { companyId, customerId, docType: 'request', docId: id, status: REQUEST_STATUS.SUBMITTED, requestNumber });
    emitEntityChange('admin', { companyId, customerId, docType: 'request', docId: id, status: REQUEST_STATUS.SUBMITTED, requestNumber });

    return { id, requestNumber, status: REQUEST_STATUS.SUBMITTED, items: normalized, subtotal };
  },

  async getRequests({ customerId, companyId, status } = {}) {
    let query = `
      SELECT q.*, c.name AS resolved_customer_name
      FROM quotation_requests q
      LEFT JOIN customers c ON c.id = q.customer_id
      WHERE 1=1`;
    const params = [];
    if (customerId) { query += ' AND q.customer_id = ?'; params.push(customerId); }
    if (companyId) { query += ' AND q.company_id = ?'; params.push(companyId); }
    if (status) { query += ' AND q.status = ?'; params.push(status); }
    query += ' ORDER BY q.created_at DESC';
    const rows = await getAll(query, params);
    return rows.map((r) => ({
      ...r,
      customer_name: r.resolved_customer_name || r.customer_name,
      items: parseJson(r.items, []),
    }));
  },

  async getRequestById(id, { customerId, companyId } = {}) {
    const request = await getOne(
      `SELECT q.*, c.name AS resolved_customer_name
         FROM quotation_requests q
         LEFT JOIN customers c ON c.id = q.customer_id
        WHERE q.id = ?`,
      [id]
    );
    if (!request) return null;
    if (companyId && request.company_id !== companyId) return null;
    if (customerId && request.customer_id !== customerId) return null;
    request.customer_name = request.resolved_customer_name || request.customer_name;
    request.items = parseJson(request.items, []);
    return request;
  },

  async cancelRequest(id, { portalUserId, customerId, companyId, context = {} }) {
    const request = await this.getRequestById(id, { customerId, companyId });
    if (!request) throw new Error('Request not found');
    assertRequestTransition(request, REQUEST_STATUS.CANCELLED);

    await runQuery(
      `UPDATE quotation_requests SET status = ?, updated_at = ? WHERE id = ?`,
      [REQUEST_STATUS.CANCELLED, nowIso(), id]
    );

    await addTimeline(companyId, customerId, 'request', id, EVENT_TYPES.REQUEST_CANCELLED,
      'Request cancelled', `${request.customer_name} cancelled ${request.request_number}.`,
      { type: 'customer', id: portalUserId, name: request.customer_name });

    await logAudit({
      actor: { id: portalUserId, name: request.customer_name, role: 'portal_customer' },
      companyId, action: 'PORTAL_REQUEST_CANCEL', entityType: 'quotation_request', entityId: id,
      details: `${request.request_number} cancelled by customer`,
      oldValue: { status: request.status }, newValue: { status: REQUEST_STATUS.CANCELLED }, context,
    });

    await notifyAdmin({
      companyId, type: NOTIFICATION_TYPES.REQUEST, title: 'Quotation request cancelled',
      body: `Customer: ${request.customer_name} — Request: ${request.request_number} was cancelled.`,
      link: '#/sales-flow/requests', customerId, customerName: request.customer_name,
    });

    emitEntityChange('admin', { companyId, customerId, docType: 'request', docId: id, status: REQUEST_STATUS.CANCELLED });
    return { id, status: REQUEST_STATUS.CANCELLED };
  },

  // ─── Admin: review requests ────────────────────────────────────────────────
  async adminListRequests({ companyId, status } = {}) {
    return this.getRequests({ companyId, status });
  },

  async adminGetRequest(id, companyId) {
    return this.getRequestById(id, { companyId });
  },

  async updateRequest(id, { admin, companyId, items, notes, context = {} }) {
    const request = await this.adminGetRequest(id, companyId);
    if (!request) throw new Error('Request not found');
    if ([REQUEST_STATUS.QUOTATION_READY, REQUEST_STATUS.REJECTED, REQUEST_STATUS.CANCELLED].includes(request.status)) {
      throw new Error('Request can no longer be edited');
    }

    const normalized = items ? normalizeItems(items) : request.items;
    if (normalized.length === 0) throw new Error('At least one line item is required');
    const { subtotal } = computeTotals(normalized);

    const nextStatus = request.status === REQUEST_STATUS.SUBMITTED ? REQUEST_STATUS.UNDER_REVIEW : request.status;
    await runQuery(
      `UPDATE quotation_requests SET items = ?, subtotal = ?, notes = ?, status = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
       WHERE id = ?`,
      [JSON.stringify(normalized), subtotal, notes !== undefined ? notes : request.notes,
        nextStatus, admin.id, nowIso(), nowIso(), id]
    );

    if (nextStatus === REQUEST_STATUS.UNDER_REVIEW && request.status === REQUEST_STATUS.SUBMITTED) {
      await addTimeline(companyId, request.customer_id, 'request', id, EVENT_TYPES.REQUEST_REVIEWED,
        'Under review', `${admin.name || 'Sales'} started reviewing ${request.request_number}.`,
        { type: 'admin', id: admin.id, name: admin.name || 'Sales' });
      await logAudit({
        actor: { id: admin.id, name: admin.name || 'Sales', role: admin.role || 'admin' },
        companyId, action: 'PORTAL_REQUEST_REVIEW_START', entityType: 'quotation_request', entityId: id,
        details: `${request.request_number} moved to under review`, context,
      });
    } else {
      await logAudit({
        actor: { id: admin.id, name: admin.name || 'Sales', role: admin.role || 'admin' },
        companyId, action: 'PORTAL_REQUEST_EDIT', entityType: 'quotation_request', entityId: id,
        details: `${request.request_number} line items updated by sales`,
        oldValue: { items: request.items, subtotal: request.subtotal },
        newValue: { items: normalized, subtotal }, context,
      });
    }

    emitEntityChange('admin', { companyId, customerId: request.customer_id, docType: 'request', docId: id, status: nextStatus });
    return this.adminGetRequest(id, companyId);
  },

  async rejectRequest(id, { admin, companyId, reason, context = {} }) {
    const request = await this.adminGetRequest(id, companyId);
    if (!request) throw new Error('Request not found');
    assertRequestTransition(request, REQUEST_STATUS.REJECTED);

    await runQuery(
      `UPDATE quotation_requests SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
       WHERE id = ?`,
      [REQUEST_STATUS.REJECTED, reason || null, admin.id, nowIso(), nowIso(), id]
    );

    await addTimeline(companyId, request.customer_id, 'request', id, EVENT_TYPES.REQUEST_REJECTED,
      'Request rejected', `${admin.name || 'Sales'} rejected ${request.request_number}.`,
      { type: 'admin', id: admin.id, name: admin.name || 'Sales' },
      { reason: reason || '' });

    await logAudit({
      actor: { id: admin.id, name: admin.name || 'Sales', role: admin.role || 'admin' },
      companyId, action: 'PORTAL_REQUEST_REJECT', entityType: 'quotation_request', entityId: id,
      details: `${request.request_number} rejected${reason ? `: ${reason}` : ''}`,
      oldValue: { status: request.status }, newValue: { status: REQUEST_STATUS.REJECTED, reason }, context,
    });

    await notifyCustomer({
      companyId, customerId: request.customer_id, type: NOTIFICATION_TYPES.REQUEST,
      title: 'Your request was not approved',
      body: `${request.request_number} — ${reason || 'Please contact our sales team for more information.'}`,
      link: '#/portal/requests',
      actorName: admin.name || 'Sales',
    });

    emitEntityChange('portal', { companyId, customerId: request.customer_id, docType: 'request', docId: id, status: REQUEST_STATUS.REJECTED });
    return { id, status: REQUEST_STATUS.REJECTED };
  },

  async requestClarification(id, { admin, companyId, note, context = {} }) {
    const request = await this.adminGetRequest(id, companyId);
    if (!request) throw new Error('Request not found');
    if ([REQUEST_STATUS.QUOTATION_READY, REQUEST_STATUS.REJECTED, REQUEST_STATUS.CANCELLED].includes(request.status)) {
      throw new Error('Request can no longer be updated');
    }

    await runQuery(
      `UPDATE quotation_requests SET review_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
       WHERE id = ?`,
      [note || null, admin.id, nowIso(), nowIso(), id]
    );

    await addTimeline(companyId, request.customer_id, 'request', id, EVENT_TYPES.REQUEST_CLARIFICATION,
      'Clarification requested', `${admin.name || 'Sales'} asked for clarification on ${request.request_number}.`,
      { type: 'admin', id: admin.id, name: admin.name || 'Sales' },
      { note: note || '' });

    await logAudit({
      actor: { id: admin.id, name: admin.name || 'Sales', role: admin.role || 'admin' },
      companyId, action: 'PORTAL_REQUEST_CLARIFY', entityType: 'quotation_request', entityId: id,
      details: `Clarification requested for ${request.request_number}`, context,
    });

    await notifyCustomer({
      companyId, customerId: request.customer_id, type: NOTIFICATION_TYPES.REQUEST,
      title: 'We need more information',
      body: `Regarding ${request.request_number} — ${note || 'Please review your request and contact us.'}`,
      link: '#/portal/requests',
      actorName: admin.name || 'Sales',
    });

    emitEntityChange('portal', { companyId, customerId: request.customer_id, docType: 'request', docId: id, status: request.status });
    return { id, status: request.status };
  },

  // ─── Admin: generate official quotation ────────────────────────────────────
  async generateQuotation(requestId, { admin, companyId, items, discount, taxRate, deliveryFee, paymentTerms, validUntil, context = {} }) {
    const request = await this.adminGetRequest(requestId, companyId);
    if (!request) throw new Error('Request not found');
    if (request.status === REQUEST_STATUS.REJECTED || request.status === REQUEST_STATUS.CANCELLED) {
      throw new Error('Request is closed and cannot be converted');
    }
    if (request.quotation_id) throw new Error('A quotation has already been generated for this request');

    const normalized = normalizeItems(items);
    if (normalized.length === 0) throw new Error('At least one line item is required');
    const { subtotal, taxAmount, total } = computeTotals(normalized, discount, taxRate, deliveryFee);

    const id = genId('qt');
    const quotationNumber = await nextSequentialNumber('quotations', 'quotation_number', 'QT');

    await runQuery(
      `INSERT INTO quotations
         (id, quotation_number, request_id, customer_id, customer_name, company_id, items,
          subtotal, discount, tax_rate, tax_amount, delivery_fee, total, currency,
          payment_terms, valid_until, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MWK', ?, ?, ?, ?)`,
      [id, quotationNumber, requestId, request.customer_id, request.customer_name, companyId,
        JSON.stringify(normalized), subtotal, round2(discount), Number(taxRate) || 0, taxAmount,
        round2(deliveryFee), total, paymentTerms || 'Net 7', validUntil || null,
        QUOTATION_STATUS.READY, admin.id]
    );

    await runQuery(
      `UPDATE quotation_requests SET status = ?, quotation_id = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
       WHERE id = ?`,
      [REQUEST_STATUS.QUOTATION_READY, id, admin.id, nowIso(), nowIso(), requestId]
    );

    await addTimeline(companyId, request.customer_id, 'request', requestId, EVENT_TYPES.QUOTATION_GENERATED,
      'Quotation generated', `${quotationNumber} was generated from ${request.request_number}.`,
      { type: 'admin', id: admin.id, name: admin.name || 'Sales' },
      { quotationNumber, total });

    await addTimeline(companyId, request.customer_id, 'quotation', id, EVENT_TYPES.QUOTATION_GENERATED,
      'Quotation ready', `Official quotation ${quotationNumber} is ready for review.`,
      { type: 'system' }, { total });

    await addTimeline(companyId, request.customer_id, 'quotation', id, EVENT_TYPES.QUOTATION_GENERATED,
      'Customer notified', `Customer was notified that ${quotationNumber} is ready.`,
      { type: 'system' });

    await logAudit({
      actor: { id: admin.id, name: admin.name || 'Sales', role: admin.role || 'admin' },
      companyId, action: 'QUOTATION_GENERATE', entityType: 'quotation', entityId: id,
      details: `${quotationNumber} generated from request ${request.request_number}`,
      oldValue: { status: request.status },
      newValue: { status: QUOTATION_STATUS.READY, items: normalized, subtotal, taxAmount, total }, context,
    });

    const portalUsers = await getAll(
      'SELECT id, email FROM portal_users WHERE customer_id = ? AND company_id = ? AND status = ?',
      [request.customer_id, companyId, 'active']
    );
    await notifyCustomer({
      companyId, customerId: request.customer_id, type: NOTIFICATION_TYPES.QUOTATION,
      title: `Your quotation ${quotationNumber} is ready`,
      body: 'Your quotation is available for review. You can accept, reject or request changes.',
      link: `#/portal/quotations/${id}`,
      actorName: admin.name || 'Sales',
    });
    for (const user of portalUsers) {
      await sendEmailBestEffort({
        to: user.email,
        subject: `Your quotation ${quotationNumber} is ready for review`,
        text: `Dear ${request.customer_name},\n\nYour quotation ${quotationNumber} (total ${total}) is ready.\nSign in to the customer portal to preview, download or respond.\n\nPrime ERP`,
      });
    }

    emitEntityChange('portal', { companyId, customerId: request.customer_id, docType: 'quotation', docId: id, status: QUOTATION_STATUS.READY, quotationNumber });
    emitEntityChange('portal', { companyId, customerId: request.customer_id, docType: 'request', docId: requestId, status: REQUEST_STATUS.QUOTATION_READY });
    emitEntityChange('admin', { companyId, customerId: request.customer_id, docType: 'quotation', docId: id, status: QUOTATION_STATUS.READY, quotationNumber });

    return this.getQuotationById(id, { companyId });
  },

  // ─── Quotation reads ───────────────────────────────────────────────────────
  async getQuotations({ customerId, companyId, status } = {}) {
    let query = `
      SELECT q.*, c.name AS resolved_customer_name
      FROM quotations q
      LEFT JOIN customers c ON c.id = q.customer_id
      WHERE 1=1`;
    const params = [];
    if (customerId) { query += ' AND q.customer_id = ?'; params.push(customerId); }
    if (companyId) { query += ' AND q.company_id = ?'; params.push(companyId); }
    if (status) { query += ' AND q.status = ?'; params.push(status); }
    query += ' ORDER BY q.created_at DESC';
    const rows = await getAll(query, params);
    return rows.map((r) => ({
      ...r,
      customer_name: r.resolved_customer_name || r.customer_name,
      items: parseJson(r.items, []),
    }));
  },

  async getQuotationById(id, { customerId, companyId } = {}) {
    const quotation = await getOne(
      `SELECT q.*, c.name AS resolved_customer_name
         FROM quotations q
         LEFT JOIN customers c ON c.id = q.customer_id
        WHERE q.id = ?`,
      [id]
    );
    if (!quotation) return null;
    if (companyId && quotation.company_id !== companyId) return null;
    if (customerId && quotation.customer_id !== customerId) return null;
    quotation.customer_name = quotation.resolved_customer_name || quotation.customer_name;
    quotation.items = parseJson(quotation.items, []);
    return quotation;
  },

  // ─── Customer: quotation decisions ─────────────────────────────────────────
  async acceptQuotation(id, { portalUserId, customerId, companyId, context = {} }) {
    const quotation = await this.getQuotationById(id, { customerId, companyId });
    if (!quotation) throw new Error('Quotation not found');
    assertQuotationTransition(quotation, QUOTATION_STATUS.ACCEPTED);

    await runQuery(
      `UPDATE quotations SET status = ?, accepted_at = ?, updated_at = ? WHERE id = ?`,
      [QUOTATION_STATUS.ACCEPTED, nowIso(), nowIso(), id]
    );

    await addTimeline(companyId, customerId, 'quotation', id, EVENT_TYPES.QUOTATION_ACCEPTED,
      'Quotation accepted', `${quotation.customer_name} accepted ${quotation.quotation_number}.`,
      { type: 'customer', id: portalUserId, name: quotation.customer_name });

    await logAudit({
      actor: { id: portalUserId, name: quotation.customer_name, role: 'portal_customer' },
      companyId, action: 'QUOTATION_ACCEPT', entityType: 'quotation', entityId: id,
      details: `${quotation.quotation_number} accepted by customer`,
      oldValue: { status: quotation.status }, newValue: { status: QUOTATION_STATUS.ACCEPTED }, context,
    });

    await notifyAdmin({
      companyId, type: NOTIFICATION_TYPES.DECISION, title: 'Quotation accepted',
      body: `${quotation.customer_name} accepted ${quotation.quotation_number} (${quotation.total}).`,
      link: '#/sales-flow/requests', customerId, customerName: quotation.customer_name,
    });

    emitEntityChange('admin', { companyId, customerId, docType: 'quotation', docId: id, status: QUOTATION_STATUS.ACCEPTED, quotationNumber: quotation.quotation_number });
    return { id, status: QUOTATION_STATUS.ACCEPTED };
  },

  async rejectQuotation(id, { portalUserId, customerId, companyId, reason, context = {} }) {
    const quotation = await this.getQuotationById(id, { customerId, companyId });
    if (!quotation) throw new Error('Quotation not found');
    assertQuotationTransition(quotation, QUOTATION_STATUS.REJECTED);

    await runQuery(
      `UPDATE quotations SET status = ?, rejection_reason = ?, rejected_at = ?, updated_at = ? WHERE id = ?`,
      [QUOTATION_STATUS.REJECTED, reason || null, nowIso(), nowIso(), id]
    );

    await addTimeline(companyId, customerId, 'quotation', id, EVENT_TYPES.QUOTATION_REJECTED,
      'Quotation rejected', `${quotation.customer_name} rejected ${quotation.quotation_number}.`,
      { type: 'customer', id: portalUserId, name: quotation.customer_name },
      { reason: reason || '' });

    await logAudit({
      actor: { id: portalUserId, name: quotation.customer_name, role: 'portal_customer' },
      companyId, action: 'QUOTATION_REJECT', entityType: 'quotation', entityId: id,
      details: `${quotation.quotation_number} rejected${reason ? `: ${reason}` : ''}`,
      oldValue: { status: quotation.status }, newValue: { status: QUOTATION_STATUS.REJECTED, reason }, context,
    });

    await notifyAdmin({
      companyId, type: NOTIFICATION_TYPES.DECISION, title: 'Quotation rejected',
      body: `${quotation.customer_name} rejected ${quotation.quotation_number}${reason ? ` — ${reason}` : ''}.`,
      link: '#/sales-flow/requests', customerId, customerName: quotation.customer_name,
    });

    emitEntityChange('admin', { companyId, customerId, docType: 'quotation', docId: id, status: QUOTATION_STATUS.REJECTED, quotationNumber: quotation.quotation_number });
    return { id, status: QUOTATION_STATUS.REJECTED };
  },

  async requestRevision(id, { portalUserId, customerId, companyId, comments, context = {} }) {
    const quotation = await this.getQuotationById(id, { customerId, companyId });
    if (!quotation) throw new Error('Quotation not found');
    assertQuotationTransition(quotation, QUOTATION_STATUS.REVISION_REQUESTED);

    await runQuery(
      `UPDATE quotations SET status = ?, revision_note = ?, revision_requested_at = ?, updated_at = ? WHERE id = ?`,
      [QUOTATION_STATUS.REVISION_REQUESTED, comments || null, nowIso(), nowIso(), id]
    );

    await addTimeline(companyId, customerId, 'quotation', id, EVENT_TYPES.REVISION_REQUESTED,
      'Revision requested', `${quotation.customer_name} requested changes to ${quotation.quotation_number}.`,
      { type: 'customer', id: portalUserId, name: quotation.customer_name },
      { comments: comments || '' });

    await logAudit({
      actor: { id: portalUserId, name: quotation.customer_name, role: 'portal_customer' },
      companyId, action: 'QUOTATION_REVISION_REQUEST', entityType: 'quotation', entityId: id,
      details: `Revision requested for ${quotation.quotation_number}${comments ? `: ${comments}` : ''}`,
      oldValue: { status: quotation.status }, newValue: { status: QUOTATION_STATUS.REVISION_REQUESTED, comments }, context,
    });

    await notifyAdmin({
      companyId, type: NOTIFICATION_TYPES.DECISION, title: 'Revision requested',
      body: `${quotation.customer_name} requested changes to ${quotation.quotation_number}${comments ? ` — ${comments}` : ''}.`,
      link: '#/sales-flow/requests', customerId, customerName: quotation.customer_name,
    });

    emitEntityChange('admin', { companyId, customerId, docType: 'quotation', docId: id, status: QUOTATION_STATUS.REVISION_REQUESTED, quotationNumber: quotation.quotation_number });
    return { id, status: QUOTATION_STATUS.REVISION_REQUESTED };
  },

  async regenerateQuotation(id, { admin, companyId, items, discount, taxRate, deliveryFee, paymentTerms, validUntil, context = {} }) {
    const quotation = await this.getQuotationById(id, { companyId });
    if (!quotation) throw new Error('Quotation not found');
    if (quotation.status !== QUOTATION_STATUS.REVISION_REQUESTED) {
      throw new Error('Only quotation revisions can be regenerated');
    }

    const normalized = normalizeItems(items);
    if (normalized.length === 0) throw new Error('At least one line item is required');
    const { subtotal, taxAmount, total } = computeTotals(normalized, discount, taxRate, deliveryFee);

    await runQuery(
      `UPDATE quotations SET items = ?, subtotal = ?, discount = ?, tax_rate = ?, tax_amount = ?,
         delivery_fee = ?, total = ?, payment_terms = ?, valid_until = ?, status = ?, revision_note = NULL,
         updated_at = ?
       WHERE id = ?`,
      [JSON.stringify(normalized), subtotal, round2(discount), Number(taxRate) || 0, taxAmount,
        round2(deliveryFee), total, paymentTerms || quotation.payment_terms || 'Net 7',
        validUntil || quotation.valid_until, QUOTATION_STATUS.READY, nowIso(), id]
    );

    await addTimeline(companyId, quotation.customer_id, 'quotation', id, EVENT_TYPES.REVISION_REGENERATED,
      'Quotation updated', `${admin.name || 'Sales'} updated ${quotation.quotation_number} and sent it back for review.`,
      { type: 'admin', id: admin.id, name: admin.name || 'Sales' }, { total });

    await logAudit({
      actor: { id: admin.id, name: admin.name || 'Sales', role: admin.role || 'admin' },
      companyId, action: 'QUOTATION_REGENERATE', entityType: 'quotation', entityId: id,
      details: `${quotation.quotation_number} regenerated after revision request`,
      oldValue: { status: quotation.status, total: quotation.total },
      newValue: { status: QUOTATION_STATUS.READY, items: normalized, total }, context,
    });

    await notifyCustomer({
      companyId, customerId: quotation.customer_id, type: NOTIFICATION_TYPES.QUOTATION,
      title: `Updated quotation ${quotation.quotation_number}`,
      body: 'Your revised quotation is ready for review.',
      link: `#/portal/quotations/${id}`, actorName: admin.name || 'Sales',
    });

    emitEntityChange('portal', { companyId, customerId: quotation.customer_id, docType: 'quotation', docId: id, status: QUOTATION_STATUS.READY });
    return this.getQuotationById(id, { companyId });
  },

  // ─── Admin: convert to official sales order ────────────────────────────────
  async convertToOrder(id, { admin, companyId, deliveryDate, notes, context = {} }) {
    const quotation = await this.getQuotationById(id, { companyId });
    if (!quotation) throw new Error('Quotation not found');
    if (quotation.status !== QUOTATION_STATUS.ACCEPTED && quotation.status !== QUOTATION_STATUS.READY) {
      throw new Error('Quotation must be accepted before converting to an order');
    }

    const orderId = genId('so');
    const orderNumber = await nextSequentialNumber('sales_orders', 'id', 'SO');
    const itemsJson = JSON.stringify(
      quotation.items.map((item) => ({
        id: item.productId || genId('itm'),
        productId: item.productId || null,
        description: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      }))
    );
    const now = nowIso();

    await runQuery(
      `INSERT INTO sales_orders
         (id, quotation_id, customer_id, orderDate, deliveryDate, status, items,
          subtotal, discounts, tax, other_charges, total, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, id, quotation.customer_id, now, deliveryDate || null,
        'Confirmed', itemsJson, quotation.subtotal, quotation.discount, quotation.tax_amount,
        quotation.delivery_fee, quotation.total, notes || `Converted from ${quotation.quotation_number}`,
        admin.id, now, now]
    );

    await runQuery(
      `UPDATE quotations SET status = ?, order_id = ?, converted_at = ?, updated_at = ? WHERE id = ?`,
      [QUOTATION_STATUS.CONVERTED, orderId, nowIso(), nowIso(), id]
    );

    await addTimeline(companyId, quotation.customer_id, 'quotation', id, EVENT_TYPES.ORDER_CONVERTED,
      'Converted to sales order', `${quotation.quotation_number} was converted to sales order ${orderNumber}.`,
      { type: 'admin', id: admin.id, name: admin.name || 'Sales' }, { orderNumber });

    await addTimeline(companyId, quotation.customer_id, 'order', orderId, EVENT_TYPES.ORDER_CONVERTED,
      'Order confirmed', `Sales order ${orderNumber} created from ${quotation.quotation_number}.`,
      { type: 'system' }, { quotationNumber: quotation.quotation_number, total: quotation.total });

    await logAudit({
      actor: { id: admin.id, name: admin.name || 'Sales', role: admin.role || 'admin' },
      companyId, action: 'SALES_ORDER_CONVERT', entityType: 'sales_order', entityId: orderId,
      details: `${orderNumber} created from quotation ${quotation.quotation_number}`,
      oldValue: { status: quotation.status },
      newValue: { status: QUOTATION_STATUS.CONVERTED, orderId, orderNumber }, context,
    });

    const portalUsers = await getAll(
      'SELECT id, email FROM portal_users WHERE customer_id = ? AND company_id = ? AND status = ?',
      [quotation.customer_id, companyId, 'active']
    );
    await notifyCustomer({
      companyId, customerId: quotation.customer_id, type: NOTIFICATION_TYPES.ORDER,
      title: `Your order ${orderNumber} is confirmed`,
      body: `Your order from ${quotation.quotation_number} has been confirmed.`,
      link: `#/portal/orders/${orderId}`,
      actorName: admin.name || 'Sales',
    });
    for (const user of portalUsers) {
      await sendEmailBestEffort({
        to: user.email,
        subject: `Your order ${orderNumber} is confirmed`,
        text: `Dear ${quotation.customer_name},\n\nYour order ${orderNumber} (total ${quotation.total}) has been confirmed.\nTrack it from the customer portal.\n\nPrime ERP`,
      });
    }

    emitEntityChange('portal', { companyId, customerId: quotation.customer_id, docType: 'order', docId: orderId, status: 'Confirmed', orderNumber });
    emitEntityChange('admin', { companyId, customerId: quotation.customer_id, docType: 'quotation', docId: id, status: QUOTATION_STATUS.CONVERTED });
    emitEntityChange('admin', { companyId, customerId: quotation.customer_id, docType: 'order', docId: orderId, status: 'Confirmed' });

    return { id: orderId, orderNumber, status: 'Confirmed' };
  },

  // ─── Downloads (gated + audited) ───────────────────────────────────────────
  async recordDownload({ docType, docId, portalUserId, customerId, companyId, context = {} }) {
    let doc = null;
    let docNumber = null;
    let allowed = false;

    if (docType === 'quotation') {
      doc = await this.getQuotationById(docId, { customerId, companyId });
      if (!doc) throw new Error('Quotation not found');
      allowed = [QUOTATION_STATUS.READY, QUOTATION_STATUS.ACCEPTED, QUOTATION_STATUS.REVISION_REQUESTED, QUOTATION_STATUS.CONVERTED].includes(doc.status);
      docNumber = doc.quotation_number;
    } else if (docType === 'order') {
      doc = await getOne(
        'SELECT * FROM sales_orders WHERE id = ? AND customer_id = ? AND company_id = ?',
        [docId, customerId, companyId]
      );
      if (!doc) throw new Error('Order not found');
      allowed = !['Draft', 'Cancelled'].includes(String(doc.status || ''));
      docNumber = doc.id;
    } else {
      throw new Error('Unsupported document type');
    }

    if (!allowed) throw new Error('This document is not available for download yet');

    const id = genId('pdl');
    await runQuery(
      `INSERT INTO portal_downloads
         (id, company_id, customer_id, portal_user_id, doc_type, doc_id, doc_number, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, companyId, customerId, portalUserId, docType, docId, docNumber,
        context.ip || null, context.userAgent ? String(context.userAgent).slice(0, 500) : null]
    );

    const title = docType === 'quotation' ? `Quotation ${docNumber} downloaded` : `Order ${docNumber} downloaded`;
    await addTimeline(companyId, customerId, docType, docId, EVENT_TYPES.QUOTATION_DOWNLOADED,
      'Document downloaded', `${doc.customer_name || 'Customer'} ${title}.`,
      { type: 'customer', id: portalUserId, name: doc.customer_name || 'Customer' },
      { docType, docNumber });

    await logAudit({
      actor: { id: portalUserId, name: doc.customer_name || 'Customer', role: 'portal_customer' },
      companyId, action: 'DOCUMENT_DOWNLOAD', entityType: docType, entityId: docId,
      details: `${title} downloaded by ${doc.customer_name || 'customer'}`,
      newValue: { docType, docNumber }, context,
    });

    await notifyAdmin({
      companyId, type: NOTIFICATION_TYPES.DOWNLOAD, title: 'Document downloaded',
      body: `${doc.customer_name || 'Customer'} downloaded ${docType} ${docNumber}.`,
      link: '#/sales-flow/requests', customerId, customerName: doc.customer_name || 'Customer',
    });

    emitEntityChange('admin', { companyId, customerId, docType, docId, event: 'download' });
    return { allowed: true, docType, docId, docNumber, downloadId: id };
  },

  // ─── Timeline (merged customer + admin chronological history) ──────────────
  async getTimeline({ docType, docId, companyId, customerId } = {}) {
    let query = 'SELECT * FROM portal_timeline_events WHERE doc_type = ? AND doc_id = ?';
    const params = [docType, docId];
    if (companyId) { query += ' AND company_id = ?'; params.push(companyId); }
    if (customerId) { query += ' AND customer_id = ?'; params.push(customerId); }
    query += ' ORDER BY created_at ASC';
    return getAll(query, params);
  },

  // ─── Admin notifications ───────────────────────────────────────────────────
  async getAdminNotifications(companyId, { limit = 50 } = {}) {
    return getAll(
      'SELECT * FROM admin_notifications WHERE company_id = ? ORDER BY created_at DESC LIMIT ?',
      [companyId, limit]
    );
  },

  async getAdminUnreadCount(companyId) {
    const row = await getOne(
      'SELECT COUNT(*) as count FROM admin_notifications WHERE company_id = ? AND is_read = 0',
      [companyId]
    );
    return (row && row.count) || 0;
  },

  async markAdminNotificationRead(id, companyId) {
    await runQuery(
      'UPDATE admin_notifications SET is_read = 1 WHERE id = ? AND company_id = ?',
      [id, companyId]
    );
  },

  async markAllAdminNotificationsRead(companyId) {
    await runQuery(
      'UPDATE admin_notifications SET is_read = 1 WHERE company_id = ?',
      [companyId]
    );
  },

  // ─── Admin activity feed (customer actions merged into one stream) ─────────
  async getActivity(companyId, { limit = 25 } = {}) {
    const timeline = await getAll(
      `SELECT 'timeline' as source, id, created_at, doc_type, doc_id, event_type, title, description, actor_type, actor_name, customer_id
       FROM portal_timeline_events WHERE company_id = ?
       ORDER BY created_at DESC LIMIT ?`,
      [companyId, limit]
    );
    const downloads = await getAll(
      `SELECT 'download' as source, id, created_at, doc_type, doc_id, doc_number, customer_id,
              '' as event_type, doc_number as title, '' as description, 'customer' as actor_type, '' as actor_name
       FROM portal_downloads WHERE company_id = ?
       ORDER BY created_at DESC LIMIT ?`,
      [companyId, limit]
    );
    return [...timeline, ...downloads]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  },

  // ─── Analytics (derived from audit-grade tables) ───────────────────────────
  async getAnalytics(companyId) {
    const requests = await getAll(
      'SELECT status, COUNT(*) as count FROM quotation_requests WHERE company_id = ? GROUP BY status',
      [companyId]
    );
    const requestTotals = {};
    for (const row of requests) requestTotals[row.status] = row.count;
    const totalRequests = Object.values(requestTotals).reduce((a, b) => a + b, 0);

    const reviewTimes = await getAll(
      `SELECT (julianday(reviewed_at) - julianday(created_at)) * 24 * 60 as minutes
       FROM quotation_requests WHERE company_id = ? AND reviewed_at IS NOT NULL`,
      [companyId]
    );
    const avgReviewMinutes = reviewTimes.length
      ? Math.round(reviewTimes.reduce((sum, r) => sum + (r.minutes || 0), 0) / reviewTimes.length)
      : 0;

    const quotations = await getAll(
      'SELECT status, COUNT(*) as count FROM quotations WHERE company_id = ? GROUP BY status',
      [companyId]
    );
    const quotationTotals = {};
    for (const row of quotations) quotationTotals[row.status] = row.count;
    const totalQuotations = Object.values(quotationTotals).reduce((a, b) => a + b, 0);

    const downloads = await getAll(
      'SELECT doc_type, COUNT(*) as count FROM portal_downloads WHERE company_id = ? GROUP BY doc_type',
      [companyId]
    );
    const downloadTotals = {};
    for (const row of downloads) downloadTotals[row.doc_type] = row.count;
    const totalDownloads = Object.values(downloadTotals).reduce((a, b) => a + b, 0);

    const uniqueDownloadDocs = await getOne(
      'SELECT COUNT(DISTINCT doc_id) as count FROM portal_downloads WHERE company_id = ?',
      [companyId]
    );

    const acceptedCount = (quotationTotals.accepted || 0) + (quotationTotals.converted || 0);
    return {
      requests: requestTotals,
      totalRequests,
      avgReviewMinutes,
      quotations: quotationTotals,
      totalQuotations,
      acceptedQuotations: acceptedCount,
      convertedQuotations: quotationTotals.converted || 0,
      acceptanceRate: totalQuotations ? Math.round((acceptedCount / totalQuotations) * 100) : 0,
      conversionRate: totalQuotations ? Math.round(((quotationTotals.converted || 0) / totalQuotations) * 100) : 0,
      downloads: downloadTotals,
      totalDownloads,
      uniqueDownloads: (uniqueDownloadDocs && uniqueDownloadDocs.count) || 0,
    };
  },

};

module.exports = portalLifecycleService;
