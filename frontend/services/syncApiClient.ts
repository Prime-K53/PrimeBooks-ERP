import { API_BASE_URL } from '../config/api.js';
import { getJsonRequestHeaders } from './requestHeaders';

/**
 * syncApiClient.ts — browser-side client for the backend sync gateway
 * (`POST /api/sync/ops`).
 *
 * The durable sync queue used to write directly to Supabase. Under the
 * offline-first architecture the backend is the single gateway for ALL
 * business writes: it validates, applies idempotent upserts + tombstone
 * deletes, and writes to the cloud with the service-role key. This client
 * just forwards a batch of ops and returns the per-op results.
 */

export type SyncOpOperation = 'upsert' | 'delete';

export interface SyncOp {
  operationId?: string;
  table: string;
  recordId: string | null;
  operation: SyncOpOperation;
  payload: unknown;
}

export interface SyncOpResult {
  operationId?: string;
  ok: boolean;
  id?: string | null;
  updatedAt?: string;
  replayed?: boolean;
  noop?: boolean;
  error?: string;
  retryable?: boolean;
}

export interface SyncOpsResponse {
  ok: boolean;
  processed?: number;
  succeeded?: number;
  results: SyncOpResult[];
}

const SYNC_ENDPOINT = `${API_BASE_URL}/sync/ops`;

/**
 * Get a fresh Supabase access token for the backend to verify.
 * Prefers the app session (nexus_user), falls back to supabase-js session.
 */
export async function getSyncAccessToken(): Promise<string | null> {
  try {
    const raw = sessionStorage.getItem('nexus_user');
    if (raw) {
      const session = JSON.parse(raw);
      if (session?.accessToken) return session.accessToken;
    }
  } catch {
    // ignore and fall through to supabase session
  }
  try {
    const { supabase } = await import('./supabaseClient');
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

export interface SyncSendOptions {
  timeoutMs?: number;
}

/**
 * Send a batch of operations to the backend sync gateway.
 *
 * Throws only on transport-level failures (offline / 5xx / 503 not-configured),
 * so the caller can retry the whole batch. Per-op validation failures come
 * back inside `results` with `ok:false` and must be dead-lettered individually.
 */
export async function sendSyncOps(ops: SyncOp[], options: SyncSendOptions = {}): Promise<SyncOpsResponse> {
  if (ops.length === 0) {
    return { ok: true, processed: 0, succeeded: 0, results: [] };
  }
  if (typeof fetch === 'undefined') {
    throw new Error('fetch is not available in this environment');
  }

  const token = await getSyncAccessToken();
  const headers: Record<string, string> = getJsonRequestHeaders();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 25000);

  try {
    const res = await fetch(SYNC_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ops }),
      signal: controller.signal,
    });

    if (res.status === 503) {
      throw new Error('Cloud database is not configured on this server');
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Sync gateway rejected the request (${res.status})`);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as any)?.error || `Sync gateway failed (${res.status})`);
    }

    const payload = await res.json() as SyncOpsResponse;
    if (!Array.isArray(payload?.results)) {
      throw new Error('Sync gateway returned an unexpected response');
    }
    return payload;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Sync gateway timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function isSyncGatewayConfigured(): boolean {
  return Boolean(API_BASE_URL);
}