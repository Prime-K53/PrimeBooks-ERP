/**
 * cloudSyncStore.cjs — server-side Supabase write client for the ERP sync
 * gateway (`POST /api/sync/ops`).
 *
 * The ERP is offline-first: the sync queue runs on the browser and the
 * backend is the single gateway that validates operations and writes them
 * to the cloud database. This module does those cloud writes with the
 * service-role key (bypassing RLS) so business data lands in Postgres
 * regardless of the calling user's row-level visibility.
 *
 * It deliberately mirrors the write shape used by the legacy direct client
 * (`frontend/services/cloudDb.ts`): rows are stored as `{ id, data, updated_at }`
 * with an optional numeric `version`, and deletes are soft-deletes via a
 * tombstone (`data.deleted = true` + `data.deletedAt`).
 */
const axios = require('axios');

const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY || '';

const isConfigured = () => Boolean(
  SUPABASE_URL
  && SECRET_KEY
  && !SUPABASE_URL.includes('placeholder')
  && !SECRET_KEY.includes('placeholder')
);

function adminHeaders() {
  return {
    apikey: SECRET_KEY,
    Authorization: `Bearer ${SECRET_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

// ─── uuid5 (deterministic id for idempotency keys) ─────────────────────────
const NAMESPACE = Buffer.from('d6a7e280-8c0e-4a7e-9b1a-1e5f2c3d4a5b', 'utf8');

function stringToUuid5(input) {
  const { createHash } = require('crypto');
  const hash = createHash('sha1').update(NAMESPACE).update(String(input || ''), 'utf8').digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ─── idempotency ────────────────────────────────────────────────────────────
let idempotencyTableReady = null;

async function ensureIdempotencyTable() {
  if (idempotencyTableReady !== null) return idempotencyTableReady;
  try {
    const res = await axios.get(`${SUPABASE_URL}/rest/v1/idempotency_keys`, {
      headers: { apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}` },
      params: { select: 'id', limit: 0 },
      timeout: 8000,
    });
    idempotencyTableReady = Array.isArray(res.data);
  } catch {
    idempotencyTableReady = false;
  }
  return idempotencyTableReady;
}

async function checkIdempotency(operationId) {
  if (!operationId || !(await ensureIdempotencyTable())) {
    return { alreadyProcessed: false };
  }
  try {
    const uuid = stringToUuid5(operationId);
    const res = await axios.get(`${SUPABASE_URL}/rest/v1/idempotency_keys`, {
      headers: { apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}` },
      params: { select: 'id,result', id: `eq.${uuid}`, limit: 1 },
      timeout: 8000,
    });
    const row = Array.isArray(res.data) ? res.data[0] : null;
    return row
      ? { alreadyProcessed: true, result: row.result || null }
      : { alreadyProcessed: false };
  } catch {
    return { alreadyProcessed: false };
  }
}

async function recordIdempotency(operationId, result) {
  if (!operationId || !(await ensureIdempotencyTable())) return;
  try {
    const uuid = stringToUuid5(operationId);
    await axios.post(`${SUPABASE_URL}/rest/v1/idempotency_keys`, {
      id: uuid,
      result: result || null,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }, {
      headers: { ...adminHeaders(), Prefer: 'resolution=merge-duplicates' },
      timeout: 8000,
    });
  } catch {
    // best-effort
  }
}

// ─── row helpers ────────────────────────────────────────────────────────────
async function getRow(table, id) {
  const res = await axios.get(`${SUPABASE_URL}/rest/v1/${table}`, {
    headers: { apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}` },
    params: { select: '*', id: `eq.${id}`, limit: 1 },
    timeout: 15000,
  });
  return Array.isArray(res.data) ? (res.data[0] || null) : null;
}

function sanitizeRecord(payload) {
  const raw = { ...(payload && typeof payload === 'object' ? payload : {}) };
  delete raw._updatedAt;
  delete raw._cloudSource;
  delete raw._operationId;
  delete raw._version;
  delete raw.dependsOn;
  delete raw.deletedAt; // computed server-side for tombstones only
  return raw;
}

/**
 * Upsert a row: `{ id, data: <domain fields>, updated_at }`.
 * Optional numeric `version` enables optimistic-lock protection.
 */
