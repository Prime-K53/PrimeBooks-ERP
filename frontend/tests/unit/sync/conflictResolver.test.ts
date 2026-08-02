import { describe, it, expect } from 'vitest';
import { resolveConflict, fieldLevelMerge } from '../../../services/syncConflictResolver';

describe('syncConflictResolver', () => {
  describe('resolveConflict', () => {
    it('should prefer higher version number', () => {
      const local = { id: '1', _version: 2, _updatedAt: '2026-01-01T00:00:00Z' };
      const remote = { id: '1', version: 1, updated_at: '2026-06-01T00:00:00Z' };
      expect(resolveConflict(local, remote)).toBe('local_wins');
    });

    it('should prefer server authoritative timestamps over client timestamps', () => {
      const local = { id: '1', serverUpdatedAt: '2026-06-29T12:00:00Z', _updatedAt: '2026-06-01T00:00:00Z' };
      const remote = { id: '1', updated_at: '2026-06-28T12:00:00Z' };
      expect(resolveConflict(local, remote)).toBe('local_wins');
    });

    it('should use server updated_at when no serverUpdatedAt', () => {
      const local = { id: '1', updated_at: '2026-06-01T00:00:00Z' };
      const remote = { id: '1', updated_at: '2026-06-29T12:00:00Z' };
      expect(resolveConflict(local, remote)).toBe('remote_wins');
    });

    it('should prefer local when timestamps are equal', () => {
      const local = { id: '1', _updatedAt: '2026-06-29T12:00:00Z' };
      const remote = { id: '1', updated_at: '2026-06-29T12:00:00Z' };
      expect(resolveConflict(local, remote)).toBe('local_wins');
    });
  });

  describe('fieldLevelMerge', () => {
    it('should prefer remote fields when remote timestamp is newer (unless local per-field)', () => {
      const local = { id: '1', name: 'Local Name', price: 100, _updatedAt: '2026-01-01T00:00:00Z' };
      const remote = { id: '1', name: 'Remote Name', description: 'Remote desc', updated_at: '2026-06-29T12:00:00Z' };

      const merged = fieldLevelMerge(local, remote);
      // Remote timestamp is newer, so remote values win for all fields
      expect(merged.name).toBe('Remote Name');
      expect(merged.price).toBe(100);
      expect(merged.description).toBe('Remote desc');
    });

    it('should prefer remote values when remote timestamp is newer', () => {
      const local = { id: '1', name: 'Old', price: 100, _updatedAt: '2026-01-01T00:00:00Z' };
      const remote = { id: '1', name: 'New', price: 200, updated_at: '2026-06-29T12:00:00Z' };

      const merged = fieldLevelMerge(local, remote);
      expect(merged.name).toBe('New');
      expect(merged.price).toBe(200);
    });

    it('should prefer local values when local timestamp is newer', () => {
      const local = { id: '1', name: 'Newer Local', _updatedAt: '2026-06-29T12:00:00Z' };
      const remote = { id: '1', name: 'Older Remote', updated_at: '2026-01-01T00:00:00Z' };

      const merged = fieldLevelMerge(local, remote);
      expect(merged.name).toBe('Newer Local');
    });

    it('should use server authoritative timestamps for field comparison', () => {
      const local = { id: '1', name: 'Local Edit', serverUpdatedAt: '2026-06-29T12:00:00Z', _updatedAt: '2026-01-01T00:00:00Z' };
      const remote = { id: '1', name: 'Remote Edit', updated_at: '2026-06-28T00:00:00Z' };

      const merged = fieldLevelMerge(local, remote);
      expect(merged.name).toBe('Local Edit');
    });

    it('should handle null and undefined values', () => {
      const local = { id: '1', name: null, price: undefined, _updatedAt: '2026-06-29T00:00:00Z' };
      const remote = { id: '1', name: 'Remote Name', price: 50, updated_at: '2026-01-01T00:00:00Z' };

      const merged = fieldLevelMerge(local, remote);
      // local timestamp is newer, so local null wins for name
      expect(merged.name).toBeNull();
      // local price is undefined, so remote price wins
      expect(merged.price).toBe(50);
    });

    it('should strip metadata fields from merged data', () => {
      const local = { id: '1', name: 'Test', _version: 5, _updatedAt: '2026-06-29T00:00:00Z' };
      const remote = { id: '1', updated_at: '2026-01-01T00:00:00Z' };

      const merged = fieldLevelMerge(local, remote);
      expect(merged.name).toBe('Test');
      expect(merged._version).toBeUndefined();
      expect(merged.updated_at).toBeUndefined();
    });
  });
});
