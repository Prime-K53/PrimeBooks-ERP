import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BatchRecord, OfflineState, SyncQueueItem, SyncQueuePriority, SyncQueueStatus } from '../types/offline';
import { dbService } from './db';

interface PrimeErpOfflineDbSchema extends DBSchema {
  batches: {
    key: string;
    value: BatchRecord;
  };
  syncQueue: {
    key: string;
    value: SyncQueueItem;
    indexes: {
      'by-status': SyncQueueStatus;
      'by-next-retry': string;
      'by-entity-id': string;
    };
  };
  meta: {
    key: string;
    value: {
      key: string;
      value: unknown;
      updatedAt: string;
    };
  };
}

const DB_NAME = 'PrimeERP_OfflineFirst';
const DB_VERSION = 1;
const STORAGE_PREFIX = 'primeerp:offline-db';
const OFFLINE_DB_EVENT = 'primeerp:offline-db-changed';

let dbPromise: Promise<IDBPDatabase<PrimeErpOfflineDbSchema>> | null = null;

const nowIso = () => new Date().toISOString();

const storageKey = (storeName: 'batches' | 'syncQueue' | 'meta') => `${STORAGE_PREFIX}:${storeName}`;

const canUseIndexedDb = () => typeof indexedDB !== 'undefined';

const emitOfflineDbChange = (store: string, ids: string[]) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(OFFLINE_DB_EVENT, {
    detail: {
      store,
      ids,
      at: nowIso()
    }
  }));
};

const readLocalFallback = async <T extends { id?: string; key?: string }>(storeName: 'batches' | 'syncQueue' | 'meta'): Promise<T[]> => {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const parsed = await dbService.getSetting<T[]>(storageKey(storeName));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeLocalFallback = async <T extends { id?: string; key?: string }>(storeName: 'batches' | 'syncQueue' | 'meta', rows: T[]) => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  await dbService.saveSetting(storageKey(storeName), rows);
};

const upsertLocalFallback = async <T extends { id?: string; key?: string }>(
  storeName: 'batches' | 'syncQueue' | 'meta',
  row: T
) => {
  const rows = await readLocalFallback<T>(storeName);
  const key = String(row.id ?? row.key ?? '');
  const next = rows.filter((entry) => String(entry.id ?? entry.key ?? '') !== key);
  next.push(row);
  await writeLocalFallback(storeName, next);
};

const removeFromLocalFallback = async (storeName: 'batches' | 'syncQueue' | 'meta', key: string) => {
  const rows = await readLocalFallback<any>(storeName);
  await writeLocalFallback(storeName, rows.filter((entry) => String(entry.id ?? entry.key ?? '') !== String(key)));
};

const initDb = async () => {
  if (!canUseIndexedDb()) {
    throw new Error('IndexedDB is not available in this runtime.');
  }

  if (!dbPromise) {
    dbPromise = openDB<PrimeErpOfflineDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('batches')) {
          db.createObjectStore('batches', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('syncQueue')) {
          const queueStore = db.createObjectStore('syncQueue', { keyPath: 'id' });
          queueStore.createIndex('by-status', 'status');
          queueStore.createIndex('by-next-retry', 'nextRetryAt');
          queueStore.createIndex('by-entity-id', 'entityId');
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      }
    });
  }

  return dbPromise;
};

export const closeOfflineDbConnection = async () => {
  if (!dbPromise) {
    return;
  }

  try {
    const db = await dbPromise;
    db.close();
  } catch {
    // Ignore close failures during teardown/reset.
  } finally {
    dbPromise = null;
  }
};

const withIndexedDbFallback = async <T>(fallback: () => T | Promise<T>, operation: (db: IDBPDatabase<PrimeErpOfflineDbSchema>) => Promise<T>) => {
  if (!canUseIndexedDb()) {
    return fallback();
  }

  try {
    const db = await initDb();
    return await operation(db);
  } catch {
    return fallback();
  }
};