async function upsertRow(table, id, payload, serverNow = new Date().toISOString()) {
  const domain = sanitizeRecord(payload);
  const version = Number(payload._version ?? payload.version);
  const row = {
    id,
    data: domain,
    updated_at: serverNow,
  };
  if (Number.isFinite(version)) row.version = version;

  const headers = { ...adminHeaders(), Prefer: 'resolution=merge-duplicates,return=representation' };
  const params = { on_conflict: 'id' };
  if (Number.isFinite(version)) {
    // Optimistic lock: only apply if the stored version matches. Without it,
    // a stale client could overwrite a newer row — this keeps last-write-wins
    // deterministic for the sync engine (which retries on 409).
    params.version = `eq.${version}`;
  }

  const res = await axios.post(`${SUPABASE_URL}/rest/v1/${table}`, row, { headers, params, timeout: 20000 });

  const saved = Array.isArray(res.data) ? (res.data[0] || null) : res.data;
  return {
    id: saved?.id || id,
    updatedAt: saved?.updated_at || serverNow,
    createdAt: saved?.created_at || null,
    version: saved?.version != null ? Number(saved.version) : undefined,
  };
}

/**
 * Soft-delete a row by writing a tombstone into `data`. The physical row is
 * kept so realtime subscribers on other devices observe the deletion as an
 * UPDATE and can reconcile their local caches.
 */
async function softDeleteRow(table, id, serverNow = new Date().toISOString()) {
  const existing = await getRow(table, id);
  const base = existing && existing.data && typeof existing.data === 'object' ? existing.data : {};

  const row = {
    id,
    data: { ...base, deleted: true, deletedAt: serverNow, ...(existing?.data ? {} : {}) },
    updated_at: serverNow,
  };
  if (existing && existing.version != null) row.version = Number(existing.version);

  const res = await axios.post(`${SUPABASE_URL}/rest/v1/${table}`, row, {
    headers: { ...adminHeaders(), Prefer: 'resolution=merge-duplicates,return=representation' },
    params: { on_conflict: 'id' },
    timeout: 20000,
  });

  const saved = Array.isArray(res.data) ? (res.data[0] || null) : res.data;
  return {
    id: saved?.id || id,
    updatedAt: saved?.updated_at || serverNow,
    deleted: true,
  };
}

/**
 * Apply one operation. Returns a normalized result object used by the route:
 *   { operationId, ok, id, updatedAt, error, retryable }
 * Errors produced by the cloud (validation, schema, RLS, uniqueness) are
 * marked `retryable:false` so the client moves the op to its dead-letter
 * queue instead of retrying forever. Network/5xx are retryable.
 */
async function applyOp(op) {
  const { operationId, table, recordId, operation, payload } = op || {};
  if (!table || typeof table !== 'string') {
    return { operationId, ok: false, error: 'table is required', retryable: false };
  }
  if (!['upsert', 'delete'].includes(operation)) {
    return { operationId, ok: false, error: `unsupported operation: ${operation}`, retryable: false };
  }

  // Idempotency guard — if the same operation id already succeeded, replay is a no-op.
  if (operationId) {
    const seen = await checkIdempotency(operationId);
    if (seen.alreadyProcessed) {
      return { operationId, ok: true, id: seen.result || recordId, replayed: true };
    }
  }

  try {
    let result;
    if (operation === 'delete') {
      // recordId required; tombstone the row (no hard delete).
      if (!recordId) {
        return { operationId, ok: false, error: 'recordId is required for delete', retryable: false };
      }
      result = await softDeleteRow(table, recordId);
    } else {
      const id = recordId || payload?.id;
      if (!id) {
        return { operationId, ok: false, error: 'recordId or payload.id is required for upsert', retryable: false };
      }
      result = await upsertRow(table, id, payload);
    }

    if (operationId && result?.id) {
      await recordIdempotency(operationId, result.id);
    }
    return { operationId, ok: true, id: result.id, updatedAt: result.updatedAt };
  } catch (err) {
    const status = err?.response?.status;
    const detail = err?.response?.data ? (typeof err.response.data === 'string' ? err.response.data : JSON.stringify(err.response.data)) : '';
    const message = err?.message || String(err);
    const isRetryable = status === 409 || status >= 500 || !status;
    // Harden: any cloud-side rejection surfaces a stable, short error string.
    const normalized = detail && detail.length < 300 ? detail : message;
    console.warn(`[cloudSyncStore] ${operation} ${table}/${recordId} failed (${status || 'network'}): ${normalized}`);
    return { operationId, ok: false, id: recordId, error: normalized, retryable: isRetryable };
  }
}

module.exports = {
  isConfigured,
  stringToUuid5,
  applyOp,
  getRow,
  upsertRow,
  softDeleteRow,
  checkIdempotency,
  recordIdempotency,
};