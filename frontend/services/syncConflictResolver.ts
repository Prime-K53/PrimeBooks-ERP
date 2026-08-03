export type ResolveResult = 'local_wins' | 'remote_wins';

/**
 * Resolve conflict between local and remote records.
 * Uses server-authoritative `updated_at` as the truth, falls back to client `_updatedAt`.
 */
export function resolveConflict(
  localRecord: any,
  remoteRecord: any
): ResolveResult {
  const localVersion = Number(localRecord.version || localRecord._version || 0);
  const remoteVersion = Number(remoteRecord.version || remoteRecord._version || 0);

  if (localVersion > remoteVersion) return 'local_wins';
  if (remoteVersion > localVersion) return 'remote_wins';

  // Server timestamps are authoritative (in UTC from Supabase)
  const localTime = new Date(
    localRecord.serverUpdatedAt || localRecord.updated_at || localRecord._updatedAt || 0
  ).getTime();
  const remoteTime = new Date(
    remoteRecord.updated_at || remoteRecord._updatedAt || 0
  ).getTime();

  if (localTime >= remoteTime) return 'local_wins';
  return 'remote_wins';
}

export function mergeRecords(localRecord: any, remoteRecord: any): any {
  const winner = resolveConflict(localRecord, remoteRecord);
  if (winner === 'local_wins') {
    return { ...remoteRecord, ...localRecord, _updatedAt: new Date().toISOString() };
  }
  return { ...localRecord, ...remoteRecord, _updatedAt: new Date().toISOString() };
}

/**
 * Field-level merge: for each field, take the value from the record with the newer timestamp.
 * Uses server-authoritative `updated_at` first, falls back to client `_updatedAt`.
 *
 * This prevents silent data loss when two devices edit different fields of the same record.
 */
export function fieldLevelMerge(localRecord: any, remoteRecord: any): any {
  const METADATA_FIELDS = new Set([
    'id', '_updatedAt', '_cloudSource', '_version',
    'version', 'updated_at', 'created_at', 'serverUpdatedAt',
  ]);

  // Prefer server authoritative timestamps
  const localTime = new Date(
    localRecord.serverUpdatedAt || localRecord.updated_at || localRecord._updatedAt || 0
  ).getTime();
  const remoteTime = new Date(
    remoteRecord.updated_at || remoteRecord._updatedAt || 0
  ).getTime();

  const merged: Record<string, unknown> = {
    id: remoteRecord.id || localRecord.id,
    _updatedAt: new Date().toISOString(),
    serverUpdatedAt: remoteRecord.updated_at || remoteRecord.serverUpdatedAt || localRecord.serverUpdatedAt,
    _cloudSource: true,
  };

  const allKeys = new Set([
    ...Object.keys(localRecord || {}),
    ...Object.keys(remoteRecord || {}),
  ]);

  for (const key of allKeys) {
    if (METADATA_FIELDS.has(key)) continue;

    const localVal = localRecord?.[key];
    const remoteVal = remoteRecord?.[key];

    if (localVal === undefined && remoteVal === undefined) continue;
    if (localVal === undefined) { merged[key] = remoteVal; continue; }
    if (remoteVal === undefined) { merged[key] = localVal; continue; }

    if (JSON.stringify(localVal) === JSON.stringify(remoteVal)) {
      merged[key] = localVal;
      continue;
    }

    const localFieldTime = localRecord[`${key}_updatedAt`]
      ? new Date(localRecord[`${key}_updatedAt`]).getTime()
      : localTime;
    const remoteFieldTime = remoteRecord[`${key}_updatedAt`]
      ? new Date(remoteRecord[`${key}_updatedAt`]).getTime()
      : remoteTime;

    if (remoteFieldTime >= localFieldTime) {
      merged[key] = remoteVal;
    } else {
      merged[key] = localVal;
    }
  }

  return merged;
}
