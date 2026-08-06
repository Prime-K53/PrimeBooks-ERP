/**
 * acceptanceService.cjs — server-side coordinator for the Live Multi-Device
 * Acceptance Framework.
 *
 * Runs are coordinated through the backend only. Two devices (A = initiator,
 * B = observer) communicate via this API plus the normal sync + realtime
 * pipeline; they never talk to each other directly. Every generated business
 * record carries `acceptanceRunId` so the whole dataset can be located and
 * removed cleanly at the end of a run.
 *
 * This module owns:
 *   - run lifecycle state (created -> awaiting_device_b -> running -> complete
 *     -> closed)
 *   - device join/registration
 *   - observation + telemetry ingestion from both devices
 *   - evidence file storage under the workspace "Acceptance Reports" folder
 *   - cloud verification (service-role row counts by acceptanceRunId) and
 *     cleanup (hard-delete of acceptance-tagged rows + storage objects)
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { db } = require('../db.cjs');
const workspaceService = require('./workspaceService.cjs');

const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY || '';
const FILE_BUCKET = 'prime-erp-files';
const FINAL_STATES = new Set(['complete', 'closed']);

const isCloudConfigured = () => Boolean(
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
    Prefer: 'count=exact',
  };
}

// ─── SQLite helpers (promise wrappers around sqlite3) ───────────────────────
const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, (err) => (err ? reject(err) : resolve()));
});

const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});

const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
});

const ensureSchema = () => run(`
  CREATE TABLE IF NOT EXISTS acceptance_runs (
    run_id TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'created',
    device_a_id TEXT,
    device_a_label TEXT,
    device_b_id TEXT,
    device_b_label TEXT,
    scenario_index INTEGER NOT NULL DEFAULT 0,
    scenario_key TEXT,
    step TEXT,
    plan TEXT NOT NULL DEFAULT '[]',
    run_data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

const now = () => new Date().toISOString();

function parseRun(row) {
  if (!row) return null;
  return {
    runId: row.run_id,
    state: row.state,
    deviceA: { id: row.device_a_id, label: row.device_a_label },
    deviceB: { id: row.device_b_id, label: row.device_b_label },
    scenarioIndex: row.scenario_index,
    scenarioKey: row.scenario_key,
    step: row.step,
    plan: JSON.parse(row.plan || '[]'),
    data: JSON.parse(row.run_data || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function setRun(rowPatch, whereRunId) {
  const fields = Object.keys(rowPatch).map((k) => `${k} = ?`).join(', ');
  const values = [...Object.values(rowPatch), whereRunId];
  await run(`UPDATE acceptance_runs SET ${fields}, updated_at = ? WHERE run_id = ?`, [...values, now(), whereRunId]);
}

// ─── run lifecycle ──────────────────────────────────────────────────────────
async function createRun({ runId, deviceId, label, plan = [] }) {
  await ensureSchema();
  const existing = await get('SELECT run_id FROM acceptance_runs WHERE run_id = ?', [runId]);
  if (existing) throw new Error('run already exists');
  await run(
    `INSERT INTO acceptance_runs (run_id, device_a_id, device_a_label, scenario_index, plan, run_data, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, '{}', ?, ?)`,
    [runId, deviceId, label || 'Device A', JSON.stringify(plan || []), now(), now()]
  );
  return getRun(runId);
}

async function joinRun(runId, { deviceId, label }) {
  await ensureSchema();
  const row = await get('SELECT * FROM acceptance_runs WHERE run_id = ?', [runId]);
  if (!row) throw new Error('run not found');
  if (FINAL_STATES.has(row.state)) throw new Error('run already closed');
  if (row.device_b_id && row.device_b_id !== deviceId) throw new Error('another device already joined');
  await setRun({ device_b_id: deviceId, device_b_label: label || 'Device B' }, runId);
  return getRun(runId);
}

async function startRun(runId, deviceId) {
  await ensureSchema();
  const row = await get('SELECT * FROM acceptance_runs WHERE run_id = ?', [runId]);
  if (!row) throw new Error('run not found');
  if (row.device_a_id !== deviceId) throw new Error('only the initiator can start the run');
  const first = JSON.parse(row.plan || '[]')[0];
  await setRun({ state: 'running', scenario_index: 0, scenario_key: first?.key || 'offline_create' }, runId);
  return getRun(runId);
}

async function advanceRun(runId, deviceId, { scenarioIndex, scenarioKey, step, state }) {
  await ensureSchema();
  const row = await get('SELECT * FROM acceptance_runs WHERE run_id = ?', [runId]);
  if (!row) throw new Error('run not found');
  if (FINAL_STATES.has(state || '')) {
    await setRun({ state, scenario_index: scenarioIndex, scenario_key: scenarioKey, step: step || null }, runId);
  } else {
    await setRun({ scenario_index: scenarioIndex, scenario_key: scenarioKey, step: step || null }, runId);
  }
  return getRun(runId);
}

/** Merge a small JSON patch into run_data (used for scenario hand-off signals). */
async function patchRunData(runId, patch) {
  await ensureSchema();
  const row = await get('SELECT run_data FROM acceptance_runs WHERE run_id = ?', [runId]);
  if (!row) throw new Error('run not found');
  const data = JSON.parse(row.run_data || '{}');
  await setRun({ run_data: JSON.stringify({ ...data, ...patch }) }, runId);
  return getRun(runId);
}

