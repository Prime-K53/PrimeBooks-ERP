import { supabase } from './supabaseClient';
import { dbService } from './db';
import { mergeRecords, fieldLevelMerge } from './syncConflictResolver';
import { durableSyncQueue } from './durableSyncQueue';
import { logger } from './logger';

const getCompanyId = (): string | null => {
  try {
    const raw = localStorage.getItem('nexus_company_config');
    if (!raw) return null;
    return JSON.parse(raw).companyId || null;
  } catch {
    return null;
  }
};

const SUPABASE_ENABLED = Boolean(
  import.meta.env.VITE_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_ANON_KEY &&
  import.meta.env.VITE_SUPABASE_URL !== 'https://placeholder.supabase.co'
);

const PUSH_INTERVAL_MS = 60000;
const SYNC_CONCURRENCY = 6;
let pushTimer: ReturnType<typeof setInterval> | null = null;
let realtimeSubscribed = false;
let realtimeChannels: any[] = [];

export interface SyncProgress {
  totalStores: number;
  completedStores: number;
  currentStore: string;
  phase: 'pull' | 'push' | 'done';
}

const STORE_TO_TABLE: Record<string, string> = {
  warehouses: 'warehouses',
  inventory: 'products',
  ledger: 'ledger_entries',
  batches: 'production_batches',
  resources: 'production_resources',
  workCenters: 'work_centers',
  workOrders: 'work_orders',
  salesOrders: 'sales_orders',
  userGroups: 'user_groups',
  bomTemplates: 'bom_templates',
  bankAccounts: 'bank_accounts',
  customerPayments: 'customer_payments',
  examinationBatches: 'examination_batches',
  auditLogs: 'audit_logs',
  goodsReceipts: 'goods_receipts',
  supplierPayments: 'supplier_payments',
  resourceAllocations: 'resource_allocations',
  profitMarginSettings: 'profit_margin_settings',
  marketAdjustments: 'market_adjustments',
  materialCategories: 'material_categories',
  warehouseInventory: 'warehouse_inventory',
  materialBatches: 'material_batches',
  inventoryTransactions: 'inventory_transactions',
  materialReservations: 'material_reservations',
  bankTransactions: 'bank_transactions',
  bankStatements: 'bank_statements',
  bankScheduledPayments: 'bank_scheduled_payments',
  bankExchangeRates: 'bank_exchange_rates',
  bankFees: 'bank_fees',
  bankReconciliations: 'bank_reconciliations',
  bankAdjustments: 'bank_adjustments',
  bankCashFlowForecasts: 'bank_cash_flow_forecasts',
  bankAlerts: 'bank_alerts',
  bankCategories: 'bank_categories',
  idempotencyKeys: 'idempotency_keys',
  customerNotificationLogs: 'customer_notification_logs',
  whatsappChats: 'whatsapp_chats',
  whatsappTemplates: 'whatsapp_templates',
  whatsappCampaigns: 'whatsapp_campaigns',
  whatsappAutomations: 'whatsapp_automations',
  vatTransactions: 'vat_transactions',
  vatReturns: 'vat_returns',
  roundingLogs: 'rounding_logs',
  examinationJobs: 'examination_jobs',
  examinationJobSubjects: 'examination_job_subjects',
  examinationInvoiceGroups: 'examination_invoice_groups',
  examinationRecurringProfiles: 'examination_recurring_profiles',
  examinationInventoryDeductions: 'examination_inventory_deductions',
  examinationBatchNotifications: 'examination_batch_notifications',
  smsCampaigns: 'sms_campaigns',
  smsTemplates: 'sms_templates',
  subcontractOrders: 'subcontract_orders',
  maintenanceLogs: 'maintenance_logs',
  jobTickets: 'job_tickets',
  jobTicketSettings: 'job_ticket_settings',
  jobOrders: 'job_orders',
  examJobs: 'examination_jobs',
  examPapers: 'examination_papers',
  examPrintingBatches: 'examination_printing_batches',
  salesExchanges: 'sales_exchanges',
  salesExchangeItems: 'sales_exchange_items',
  reprintJobs: 'reprint_jobs',
  salesExchangeApprovals: 'sales_exchange_approvals',
  marketAdjustmentTransactions: 'market_adjustment_transactions',
  notificationAuditLogs: 'notification_audit_logs',
  classes: 'classes',
  subjects: 'subjects',
  recurringInvoices: 'recurring_invoices',
  scheduledPayments: 'scheduled_payments',
  walletTransactions: 'wallet_transactions',
  deliveryNotes: 'delivery_notes',
  payrollRuns: 'payroll_runs',
  expenses: 'expenses',
  income: 'income',
  budgets: 'budgets',
  transfers: 'transfers',
  cheques: 'cheques',
  employees: 'employees',
  payslips: 'payslips',
  subscribers: 'subscribers',
  shipments: 'shipments',
  schools: 'schools',
  tasks: 'tasks',
};

