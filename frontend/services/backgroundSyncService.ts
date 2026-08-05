import { durableSyncQueue, classifyError, QueuedOperation, QueueMetrics } from './durableSyncQueue';
import { sendSyncOps, SyncOp, SyncOpResult } from './syncApiClient';
import { cloudDb } from './cloudDb';

type SyncEventType = 'sync-start' | 'sync-complete' | 'sync-failure' | 'sync-partial' | 'queue-empty' | 'queue-full' | 'dead-letter';
type SyncCallback = (event: SyncEventType, data?: unknown) => void;

interface BatchResult {
  success: number;
  failed: number;
  deadLetter: number;
  skipped: number;
  durationMs: number;
}

interface SyncState {
  isSyncing: boolean;
  lastSyncStart: string | null;
  lastSyncSuccess: string | null;
  lastSyncFailure: string | null;
  consecutiveFailures: number;
  totalSynced: number;
  totalFailed: number;
}

const isClient = typeof window !== 'undefined';

let intervalId: ReturnType<typeof setInterval> | null = null;
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
let eventListenersRegistered = false;
let isInitialized = false;

let originalPushState: typeof history.pushState | null = null;
let originalReplaceState: typeof history.replaceState | null = null;

function onVisibilityChange() {
  if (document.visibilityState === 'visible') {
    syncOnce(true).catch(() => {});
  }
}

function onOnline() {
  syncOnce(true).catch(() => {});
}

function onPushState(this: typeof history, ...args: Parameters<typeof history.pushState>) {
  setTimeout(() => syncOnce(true).catch(() => {}), 500);
  return originalPushState!.apply(this, args);
}

function onReplaceState(this: typeof history, ...args: Parameters<typeof history.replaceState>) {
  setTimeout(() => syncOnce(true).catch(() => {}), 500);
  return originalReplaceState!.apply(this, args);
}

const state: SyncState = {
  isSyncing: false,
  lastSyncStart: null,
  lastSyncSuccess: null,
  lastSyncFailure: null,
  consecutiveFailures: 0,
  totalSynced: 0,
  totalFailed: 0,
};

const subscribers = new Map<string, SyncCallback>();

function notify(event: SyncEventType, data?: unknown) {
  for (const cb of subscribers.values()) {
    try { cb(event, data); } catch { /* guard */ }
  }
}

async function processBatch(batchSize: number = 10): Promise<BatchResult> {
  const startTime = Date.now();
  let success = 0;
  let failed = 0;
  let deadLetter = 0;
  let skipped = 0;

  const items = await durableSyncQueue.dequeue(batchSize);

  if (items.length === 0) return { success: 0, failed: 0, deadLetter: 0, skipped: 0, durationMs: 0 };

  // Split the batch: business ops go through the backend sync gateway
  // (single write path); file uploads stay direct to Supabase Storage.
  const gatewayOps: { item: QueuedOperation; op: SyncOp }[] = [];
  const fileItems: QueuedOperation[] = [];

  for (const item of items) {
    if (item.fileRef) {
      fileItems.push(item);
    } else {
      gatewayOps.push({
        item,
        op: {
          operationId: item.operationId,
          table: item.table,
          recordId: item.recordId,
          operation: item.operation === 'delete' ? 'delete' : 'upsert',
          payload: item.payload,
        },
      });
    }
  }

  // 1) Business ops → backend gateway (one round-trip for the whole batch).
  let opResults = new Map<string, SyncOpResult>();
  let transportFailed = false;
  if (gatewayOps.length > 0) {
    try {
      const response = await sendSyncOps(gatewayOps.map(({ op }) => op));
      for (const result of response.results) {
        if (result.operationId) opResults.set(result.operationId, result);
      }
    } catch (err) {
      // Transport failure: the entire batch is retryable. Mark items failed
      // and bail before the settle loop so they aren't marked completed.
      transportFailed = true;
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorType = classifyError(errorMessage);
      for (const { item } of gatewayOps) {
        await durableSyncQueue.markFailed(item.id, errorMessage);
        if (errorType === 'permanent') deadLetter++;
        else failed++;
      }
    }
  }

  const settleItem = async (item: QueuedOperation, result: SyncOpResult | undefined) => {
    if (!result || result.ok) {
      await durableSyncQueue.markCompleted(item.id);
      return 'success';
    }
    // Per-op rejection from the gateway: dead-letter permanent errors,
    // keep retrying transient ones.
    const errorMessage = result.error || 'Sync gateway rejected the operation';
    const permanent = result.retryable === false || classifyError(errorMessage) === 'permanent';
    await durableSyncQueue.markFailed(item.id, errorMessage);
    return permanent ? 'deadLetter' : 'failed';
  };

  for (const { item } of gatewayOps) {
    if (transportFailed) {
      // Already handled in the transport-failure catch above.
      continue;
    }
    const outcome = await settleItem(item, opResults.get(item.operationId));
    if (outcome === 'success') {
      // Mark the local record as synced so the FY migration is idempotent
      // and the record is never re-queued. Uses bulkPut (no re-enqueue).
      if (item.table === 'financial_years' && item.recordId) {
        try {
          const { dbService } = await import('./db');
          const record = await dbService.get<any>('financialYears', item.recordId);
          if (record && !record.deletedAt) {
            record.syncStatus = 'synced';
            record.lastSyncedAt = new Date().toISOString();
            record._cloudSource = true;
            await dbService.bulkPut('financialYears', [record]);
          }
        } catch {
          // best-effort status write
        }
      }
      success++;
    } else if (outcome === 'deadLetter') {
      deadLetter++;
    } else {
      failed++;
    }
  }

  // 2) File uploads → direct Supabase Storage (large binaries bypass the
  // backend so the gateway never becomes a bandwidth bottleneck).
  const filePromises = fileItems.map(async (item) => {
    try {
      const { openDB } = await import('idb');
      const localDb = await openDB('nexus-db', 1);
      const fileRecord = await localDb.get('files', item.fileRef);
      if (fileRecord?.blob) {
        await cloudDb.uploadFile(fileRecord.blob as File, 'documents', item.operationId);
      }
      await durableSyncQueue.markCompleted(item.id);
      success++;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorType = classifyError(errorMessage);
      await durableSyncQueue.markFailed(item.id, errorMessage);
      if (errorType === 'permanent') deadLetter++;
      else failed++;
    }
  });

  const settled = await Promise.allSettled(filePromises);
  for (const result of settled) {
    if (result.status === 'rejected') {
      skipped++;
    }
  }

  const durationMs = Date.now() - startTime;
  state.lastSyncStart = new Date().toISOString();

  return { success, failed, deadLetter, skipped, durationMs };
}

