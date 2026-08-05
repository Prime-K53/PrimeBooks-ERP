import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { durableSyncQueue, resetDbConnection } from '../../../services/durableSyncQueue';
import { backgroundSyncService } from '../../../services/backgroundSyncService';

(globalThis as any).IDBKeyRange = {
  only: vi.fn((val: string) => ({ only: val })),
  upperBound: vi.fn(),
  lowerBound: vi.fn(),
  bound: vi.fn(),
};

const { openDBMock } = vi.hoisted(() => ({ openDBMock: vi.fn() }));
const { mockSendOps, mockUploadFile } = vi.hoisted(() => ({
  mockSendOps: vi.fn(async (ops: { operationId?: string }[]) => ({
    ok: true,
    processed: ops.length,
    succeeded: ops.length,
    results: ops.map((op) => ({ operationId: op.operationId, ok: true, id: 'mock-id' })),
  })),
  mockUploadFile: vi.fn(async () => 'mock-url'),
}));

vi.mock('idb', () => ({
  openDB: openDBMock,
  deleteDB: vi.fn(async () => {}),
  unwrap: vi.fn(),
}));

vi.mock('../../../services/syncApiClient', () => ({
  sendSyncOps: mockSendOps,
}));

vi.mock('../../../services/cloudDb', () => ({
  cloudDb: {
    uploadFile: mockUploadFile,
  },
}));

let createCounter = 0;

function createDb() {
  const id = ++createCounter;
  const stores: Record<string, Map<string, Record<string, unknown>>> = {
    operations: new Map(),
    meta: new Map(),
    metrics: new Map(),
  };

  const INDEX_FIELD: Record<string, string> = {
    'by-status': 'status',
    'by-created': 'createdAt',
    'by-operationId': 'operationId',
    'by-metric': 'metric',
  };

  return {
    __testId: id,
    get: vi.fn(async (storeName: string, key: string) => stores[storeName]?.get(key) || undefined),
    put: vi.fn(async (storeName: string, value: Record<string, unknown>) => {
      stores[storeName].set(value.id as string, { ...value });
    }),
    delete: vi.fn(async (storeName: string, key: string) => { stores[storeName].delete(key); }),
    getAll: vi.fn(async (storeName: string) => Array.from(stores[storeName].values())),
    getAllFromIndex: vi.fn(async (storeName: string, indexName: string, range?: unknown) => {
      const all = Array.from(stores[storeName].values());
      if (!range) return all;
      const rangeVal = (range as { only: string }).only;
      const field = INDEX_FIELD[indexName] || indexName;
      return all.filter(r => (r as any)[field] === rangeVal);
    }),
    count: vi.fn(async (storeName: string) => stores[storeName].size),
    close: vi.fn(),
    objectStoreNames: { contains: vi.fn(() => true) },
    transaction: vi.fn(() => ({ done: Promise.resolve(), objectStore: vi.fn() })),
    createObjectStore: vi.fn(),
    deleteObjectStore: vi.fn(),
  };
}