const TABLES_TO_SYNC = [
  'users', 'userGroups', 'inventory', 'warehouses', 'customers', 'suppliers',
  'sales', 'invoices', 'purchases', 'accounts', 'ledger',
  'settings', 'reminders',
  'workCenters', 'workOrders', 'batches', 'resources',
  'salesOrders', 'quotations', 'orders',
  'jobOrders', 'examJobs', 'salesExchanges', 'reprintJobs',
  'examinationBatches', 'examinationJobs',
  'bomTemplates', 'boms', 'profitMarginSettings', 'marketAdjustments',
  'bankAccounts', 'bankTransactions', 'bankStatements',
  'customerPayments', 'supplierPayments', 'goodsReceipts',
  'recurringInvoices', 'scheduledPayments', 'walletTransactions',
  'deliveryNotes', 'payrollRuns',
  'vatTransactions', 'vatReturns', 'roundingLogs',
  'expenses', 'income', 'budgets', 'transfers', 'cheques',
  'employees', 'payslips',
  'materialCategories', 'warehouseInventory', 'materialBatches',
  'inventoryTransactions', 'materialReservations',
  'jobTickets', 'jobTicketSettings', 'resourceAllocations',
  'examinationJobSubjects', 'examinationInvoiceGroups',
  'examinationRecurringProfiles', 'examinationInventoryDeductions',
  'examinationBatchNotifications',
  'examPapers', 'examPrintingBatches',
  'salesExchangeItems', 'salesExchangeApprovals',
  'subcontractOrders', 'maintenanceLogs', 'classes', 'subjects',
  'subscribers', 'shipments', 'schools', 'tasks',
  'bankScheduledPayments', 'bankExchangeRates', 'bankFees',
  'bankReconciliations', 'bankAdjustments', 'bankCashFlowForecasts',
  'bankAlerts', 'bankCategories',
  'smsCampaigns', 'smsTemplates',
  'marketAdjustmentTransactions', 'notificationAuditLogs',
  'whatsappChats', 'whatsappTemplates', 'whatsappCampaigns', 'whatsappAutomations',
];

const getTable = (storeName: string): string => STORE_TO_TABLE[storeName] || storeName;

async function ensureSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session;
  try {
    const { data: { session: refreshed } } = await supabase.auth.refreshSession();
    if (refreshed) return refreshed;
  } catch {
    // Refresh token expired or invalid — skip sync, fall back to local
  }
  return null;
}

const LAST_SYNC_META_PREFIX = 'last_synced_at:';

/**
 * Get the last successful sync timestamp for a given table
 */
async function getLastSyncAt(table: string): Promise<string | null> {
  try {
    const val = await durableSyncQueue.getMeta(`${LAST_SYNC_META_PREFIX}${table}`);
    return val as string | null;
  } catch {
    return null;
  }
}

/**
 * Save the last successful sync timestamp for a given table
 */
async function setLastSyncAt(table: string, timestamp: string): Promise<void> {
  await durableSyncQueue.setMeta(`${LAST_SYNC_META_PREFIX}${table}`, timestamp);
}

/**
 * Pull data from Supabase into local IndexedDB cache using incremental sync.
 * Only fetches rows updated since last sync per table.
 * Falls back to full sync if no prior sync exists.
 */