async function syncOnce(force: boolean = false): Promise<BatchResult | null> {
  // Never run two sync passes concurrently — forced syncs (navigation, online,
  // visibility) previously bypassed this guard and flooded the network with
  // overlapping cloud writes.
  if (state.isSyncing) return null;

  // Cheap short-circuit: when nothing is pending there is nothing to do, so we
  // avoid the heavy getMetrics()/dequeue() scans that fired on every page
  // navigation and every background interval tick.
  try {
    if ((await durableSyncQueue.countPending()) === 0) return null;
  } catch {
    // If the count fails, proceed anyway.
  }

  state.isSyncing = true;

  try {
    const metricsBefore: QueueMetrics = await durableSyncQueue.getMetrics();
    const totalBefore = metricsBefore.total;

    let totalSuccess = 0;
    let totalFailed = 0;
    let totalDeadLetter = 0;
    let totalSkipped = 0;
    let totalDuration = 0;
    let batchCount = 0;

    const maxBatches = 5;

    for (let i = 0; i < maxBatches; i++) {
      const result = await processBatch(10);
      if (result.success === 0 && result.failed === 0 && result.deadLetter === 0 && result.skipped === 0) break;

      totalSuccess += result.success;
      totalFailed += result.failed;
      totalDeadLetter += result.deadLetter;
      totalSkipped += result.skipped;
      totalDuration += result.durationMs;
      batchCount++;
    }

    state.totalSynced += totalSuccess;
    state.totalFailed += totalFailed + totalDeadLetter;

    const metricsAfter: QueueMetrics = await durableSyncQueue.getMetrics();

    await durableSyncQueue.setMeta('last_sync_batch', {
      timestamp: new Date().toISOString(),
      success: totalSuccess,
      failed: totalFailed,
      deadLetter: totalDeadLetter,
      durationMs: totalDuration,
      batchCount,
      totalBefore,
      totalAfter: metricsAfter.total,
    });

    if (totalFailed > 0 || totalDeadLetter > 0) {
      state.consecutiveFailures++;
      state.lastSyncFailure = new Date().toISOString();
      await durableSyncQueue.recordMetric('last_sync_failure', state.lastSyncFailure);
      notify('sync-failure', { failed: totalFailed, deadLetter: totalDeadLetter, totalBefore });
    } else if (totalSuccess > 0) {
      state.consecutiveFailures = 0;
      state.lastSyncSuccess = new Date().toISOString();
      await durableSyncQueue.recordMetric('last_sync_success', state.lastSyncSuccess);
      notify('sync-complete', { synced: totalSuccess, totalBefore });
    }

    if (totalBefore > 0 && metricsAfter.total === 0) {
      notify('queue-empty');
    }

    return { success: totalSuccess, failed: totalFailed, deadLetter: totalDeadLetter, skipped: totalSkipped, durationMs: totalDuration };
  } catch (err) {
    state.consecutiveFailures++;
    state.lastSyncFailure = new Date().toISOString();
    await durableSyncQueue.recordMetric('last_sync_failure', state.lastSyncFailure);
    notify('sync-failure', { error: err instanceof Error ? err.message : String(err) });
    return null;
  } finally {
    state.isSyncing = false;
  }
}

