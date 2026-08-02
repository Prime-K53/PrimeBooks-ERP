/**
 * Workflow Engine
 *
 * Central registry for the sales document chain and its lifecycle rules:
 *   Request → Quotation → Sales Order → (Invoice → Receipt — later phases)
 *
 * This module is intentionally dependency-light (db only) so both
 * portalLifecycleService and portalService can consume it without circular
 * requires. All status transitions, document numbering and chain navigation
 * rules live here — components must never duplicate this logic.
 *
 * Domain docTypes (portal realm):
 *   'request'      → quotation_requests
 *   'quotation'    → quotations
 *   'order'        → sales_orders
 */

const { db } = require('../db.cjs');
const crypto = require('crypto');

// ─── Centralized status enums ────────────────────────────────────────────────
const SALES_ORDER_STATUS = Object.freeze({
  DRAFT: 'Draft',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  PENDING: 'Pending',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  FULFILLED: 'Fulfilled',
  CANCELLED: 'Cancelled',
});

// Request numbering prefixes per request type. Quotation requests use QTR,
// order requests use ODR — sequences are fully independent and year-scoped.
const REQUEST_NUMBER_PREFIXES = Object.freeze({
  quotation: 'QTR',
  order: 'ODR',
});

function requestNumberPrefix(requestType) {
  return requestType === 'order' ? REQUEST_NUMBER_PREFIXES.order : REQUEST_NUMBER_PREFIXES.quotation;
}

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
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

// Year-scoped sequence (QTR-2026-000001 / ODR-2026-000001 / SO-2026-000125).
// Each calendar year restarts at 000001. Request numbers never consume
// official document numbers — the sequences are fully independent.
async function nextYearScopedNumber(table, column, prefix) {
  const year = new Date().getFullYear();
  const rows = await getAll(`SELECT ${column} FROM ${table} WHERE ${column} LIKE ?`, [`${prefix}-${year}-%`]);
  let maxSeq = 0;
  for (const row of rows) {
    const suffix = String(row[column] || '').slice(prefix.length + 1 + String(year).length + 1);
    const num = parseInt(suffix, 10);
    if (Number.isFinite(num) && num > maxSeq) maxSeq = num;
  }
  return `${prefix}-${year}-${String(maxSeq + 1).padStart(6, '0')}`;
}

// ─── Sales order state machine ───────────────────────────────────────────────
function assertSalesOrderTransition(order, toStatus) {
  const allowed = {
    [SALES_ORDER_STATUS.DRAFT]: [SALES_ORDER_STATUS.CONFIRMED, SALES_ORDER_STATUS.CANCELLED],
    [SALES_ORDER_STATUS.CONFIRMED]: [SALES_ORDER_STATUS.PROCESSING, SALES_ORDER_STATUS.PENDING, SALES_ORDER_STATUS.SHIPPED, SALES_ORDER_STATUS.DELIVERED, SALES_ORDER_STATUS.FULFILLED, SALES_ORDER_STATUS.CANCELLED],
    [SALES_ORDER_STATUS.PROCESSING]: [SALES_ORDER_STATUS.SHIPPED, SALES_ORDER_STATUS.DELIVERED, SALES_ORDER_STATUS.FULFILLED, SALES_ORDER_STATUS.CANCELLED],
    [SALES_ORDER_STATUS.PENDING]: [SALES_ORDER_STATUS.CONFIRMED, SALES_ORDER_STATUS.PROCESSING, SALES_ORDER_STATUS.CANCELLED],
    [SALES_ORDER_STATUS.SHIPPED]: [SALES_ORDER_STATUS.DELIVERED, SALES_ORDER_STATUS.FULFILLED],
    [SALES_ORDER_STATUS.DELIVERED]: [SALES_ORDER_STATUS.FULFILLED],
    [SALES_ORDER_STATUS.FULFILLED]: [],
    [SALES_ORDER_STATUS.CANCELLED]: [],
  };
  if (!(allowed[String(order.status || '')] || []).includes(toStatus)) {
    throw new Error(`Invalid sales order transition: ${order.status} → ${toStatus}`);
  }
}

// ─── Document versioning ─────────────────────────────────────────────────────
// Immutable point-in-time snapshots per document (Phase 3). The entity-generic
// shape (doc_type + doc_id + version) means any document kind — quotations now,
// artwork files in later phases — records history without schema changes.
function genId(prefix = 'dv') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

async function createVersionSnapshot({ customerId, docType, docId, version, snapshot, reason, actor = {} }) {
  if (!docType || !docId || !version) throw new Error('docType, docId and version are required');
  return runQuery(
    `INSERT INTO document_versions
       (id, customer_id, doc_type, doc_id, version, snapshot, reason, created_by, created_by_name)
     VALUES (? , ?, ?, ?, ?, ?, ?, ?, ?)`,
    [genId('dv'), customerId || null, docType, docId, version, typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot), reason || null, actor.id || null, actor.name || null]
  );
}

async function listDocumentVersions(docType, docId, {} = {}) {
  let q = `SELECT id, version, snapshot, reason, created_by, created_by_name, created_at
             FROM document_versions WHERE doc_type = ? AND doc_id = ?`;
  const params = [docType, docId];
  
  q += ' ORDER BY version ASC';
  const rows = await getAll(q, params);
  return rows.map((r) => ({ ...r, snapshot: parseJson(r.snapshot, {}) }));
}

async function getDocumentVersion(docType, docId, version, {} = {}) {
  let q = `SELECT id, version, snapshot, reason, created_by, created_by_name, created_at
             FROM document_versions WHERE doc_type = ? AND doc_id = ? AND version = ?`;
  const params = [docType, docId, version];
  
  const row = await getOne(q, params);
  if (!row) return null;
  return { ...row, snapshot: parseJson(row.snapshot, {}) };
}