export async function pullRemoteChanges(
  onProgress?: (progress: SyncProgress) => void,
  forceFullSync: boolean = false
): Promise<{ pulled: number; errors: string[] }> {
  if (!SUPABASE_ENABLED) return { pulled: 0, errors: [] };

  const session = await ensureSession();
  if (!session) return { pulled: 0, errors: ['Not authenticated'] };

  const errors: string[] = [];
  let pulled = 0;
  const totalStores = TABLES_TO_SYNC.length;
  let completedStores = 0;
  const companyId = getCompanyId();

  for (let i = 0; i < totalStores; i += SYNC_CONCURRENCY) {
    const batch = TABLES_TO_SYNC.slice(i, i + SYNC_CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (storeName) => {
        const table = getTable(storeName);
        let storeCount = 0;

        try {
          let query = supabase.from(table).select('*');

          if (companyId) query = query.eq('company_id', companyId);

          // Incremental sync: only fetch rows updated since last sync
          if (!forceFullSync) {
            const lastSyncAt = await getLastSyncAt(table);
            if (lastSyncAt) {
              query = query.gte('updated_at', lastSyncAt);
            }
          }

          const { data, error } = await query
            .order('updated_at', { ascending: true })
            .limit(10000);

          if (error) { errors.push(`${storeName}: ${error.message}`); return 0; }
          if (!data || data.length === 0) return 0;

          const cloudRecords = data.map((record: any) => {
            const { data: jsonData, updated_at, ...rest } = record;
            return { id: record.id, ...rest, ...(jsonData || {}), _cloudSource: true };
          });

          // Apply field-level merge for existing records, skip for new ones
          // All cloud records are marked _cloudSource: true so they don't trigger re-sync
          const mergedRecords = [];
          for (const cloudRecord of cloudRecords) {
            const existing = await dbService.get(storeName, cloudRecord.id);
            if (existing) {
              const merged = fieldLevelMerge(existing, cloudRecord);
              merged._cloudSource = true;
              await dbService.put(storeName, merged);
            } else {
              mergedRecords.push(cloudRecord as Record<string, unknown>);
            }
          }
          if (mergedRecords.length > 0) {
            await dbService.bulkPut(storeName, mergedRecords);
          }

          // Track the latest updated_at for incremental sync
          const lastTimestamp = data[data.length - 1]?.updated_at;
          if (lastTimestamp) {
            await setLastSyncAt(table, lastTimestamp);
          }

          storeCount = cloudRecords.length;
        } catch (err) {
          errors.push(`${storeName}: ${err instanceof Error ? err.message : 'Unknown'}`);
        }

        return storeCount;
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        pulled += result.value;
      }
    }

    completedStores += batch.length;
    onProgress?.({
      totalStores,
      completedStores,
      currentStore: batch[batch.length - 1] || '',
      phase: 'pull',
    });
  }

  if (pulled > 0) {
    localStorage.setItem('nexus_last_sync_pull', new Date().toISOString());
  }

  return { pulled, errors };
}

/**
 * Push offline-queued mutations from IndexedDB syncOutbox to Supabase.
 * Called when coming back online and periodically.
 */
