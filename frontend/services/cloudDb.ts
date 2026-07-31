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

let activeCompanyId: string | null = null;

export const setActiveCompanyId = (companyId: string | null | undefined) => {
  activeCompanyId = companyId || null;
};

const getStoredCompanyId = (): string | null => {
  try {
    const raw = localStorage.getItem('nexus_company_config');
    if (!raw) return null;
    return JSON.parse(raw).companyId || null;
  } catch {
    return null;
  }
};

const jwtDecode = (token: string): Record<string, unknown> | null => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
};

const extractCompanyIdFromSession = async (): Promise<string | null> => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;
    const claims = jwtDecode(session.access_token);
    if (!claims) return null;
    const metadata = claims.user_metadata as Record<string, unknown> | undefined;
    return (metadata?.company_id as string) || null;
  } catch {
    return null;
  }
};

const getCompanyId = async (): Promise<string | null> => {
  if (activeCompanyId) return activeCompanyId;

  const storedCompanyId = getStoredCompanyId();
  if (storedCompanyId) {
    activeCompanyId = storedCompanyId;
    return activeCompanyId;
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();
    const metadataCompanyId = user?.user_metadata?.company_id;
    if (metadataCompanyId) {
      activeCompanyId = metadataCompanyId;
      return activeCompanyId;
    }

    if (user?.id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profile?.company_id) {
        activeCompanyId = profile.company_id;
        return activeCompanyId;
      }
    }

    const sessionCompanyId = await extractCompanyIdFromSession();
    if (sessionCompanyId) {
      activeCompanyId = sessionCompanyId;
      return activeCompanyId;
    }
  } catch {
    return null;
  }

  return null;
};

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

async function withSession<T>(fn: () => Promise<T>): Promise<T> {
  const session = await ensureSession();
  if (!session) throw new Error('No Supabase session available');
  return fn();
}

