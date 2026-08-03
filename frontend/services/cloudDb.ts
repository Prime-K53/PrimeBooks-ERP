import { supabase } from './supabaseClient';
import { isSupabaseConfigured } from './cloudMode';
import { logger } from './logger';
import { stringToUuid5 } from '../utils/uuid';

export const STORE_TO_TABLE: Record<string, string> = {
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
  productionBatches: 'production_batches',
  productionResources: 'production_resources',
  goodsReceipts: 'goods_receipts',
  supplierPayments: 'supplier_payments',
  resourceAllocations: 'resource_allocations',
  profitMarginSettings: 'profit_margin_settings',
  marketAdjustments: 'market_adjustments',
  materialCategories: 'material_categories',
  taxRates: 'tax_rates',
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
  shipments: 'shipments',
  schools: 'schools',
  tasks: 'tasks',
  referrals: 'customer_referrals',
  referralRewards: 'referral_rewards',
  referralTimeline: 'referral_timeline',
  referralAuditLogs: 'referral_audit_logs',
  referralCampaigns: 'referral_campaigns',
  referralAnalytics: 'referral_analytics',
  referralReversals: 'referral_reversals',
  referralEventHistory: 'referral_event_history',
  engagementTimeline: 'engagement_timeline',
  engagementAudit: 'engagement_audit',
  engagementPoints: 'engagement_points',
  engagementPointBalances: 'engagement_point_balances',
  engagementCashback: 'engagement_cashback',
  engagementMembershipTiers: 'engagement_membership_tiers',
  engagementCustomerTiers: 'engagement_customer_tiers',
  engagementGiftCards: 'engagement_gift_cards',
  engagementGiftCardTransactions: 'engagement_gift_card_transactions',
  engagementAffiliates: 'engagement_affiliates',
  engagementAffiliateCommissions: 'engagement_affiliate_commissions',
  engagementPromotions: 'engagement_promotions',
  engagementCustomerRewards: 'engagement_customer_rewards',
  engagementAnalytics: 'engagement_analytics',

  // Financial years & user preferences for cross-device sync
  financialYears: 'financial_years',
  userPreferences: 'user_preferences',

};

const SUPABASE_ENABLED = isSupabaseConfigured();
const FILE_BUCKET = 'prime-erp-files';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

const getTable = (storeName: string): string => STORE_TO_TABLE[storeName] || storeName;

async function ensureSession(signal?: AbortSignal) {
  if (!SUPABASE_ENABLED) return null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) return session;
  } catch {
    // getSession threw — don't return null yet, try refresh below
  }
  try {
    const { data: { session: refreshed } } = await supabase.auth.refreshSession();
    if (refreshed) return refreshed;
  } catch {
    // Refresh token expired or invalid — fall back to local operations
  }
  return null;
}

const SESSION_TIMEOUT_MS = 8_000;

interface CloudPutOptions {
  cloudSource?: boolean;
}

async function withSession<T>(fn: () => Promise<T>): Promise<T> {
  const session = await ensureSession();
  if (!session) throw new Error('No Supabase session available');
  return fn();
}