export async function pushLocalChanges(): Promise<{ pushed: number; errors: string[] }> {
  if (!SUPABASE_ENABLED) return { pushed: 0, errors: [] };

  const session = await ensureSession();
  if (!session) return { pushed: 0, errors: ['Not authenticated'] };

  const errors: string[] = [];
  let pushed = 0;

  const outbox = await dbService.getAll<any>('syncOutbox');
  if (outbox.length === 0) return { pushed: 0, errors: [] };

  for (const entry of outbox) {
    try {
      const [storeName, operation] = entry.type.split(':');
      const table = getTable(storeName);

      if (operation === 'delete') {
        const { error } = await supabase
          .from(table)
          .delete()
          .eq('id', entry.entityId);
        if (error) throw error;
      } else {
        const cleanPayload = { ...entry.payload };
        delete cleanPayload._updatedAt;
        delete cleanPayload._cloudSource;
        const companyId = cleanPayload.company_id;
        const { id, ...domainData } = cleanPayload;
        const record: Record<string, unknown> = {
          id: id || entry.entityId,
          data: domainData,
          updated_at: new Date().toISOString(),
        };
        if (companyId) {
          record.company_id = companyId;
        }
        const { error } = await supabase
          .from(table)
          .upsert(record, {
            onConflict: 'id',
            ignoreDuplicates: false,
          });
        if (error) throw error;
      }

      await dbService.delete('syncOutbox', entry.id);
      pushed++;
    } catch (err) {
      errors.push(`${entry.type}/${entry.entityId}: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  if (pushed > 0) {
    localStorage.setItem('nexus_last_sync', new Date().toISOString());
  }

  return { pushed, errors };
}

export async function fullSync(
  onProgress?: (progress: SyncProgress) => void
): Promise<{ pulled: number; pushed: number; errors: string[] }> {
  onProgress?.({ totalStores: 0, completedStores: 0, currentStore: '', phase: 'push' });
  const pushResult = await pushLocalChanges();
  const pullResult = await pullRemoteChanges(onProgress);
  onProgress?.({ totalStores: 0, completedStores: 0, currentStore: '', phase: 'done' });
  return {
    pulled: pullResult.pulled,
    pushed: pushResult.pushed,
    errors: [...pushResult.errors, ...pullResult.errors],
  };
}

/**
 * Subscribe to real-time changes from Supabase.
 * When another device makes a change, it's pushed to all connected clients.
 */
function subscribeToRemoteChanges() {
  if (!SUPABASE_ENABLED || realtimeSubscribed) return;
  realtimeSubscribed = true;

  const companyId = getCompanyId();

  for (const storeName of TABLES_TO_SYNC) {
    const table = getTable(storeName);

    try {
      const filter: Record<string, string> = { event: '*', schema: 'public', table };
      if (companyId) {
        filter.filter = `company_id=eq.${companyId}`;
      }
      const channel = supabase
        .channel(`public:${table}`)
        .on(
          'postgres_changes' as const,
          filter,
          async (payload: any) => {
            try {
              if (payload.eventType === 'DELETE') {
                try { await dbService.delete(storeName, payload.old.id); } catch (e) { logger.error("Operation failed", e as Error); }
              } else if (payload.new) {
                const { data: jsonData, updated_at, ...rest } = payload.new;
                const cloudRecord = { id: payload.new.id, ...rest, ...(jsonData || {}), _cloudSource: true };
                const local = await dbService.get(storeName, payload.new.id);
                if (local) {
                  const merged = fieldLevelMerge(local, cloudRecord);
                  merged._cloudSource = true;
                  await dbService.put(storeName, merged as Record<string, unknown>);
                } else {
                  await dbService.put(storeName, cloudRecord as Record<string, unknown>);
                }
              }
            } catch {
              // best-effort realtime sync
            }
          }
        )
        .subscribe((status: string) => {
          // On reconnection, trigger an incremental pull to catch missed events
          if (status === 'SUBSCRIBED') {
            import('./backgroundSyncService').then(({ backgroundSyncService }) => {
              backgroundSyncService.trigger();
            }).catch(() => {});
          }
        });

      realtimeChannels.push(channel);
    } catch {
      // best-effort subscription setup
    }
  }
}

function unsubscribeFromRemoteChanges() {
  for (const channel of realtimeChannels) {
    try { supabase.removeChannel(channel); } catch { /* skip */ }
  }
  realtimeChannels = [];
  realtimeSubscribed = false;
}

export function startPeriodicSync(
  intervalMs = PUSH_INTERVAL_MS,
  onSyncComplete?: (result: { pulled: number; pushed: number; errors: string[] }) => void
) {
  if (!SUPABASE_ENABLED) return;
  if (pushTimer) clearInterval(pushTimer);

  subscribeToRemoteChanges();

  // Start the durable background sync engine (processes the durable queue,
  // handles realtime recovery, incremental pulls, and retries forever)
  import('./backgroundSyncService').then(({ backgroundSyncService }) => {
    backgroundSyncService.start();
  });

  // Periodic pull (incremental sync) - 30 second interval for catching missed realtime events
  pushTimer = setInterval(async () => {
    if (navigator.onLine) {
      const result = await pullRemoteChanges().catch(() => ({ pulled: 0, errors: [] }));
    }
  }, Math.min(intervalMs, 30000));

  // Initial sync on start - full pull on first sync, then incremental
  if (navigator.onLine) {
    const isFirstSync = !localStorage.getItem('nexus_last_sync_pull');
    pullRemoteChanges(undefined, isFirstSync).then(result => {
      onSyncComplete?.({ pulled: result.pulled, pushed: 0, errors: result.errors });
    }).catch(err => console.warn('[Sync] Initial pull failed:', err));
  } else {
    onSyncComplete?.({ pulled: 0, pushed: 0, errors: ['offline'] });
  }
}

export function stopPeriodicSync() {
  if (pushTimer) {
    clearInterval(pushTimer);
    pushTimer = null;
  }
  unsubscribeFromRemoteChanges();
}