async function getRun(runId) {
  await ensureSchema();
  return parseRun(await get('SELECT * FROM acceptance_runs WHERE run_id = ?', [runId]));
}

async function listRuns(limit = 10) {
  await ensureSchema();
  const rows = await all('SELECT * FROM acceptance_runs ORDER BY created_at DESC LIMIT ?', [limit]);
  return rows.map(parseRun);
}

async function getActiveRun() {
  await ensureSchema();
  const row = await get(
    "SELECT * FROM acceptance_runs WHERE state NOT IN ('complete','closed') ORDER BY created_at DESC LIMIT 1"
  );
  return parseRun(row);
}

async function closeRun(runId) {
  await ensureSchema();
  await setRun({ state: 'closed' }, runId);
  return getRun(runId);
}

// ─── observations & telemetry ───────────────────────────────────────────────
async function appendToRunData(runId, key, entry) {
  const row = await get('SELECT run_data FROM acceptance_runs WHERE run_id = ?', [runId]);
  if (!row) throw new Error('run not found');
  const data = JSON.parse(row.run_data || '{}');
  const list = Array.isArray(data[key]) ? data[key] : [];
  list.push(entry);
  return patchRunData(runId, { [key]: list });
}

async function addObservation(runId, deviceId, observation) {
  return appendToRunData(runId, 'observations', { deviceId, at: now(), ...observation });
}

async function addTelemetry(runId, deviceId, telemetry) {
  return appendToRunData(runId, 'telemetry', { deviceId, at: now(), ...telemetry });
}

// ─── evidence storage (workspace "Acceptance Reports" folder) ──────────────
function runEvidenceDir(runId) {
  const config = workspaceService.getWorkspaceConfig();
  return config?.workspacePath
    ? path.join(config.workspacePath, 'Acceptance Reports', runId)
    : null;
}

function storeEvidence(runId, name, payload) {
  const dir = runEvidenceDir(runId);
  if (!dir) return null;
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, '_');
  const file = path.join(dir, safe.endsWith('.json') ? safe : `${safe}.json`);
  fs.writeFileSync(file, typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2));
  return file;
}

function listEvidence(runId) {
  const dir = runEvidenceDir(runId);
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir);
}

function removeEvidenceDir(runId) {
  const dir = runEvidenceDir(runId);
  if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// ─── cloud verification & cleanup (service role) ────────────────────────────
async function countAcceptanceRows(table, runId) {
  if (!isCloudConfigured()) return 0;
  try {
    const res = await axios.get(`${SUPABASE_URL}/rest/v1/${table}`, {
      headers: adminHeaders(),
      params: {
        select: 'id',
        'data->>acceptanceRunId': `eq.${runId}`,
        limit: 1,
      },
      timeout: 15000,
    });
    const range = String(res.headers?.['content-range'] || '0-0/0');
    const total = Number(range.split('/')[1]);
    return Number.isFinite(total) ? total : 0;
  } catch {
    return 0;
  }
}

/** Fetch up to `limit` cloud rows tagged with this run id (verification). */
async function fetchAcceptanceRows(table, runId, limit = 50) {
  if (!isCloudConfigured()) return [];
  try {
    const res = await axios.get(`${SUPABASE_URL}/rest/v1/${table}`, {
      headers: adminHeaders(),
      params: {
        select: 'id,data,version,updated_at',
        'data->>acceptanceRunId': `eq.${runId}`,
        limit,
      },
      timeout: 15000,
    });
    return Array.isArray(res.data) ? res.data : [];
  } catch {
    return [];
  }
}

/** Verify storage: list bucket objects whose name contains the run id. */
async function verifyStorage(runId) {
  if (!isCloudConfigured()) return { count: 0, rows: [] };
  const all = await listStorageObjects('');
  const rows = all
    .filter((name) => String(name).includes(String(runId)))
    .map((name) => ({ name }));
  return { count: rows.length, rows };
}

async function fetchAcceptanceRowIds(table, runId) {
  if (!isCloudConfigured()) return [];
  const ids = [];
  try {
    for (let offset = 0; offset < 10000; offset += 1000) {
      const res = await axios.get(`${SUPABASE_URL}/rest/v1/${table}`, {
        headers: { apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}` },
        params: {
          select: 'id',
          'data->>acceptanceRunId': `eq.${runId}`,
          limit: 1000,
          offset,
        },
        timeout: 20000,
      });
      const rows = Array.isArray(res.data) ? res.data : [];
      for (const row of rows) if (row?.id != null) ids.push(row.id);
      if (rows.length < 1000) break;
    }
  } catch {
    /* cleanup is best-effort */
  }
  return ids;
}

/** Hard-delete every cloud row tagged with this run id. */
async function hardDeleteAcceptanceRows(table, runId) {
  const ids = await fetchAcceptanceRowIds(table, runId);
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    try {
      await axios.delete(`${SUPABASE_URL}/rest/v1/${table}`, {
        headers: { apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}` },
        params: { id: `in.(${batch.join(',')})` },
        timeout: 20000,
      });
      deleted += batch.length;
    } catch {
      /* best-effort */
    }
  }
  return deleted;
}

