import { describe, it, expect, vi, beforeEach } from 'vitest';

let resolvedData: unknown = null;
let resolvedError: unknown = null;

function createQueryBuilder() {
  const builder: Record<string, unknown> = {};
  const thenable = (data: unknown, error: unknown) => {
    const p = Promise.resolve({ data, error });
    return p;
  };

  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => thenable(resolvedData, resolvedError));
  builder.single = vi.fn(() => thenable(resolvedData, resolvedError));
  builder.maybeSingle = vi.fn(() => thenable(resolvedData, resolvedError));
  builder.upsert = vi.fn(() => builder);
  builder.delete = vi.fn(() => builder);
  builder.then = undefined as any;

  return builder;
}

let mockBuilder = createQueryBuilder();

vi.mock('../../../services/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: { user: { id: 'user-1' }, access_token: 'tok' } } })),
      refreshSession: vi.fn(() => Promise.resolve({ data: { session: { user: { id: 'user-1' }, access_token: 'tok' } } })),
      getUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } } })),
    },
    from: vi.fn(() => mockBuilder),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(),
        createSignedUrl: vi.fn(),
        download: vi.fn(),
      })),
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  },
}));

describe('cloudDb', () => {
  let cloudDb: typeof import('../../../services/cloudDb').cloudDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    resolvedData = null;
    resolvedError = null;

    cloudDb = (await import('../../../services/cloudDb')).cloudDb;
  });

  describe('put with server timestamps', () => {
    it('should return server timestamps on success', async () => {
      const serverData = {
        id: 'prod-1',
        updated_at: '2026-06-29T12:00:00Z',
        created_at: '2026-06-29T11:00:00Z',
        version: 3,
      };
      resolvedData = serverData;
      resolvedError = null;

      const result = await cloudDb.put('inventory', { id: 'prod-1', name: 'Test', price: 100 });

      expect(result).toBeDefined();
      expect(result!.id).toBe('prod-1');
      expect(result!.updatedAt).toBe('2026-06-29T12:00:00Z');
      expect(result!.createdAt).toBe('2026-06-29T11:00:00Z');
      expect(result!.version).toBe(3);
    });

    it('should throw on server error', async () => {
      resolvedData = null;
      resolvedError = new Error('DB error');

      await expect(
        cloudDb.put('inventory', { id: 'prod-1', name: 'Test' })
      ).rejects.toThrow();
    });
  });

  describe('delete with idempotency', () => {
    it('should return true on successful delete', async () => {
      resolvedData = null;
      resolvedError = null;
      mockBuilder = createQueryBuilder();

      const result = await cloudDb.delete('inventory', 'prod-1', 'op-delete-1');
      expect(result).toBe(true);
    });
  });

  describe('uploadFile with idempotency', () => {
    it('should upload and return storage path', async () => {
      const { supabase } = await import('../../../services/supabaseClient');
      const uploadMock = vi.fn().mockResolvedValue({ data: { path: 'comp-1/documents/file.pdf' }, error: null });
      vi.mocked(supabase.storage.from).mockReturnValue({
        upload: uploadMock,
        createSignedUrl: vi.fn(),
        download: vi.fn(),
      } as any);

      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });
      const result = await cloudDb.uploadFile(file, 'documents', 'op-file-1');
      expect(result).toMatch(/^storage:/);
    });
  });

  describe('getAll', () => {
    it('should fetch and flatten records', async () => {
      const serverRecords = [
        { id: '1', data: { name: 'Product A' }, updated_at: '2026-06-29T12:00:00Z' },
        { id: '2', data: { name: 'Product B' }, updated_at: '2026-06-29T13:00:00Z' },
      ];
      resolvedData = serverRecords;
      resolvedError = null;

      const records = await cloudDb.getAll('inventory');
      expect(records).toHaveLength(2);
      expect(records![0].name).toBe('Product A');
    });
  });

  describe('get', () => {
    it('should fetch single record with flattened data', async () => {
      const serverRecord = { id: '1', data: { name: 'Product A', price: 100 }, updated_at: '2026-06-29T12:00:00Z' };
      resolvedData = serverRecord;
      resolvedError = null;

      const record = await cloudDb.get('inventory', '1');
      expect(record).toBeDefined();
      expect(record!.name).toBe('Product A');
      expect(record!.price).toBe(100);
    });
  });
});