export const cloudDb = {
  isConfigured: () => SUPABASE_ENABLED,
  setActiveCompanyId,

  async getActiveCompanyId(): Promise<string | null> {
    return getCompanyId();
  },

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
      'companies',
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
      if (profile) {
        setActiveCompanyId(profile.company_id);
        return profile;
      }

      return null;
    });
  },

  async listCompanyProfiles(): Promise<any[] | null> {
    return withSession(async () => {
      const companyId = await getCompanyId();
      if (!companyId) return [];

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data || [];
    });
  },

  async getCompany(companyId?: string | null): Promise<any | null> {
    return withSession(async () => {
      const targetCompanyId = companyId || await getCompanyId();
      if (!targetCompanyId) return null;

      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('id', targetCompanyId)
        .maybeSingle();

      if (!error && data) {
        setActiveCompanyId(data.id);
        return data;
      }

      const { data: legacyConfig, error: legacyError } = await supabase
        .from('company_config')
        .select('*')
        .eq('id', targetCompanyId)
        .maybeSingle();

      if (legacyError) throw legacyError;
      return legacyConfig;
    });
  },

  async upsertCompany(config: Record<string, any>): Promise<string | null> {
    return withSession(async () => {
      const id = config.companyId || config.id || crypto.randomUUID();

      // Minimal payload — only columns guaranteed by the SQL schema.
      // Other fields (email, phone, logo_url, etc.) are stored in the data JSONB.
      const payload: Record<string, any> = {
        id,
        company_name: config.companyName || config.company_name || 'Prime ERP Company',
        data: { ...config, companyId: id },
        updated_at: new Date().toISOString(),
      };

      // We already know the ID — avoid .select() because the SELECT RLS policy
      // requires a profile (which doesn't exist yet during first-time setup).
      const doUpsert = (p: Record<string, any>) => supabase
        .from('companies')
        .upsert(p, { onConflict: 'id' });

      const doInsert = (p: Record<string, any>) => supabase
        .from('companies')
        .insert(p);

      const doUpdate = (p: Record<string, any>) => supabase
        .from('companies')
        .update(p)
        .eq('id', id);

      // Use upsert (handles both insert and update for existing rows)
      const { error: uErr } = await doUpsert(payload);
      if (!uErr) {
        setActiveCompanyId(id);
        return id;
      }

      // If upsert failed, try update directly (row may exist but upsert blocked by RLS)
      const { error: updErr } = await doUpdate(payload);
      if (!updErr) {
        setActiveCompanyId(id);
        return id;
      }

      // If the error mentions the "data" JSONB column, retry without it
      const msg = ((uErr?.message || '') + (uErr?.details || '')).toLowerCase();
      if (msg.includes('column "data"')) {
        logger.warn('[CloudDB] Retrying company creation without data column');
        const slim = { id: payload.id, company_name: payload.company_name, updated_at: payload.updated_at };
        const { error: suErr } = await doUpsert(slim);
        if (!suErr) {
          setActiveCompanyId(id);
          return id;
        }
        const { error: suErr2 } = await doUpdate(slim);
        if (!suErr2) {
          setActiveCompanyId(id);
          return id;
        }
      }

      throw uErr || new Error('Failed to create or update company');
    });
  },

  async upsertProfile(profile: Record<string, any>): Promise<string | null> {
    return withSession(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = profile.user_id || profile.userId || profile.id || user?.id;
      const companyId = profile.company_id || profile.companyId || await getCompanyId();
      if (!userId || !companyId) return null;

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
        company_id: companyId,
        full_name: profile.full_name || profile.fullName || profile.name || user?.email?.split('@')[0] || 'User',
        role: profile.role || 'Sales Staff',
        status: profile.status || 'Active',
        data: profileData,
        updated_at: new Date().toISOString(),
      };

      // First attempt: upsert (handles both new and existing profile rows).
      const { data, error } = await supabase
        .from('profiles')
        .upsert(payload, { onConflict: 'user_id' })
        .select('id')
        .single();

      if (!error) {
        setActiveCompanyId(companyId);
        return data.id;
      }

      // If the FK violation occurs (company_id not in companies yet), the most
      // likely cause is a timing issue: the trigger already wrote a profile row
      // with company_id = NULL before the company was created. Attempt a targeted
      // UPDATE to set the company_id now that the company row exists.
      const isFkViolation = error.code === '23503' ||
        (error.message || '').includes('violates foreign key constraint');

      if (isFkViolation) {
        logger.warn('[CloudDB] upsertProfile: FK violation — retrying as UPDATE to set company_id on existing profile');
        const { data: updData, error: updError } = await supabase
          .from('profiles')
          .update({
            company_id: companyId,
            full_name: payload.full_name,
            role: payload.role,
            status: payload.status,
            data: payload.data,
            updated_at: payload.updated_at,
          })
          .eq('user_id', userId)
          .select('id')
          .single();

        if (!updError) {
          setActiveCompanyId(companyId);
          return updData.id;
        }
        logger.error('[CloudDB] upsertProfile: UPDATE retry also failed:', updError);
        throw updError;
      }

      throw error;
    });
  },


  async getAll<T>(storeName: string): Promise<T[] | null> {
    return withSession(async () => {
      const table = getTable(storeName);
      const companyId = await getCompanyId();
      let query = supabase.from(table).select('*');
      if (companyId) {
        query = query.eq('company_id', companyId);
      }
      const { data, error } = await query.order('updated_at', { ascending: false });
      if (error) throw error;
      return (data || []).map((r: any) => {
        const { data: jsonData, updated_at, company_id, ...rest } = r;
        return { id: r.id, ...rest, ...(jsonData || {}), _companyId: company_id } as T;
      });
    });
  },

  async get<T>(storeName: string, id: string): Promise<T | null> {
    return withSession(async () => {
      const table = getTable(storeName);
      const companyId = await getCompanyId();
      let query = supabase.from(table).select('*').eq('id', id);
      if (companyId) {
        query = query.eq('company_id', companyId);
      }
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const { data: jsonData, updated_at, company_id, ...rest } = data;
      return { id: data.id, ...rest, ...(jsonData || {}), _companyId: company_id } as T;
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
      const companyId = await getCompanyId();
      const uuidId = await stringToUuid5(operationId);
      let query = supabase
        .from('idempotency_keys')
        .select('result')
        .eq('id', uuidId);
      if (companyId) query = query.eq('company_id', companyId);
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
      const companyId = await getCompanyId();
      const uuidId = await stringToUuid5(operationId);
      const record: any = {
        id: uuidId,
        result,
        expires_at: new Date(Date.now() + ttlMs).toISOString(),
      };
      if (companyId) record.company_id = companyId;
      await supabase.from('idempotency_keys').upsert(record, { onConflict: 'id' });
    } catch {
      // Idempotency recording is best-effort
    }
  },

  async put<T>(storeName: string, item: T, operationId?: string): Promise<{ id: string | null; updatedAt?: string; createdAt?: string; version?: number } | null> {
    return withSession(async () => {
      const raw = { ...(item as Record<string, unknown>) };

      // Idempotency check
      const opId = operationId || (raw._operationId as string | undefined);
      if (opId) {
        const { alreadyProcessed, result } = await this.checkIdempotency(opId);
        if (alreadyProcessed) {
          return result ? { id: result } : null;
        }
      }

      const table = getTable(storeName);
      let companyId = await getCompanyId();
      const itemCompanyId = raw._companyId as string | undefined;
      if (!companyId && itemCompanyId) {
        companyId = itemCompanyId;
        activeCompanyId = itemCompanyId;
      }

      const version = raw._version as number | undefined;
      delete raw._updatedAt;
      delete raw._cloudSource;
      delete raw._companyId;
      delete raw._operationId;
      delete raw._version;
      delete raw.dependsOn;

      const { id, ...domainData } = raw;
      const record: Record<string, unknown> = {
        id: id || crypto.randomUUID(),
        data: domainData,
        updated_at: new Date().toISOString(),
      };
      if (companyId) {
        record.company_id = companyId;
      } else {
        console.warn(`[cloudDb] No company_id for ${storeName} (id: ${record.id}). companyId=${JSON.stringify(companyId)}, item._companyId=${JSON.stringify(raw._companyId)}. Attempting direct profile lookup...`);
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user?.id) {
            const { data: profile, error: profileErr } = await supabase
              .from('profiles')
              .select('company_id')
              .eq('user_id', user.id)
              .maybeSingle();
            console.warn(`[cloudDb] Profile lookup result:`, { userId: user.id, profile, error: profileErr });
            if (profile?.company_id) {
              record.company_id = profile.company_id;
              activeCompanyId = profile.company_id;
            }
          } else {
            console.warn(`[cloudDb] No authenticated user found`);
          }
        } catch (e) {
          console.warn(`[cloudDb] Profile lookup threw:`, e);
        }
        if (!record.company_id) {
          console.error(`[cloudDb] FINAL: cannot resolve company_id for ${storeName}. Skipping cloud write.`);
          return null;
        }
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

  async get<T = Record<string, unknown>>(storeName: string, id: string): Promise<T | null> {
    return withSession(async () => {
      const table = getTable(storeName);
      let query = supabase.from(table).select('*').eq('id', id);
      const companyId = await getCompanyId();
      if (companyId) {
        query = query.eq('company_id', companyId);
      }
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const {
        id: _id,
        company_id,
        created_at,
        updated_at,
        data: domainData,
        ...rest
      } = data as Record<string, unknown>;
      return {
        ...(domainData as Record<string, unknown> | undefined),
        ...rest,
        id: _id,
        company_id,
        created_at,
        updated_at,
      } as T;
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
      const companyId = await getCompanyId();
      let query = supabase.from(table).delete().eq('id', id);
      if (companyId) {
        query = query.eq('company_id', companyId);
      }
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
      const companyId = await getCompanyId();
      let query = supabase
        .from('settings')
        .select('data')
        .eq('id', key);
      if (companyId) query = query.eq('company_id', companyId);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data?.data as T ?? null;
    });
  },

  async saveSetting<T>(key: string, value: T): Promise<void | null> {
    return withSession(async () => {
      const companyId = await getCompanyId();
      const record: Record<string, unknown> = {
        id: key,
        data: value,
        updated_at: new Date().toISOString(),
      };
      if (companyId) record.company_id = companyId;
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

      const companyId = await getCompanyId();
      if (!companyId) throw new Error('Cannot upload file without an active company.');

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${companyId}/${folder}/${crypto.randomUUID()}-${safeName}`;
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

  async deleteCompany(companyId: string): Promise<void> {
    if (!SUPABASE_ENABLED) return;
    await withSession(async () => {
      const { error: rpcError } = await supabase.rpc('cascade_delete_company', {
        target_company_id: companyId,
      });
      if (!rpcError) return;
      if (!rpcError.message?.includes('function') && !rpcError.message?.includes('does not exist')) {
        if (rpcError.message?.includes('permission denied') || rpcError.code === '42501') {
          throw new Error(
            'Permission denied. Run the SQL from database/supabase-cascade-delete.sql in your Supabase dashboard ' +
            'to create the cascade_delete_company function, then try again.'
          );
        }
        throw rpcError;
      }

      const tablesWithCompanyId = [
        'sales', 'invoices', 'sale_items', 'customers', 'inventory',
        'inventory_transactions', 'material_batches', 'warehouse_inventory',
        'material_categories', 'sales_orders', 'sales_exchanges',
        'sales_exchange_items', 'sales_exchange_approvals', 'reprint_jobs',
        'market_adjustments', 'market_adjustment_transactions',
        'transaction_adjustment_snapshots', 'audit_logs', 'documents',
        'tasks', 'classes', 'subjects', 'examination_batches',
        'examination_classes', 'examination_subjects',
        'examination_bom_calculations', 'examination_class_adjustments',
        'examination_pricing_audit', 'examination_batch_notifications',
        'notification_audit_logs', 'bom_default_materials',
        'profit_margin_settings', 'profit_margin_audit_logs',
        'work_centers', 'production_resources', 'work_orders',
        'production_batches', 'chart_of_accounts', 'ledger_entries',
        'budgets', 'transfers', 'expenses', 'income', 'suppliers',
        'purchase_orders', 'goods_receipts', 'departments', 'employees',
        'payroll_runs', 'payslips', 'customer_payments', 'assets',
        'settings', 'schools', 'examinations',
      ];

      for (const table of tablesWithCompanyId) {
        const { error } = await supabase.from(table).delete().eq('company_id', companyId);
        if (error && !error.message?.includes('does not exist') && !error.message?.includes('permission')) {
          console.warn(`[cloudDb] Failed to clear ${table}:`, error.message);
        }
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .delete()
        .eq('company_id', companyId);
      if (profileError && !profileError.message?.includes('permission')) throw profileError;

      const { error: companyError } = await supabase
        .from('companies')
        .delete()
        .eq('id', companyId);
      if (companyError) {
        if (companyError.message?.includes('foreign key') || companyError.code === '23503') {
          throw new Error(
            'Company cannot be deleted because other records still reference it. ' +
            'Run the cascade_delete_company SQL function in your Supabase dashboard, ' +
            'or manually delete related data first. See database/supabase-cascade-delete.sql'
          );
        }
        if (companyError.message?.includes('permission') || companyError.code === '42501') {
          throw new Error(
            'Your Supabase user does not have permission to delete the company. ' +
            'Run the SQL from database/supabase-cascade-delete.sql in your Supabase dashboard, ' +
            'or grant DELETE permission on the companies table to your user role.'
          );
        }
        throw companyError;
      }

      // After successful company deletion, remind user to clean up the auth user
      console.info(
        'Company data deleted. IMPORTANT: The Supabase Auth user still exists. ' +
        'If you need to re-register with the same email, go to your Supabase Dashboard → ' +
        'Authentication → Users and delete this user manually, then you can create a new company.'
      );
    });
  },
};

export default cloudDb;