// ─── storage cleanup ────────────────────────────────────────────────────────
async function listStorageObjects(prefix) {
  if (!isCloudConfigured()) return [];
  try {
    const res = await axios.post(
      `${SUPABASE_URL}/storage/v1/object/list/${FILE_BUCKET}`,
      { prefix: prefix || '', limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } },
      { headers: adminHeaders(), timeout: 20000 }
    );
    return Array.isArray(res.data) ? res.data.map((o) => o.name) : [];
  } catch {
    return [];
  }
}

/** Create a short-lived signed URL for a storage object (download verify). */
async function createStorageSignedUrl(namePath) {
  if (!isCloudConfigured() || !namePath) return null;
  const encoded = String(namePath).split('/').map(encodeURIComponent).join('/');
  try {
    const res = await axios.post(
      `${SUPABASE_URL}/storage/v1/object/sign/${FILE_BUCKET}/${encoded}`,
      { expiresIn: 120 },
      { headers: adminHeaders(), timeout: 20000 }
    );
    const signedPath = res.data?.signedURL || res.data?.signedUrl;
    if (!signedPath) return null;
    return `${SUPABASE_URL.replace(/\/+$/, '')}/storage/v1${signedPath}`;
  } catch {
    return null;
  }
}

/** Verify a run's file on storage: locate the object, return a signed URL. */
async function verifyRunFile(runId) {
  if (!isCloudConfigured()) return { found: false, name: null, url: null };
  const all = await listStorageObjects('');
  const name = all.find((n) => String(n).includes(String(runId)));
  if (!name) return { found: false, name: null, url: null };
  const url = await createStorageSignedUrl(name);
  return { found: true, name, url };
}

async function deleteStorageObject(namePath) {
  if (!namePath) return false;
  const encoded = String(namePath).split('/').map(encodeURIComponent).join('/');
  try {
    await axios.delete(`${SUPABASE_URL}/storage/v1/object/${FILE_BUCKET}/${encoded}`, {
      headers: { apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}` },
      timeout: 20000,
    });
    return true;
  } catch {
    return false;
  }
}

/** Delete files: explicit paths if given, otherwise everything under `prefix`. */
async function deleteAcceptanceFiles(filePaths = [], prefix) {
  const targets = filePaths && filePaths.length > 0
    ? filePaths.slice()
    : prefix
      ? await listStorageObjects(prefix)
      : [];
  let deleted = 0;
  for (const name of targets) {
    if (await deleteStorageObject(name)) deleted++;
  }
  return deleted;
}

/**
 * Full cleanup: hard-delete acceptance-tagged business rows, remove file
 * objects, drop the run's evidence folder, then close the run.
 */
async function cleanupRun(runId, { tables = [], filePaths = [], prefix, close = true } = {}) {
  const counts = {};
  for (const table of tables) {
    counts[table] = await hardDeleteAcceptanceRows(table, runId);
  }
  const filesRemoved = await deleteAcceptanceFiles(filePaths, prefix);
  removeEvidenceDir(runId);
  if (close) await closeRun(runId);
  return {
    counts,
    filesRemoved,
    rowsRemoved: Object.values(counts).reduce((s, n) => s + n, 0),
  };
}

module.exports = {
  ensureSchema,
  createRun,
  joinRun,
  startRun,
  advanceRun,
  patchRunData,
  getRun,
  listRuns,
  getActiveRun,
  closeRun,
  addObservation,
  addTelemetry,
  storeEvidence,
  listEvidence,
  removeEvidenceDir,
  countAcceptanceRows,
  fetchAcceptanceRows,
  verifyStorage,
  createStorageSignedUrl,
  verifyRunFile,
  hardDeleteAcceptanceRows,
  listStorageObjects,
  deleteStorageObject,
  deleteAcceptanceFiles,
  cleanupRun,
};