// ─── Document chain navigation ───────────────────────────────────────────────
// Resolves the full document chain (request → quotation → sales order) for a
// given document. Works starting from ANY point in the chain; also follows
// reorder links so a reorder request surfaces its original order.
async function getDocumentChain({ docType, docId, customerId } = {}) {
  if (!docType || !docId) throw new Error('docType and docId are required');

  const collected = { request: null, quotation: null, order: null, originOrder: null };

  const loadRequest = async (id) => {
    if (!id || collected.request) return collected.request;
    let q = 'SELECT id, request_number, request_type, status, customer_id, quotation_id, sales_order_id, sales_order_number, reorder_of, reorder_of_number, created_at FROM quotation_requests WHERE id = ?';
    const params = [id];
    
    if (customerId) { q += ' AND customer_id = ?'; params.push(customerId); }
    const row = await getOne(q, params);
    if (row) collected.request = row;
    return row;
  };

  const loadQuotation = async (id) => {
    if (!id || collected.quotation) return collected.quotation;
    let q = 'SELECT id, quotation_number, status, customer_id, request_id, order_id, created_at FROM quotations WHERE id = ?';
    const params = [id];
    
    if (customerId) { q += ' AND customer_id = ?'; params.push(customerId); }
    const row = await getOne(q, params);
    if (row) collected.quotation = row;
    return row;
  };

  const loadOrder = async (id) => {
    if (!id || collected.order) return collected.order;
    let q = 'SELECT id, order_number, status, customer_id, quotation_id, source_request_id, source_request_number, reorder_of, reorder_of_number, created_at FROM sales_orders WHERE id = ?';
    const params = [id];
    
    if (customerId) { q += ' AND customer_id = ?'; params.push(customerId); }
    const row = await getOne(q, params);
    if (row) collected.order = row;
    return row;
  };

  // Seed the chain from whichever document was requested
  if (docType === 'request') {
    const request = await loadRequest(docId);
    if (!request) throw new Error('Request not found');
    if (request.quotation_id) await loadQuotation(request.quotation_id);
    if (request.sales_order_id) {
      await loadOrder(request.sales_order_id);
    } else if (collected.quotation && collected.quotation.order_id) {
      await loadOrder(collected.quotation.order_id);
    } else {
      const bySource = await getAll(
        'SELECT id FROM sales_orders WHERE source_request_id = ? ORDER BY created_at DESC LIMIT 1',
        [request.id]
      );
      if (bySource[0]) await loadOrder(bySource[0].id);
    }
    if (request.reorder_of) {
      collected.originOrder = await loadOrder(request.reorder_of);
    }
  } else if (docType === 'quotation') {
    const quotation = await loadQuotation(docId);
    if (!quotation) throw new Error('Quotation not found');
    if (quotation.request_id) await loadRequest(quotation.request_id);
    if (quotation.order_id) {
      await loadOrder(quotation.order_id);
    } else if (collected.request && collected.request.sales_order_id) {
      await loadOrder(collected.request.sales_order_id);
    }
  } else if (docType === 'order') {
    const order = await loadOrder(docId);
    if (!order) throw new Error('Order not found');
    if (order.source_request_id) {
      const request = await loadRequest(order.source_request_id);
      if (request && request.quotation_id) await loadQuotation(request.quotation_id);
    } else if (order.quotation_id) {
      const quotation = await loadQuotation(order.quotation_id);
      if (quotation && quotation.request_id) await loadRequest(quotation.request_id);
    }
    if (order.reorder_of) {
      collected.originOrder = await loadOrder(order.reorder_of);
    }
  } else {
    throw new Error('Unsupported document type');
  }

  const entry = (docTypeValue, row) => {
    if (!row) return null;
    const docNumber = docTypeValue === 'request'
      ? row.request_number
      : docTypeValue === 'quotation'
        ? row.quotation_number
        : row.order_number || row.id;
    return {
      docType: docTypeValue,
      docId: row.id,
      docNumber,
      status: row.status,
      title: docTypeValue === 'request'
        ? `${row.request_type === 'order' ? 'Order' : 'Quotation'} Request`
        : docTypeValue === 'quotation'
          ? 'Quotation'
          : 'Sales Order',
      createdAt: row.created_at,
    };
  };

  const chain = [
    entry('request', collected.request),
    entry('quotation', collected.quotation),
    entry('order', collected.order),
  ].filter(Boolean).sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

  return {
    chain,
    originOrder: entry('order', collected.originOrder),
    request: collected.request,
    quotation: collected.quotation,
    order: collected.order,
  };
}

// Parse a sales_orders.items JSON row into the portal line-item shape
function parseOrderItems(itemsJson) {
  return (parseJson(itemsJson, []) || []).map((item) => ({
    productId: item.productId || item.product_id || null,
    name: item.name || item.description || item.productName || 'Item',
    quantity: Number(item.quantity ?? 1),
    unitPrice: Number(item.unitPrice ?? item.unit_price ?? item.price ?? 0),
    lineTotal: Number(item.lineTotal ?? item.line_total ?? 0),
  }));
}

module.exports = {
  SALES_ORDER_STATUS,
  REQUEST_NUMBER_PREFIXES,
  requestNumberPrefix,
  nextYearScopedNumber,
  assertSalesOrderTransition,
  getDocumentChain,
  parseOrderItems,
  createVersionSnapshot,
  listDocumentVersions,
  getDocumentVersion,
};