const readBatchesFromLegacy = () => withIndexedDbFallback(
  () => readLocalFallback<BatchRecord>('batches'),
  async (db) => db.getAll('batches')
);

const readBatchFromLegacy = (id: string) => withIndexedDbFallback(
  async () => (await readLocalFallback<BatchRecord>('batches')).find((row) => String(row.id) === id),
  async (db) => db.get('batches', id)
);

const writeBatchToLegacy = async (batch: BatchRecord) => {
  await withIndexedDbFallback(
    async () => {
      await upsertLocalFallback('batches', batch);
      return undefined;
    },
    async (db) => {
      await db.put('batches', batch);
    }
  );
};

const writeBatchesToLegacy = async (batches: BatchRecord[]) => {
  await withIndexedDbFallback(
    async () => {
      await writeLocalFallback('batches', batches);
      return undefined;
    },
    async (db) => {
      const tx = db.transaction('batches', 'readwrite');
      await tx.store.clear();
      for (const batch of batches) {
        await tx.store.put(batch);
      }
      await tx.done;
    }
  );
};

const deleteBatchFromLegacy = async (id: string) => {
  await withIndexedDbFallback(
    async () => {
      await removeFromLocalFallback('batches', id);
      return undefined;
    },
    async (db) => {
      await db.delete('batches', id);
    }
  );
};

const normalizeQueueRows = (rows: SyncQueueItem[], statuses?: SyncQueueStatus[]) => {
  const priorityWeight: Record<SyncQueuePriority, number> = {
    urgent: 0,
    high: 1,
    normal: 2,
    low: 3
  };
  const wanted = Array.isArray(statuses) && statuses.length > 0 ? new Set(statuses) : null;
  return rows
    .filter((row) => !wanted || wanted.has(row.status))
    .sort((left, right) => {
      const leftPriority = priorityWeight[(left.priority || 'normal') as SyncQueuePriority] ?? priorityWeight.normal;
      const rightPriority = priorityWeight[(right.priority || 'normal') as SyncQueuePriority] ?? priorityWeight.normal;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      const leftAvailableAt = left.availableAt || left.nextRetryAt || left.createdAt;
      const rightAvailableAt = right.availableAt || right.nextRetryAt || right.createdAt;
      const availableDelta = new Date(leftAvailableAt).getTime() - new Date(rightAvailableAt).getTime();
      if (availableDelta !== 0) {
        return availableDelta;
      }

      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });
};

const mergeByIdentifier = <T extends { id?: string; dedupeKey?: string }>(primary: T[], fallback: T[]) => {
  const merged = new Map<string, T>();

  [...fallback, ...primary].forEach((row) => {
    const key = String(row.id || row.dedupeKey || '');
    if (!key) return;
    merged.set(key, row);
  });

  return Array.from(merged.values());
};

const readQueueFromLegacy = (statuses?: SyncQueueStatus[]) => withIndexedDbFallback(
  async () => normalizeQueueRows(await readLocalFallback<SyncQueueItem>('syncQueue'), statuses),
  async (db) => normalizeQueueRows(await db.getAll('syncQueue'), statuses)
);

const writeQueueToLegacy = async (item: SyncQueueItem) => {
  await withIndexedDbFallback(
    async () => {
      await upsertLocalFallback('syncQueue', item);
      return undefined;
    },
    async (db) => {
      await db.put('syncQueue', item);
    }
  );
};

const deleteQueueFromLegacy = async (id: string) => {
  await withIndexedDbFallback(
    async () => {
      await removeFromLocalFallback('syncQueue', id);
      return undefined;
    },
    async (db) => {
      await db.delete('syncQueue', id);
    }
  );
};

const readMetaFromLegacy = async <T>(key: string): Promise<T | undefined> =>
  withIndexedDbFallback(
    async () => {
      const records = await readLocalFallback<{ key: string; value: T }>('meta');
      const record = records.find((entry) => String(entry.key) === String(key));
      return record?.value;
    },
    async (db) => {
      const record = await db.get('meta', key);
      return record?.value as T | undefined;
    }
  );