export const cloudDb = {
  isConfigured: () => SUPABASE_ENABLED,

  getRealtimeTables(): string[] {
    return Array.from(new Set([
      ...Object.values(STORE_TO_TABLE),
      'customers',
      'products',
      'sales',
      'invoices',
      'expenses',
      'suppliers',
      'purchase_orders',
      'inventory_movements',
      'profiles',
      'users',
      'financial_years',
    ]));
  },

  async getCurrentProfile(): Promise<any | null> {
    return withSession(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return null;

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      return profile || null;
    });
  },

  async listCompanyProfiles(): Promise<any[] | null> {
    return withSession(async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data || [];
    });
  },

  async upsertProfile(profile: Record<string, any>): Promise<string | null> {
    return withSession(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = profile.user_id || profile.userId || profile.id || user?.id;
      if (!userId) return null;

      const profileData = { ...profile };
      delete profileData.password;
      delete profileData.confirmPassword;
      delete profileData.profile_id;
      delete profileData.profileId;
      delete profileData.user_id;
      delete profileData.userId;

      const payload = {
        id: profile.profile_id || profile.profileId || crypto.randomUUID(),
        user_id: userId,
        full_name: profile.full_name || profile.fullName || profile.name || user?.email?.split('@')[0] || 'User',
        role: profile.role || 'Sales Staff',
        status: profile.status || 'Active',
        data: profileData,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('profiles')
        .upsert(payload, { onConflict: 'user_id' })
        .select('id')
        .single();

      if (error) throw error;
      return data?.id || null;
    });
  },


  async getAll<T>(storeName: string): Promise<T[] | null> {
    return withSession(async () => {
      const table = getTable(storeName);
      const query = supabase.from(table).select('*');
      const { data, error } = await query.order('updated_at', { ascending: false });
      if (error) throw error;
      return (data || []).map((r: any) => {
        const { data: jsonData, updated_at, ...rest } = r;
        return { id: r.id, ...rest, ...(jsonData || {}) } as T;
      });
    });
  },

  async get<T>(storeName: string, id: string): Promise<T | null> {
    return withSession(async () => {
      const table = getTable(storeName);
      const query = supabase.from(table).select('*').eq('id', id);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const { data: jsonData, updated_at, ...rest } = data;
      return { id: data.id, ...rest, ...(jsonData || {}) } as T;
    });
  },

  /**
   * Check if an operation has already been processed (idempotency check).
   */
  _idempotencyTableReady: null as boolean | null,
  _idempotencyCache: new Map(),
  _idempotencyCacheMax: 500,
  _idempotencyCacheTtl: 60_000,
  _pendingChecks: new Map(),

  async _ensureIdempotencyTable(): Promise<boolean> {
    if (this._idempotencyTableReady !== null) return this._idempotencyTableReady;
    try {
      const { error } = await supabase
        .from('idempotency_keys')
        .select('id', { head: true, count: 'exact' })
        .limit(0);
      this._idempotencyTableReady = !error;
    } catch {
      this._idempotencyTableReady = false;
    }
    return this._idempotencyTableReady;
  },

  async checkIdempotency(operationId: string): Promise<{ alreadyProcessed: boolean; result?: string | null }> {
    // Check local cache first
    const cached = this._idempotencyCache.get(operationId);
    if (cached && Date.now() - cached.ts < this._idempotencyCacheTtl) {
      return { alreadyProcessed: cached.alreadyProcessed, result: cached.result };
    }

    // Deduplicate concurrent checks for the same operationId
    const pending = this._pendingChecks.get(operationId);
    if (pending) return pending;

    const promise = this._performIdempotencyCheck(operationId);
    this._pendingChecks.set(operationId, promise);
    try {
      return await promise;
    } finally {
      this._pendingChecks.delete(operationId);
    }
  },

  async _performIdempotencyCheck(operationId: string): Promise<{ alreadyProcessed: boolean; result?: string | null }> {
    if (!(await this._ensureIdempotencyTable())) return { alreadyProcessed: false };
    try {
      const uuidId = await stringToUuid5(operationId);
      const query = supabase
        .from('idempotency_keys')
        .select('result')
        .eq('id', uuidId);
      const { data } = await query.maybeSingle();
      const result = data
        ? { alreadyProcessed: true, result: data.result as string | null }
        : { alreadyProcessed: false };

      // Cache the result
      if (this._idempotencyCache.size >= this._idempotencyCacheMax) {
        const oldest = this._idempotencyCache.keys().next().value;
        if (oldest) this._idempotencyCache.delete(oldest);
      }
      this._idempotencyCache.set(operationId, { ...result, ts: Date.now() });

      return result;
    } catch {
      return { alreadyProcessed: false };
    }
  },

  /**
   * Record an idempotency key after successful operation.
   */
  async recordIdempotency(operationId: string, result: string, ttlMs: number = 86400000): Promise<void> {
    if (!(await this._ensureIdempotencyTable())) return;
    try {
      const uuidId = await stringToUuid5(operationId);
      const record: any = {
        id: uuidId,
        result,
        expires_at: new Date(Date.now() + ttlMs).toISOString(),
      };
      await supabase.from('idempotency_keys').upsert(record, { onConflict: 'id' });
    } catch {
      // Idempotency recording is best-effort
    }
  },

  async put<T>(
    storeName: string,
    item: T,
    operationId?: string,
    options: CloudPutOptions = {}
  ): Promise<{ id: string | null; updatedAt?: string; createdAt?: string; version?: number } | null> {
    return withSession(async () => {
      const raw = { ...(item as Record<string, unknown>) };
      const isCloudSource = options.cloudSource === true || raw._cloudSource === true;

      // Idempotency check
      const opId = operationId || (raw._operationId as string | undefined);
      if (opId) {
        const { alreadyProcessed, result } = await this.checkIdempotency(opId);
        if (alreadyProcessed) {
          return result ? { id: result } : null;
        }
      }

      const table = getTable(storeName);
      const version = raw._version as number | undefined;
      delete raw._updatedAt;
      delete raw._cloudSource;
      delete raw._operationId;
      delete raw._version;
      delete raw.dependsOn;

      const { id, ...domainData } = raw;
      const record: Record<string, unknown> = {
        id: id || crypto.randomUUID(),
        data: domainData,
      };

      if (!isCloudSource) {
        record.updated_at = new Date().toISOString();
      } else if (typeof raw.updated_at === 'string' && raw.updated_at.trim()) {
        record.updated_at = raw.updated_at;
      }

      // Use `any` type for the query builder chain to avoid complex type inference issues
      // with Supabase's PostgrestBuilder/PostgrestFilterBuilder type hierarchy
      let query: any = supabase
        .from(table)
        .upsert(record, { onConflict: 'id', ignoreDuplicates: false })
        .select('*')
        .single();

      if (version !== undefined) {
        query = query.eq('version', version);
      }

      const { data, error } = await query;
      if (error) throw error;

      const result = {
        id: data?.id || id || null,
        updatedAt: data?.updated_at ? String(data.updated_at) : undefined,
        createdAt: data?.created_at ? String(data.created_at) : undefined,
        version: data?.version ? Number(data.version) : undefined,
      };

      // Record idempotency
      if (opId && result.id) {
        await this.recordIdempotency(opId, result.id);
      }

      return result;
    });
  },

  async delete(storeName: string, id: string, operationId?: string): Promise<boolean | null> {
    return withSession(async () => {
      // Idempotency check
      if (operationId) {
        const { alreadyProcessed } = await this.checkIdempotency(operationId);
        if (alreadyProcessed) return true;
      }

      const table = getTable(storeName);
      const query = supabase.from(table).delete().eq('id', id);
      const { error } = await query;
      if (error) throw error;

      // Record idempotency
      if (operationId) {
        await this.recordIdempotency(operationId, id);
      }

      return true;
    });
  },

  async getSetting<T>(key: string): Promise<T | null> {
    return withSession(async () => {
      const query = supabase
        .from('settings')
        .select('data')
        .eq('id', key);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data?.data as T ?? null;
    });
  },

  async saveSetting<T>(key: string, value: T): Promise<void | null> {
    return withSession(async () => {
      const record: Record<string, unknown> = {
        id: key,
        data: value,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('settings')
        .upsert(record, { onConflict: 'id' });
      if (error) throw error;
    });
  },

  async uploadFile(file: File, folder = 'documents', operationId?: string): Promise<string | null> {
    return withSession(async () => {
      // Idempotency check for file uploads
      if (operationId) {
        const { alreadyProcessed, result } = await this.checkIdempotency(operationId);
        if (alreadyProcessed) return result || null;
      }

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${folder}/${crypto.randomUUID()}-${safeName}`;
      const { data: uploadData, error } = await supabase.storage
        .from(FILE_BUCKET)
        .upload(path, file, {
          cacheControl: '3600',
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        });

      if (error) {
        if (String(error.message || error.statusCode || '').includes('bucket')) {
          logger.error(`[CloudDB] Storage bucket '${FILE_BUCKET}' not found. Create it in Supabase Dashboard → Storage.`, error);
        } else {
          logger.error(`[CloudDB] File upload failed for ${path}`, error);
        }
        throw error;
      }
      const result = `storage:${FILE_BUCKET}:${path}`;

      // Record idempotency
      if (operationId) {
        await this.recordIdempotency(operationId, result);
      }

      return result;
    });
  },

  async createSignedFileUrl(fileId: string, expiresIn = SIGNED_URL_TTL_SECONDS): Promise<string | null> {
    return withSession(async () => {
      const match = /^storage:([^:]+):(.+)$/.exec(fileId);
      if (!match) return null;
      const [, bucket, path] = match;
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, expiresIn);

      if (error) throw error;
      return data.signedUrl;
    });
  },

  async downloadFile(fileId: string): Promise<Blob | null> {
    return withSession(async () => {
      const match = /^storage:([^:]+):(.+)$/.exec(fileId);
      if (!match) return null;
      const [, bucket, path] = match;
      const { data, error } = await supabase.storage
        .from(bucket)
        .download(path);

      if (error) throw error;
      return data;
    });
  },
};

export default cloudDb;