function getBackoffInterval(): number {
  const base = 15000;
  const maxInterval = 600000;
  const multiplier = Math.min(state.consecutiveFailures, 8);
  return Math.min(base * Math.pow(2, multiplier), maxInterval);
}

async function runCleanup(): Promise<void> {
  try {
    const removed = await durableSyncQueue.cleanup(86400000);
    if (removed > 0) {
      await durableSyncQueue.recordMetric('cleanup_removed', removed);
    }
  } catch {
    // cleanup errors are non-fatal
  }
}

async function reportHealth(): Promise<void> {
  try {
    const metrics = await durableSyncQueue.getMetrics();
    const stuckThreshold = 300000;
    if (metrics.oldestPending) {
      const oldestAge = Date.now() - new Date(metrics.oldestPending).getTime();
      if (oldestAge > stuckThreshold && metrics.pending > 0) {
        notify('queue-full', { oldestAge, pending: metrics.pending });
      }
    }
  } catch {
    // health check errors are non-fatal
  }
}

if (isClient) {
  if ('onvisibilitychange' in document) {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
    window.addEventListener('online', onOnline);
  }
  originalPushState = history.pushState.bind(history);
  originalReplaceState = history.replaceState.bind(history);
  history.pushState = onPushState;
  history.replaceState = onReplaceState;
}

export const backgroundSyncService = {
  get state(): Readonly<SyncState> { return state; },

  async initialize(): Promise<void> {
    if (isInitialized) return;
    isInitialized = true;

    const recovered = await durableSyncQueue.rebuildDependencyGraph();
    if (recovered > 0) {
      await durableSyncQueue.recordMetric('graph_recovered', recovered);
    }

    await this.startPeriodicSync();
    await runCleanup();
  },

  startPeriodicSync(intervalMs?: number): void {
    if (intervalId) clearInterval(intervalId);

    const doSync = async () => {
      try {
        await syncOnce();
      } catch {
        // background sync errors are handled internally
      }
    };

    doSync();
    intervalId = setInterval(doSync, intervalMs ?? getBackoffInterval());

    if (!cleanupIntervalId) {
      cleanupIntervalId = setInterval(runCleanup, 3600000);
    }

    if (!eventListenersRegistered) {
      eventListenersRegistered = true;
      if (isClient && 'onvisibilitychange' in document) {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            const newInterval = getBackoffInterval();
            if (intervalId) {
              clearInterval(intervalId);
              intervalId = setInterval(doSync, newInterval);
            }
            doSync();
            runCleanup();
            reportHealth();
          }
        });
      }
      if (isClient && typeof navigator !== 'undefined' && 'onLine' in navigator) {
        window.addEventListener('online', () => {
          state.consecutiveFailures = 0;
          const newInterval = getBackoffInterval();
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = setInterval(doSync, newInterval);
          }
          doSync();
        });
      }
    }
  },

  stopPeriodicSync(): void {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (cleanupIntervalId) {
      clearInterval(cleanupIntervalId);
      cleanupIntervalId = null;
    }
  },

  async syncNow(force: boolean = true): Promise<BatchResult | null> {
    return syncOnce(force);
  },

  async getMetrics(): Promise<QueueMetrics> {
    return durableSyncQueue.getMetrics();
  },

  async retryDeadLetter(id: string): Promise<void> {
    await durableSyncQueue.retryDeadLetter(id);
  },

  async retryAllFailed(): Promise<number> {
    return durableSyncQueue.retryFailed();
  },

  async getState(): Promise<SyncState & { queueMetrics: QueueMetrics }> {
    const metrics = await durableSyncQueue.getMetrics();
    return { ...state, queueMetrics: metrics };
  },

  subscribe(id: string, callback: SyncCallback): () => void {
    subscribers.set(id, callback);
    return () => { subscribers.delete(id); };
  },

  async exportQueue(): Promise<QueuedOperation[]> {
    return durableSyncQueue.getAll();
  },

  triggerImmediateSync(): void {
    syncOnce(true).catch(() => {});
  },

  /** Alias for syncNow — used by syncService.ts */
  async trigger(): Promise<BatchResult | null> {
    return syncOnce(true);
  },

  /** Alias for initialize — used by syncService.ts */
  start(): void {
    this.initialize().catch(() => {});
  },

  /** Reset internal state for test isolation */
  reset(): void {
    state.isSyncing = false;
    state.lastSyncStart = null;
    state.lastSyncSuccess = null;
    state.lastSyncFailure = null;
    state.consecutiveFailures = 0;
    state.totalSynced = 0;
    state.totalFailed = 0;
    subscribers.clear();
    this.stopPeriodicSync();
    eventListenersRegistered = false;
    isInitialized = false;
  },
};