const writeMetaToLegacy = async <T>(key: string, value: T) => {
  const record = {
    key,
    value,
    updatedAt: nowIso()
  };

  await withIndexedDbFallback(
    async () => {
      await upsertLocalFallback('meta', record);
      return undefined;
    },
    async (db) => {
      await db.put('meta', record);
    }
  );
};

export const offlineDb = {
  eventName: OFFLINE_DB_EVENT,

  async getAllBatches(): Promise<BatchRecord[]> {
    return readBatchesFromLegacy();
  },

  async getBatch(id: string): Promise<BatchRecord | undefined> {
    return readBatchFromLegacy(String(id || ''));
  },

  async saveBatch(batch: BatchRecord, { silent = true }: { silent?: boolean } = {}): Promise<BatchRecord> {
    const next = {
      ...batch,
      updated_at: String(batch.updated_at || nowIso())
    };

    await writeBatchToLegacy(next);

    if (!silent) {
      emitOfflineDbChange('batches', [String(next.id)]);
    }

    return next;
  },

  async saveBatches(batches: BatchRecord[], { silent = true }: { silent?: boolean } = {}): Promise<BatchRecord[]> {
    const normalized = batches.map((batch) => ({
      ...batch,
      updated_at: String(batch.updated_at || nowIso())
    }));

    await writeBatchesToLegacy(normalized);

    if (!silent && normalized.length > 0) {
      emitOfflineDbChange('batches', normalized.map((batch) => String(batch.id)));
    }

    return normalized;
  },

  async deleteBatch(id: string, { silent = true }: { silent?: boolean } = {}) {
    const key = String(id || '');

    await deleteBatchFromLegacy(key);

    if (!silent) {
      emitOfflineDbChange('batches', [key]);
    }
  },

  async getSyncQueue(statuses?: SyncQueueStatus[]): Promise<SyncQueueItem[]> {
    return readQueueFromLegacy(statuses);
  },

  async enqueueSyncQueueItem(item: SyncQueueItem, { silent = false }: { silent?: boolean } = {}): Promise<SyncQueueItem | null> {
    const next = {
      ...item,
      updatedAt: nowIso()
    } as SyncQueueItem;

    await writeQueueToLegacy(next);

    if (!silent) {
      emitOfflineDbChange('syncQueue', [String(next.id)]);
    }

    return next;
  },

  async saveSyncQueueItem(item: SyncQueueItem, { silent = false }: { silent?: boolean } = {}): Promise<SyncQueueItem> {
    const next: SyncQueueItem = {
      ...item,
      updatedAt: nowIso()
    };

    await writeQueueToLegacy(next);

    if (!silent) {
      emitOfflineDbChange('syncQueue', [String(next.id)]);
    }

    return next;
  },

  async deleteSyncQueueItem(id: string, { silent = false }: { silent?: boolean } = {}) {
    const key = String(id || '');

    await deleteQueueFromLegacy(key);

    if (!silent) {
      emitOfflineDbChange('syncQueue', [key]);
    }
  },

  async getMetaValue<T>(key: string): Promise<T | undefined> {
    return readMetaFromLegacy<T>(key);
  },

  async setMetaValue<T>(key: string, value: T, { silent = true }: { silent?: boolean } = {}) {
    await writeMetaToLegacy(key, value);

    if (!silent) {
      emitOfflineDbChange('meta', [key]);
    }
  },

  async getOfflineState(): Promise<OfflineState> {
    const stored = await this.getMetaValue('offline-state') as OfflineState | undefined;
    return stored || {
      isOnline: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
      isSyncing: false,
      lastSyncedAt: null,
      pendingMutations: 0,
      authBlocked: false,
      cacheReady: false
    };
  },

  async setOfflineState(nextState: OfflineState, { silent = true }: { silent?: boolean } = {}) {
    await this.setMetaValue('offline-state', nextState, { silent });
  }
};