describe('backgroundSyncService', () => {
  let freshDb: ReturnType<typeof createDb>;

  beforeEach(() => {
    freshDb = createDb();
    openDBMock.mockReset().mockResolvedValue(freshDb);

    mockSendOps.mockReset().mockImplementation(async (ops: { operationId?: string }[]) => ({
      ok: true,
      processed: ops.length,
      succeeded: ops.length,
      results: ops.map((op) => ({ operationId: op.operationId, ok: true, id: 'mock-id' })),
    }));
    mockUploadFile.mockReset().mockResolvedValue('mock-url');

    resetDbConnection();
    backgroundSyncService.reset();
  });

  afterEach(() => {
    backgroundSyncService.stopPeriodicSync();
  });

  describe('syncNow', () => {
    it('should process pending queue items', async () => {
      await durableSyncQueue.enqueue({ table: 'products', recordId: 'p1', operation: 'upsert', payload: { name: 'Test' } });

      const result = await backgroundSyncService.syncNow();
      expect(result).toBeDefined();
      expect(result!.success).toBe(1);
      expect(result!.failed).toBe(0);
    });

    it('should mark items as failed on cloud error', async () => {
      mockSendOps.mockRejectedValueOnce(new Error('timeout'));

      await durableSyncQueue.enqueue({ table: 'products', recordId: 'p1', operation: 'upsert', payload: { name: 'Test' } });

      const result = await backgroundSyncService.syncNow();
      expect(result).toBeDefined();
      expect(result!.success).toBe(0);
      expect(result!.failed).toBe(1);
    });

    it('should move permanent errors to dead letter queue', async () => {
      mockSendOps.mockImplementation(async (ops: { operationId?: string }[]) => ({
        ok: true,
        processed: ops.length,
        succeeded: 0,
        results: ops.map((op) => ({ operationId: op.operationId, ok: false, error: 'violates foreign key constraint', retryable: false })),
      }));

      await durableSyncQueue.enqueue({ table: 'products', recordId: 'p1', operation: 'upsert', payload: { name: 'Test' } });

      const result = await backgroundSyncService.syncNow();
      expect(result!.deadLetter).toBe(1);
    });

    it('should skip when already syncing', async () => {
      const promise1 = backgroundSyncService.syncNow();
      const result2 = await backgroundSyncService.syncNow(false);
      expect(result2).toBeNull();
      await promise1;
    });
  });

  describe('metrics', () => {
    it('should return queue metrics through getMetrics', async () => {
      await durableSyncQueue.enqueue({ table: 'products', recordId: 'p1', operation: 'upsert', payload: {} });

      const metrics = await backgroundSyncService.getMetrics();
      expect(metrics.pending).toBe(1);
      expect(metrics.total).toBe(1);
    });
  });

  describe('subscribe', () => {
    it('should notify subscribers on sync events', async () => {
      await durableSyncQueue.enqueue({ table: 'products', recordId: 'p1', operation: 'upsert', payload: {} });

      const callback = vi.fn();
      backgroundSyncService.subscribe('test-listener', callback);

      const result = await backgroundSyncService.syncNow();
      expect(result).toBeDefined();
      expect(result!.success).toBe(1);
      expect(callback).toHaveBeenCalledWith('sync-complete', expect.any(Object));
    });
  });

  describe('retryDeadLetter and retryAllFailed', () => {
    it('should retry a single dead letter item', async () => {
      const item = await durableSyncQueue.enqueue({ table: 't', recordId: '1', operation: 'upsert', payload: {} });
      await durableSyncQueue.markFailed(item.id, 'violates foreign key constraint');

      await backgroundSyncService.retryDeadLetter(item.id);
      const pending = await durableSyncQueue.getAll('pending');
      expect(pending).toHaveLength(1);
    });

    it('should retry all failed items', async () => {
      const i1 = await durableSyncQueue.enqueue({ table: 't', recordId: '1', operation: 'upsert', payload: {} });
      const i2 = await durableSyncQueue.enqueue({ table: 't', recordId: '2', operation: 'upsert', payload: {} });
      await durableSyncQueue.markFailed(i1.id, 'timeout');
      await durableSyncQueue.markFailed(i2.id, 'timeout');

      const count = await backgroundSyncService.retryAllFailed();
      expect(count).toBe(2);
    });
  });

  describe('state', () => {
    it('should track sync state', async () => {
      await durableSyncQueue.enqueue({ table: 'products', recordId: 'p1', operation: 'upsert', payload: {} });

      const result = await backgroundSyncService.syncNow();
      expect(result).toBeDefined();
      expect(result!.success).toBe(1);

      const fullState = await backgroundSyncService.getState();
      expect(fullState.totalSynced).toBeGreaterThan(0);
    });
  });
});
