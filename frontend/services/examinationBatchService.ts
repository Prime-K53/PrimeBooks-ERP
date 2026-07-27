import { ExaminationBatch, ExaminationClass, ExaminationPricingSettings, ExaminationSubject, Item, MarketAdjustment } from '../types';
import { getUrl, API_BASE_URL } from '../config/api.js';
import { dbService } from './db';
import { supabase } from './supabaseClient';
import { generateNextExaminationBatchNumber } from './documentNumberService';
import { getHeaders, safeJson, toServiceError, isLikelyNetworkError } from './examinationServiceUtils';
import { ensureBackendInProd } from './api';
import { calculateBatchPricing, PricingSettings } from '../utils/examinationPricingCalculator';
import { isExaminationDebugLoggingEnabled } from '../utils/debugFlags';
import { apiClient } from './apiClient';
import { examinationDb } from './examinationDb';
import { getQueuedMutations, removeQueuedMutation } from './offlineQueueManager';
import type { BatchRecord } from '../types/offline';

export interface ExaminationInvoiceLineItem {
  id: string;
  itemId: string;
  name: string;
  sku: string;
  description?: string;
  category: string;
  type: 'Service' | 'Product' | 'Material' | 'Stationery';
  unit: string;
  minStockLevel: number;
  stock: number;
  reserved?: number;
  price: number;
  cost: number;
  quantity: number;
  total: number;
}

export interface ExaminationGeneratedInvoicePayload {
  id: string;
  backendInvoiceId: string;
  invoiceNumber: string;
  date: string;
  dueDate: string;
  customerId: string;
  customerName: string;
  subtotal?: number;
  totalAmount: number;
  paidAmount: number;
  status: 'Draft' | 'Unpaid' | 'Partial' | 'Paid' | 'Overdue' | 'Cancelled';
  items: ExaminationInvoiceLineItem[];
  batchId?: string;
  schoolName?: string;
  academicYear?: string;
  term?: string;
  examType?: string;
  classBreakdown?: Array<{
    className: string;
    subjects: string[];
    totalCandidates: number;
    chargePerLearner: number;
    classTotal: number;
  }>;
  materialTotal?: number;
  adjustmentTotal?: number;
  adjustmentSnapshots?: Array<{
    name: string;
    type: 'PERCENTAGE' | 'FIXED' | 'PERCENT';
    value: number;
    calculatedAmount: number;
  }>;
  preRoundingTotalAmount?: number;
  roundingDifference?: number;
  roundingMethod?: string;
  applyRounding?: boolean;
  documentTitle?: string;
  subAccountName?: string;
  notes?: string;
  reference?: string;
  currency?: string;
  origin_module?: string;
  origin_batch_id?: string;
}

const toTimeoutMs = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const REQUEST_TIMEOUT_MS = toTimeoutMs((import.meta as any)?.env?.VITE_EXAM_REQUEST_TIMEOUT_MS, 30000);
const HEAVY_REQUEST_TIMEOUT_MS = toTimeoutMs((import.meta as any)?.env?.VITE_EXAM_HEAVY_REQUEST_TIMEOUT_MS, 180000);
const MEDIUM_REQUEST_TIMEOUT_MS = toTimeoutMs((import.meta as any)?.env?.VITE_EXAM_MEDIUM_REQUEST_TIMEOUT_MS, 60000);
const FALLBACK_CANDIDATE_TIMEOUT_MS = toTimeoutMs((import.meta as any)?.env?.VITE_EXAM_FALLBACK_CANDIDATE_TIMEOUT_MS, 12000);
const LIST_REQUEST_TIMEOUT_MS = toTimeoutMs((import.meta as any)?.env?.VITE_EXAM_LIST_REQUEST_TIMEOUT_MS, 5000);
const LIST_SYNC_BUDGET_MS = toTimeoutMs((import.meta as any)?.env?.VITE_EXAM_LIST_SYNC_BUDGET_MS, 2000);
const CREATE_REQUEST_TIMEOUT_MS = toTimeoutMs((import.meta as any)?.env?.VITE_EXAM_CREATE_REQUEST_TIMEOUT_MS, 60000);
const AUTH_RETRY_COOLDOWN_MS = toTimeoutMs((import.meta as any)?.env?.VITE_EXAM_AUTH_RETRY_COOLDOWN_MS, 15000);
const EXAM_PRICING_SETTINGS_KEY = 'examinationPricingSettings';
const DEFAULT_TONER_PAGES_PER_UNIT = 20000;
const DEFAULT_PAPER_CONVERSION_RATE = 500;
let authCooldownUntil = 0;
let backendCooldownUntil = 0;

const isAuthRetryCoolingDown = () => authCooldownUntil > Date.now();
const markAuthRetryCooldown = () => {
  authCooldownUntil = Date.now() + AUTH_RETRY_COOLDOWN_MS;
};

const isBackendCoolingDown = () => backendCooldownUntil > Date.now();
const markBackendCooldown = () => {
  backendCooldownUntil = Date.now() + AUTH_RETRY_COOLDOWN_MS;
};

const EXAM_BACKEND_URL = (import.meta as any)?.env?.VITE_EXAM_BACKEND_URL;

const API_BASE_CANDIDATES = () => {
  if (!EXAM_BACKEND_URL || isAuthRetryCoolingDown() || isBackendCoolingDown() || !apiClient.canUseRemoteApi()) return [];
  return [`${EXAM_BACKEND_URL}/api/examination`];
};

const isProd = Boolean((import.meta as any)?.env?.PROD);
const examinationDebugLoggingEnabled = isExaminationDebugLoggingEnabled();

const debugExam = (...args: any[]) => {
  if (examinationDebugLoggingEnabled) {
    console.debug(...args);
  }
};

const isAuthorizationErrorStatus = (status: unknown) => Number(status) === 401 || Number(status) === 403;

const joinPath = (base: string, endpoint: string) => {
  const trimmedBase = String(base || '').replace(/^\/+|\/+$/g, '');
  const trimmedEndpoint = String(endpoint || '').replace(/^\/+/, '');
  if (!trimmedBase) return trimmedEndpoint;
  if (!trimmedEndpoint) return trimmedBase;
  return `${trimmedBase}/${trimmedEndpoint}`;
};

const isTimeoutError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.toLowerCase().includes('timeout');
};

const isOfflineError = (error: unknown) => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();
  return normalized.includes('failed to fetch')
    || normalized.includes('networkerror')
    || normalized.includes('network request failed')
    || normalized.includes('network unavailable')
    || normalized.includes('load failed')
    || normalized.includes('timeout')
    || normalized.includes('aborted')
    || normalized.includes('backend disabled in offline mode')
    || normalized.includes('remote requests are paused')
    || normalized.includes('remote api unavailable')
    || normalized.includes('http 401')
    || normalized.includes('no authentication token provided')
    || normalized.includes('authentication required')
    || normalized.includes('session is not authorized')
    || normalized.includes('please sign in again');
};

const isBackendDisabledError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.toLowerCase().includes('backend disabled in offline mode');
};

const isAuthUnavailableError = (error: unknown) => {
  const status = Number((error as any)?.status);
  if (status === 401) return true;

  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();
  return normalized.includes('http 401')
    || normalized.includes('no authentication token provided')
    || normalized.includes('authentication required')
    || normalized.includes('authentication is unavailable')
    || normalized.includes('session is not authorized')
    || normalized.includes('please sign in again');
};

const shouldUseLocalFallback = (error: unknown) =>
  isOfflineError(error) || isBackendDisabledError(error) || isAuthUnavailableError(error);

const generateLocalId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `local-${crypto.randomUUID()}`;
  }
  return `local-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
};

const toIso = () => new Date().toISOString();
const isLocalBatchId = (id: string) => String(id || '').startsWith('local-');
const isUuidFormat = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

const resolveBatchId = async (id: string): Promise<string> => {
  if (isLocalBatchId(id)) return id;
  if (isUuidFormat(id)) return id;
  const byNumber = await examinationBatchService.getBatchByNumber(id);
  if (!byNumber) throw new Error(`Batch not found: ${id}`);
  return byNumber.id;
};

const normalizeBatchForStorage = (
  batch: Partial<ExaminationBatch> & Record<string, any>,
  overrides: Record<string, any> = {}
): any => {
  const id = String(batch.id || batch.batch_id || generateLocalId());
  const createdAt = String(batch.created_at || batch.createdAt || toIso());
  const updatedAt = String(batch.updated_at || batch.updatedAt || createdAt);
  const batchNumber = String(batch.batch_number || batch.batchNumber || '').trim();
  return {
    ...batch,
    id,
    ...(batchNumber ? { batch_number: batchNumber, batchNumber } : {}),
    created_at: createdAt,
    updated_at: updatedAt,
    ...overrides,
    _lastModifiedAt: overrides._lastModifiedAt || updatedAt
  };
};

const getLocalBatches = async () => {
  let batches: any[] = [];
  try {
    const data = await examinationDb.examinationBatches.toArray();
    batches = Array.isArray(data) ? data.map((batch) => normalizeBatchForStorage(batch)) : [];
  } catch {
  }
  try {
    const syncedBatchRecords = await dbService.getAll<any>('examinationBatches');
    if (Array.isArray(syncedBatchRecords) && syncedBatchRecords.length > 0) {
      const syncedMap = new Map<string, any>();
      for (const b of syncedBatchRecords) syncedMap.set(String(b.id), normalizeBatchForStorage(b));
      for (const batch of batches) {
        const existing = syncedMap.get(String(batch.id));
        if (existing) syncedMap.set(String(batch.id), { ...existing, ...batch });
        else syncedMap.set(String(batch.id), batch);
      }
      batches = Array.from(syncedMap.values());
    }
  } catch {
  }
  return batches;
};

const storeLocalBatches = async (batches: Array<Record<string, any>>) => {
  const entries = batches.map((batch) => normalizeBatchForStorage(batch));
  try {
    await examinationDb.examinationBatches.bulkPut(entries);
  } catch {
  }
  for (const entry of entries) {
    await syncBatchToSupabase(entry);
  }
};

const syncBatchToSupabase = async (entry: Record<string, any>) => {
  try {
    const record = {
      id: entry.id,
      name: entry.name || null,
      school_id: entry.school_id || null,
      exam_type: entry.exam_type || null,
      currency: entry.currency || null,
      status: entry.status || null,
      total_amount: entry.total_amount ?? 0,
      classes_json: Array.isArray(entry.classes) ? JSON.stringify(entry.classes) : entry.classes_json || null,
      approvals_json: entry.approvals_json || null,
      invoice_json: entry.invoice_json || null,
      company_id: entry._companyId || entry.company_id || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('examination_batches')
      .upsert(record, { onConflict: 'id', ignoreDuplicates: false });
    if (error) throw error;
  } catch {
  }
};

const storeLocalBatch = async (batch: Record<string, any>) => {
  const entry = normalizeBatchForStorage(batch);
  try {
    await examinationDb.examinationBatches.put(entry);
  } catch {
  }
  await syncBatchToSupabase(entry);
  return entry;
};

const removeLocalBatch = async (id: string) => {
  try {
    await examinationDb.examinationBatches.delete(id);
  } catch {
  }
  try {
    await dbService.delete('examinationBatches', id);
  } catch {
  }
};

const enqueueOutbox = async (type: string, entityId: string, payload: Record<string, any>) => {
  const operation = type.endsWith(':delete')
    ? 'delete'
    : type.endsWith(':update')
      ? 'update'
      : 'create';

  try {
    const { durableSyncQueue } = await import('./durableSyncQueue');
    await durableSyncQueue.enqueue({
      table: 'examination_batches',
      recordId: entityId,
      operation: operation === 'delete' ? 'delete' : 'upsert' as const,
      payload: { ...payload, id: entityId },
      companyId: null,
    });
  } catch {
  }
};

const loadOutbox = async () => {
  const entries = await getQueuedMutations();
  return entries.map((entry) => ({
    id: entry.id,
    entityId: entry.entityId,
    type: `examinationBatch:${entry.operation}`,
    payload: entry.payload,
    date: entry.createdAt,
    status: entry.status,
    retries: entry.retries
  }));
};

const removeOutboxEntries = async (ids: string[]) => {
  await Promise.all(ids.map((id) => removeQueuedMutation(id)));
};

const getLocalInventory = async () => {
  try {
    return await dbService.getAll<Item>('inventory');
  } catch {
    return [];
  }
};

const getLocalAdjustments = async () => {
  try {
    return await dbService.getAll<MarketAdjustment>('marketAdjustments');
  } catch {
    return [];
  }
};

const enrichPricingSettingsWithInventory = (
  input: Partial<PricingSettings>,
  inventory: Item[]
): PricingSettings => {
  const paperItem = inventory.find((item) => String(item.id) === String(input.paper_item_id || ''));
  const tonerItem = inventory.find((item) => String(item.id) === String(input.toner_item_id || ''));
  const conversionRate = Number(input.conversion_rate ?? (paperItem as any)?.conversionRate ?? DEFAULT_PAPER_CONVERSION_RATE) || DEFAULT_PAPER_CONVERSION_RATE;

  return {
    paper_item_id: input.paper_item_id ? String(input.paper_item_id) : null,
    paper_item_name: input.paper_item_name || paperItem?.name || null,
    paper_unit_cost: Number(input.paper_unit_cost ?? (paperItem as any)?.cost_per_unit ?? paperItem?.cost ?? paperItem?.cost_price ?? 0) || 0,
    toner_item_id: input.toner_item_id ? String(input.toner_item_id) : null,
    toner_item_name: input.toner_item_name || tonerItem?.name || null,
    toner_unit_cost: Number(input.toner_unit_cost ?? (tonerItem as any)?.cost_per_unit ?? tonerItem?.cost ?? tonerItem?.cost_price ?? 0) || 0,
    conversion_rate: conversionRate,
    adjustment_rate: input.adjustment_rate,
    profit_margin: input.profit_margin,
    constants: {
      toner_pages_per_unit: Number(input.constants?.toner_pages_per_unit ?? DEFAULT_TONER_PAGES_PER_UNIT) || DEFAULT_TONER_PAGES_PER_UNIT,
    },
    active_adjustments: Array.isArray(input.active_adjustments) ? input.active_adjustments : []
  };
};

const getLocalPricingSettings = async (): Promise<PricingSettings> => {
  const inventory = await getLocalInventory();
  const stored = await dbService.getSetting<Partial<PricingSettings>>(EXAM_PRICING_SETTINGS_KEY);
  return enrichPricingSettingsWithInventory(stored || {}, inventory);
};

const saveLocalPricingSettings = async (input: Partial<PricingSettings>) => {
  const inventory = await getLocalInventory();
  const existing = await dbService.getSetting<Partial<PricingSettings>>(EXAM_PRICING_SETTINGS_KEY);
  const next = enrichPricingSettingsWithInventory({ ...(existing || {}), ...(input || {}) }, inventory);
  await dbService.saveSetting(EXAM_PRICING_SETTINGS_KEY, next);
  return next;
};

const findLocalBatch = async (batchId: string) => {
  const localBatches = await getLocalBatches();
  const batch = localBatches.find((entry) => (
    String(entry.id) === String(batchId)
    || String(entry.batch_number || entry.batchNumber || '') === String(batchId)
  ));
  return batch ? normalizeBatchForStorage(batch) : null;
};

const updateLocalBatch = async (
  batchId: string,
  updater: (batch: Record<string, any>) => Record<string, any>
) => {
  const existing = await findLocalBatch(batchId);
  if (!existing) {
    throw new Error(`Batch not found in local storage: ${batchId}`);
  }

  const updatedAt = toIso();
  const updated = normalizeBatchForStorage(
    updater({
      ...existing,
      classes: Array.isArray(existing.classes) ? existing.classes.map((row: any) => ({ ...row })) : [],
      subjects: Array.isArray(existing.subjects) ? [...existing.subjects] : []
    }),
    {
      updated_at: updatedAt,
      updatedAt,
      _offline: true,
      _syncStatus: 'pending',
      _lastModifiedAt: updatedAt
    }
  );

  await storeLocalBatch(updated);
  await enqueueOutbox('examinationBatch:update', String(updated.id), updated);
  return updated;
};

const findLocalClassOwner = async (classId: string) => {
  const batches = await getLocalBatches();
  for (const batch of batches) {
    const classes = Array.isArray((batch as any).classes) ? (batch as any).classes : [];
    const classIndex = classes.findIndex((row: any) => String(row?.id) === String(classId));
    if (classIndex >= 0) {
      return { batch: normalizeBatchForStorage(batch), classIndex };
    }
  }
  return null;
};

const findLocalSubjectOwner = async (subjectId: string) => {
  const batches = await getLocalBatches();
  for (const batch of batches) {
    const classes = Array.isArray((batch as any).classes) ? (batch as any).classes : [];
    for (let classIndex = 0; classIndex < classes.length; classIndex += 1) {
      const subjects = Array.isArray(classes[classIndex]?.subjects) ? classes[classIndex].subjects : [];
      const subjectIndex = subjects.findIndex((row: any) => String(row?.id) === String(subjectId));
      if (subjectIndex >= 0) {
        return { batch: normalizeBatchForStorage(batch), classIndex, subjectIndex };
      }
    }
  }
  return null;
};

const calculateLocalBatchState = async (
  batch: Partial<ExaminationBatch> & Record<string, any>,
  explicitSettings?: Partial<PricingSettings>,
  explicitAdjustments?: MarketAdjustment[]
) => {
  const inventory = await getLocalInventory();
  const storedSettings = await getLocalPricingSettings();
  const settings = enrichPricingSettingsWithInventory(
    { ...storedSettings, ...(explicitSettings || {}) },
    inventory
  );
  const adjustments = explicitAdjustments || await getLocalAdjustments();
  const activeAdjustments = adjustments.filter((adjustment: any) => {
    const active = adjustment?.active ?? adjustment?.isActive ?? adjustment?.is_active ?? true;
    return active === true || active === 1 || active === '1';
  });
  const pricing = calculateBatchPricing(batch as ExaminationBatch, settings, activeAdjustments);
  return { inventory, settings, activeAdjustments, pricing };
};

const applyCalculatedBatchState = async (
  batch: Partial<ExaminationBatch> & Record<string, any>,
  explicitSettings?: Partial<PricingSettings>,
  explicitAdjustments?: MarketAdjustment[]
) => {
  const { settings, activeAdjustments, pricing } = await calculateLocalBatchState(batch, explicitSettings, explicitAdjustments);
  const pricingByClassId = new Map(pricing.classes.map((row) => [String(row.classId), row]));

  const classes = (Array.isArray(batch.classes) ? batch.classes : []).map((entry: any, index: number) => {
    const classId = String(entry?.id || `class-${index + 1}`);
    const pricingRow = pricingByClassId.get(classId);
    const learners = Math.max(1, Math.floor(Number(entry?.number_of_learners || 0)));
    const hasManualOverride = Boolean(Number(entry?.is_manual_override || 0)) && Number(entry?.manual_cost_per_learner ?? 0) > 0;
    const expectedFee = Number(pricingRow?.expectedFeePerLearner ?? entry?.expected_fee_per_learner ?? 0) || 0;
    const finalFee = hasManualOverride
      ? Number(entry?.manual_cost_per_learner ?? expectedFee)
      : Number(pricingRow?.finalFeePerLearner ?? expectedFee);
    const liveTotal = hasManualOverride
      ? Number((finalFee * learners).toFixed(2))
      : Number(pricingRow?.liveTotalPreview ?? finalFee * learners);

    return {
      ...entry,
      expected_fee_per_learner: expectedFee,
      suggested_cost_per_learner: expectedFee,
      final_fee_per_learner: finalFee,
      price_per_learner: finalFee,
      live_total_preview: liveTotal,
      manual_override_amount: hasManualOverride ? Number(((finalFee - expectedFee) * learners).toFixed(2)) : 0,
      material_total_cost: Number(pricingRow?.totalBomCost ?? entry?.material_total_cost ?? 0) || 0,
      adjustment_total_cost: Number(pricingRow?.totalAdjustments ?? entry?.adjustment_total_cost ?? 0) || 0,
      market_adjustment_total: Number(pricingRow?.marketAdjustmentTotal ?? entry?.market_adjustment_total ?? pricingRow?.totalAdjustments ?? 0) || 0,
      rounding_adjustment: Number(pricingRow?.roundingAdjustment ?? entry?.rounding_adjustment ?? 0) || 0,
      calculated_total_cost: Number(pricingRow?.totalCost ?? entry?.calculated_total_cost ?? 0) || 0,
      total_pages: Number(pricingRow?.totalPages ?? entry?.total_pages ?? 0) || 0,
      total_sheets: Number(pricingRow?.totalSheets ?? entry?.total_sheets ?? 0) || 0,
      updated_at: toIso()
    };
  });

  const totalAmount = Number(classes.reduce((sum: number, row: any) => sum + (Number(row?.live_total_preview) || 0), 0).toFixed(2));
  const materialTotal = Number(classes.reduce((sum: number, row: any) => sum + (Number(row?.material_total_cost) || 0), 0).toFixed(2));
  const adjustmentTotal = Number(classes.reduce((sum: number, row: any) => sum + (Number(row?.adjustment_total_cost) || 0), 0).toFixed(2));
  const totalLearners = classes.reduce((sum: number, row: any) => sum + Math.max(0, Math.floor(Number(row?.number_of_learners) || 0)), 0);

  return normalizeBatchForStorage({
    ...batch,
    classes,
    total_amount: totalAmount,
    pre_rounding_total_amount: totalAmount,
    material_total: materialTotal,
    adjustment_total: adjustmentTotal,
    total_students: totalLearners,
    expected_candidature: totalLearners,
    pricing_settings_snapshot: settings,
    active_adjustments_snapshot: activeAdjustments
  });
};

const summarizeBatchTotals = (batch: Partial<ExaminationBatch> & Record<string, any>) => {
  const classes = Array.isArray(batch.classes) ? batch.classes : [];
  const totalAmount = Number(classes.reduce((sum: number, row: any) => sum + (Number(row?.live_total_preview) || 0), 0).toFixed(2));
  const materialTotal = Number(classes.reduce((sum: number, row: any) => sum + (Number(row?.material_total_cost) || 0), 0).toFixed(2));
  const adjustmentTotal = Number(classes.reduce((sum: number, row: any) => sum + (Number(row?.adjustment_total_cost ?? row?.market_adjustment_total) || 0), 0).toFixed(2));
  const totalLearners = classes.reduce((sum: number, row: any) => sum + Math.max(0, Math.floor(Number(row?.number_of_learners) || 0)), 0);

  return {
    ...batch,
    total_amount: totalAmount,
    pre_rounding_total_amount: totalAmount,
    material_total: materialTotal,
    adjustment_total: adjustmentTotal,
    total_students: totalLearners,
    expected_candidature: totalLearners
  };
};

const buildLocalBomRows = async (batch: Partial<ExaminationBatch> & Record<string, any>) => {
  const { inventory, settings, pricing } = await calculateLocalBatchState(batch);
  const tonerPagesPerUnit = Number(settings.constants?.toner_pages_per_unit || DEFAULT_TONER_PAGES_PER_UNIT) || DEFAULT_TONER_PAGES_PER_UNIT;
  const paperItem = inventory.find((item) => String(item.id) === String(settings.paper_item_id || ''));
  const tonerItem = inventory.find((item) => String(item.id) === String(settings.toner_item_id || ''));
  const rows: Array<Record<string, any>> = [];

  pricing.classes.forEach((classRow) => {
    const classId = String(classRow.classId);
    const paperQuantity = Number((classRow.totalSheets / Math.max(1, Number(settings.conversion_rate) || DEFAULT_PAPER_CONVERSION_RATE)).toFixed(4));
    const tonerQuantity = Number((classRow.totalPages / Math.max(1, tonerPagesPerUnit)).toFixed(6));
    const paperTotal = Number((paperQuantity * Number(settings.paper_unit_cost || 0)).toFixed(2));
    const tonerTotal = Number((tonerQuantity * Number(settings.toner_unit_cost || 0)).toFixed(2));

    if (settings.paper_item_id) {
      rows.push({
        id: `local-bom-paper-${classId}`,
        class_id: classId,
        item_id: settings.paper_item_id,
        item_name: settings.paper_item_name || paperItem?.name || 'Paper',
        component_type: 'MATERIAL',
        quantity_required: paperQuantity,
        unit_cost: Number(settings.paper_unit_cost || 0),
        total_cost: paperTotal
      });
    }

    if (settings.toner_item_id) {
      rows.push({
        id: `local-bom-toner-${classId}`,
        class_id: classId,
        item_id: settings.toner_item_id,
        item_name: settings.toner_item_name || tonerItem?.name || 'Toner',
        component_type: 'MATERIAL',
        quantity_required: tonerQuantity,
        unit_cost: Number(settings.toner_unit_cost || 0),
        total_cost: tonerTotal
      });
    }

    if (Number(classRow.totalAdjustments) > 0) {
      rows.push({
        id: `local-bom-adjustment-${classId}`,
        class_id: classId,
        component_type: 'ADJUSTMENT',
        adjustment_id: `local-adjustment-${classId}`,
        adjustment_name: 'Pricing Adjustments',
        adjustment_type: 'PERCENTAGE',
        adjustment_value: 0,
        quantity_required: 1,
        unit_cost: Number(classRow.totalAdjustments),
        total_cost: Number(classRow.totalAdjustments)
      });
    }
  });

  return rows;
};

const buildLocalInvoicePayload = async (
  batch: Partial<ExaminationBatch> & Record<string, any>,
  payload?: { idempotencyKey?: string; invoiceNumber?: string }
): Promise<ExaminationGeneratedInvoicePayload> => {
  const invoiceId = `local-exam-invoice-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  const invoiceNumber = payload?.invoiceNumber || `EXM-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  const schools = await dbService.getAll<any>('schools').catch(() => []);
  const customers = await dbService.getAll<any>('customers').catch(() => []);
  const schoolId = String(batch.school_id || '').trim();
  const schoolName = (
    schools.find((school: any) => String(school?.id) === schoolId)?.name
    || customers.find((customer: any) => String(customer?.id) === schoolId)?.name
    || batch.schoolName
    || batch.name
    || 'Offline Customer'
  );

  const classes = Array.isArray(batch.classes) ? batch.classes : [];
  const items: ExaminationInvoiceLineItem[] = classes.map((cls: any, index: number) => {
    const learners = Math.max(1, Math.floor(Number(cls?.number_of_learners) || 0));
    const unitPrice = Number(cls?.final_fee_per_learner ?? cls?.expected_fee_per_learner ?? cls?.price_per_learner ?? 0) || 0;
    const total = Number(cls?.live_total_preview ?? (unitPrice * learners)) || 0;
    return {
      id: String(cls?.id || `${invoiceId}-${index + 1}`),
      itemId: String(cls?.id || `${invoiceId}-${index + 1}`),
      name: String(cls?.class_name || `Class ${index + 1}`),
      sku: `EXM-${String(cls?.id || index + 1)}`,
      description: `${Array.isArray(cls?.subjects) ? cls.subjects.length : 0} subject(s)`,
      category: 'Examination',
      type: 'Service',
      unit: 'learner',
      minStockLevel: 0,
      stock: 0,
      reserved: 0,
      price: Number(unitPrice.toFixed(2)),
      cost: Number((Number(cls?.material_total_cost ?? 0) / learners).toFixed(2)),
      quantity: learners,
      total: Number(total.toFixed(2))
    };
  });

  return {
    id: invoiceId,
    backendInvoiceId: invoiceId,
    invoiceNumber,
    date: toIso(),
    dueDate: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)).toISOString(),
    customerId: schoolId,
    customerName: schoolName,
    subtotal: Number(batch.pre_rounding_total_amount ?? batch.total_amount ?? items.reduce((sum, row) => sum + row.total, 0)),
    totalAmount: Number(batch.total_amount ?? items.reduce((sum, row) => sum + row.total, 0)),
    paidAmount: 0,
    status: 'Unpaid',
    items,
    batchId: String(batch.batch_number || batch.batchNumber || batch.id || ''),
    schoolName,
    academicYear: batch.academic_year,
    term: batch.term,
    examType: batch.exam_type,
    classBreakdown: classes.map((cls: any) => ({
      className: String(cls?.class_name || 'Class'),
      subjects: Array.isArray(cls?.subjects) ? cls.subjects.map((subject: any) => String(subject?.subject_name || subject?.name || 'Subject')) : [],
      totalCandidates: Math.max(0, Math.floor(Number(cls?.number_of_learners) || 0)),
      chargePerLearner: Number(cls?.final_fee_per_learner ?? cls?.expected_fee_per_learner ?? 0) || 0,
      classTotal: Number(cls?.live_total_preview ?? 0) || 0
    })),
    materialTotal: Number(batch.material_total ?? 0) || 0,
    adjustmentTotal: Number(batch.adjustment_total ?? 0) || 0,
    preRoundingTotalAmount: Number(batch.pre_rounding_total_amount ?? batch.total_amount ?? 0) || 0,
    roundingDifference: 0,
    roundingMethod: 'nearest_50',
    applyRounding: true,
    documentTitle: 'Examination Service Invoice',
    notes: `Generated offline from batch ${String(batch.batch_number || batch.batchNumber || batch.id || '')}`,
    reference: payload?.idempotencyKey,
    currency: String(batch.currency || 'MWK'),
    origin_module: 'examination',
    origin_batch_id: String(batch.batch_number || batch.batchNumber || batch.id || '')
  };
};

const fetchWithTimeout = async (
  endpoint: string,
  options: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS
) => {
  const baseCandidates = API_BASE_CANDIDATES();
  if (baseCandidates.length === 0) {
    throw new Error('Failed to fetch: backend disabled in offline mode');
  }

  try {
    return await apiClient.requestRaw({
      endpoint,
      method: String(options.method || 'GET').toUpperCase(),
      headers: options.headers as Record<string, string> | undefined,
      body: (options.body as BodyInit | null) || null,
      timeoutMs: Math.min(timeoutMs, Math.max(FALLBACK_CANDIDATE_TIMEOUT_MS, timeoutMs)),
      baseCandidates,
      retries: 0,
      expectJson: true
    });
  } catch (error) {
    if (isAuthUnavailableError(error)) {
      markAuthRetryCooldown();
    }
    if (isOfflineError(error)) {
      markBackendCooldown();
    }
    throw error;
  }
};

const requestWithFallback = async (
  path: string,
  options: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS
) => {
  return fetchWithTimeout(path, options, timeoutMs);
};

const createBatchRemote = async (payload: Partial<ExaminationBatch>) => {
  const mappedPayload = {
    ...payload,
    customerId: payload.school_id,
    name: payload.batch_number || payload.batchNumber,
  };
  debugExam('[DEBUG] createBatchRemote - mapped payload:', JSON.stringify(mappedPayload, null, 2));
  const response = await fetchWithTimeout('/batches', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(mappedPayload),
  }, CREATE_REQUEST_TIMEOUT_MS);
  if (!response.ok) throw new Error(await toServiceError(response, 'Failed to create batch'));
  const result = await safeJson(response, 'createBatch');
  return {
    ...result,
    school_id: result.customerId,
    batch_number: result.name,
    batchNumber: result.name,
  };
};

const updateBatchRemote = async (id: string, payload: Partial<ExaminationBatch>) => {
  const resolvedId = await resolveBatchId(id);
  const response = await fetchWithTimeout(`/batches/${resolvedId}`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(payload),
  }, REQUEST_TIMEOUT_MS);
  if (!response.ok) throw new Error(await toServiceError(response, 'Failed to update batch'));
  return safeJson(response, 'updateBatch');
};

const deleteBatchRemote = async (id: string) => {
  const resolvedId = await resolveBatchId(id);
  const response = await fetchWithTimeout(`/batches/${resolvedId}`, {
    method: 'DELETE',
    headers: getHeaders()
  }, REQUEST_TIMEOUT_MS);
  if (!response.ok) throw new Error(await toServiceError(response, 'Failed to delete batch'));
};

export const examinationBatchService = {
  _syncInProgress: false,

  async listBatches(): Promise<ExaminationBatch[]> {
    const localBatches = isProd ? [] : await getLocalBatches();
    const headers = getHeaders();
    const toBatchArray = (value: any): ExaminationBatch[] => {
      if (!Array.isArray(value)) return [];
      return value.filter((batch) => batch && typeof batch === 'object' && batch.id);
    };
    const mergeById = (remoteRows: ExaminationBatch[]) => {
      if (isProd) return remoteRows;
      const mergedMap = new Map<string, any>();
      remoteRows.forEach((batch) => {
        mergedMap.set(String(batch.id), batch);
      });
      localBatches.forEach((batch) => {
        const id = String((batch as any).id || '');
        if (!id || mergedMap.has(id)) {
          return;
        }
        mergedMap.set(id, batch);
      });
      return Array.from(mergedMap.values());
    };
    const attemptList = async (path: string) => {
      const response = await fetchWithTimeout(path, {
        method: 'GET',
        headers
      }, LIST_REQUEST_TIMEOUT_MS);
      if (!response.ok) {
        const error = new Error(await toServiceError(response, 'Failed to fetch batches'));
        (error as any).status = response.status;
        throw error;
      }
      return safeJson(response, 'listBatches');
    };

    try {
      await Promise.race([
        this.syncPendingBatches(),
        new Promise<void>((resolve) => setTimeout(resolve, LIST_SYNC_BUDGET_MS))
      ]);
    } catch (error) {
      debugExam('[examinationBatchService] syncPendingBatches skipped for list path:', error);
    }

    try {
      const primary = toBatchArray(await attemptList('/batches?mode=summary&include_subjects=1&include_class_stats=1'));
      const merged = mergeById(primary);
      await storeLocalBatches(merged.map(batch => ({
        ...batch,
        _syncStatus: (batch as any)._syncStatus || 'synced',
        _lastSyncedAt: toIso()
      })));
      return merged;
    } catch (error) {
      ensureBackendInProd('examinationBatchService.listBatches', error);
      const status = (error as any)?.status;
      const shouldFallback = shouldUseLocalFallback(error) || isAuthorizationErrorStatus(status);
      if (status && status < 500 && !shouldFallback) {
        throw error;
      }
      if (shouldFallback) {
        return (localBatches.length > 0 ? localBatches : await getLocalBatches()) as ExaminationBatch[];
      }
    }

    try {
      const lite = toBatchArray(await attemptList('/batches?mode=lite&include_subjects=0&include_class_stats=0'));
      const merged = mergeById(lite);
      await storeLocalBatches(merged.map(batch => ({
        ...batch,
        _syncStatus: (batch as any)._syncStatus || 'synced',
        _lastSyncedAt: toIso()
      })));
      return merged;
    } catch (error) {
      ensureBackendInProd('examinationBatchService.listBatches', error);
      const fallbackLocal = localBatches.length > 0 ? localBatches : await getLocalBatches();
      if (fallbackLocal.length > 0) return fallbackLocal as ExaminationBatch[];
      const pendingOutbox = (await loadOutbox())
        .filter((entry) => entry?.type === 'examinationBatch:create')
        .map((entry) => normalizeBatchForStorage(
          {
            ...(entry.payload || {}),
            id: entry.entityId || entry.id,
            status: (entry.payload || {}).status || 'Draft'
          },
          {
            _offline: true,
            _syncStatus: 'pending'
          }
        ));
      if (pendingOutbox.length > 0) {
        return pendingOutbox as ExaminationBatch[];
      }
      return [];
    }
  },

  async getBatch(id: string): Promise<ExaminationBatch> {
    debugExam('[DEBUG] examinationBatchService.getBatch - Fetching batch:', { id, isLocal: isLocalBatchId(id) });

    if (isLocalBatchId(id)) {
      const local = await getLocalBatches();
      const fallback = local.find(batch => String(batch.id) === String(id));
      if (fallback) return fallback as ExaminationBatch;
      throw new Error('Local batch not found');
    }

    if (!isUuidFormat(id)) {
      debugExam('[DEBUG] examinationBatchService.getBatch - ID appears to be batch number, using lookup:', { id });
      const byNumber = await this.getBatchByNumber(id);
      if (byNumber) return byNumber;
      throw new Error(`Batch not found: ${id}`);
    }

    try {
      const response = await fetchWithTimeout(`/batches/${id}`, {
        headers: getHeaders()
      }, REQUEST_TIMEOUT_MS);
      if (!response.ok) {
        // Try batch number lookup if batch not found
        if (response.status === 404) {
          const local = await getLocalBatches();
          const localBatch = local.find(batch => String(batch.id) === String(id));
          if (localBatch?.batch_number) {
            debugExam('[DEBUG] examinationBatchService.getBatch - Batch ID not found, trying batch number lookup:', { id, batchNumber: localBatch.batch_number });
            const foundByNumber = await this.getBatchByNumber(localBatch.batch_number);
            if (foundByNumber?.id) {
              debugExam('[DEBUG] examinationBatchService.getBatch - Found batch by number:', { oldId: id, newId: foundByNumber.id });
              return this.getBatch(foundByNumber.id);
            }
          }
        }
        const errorMsg = await toServiceError(response, 'Failed to fetch batch');
        debugExam('[DEBUG] examinationBatchService.getBatch - API Error:', {
          id,
          status: response.status,
          error: errorMsg
        });
        throw new Error(errorMsg);
      }
      const data = await safeJson(response, 'getBatch');
      await storeLocalBatch({
        ...data,
        _syncStatus: 'synced',
        _lastSyncedAt: toIso()
      });
      debugExam('[DEBUG] examinationBatchService.getBatch - Success:', { id, batchNumber: data.batch_number });
      return data;
    } catch (error) {
      if (shouldUseLocalFallback(error)) {
        ensureBackendInProd('examinationBatchService.getBatch', error);
        const local = await getLocalBatches();
        const fallback = local.find(batch => String(batch.id) === String(id));
        if (fallback) return fallback as ExaminationBatch;
      }
      debugExam('[DEBUG] examinationBatchService.getBatch - Error:', { id, error });
      throw error;
    }
  },

  async createBatch(payload: Partial<ExaminationBatch>): Promise<ExaminationBatch> {
    const incomingBatchNumber = String((payload as any)?.batch_number || (payload as any)?.batchNumber || '').trim();
    const reservedBatchNumber = incomingBatchNumber || await generateNextExaminationBatchNumber();
    const payloadWithBatchNumber = {
      ...payload,
      batch_number: reservedBatchNumber,
      batchNumber: reservedBatchNumber
    };

    debugExam('[DEBUG] examinationBatchService.createBatch - Starting request with payload:', payloadWithBatchNumber);
    const headers = getHeaders();
    debugExam('[DEBUG] examinationBatchService.createBatch - Headers:', headers);

    try {
      const result = await createBatchRemote(payloadWithBatchNumber);
      debugExam('[DEBUG] examinationBatchService.createBatch - Success result:', result);
      
      // Verify batch was actually created
      const batchId = result?.id || result?.batchId;
      if (batchId) {
        try {
          const verifyResponse = await fetchWithTimeout(`/batches/${batchId}`, { headers: getHeaders() }, REQUEST_TIMEOUT_MS);
          if (!verifyResponse.ok) {
            debugExam('[DEBUG] examinationBatchService.createBatch - Verification failed! Batch not found after creation:', { batchId, status: verifyResponse.status });
          } else {
            debugExam('[DEBUG] examinationBatchService.createBatch - Verified batch exists:', { batchId });
          }
        } catch (verifyError) {
          debugExam('[DEBUG] examinationBatchService.createBatch - Verification error:', verifyError);
        }
      }
      
      await storeLocalBatch({
        ...result,
        _syncStatus: 'synced',
        _lastSyncedAt: toIso()
      });
      return result;
    } catch (error) {
      if (!shouldUseLocalFallback(error)) {
        debugExam('[DEBUG] examinationBatchService.createBatch - Error response:', error);
        throw error;
      }
      ensureBackendInProd('examinationBatchService.createBatch', error);
      const now = toIso();
      const offlineBatch = normalizeBatchForStorage(
        {
          ...payloadWithBatchNumber,
          status: payload.status || 'Draft'
        },
        {
          _offline: true,
          _syncStatus: 'pending',
          _lastModifiedAt: now,
          created_at: now,
          updated_at: now
        }
      );

      await storeLocalBatch(offlineBatch);
      await enqueueOutbox('examinationBatch:create', String(offlineBatch.id), payloadWithBatchNumber as any);
      return offlineBatch as ExaminationBatch;
    }
  },

  async updateBatch(id: string, payload: Partial<ExaminationBatch>): Promise<ExaminationBatch> {
    if (isLocalBatchId(id)) {
      const local = await getLocalBatches();
      const existing = local.find(batch => String(batch.id) === String(id)) || {};
      const updated = normalizeBatchForStorage({
        ...existing,
        ...payload,
        id
      }, {
        _offline: true,
        _syncStatus: 'pending',
        _lastModifiedAt: toIso()
      });
      await storeLocalBatch(updated);
      await enqueueOutbox('examinationBatch:create', String(id), {
        ...(existing as any),
        ...payload
      } as any);
      return updated as ExaminationBatch;
    }

    try {
      const result = await updateBatchRemote(id, payload);
      await storeLocalBatch({
        ...result,
        _syncStatus: 'synced',
        _lastSyncedAt: toIso()
      });
      return result;
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      ensureBackendInProd('examinationBatchService.updateBatch', error);
      const local = await getLocalBatches();
      const existing = local.find(batch => String(batch.id) === String(id)) || {};
      const updated = normalizeBatchForStorage({
        ...existing,
        ...payload,
        id
      }, {
        _offline: true,
        _syncStatus: 'pending',
        _lastModifiedAt: toIso()
      });
      await storeLocalBatch(updated);
      await enqueueOutbox('examinationBatch:update', String(id), payload as any);
      return updated as ExaminationBatch;
    }
  },

  async deleteBatch(id: string): Promise<void> {
    try {
      await deleteBatchRemote(id);
      await removeLocalBatch(id);
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      ensureBackendInProd('examinationBatchService.deleteBatch', error);
      await removeLocalBatch(id);
      await enqueueOutbox('examinationBatch:delete', String(id), { id });
    }
  },

  async deleteBatches(ids: string[]): Promise<{ success: string[]; failed: { id: string; error: string }[] }> {
    const results = { success: [] as string[], failed: [] as { id: string; error: string }[] };

    for (const id of ids) {
      try {
        await this.deleteBatch(id);
        results.success.push(id);
      } catch (error) {
        results.failed.push({
          id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return results;
  },

  async syncPendingBatches(): Promise<{ synced: number; failed: number; pending: number }> {
    if (this._syncInProgress) {
      const outboxCount = (await loadOutbox()).filter(entry => String(entry.type || '').startsWith('examinationBatch:')).length;
      return { synced: 0, failed: 0, pending: outboxCount };
    }

    if (API_BASE_CANDIDATES().length === 0) {
      const pending = (await loadOutbox()).filter(entry => String(entry.type || '').startsWith('examinationBatch:')).length;
      return { synced: 0, failed: 0, pending };
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const pending = (await loadOutbox()).filter(entry => String(entry.type || '').startsWith('examinationBatch:')).length;
      return { synced: 0, failed: 0, pending };
    }

    const outbox = (await loadOutbox()).filter(entry => String(entry.type || '').startsWith('examinationBatch:'));
    if (outbox.length === 0) {
      return { synced: 0, failed: 0, pending: 0 };
    }

    this._syncInProgress = true;
    try {
      const ordered = [...outbox].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const grouped: Record<string, { create?: any; update?: any; delete?: boolean; entries: string[] }> = {};

      for (const entry of ordered) {
        const entityId = String(entry.entityId || '');
        if (!entityId) continue;
        if (!grouped[entityId]) {
          grouped[entityId] = { entries: [] };
        }
        grouped[entityId].entries.push(entry.id);
        if (entry.type === 'examinationBatch:create') {
          grouped[entityId].create = { ...(grouped[entityId].create || {}), ...(entry.payload || {}) };
        }
        if (entry.type === 'examinationBatch:update') {
          grouped[entityId].update = { ...(grouped[entityId].update || {}), ...(entry.payload || {}) };
        }
        if (entry.type === 'examinationBatch:delete') {
          grouped[entityId].delete = true;
        }
      }

      let synced = 0;
      let failed = 0;

      for (const [entityId, entry] of Object.entries(grouped)) {
        if (entry.delete && entry.create) {
          await removeLocalBatch(entityId);
          await removeOutboxEntries(entry.entries);
          synced += entry.entries.length;
          continue;
        }

        if (entry.create) {
          const payload = { ...(entry.create || {}), ...(entry.update || {}) };
          try {
            const remote = await createBatchRemote(payload);
            await removeLocalBatch(entityId);
            await storeLocalBatch({
              ...remote,
              _syncStatus: 'synced',
              _lastSyncedAt: toIso()
            });
            await removeOutboxEntries(entry.entries);
            synced += entry.entries.length;
          } catch (error) {
            failed += entry.entries.length;
          }
          continue;
        }

        if (entry.delete) {
          try {
            await deleteBatchRemote(entityId);
            await removeLocalBatch(entityId);
            await removeOutboxEntries(entry.entries);
            synced += entry.entries.length;
          } catch (error) {
            failed += entry.entries.length;
          }
          continue;
        }

        if (entry.update) {
          try {
            const remote = await updateBatchRemote(entityId, entry.update || {});
            await storeLocalBatch({
              ...remote,
              _syncStatus: 'synced',
              _lastSyncedAt: toIso()
            });
            await removeOutboxEntries(entry.entries);
            synced += entry.entries.length;
          } catch (error) {
            failed += entry.entries.length;
          }
        }
      }

      return { synced, failed, pending: outbox.length - synced };
    } finally {
      this._syncInProgress = false;
    }
  },

  async calculateBatch(
    id: string,
    options?: {
      trigger?: string;
      paperId?: string;
      tonerId?: string;
      paperUnitCost?: number;
      tonerUnitCost?: number;
      paperConversionRate?: number;
      roundingMethod?: string;
      roundingValue?: number;
      adjustments?: MarketAdjustment[];
    }
  ): Promise<ExaminationBatch> {
    try {
      const resolvedId = await resolveBatchId(id);
      const response = await fetchWithTimeout(`/batches/${resolvedId}/calculate`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(options || {})
      }, HEAVY_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to calculate batch'));
      const result = await safeJson(response, 'calculateBatch');
      await storeLocalBatch({
        ...result,
        _syncStatus: 'synced',
        _lastSyncedAt: toIso()
      });
      return result;
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const localBatch = await this.getBatch(id);
      const recalculated = await applyCalculatedBatchState(localBatch as any, {
        paper_item_id: options?.paperId || null,
        toner_item_id: options?.tonerId || null,
        paper_unit_cost: options?.paperUnitCost,
        toner_unit_cost: options?.tonerUnitCost,
        conversion_rate: options?.paperConversionRate
      }, options?.adjustments);
      return updateLocalBatch(String((localBatch as any).id || id), () => ({
        ...recalculated,
        status: 'Calculated'
      })) as Promise<ExaminationBatch>;
    }
  },

  async approveBatch(id: string): Promise<{ batch: ExaminationBatch; warnings?: Array<{ item_id: string; item_name: string; available: number; required: number; message: string }> }> {
    try {
      const resolvedId = await resolveBatchId(id);
      const response = await fetchWithTimeout(`/batches/${resolvedId}/approve`, {
        method: 'POST',
        headers: getHeaders()
      }, HEAVY_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to approve batch'));
      const data = await safeJson(response, 'approveBatch');
      const batch = data.batch || data;
      const warnings = data.warnings || [];
      await storeLocalBatch({
        ...batch,
        _syncStatus: 'synced',
        _lastSyncedAt: toIso()
      });
      return { batch, warnings };
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const batch = await updateLocalBatch(id, (b: any) => ({
        ...b,
        status: 'Approved'
      })) as unknown as ExaminationBatch;
      return { batch, warnings: [] };
    }
  },

  async getCostBreakdown(id: string): Promise<any[]> {
    try {
      const resolvedId = await resolveBatchId(id);
      const response = await fetchWithTimeout(`/batches/${resolvedId}/cost-breakdown`, {
        headers: getHeaders()
      }, MEDIUM_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to fetch cost breakdown'));
      return safeJson(response, 'getCostBreakdown');
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const batch = await this.getBatch(id);
      return buildLocalBomRows(batch as any);
    }
  },

  async getBOM(id: string): Promise<any[]> {
    try {
      const resolvedId = await resolveBatchId(id);
      try {
        return await this.getCostBreakdown(resolvedId);
      } catch {
        const response = await fetchWithTimeout(`/batches/${resolvedId}/bom`, {
          headers: getHeaders()
        }, MEDIUM_REQUEST_TIMEOUT_MS);
        if (!response.ok) throw new Error(await toServiceError(response, 'Failed to fetch BOM'));
        return safeJson(response, 'getBOM');
      }
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const batch = await this.getBatch(id);
      return buildLocalBomRows(batch as any);
    }
  },

  async getAdjustmentMeta(): Promise<{ adjustments: MarketAdjustment[]; fetched_at: string }> {
    try {
      const response = await fetchWithTimeout('/meta/adjustments', {
        headers: getHeaders()
      }, REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to fetch adjustment metadata'));
      return safeJson(response, 'getAdjustmentMeta');
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      return {
        adjustments: await getLocalAdjustments(),
        fetched_at: toIso()
      };
    }
  },

  async syncMarketAdjustments(payload: {
    adjustments: Array<Partial<MarketAdjustment> & Record<string, unknown>>;
    replaceMissing?: boolean;
    triggerRecalculate?: boolean;
  }): Promise<{
    success: boolean;
    upserted: number;
    changed: number;
    deactivated: number;
    checksum: string;
    item_count: number;
    recalculation?: any;
  }> {
    try {
      const response = await fetchWithTimeout('/sync/market-adjustments', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload)
      }, HEAVY_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to sync market adjustments'));
      return safeJson(response, 'syncMarketAdjustments');
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const adjustments = Array.isArray(payload.adjustments) ? payload.adjustments : [];
      await Promise.all(adjustments.map((adjustment) => dbService.put('marketAdjustments', {
        id: String(adjustment.id || generateLocalId()),
        name: String(adjustment.name || adjustment.displayName || 'Adjustment'),
        displayName: String(adjustment.displayName || adjustment.name || 'Adjustment'),
        type: String(adjustment.type || 'PERCENTAGE').toUpperCase() === 'FIXED' ? 'FIXED' : 'PERCENTAGE',
        value: Number(adjustment.value ?? adjustment.percentage ?? 0) || 0,
        percentage: Number(adjustment.percentage ?? adjustment.value ?? 0) || 0,
        active: adjustment.active ?? adjustment.isActive ?? true
      } as any)));
      return {
        success: true,
        upserted: adjustments.length,
        changed: adjustments.length,
        deactivated: 0,
        checksum: `offline-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        item_count: adjustments.length
      };
    }
  },

  async syncInventoryItems(payload: {
    items: Array<(Partial<Item> & { id: string }) & Record<string, unknown>>;
    triggerRecalculate?: boolean;
  }): Promise<{
    success: boolean;
    upserted: number;
    changed: number;
    cost_changed: number;
    checksum: string;
    item_count: number;
    recalculation?: any;
  }> {
    try {
      const response = await fetchWithTimeout('/sync/inventory-items', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload)
      }, HEAVY_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to sync inventory items'));
      return safeJson(response, 'syncInventoryItems');
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const items = Array.isArray(payload.items) ? payload.items : [];
      return {
        success: true,
        upserted: items.length,
        changed: items.length,
        cost_changed: 0,
        checksum: `offline-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        item_count: items.length
      };
    }
  },

  async getSyncHealth(): Promise<{
    checked_at: string;
    ok: boolean;
    entities: Record<string, {
      last_synced_at: string | null;
      state_checksum: string | null;
      backend_checksum: string;
      state_count: number;
      backend_count: number;
      drift: boolean;
    }>;
  }> {
    try {
      const response = await fetchWithTimeout('/sync/health', {
        headers: getHeaders()
      }, REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to fetch sync health'));
      return safeJson(response, 'getSyncHealth');
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const [batches, adjustments, inventory] = await Promise.all([
        getLocalBatches(),
        getLocalAdjustments(),
        getLocalInventory()
      ]);
      return {
        checked_at: toIso(),
        ok: true,
        entities: {
          examinationBatches: {
            last_synced_at: null,
            state_checksum: 'offline-local-first',
            backend_checksum: 'offline-disabled',
            state_count: batches.length,
            backend_count: 0,
            drift: false
          },
          marketAdjustments: {
            last_synced_at: null,
            state_checksum: 'offline-local-first',
            backend_checksum: 'offline-disabled',
            state_count: adjustments.length,
            backend_count: 0,
            drift: false
          },
          inventoryItems: {
            last_synced_at: null,
            state_checksum: 'offline-local-first',
            backend_checksum: 'offline-disabled',
            state_count: inventory.length,
            backend_count: 0,
            drift: false
          }
        }
      };
    }
  },

  async recalculateNonInvoicedBatches(payload?: {
    trigger?: string;
    includeApproved?: boolean;
    limit?: number;
  }): Promise<{
    attempted: number;
    recalculated: number;
    failed: number;
    skipped: number;
    errors: Array<{ batch_id: string; status: string; error: string }>;
  }> {
    try {
      const response = await fetchWithTimeout('/backfill/recalculate-non-invoiced', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload || {})
      }, HEAVY_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to recalculate non-invoiced batches'));
      return safeJson(response, 'recalculateNonInvoicedBatches');
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const batches = await getLocalBatches();
      const includeApproved = Boolean(payload?.includeApproved);
      const limit = Math.max(1, Number(payload?.limit || batches.length));
      const targets = batches
        .filter((batch: any) => {
          const status = String(batch?.status || '').toLowerCase();
          if (status === 'invoiced' || status === 'paid') return false;
          if (!includeApproved && status === 'approved') return false;
          return true;
        })
        .slice(0, limit);

      let recalculated = 0;
      let failed = 0;
      let skipped = Math.max(0, batches.length - targets.length);
      const errors: Array<{ batch_id: string; status: string; error: string }> = [];

      for (const batch of targets) {
        try {
          await this.calculateBatch(String(batch.id));
          recalculated += 1;
        } catch (recalcError) {
          failed += 1;
          errors.push({
            batch_id: String(batch.id),
            status: String(batch.status || 'Draft'),
            error: recalcError instanceof Error ? recalcError.message : 'Unknown error'
          });
        }
      }

      return {
        attempted: targets.length,
        recalculated,
        failed,
        skipped,
        errors
      };
    }
  },

  async recalculateBatch(batchId: string): Promise<any> {
    try {
      const response = await fetchWithTimeout(`/recalculate-batch/${batchId}`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({})
      }, HEAVY_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to recalculate batch'));
      return safeJson(response, 'recalculateBatch');
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      return this.calculateBatch(batchId);
    }
  },

  async generateInvoice(
    id: string,
    payload?: { idempotencyKey?: string; invoiceNumber?: string }
  ): Promise<{
    success: boolean;
    invoiceId: number;
    created?: boolean;
    idempotent?: boolean;
    invoice?: ExaminationGeneratedInvoicePayload;
  }> {
    try {
      const headers = getHeaders();
      const resolvedId = await resolveBatchId(id);
      const idempotencyKey = payload?.idempotencyKey || `EXAM-BATCH-${resolvedId}`;
      const invoiceNumber = payload?.invoiceNumber;

      const response = await fetchWithTimeout(`/batches/${resolvedId}/invoice`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ idempotencyKey, invoiceNumber })
      }, HEAVY_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to generate invoice'));
      return safeJson(response, 'generateInvoice');
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const localBatch = await this.getBatch(id);
      const recalculated = await applyCalculatedBatchState(localBatch as any);
      const updatedBatch = await updateLocalBatch(String((localBatch as any).id || id), () => ({
        ...recalculated,
        status: 'Invoiced'
      }));
      const invoicePayload = await buildLocalInvoicePayload(updatedBatch as any, payload);
      return {
        success: true,
        invoiceId: Date.now() * 1000 + Math.floor(Math.random() * 1000),
        created: true,
        idempotent: false,
        invoice: invoicePayload
      };
    }
  },

  // Class methods
  async getBatchByNumber(batchNumber: string): Promise<ExaminationBatch | null> {
    const local = await getLocalBatches();
    const localMatch = local.find(batch => batch.batch_number === batchNumber || batch.batchNumber === batchNumber);
    if (localMatch) return localMatch as ExaminationBatch;

    try {
      const response = await fetchWithTimeout(`/batches?batch_number=${encodeURIComponent(batchNumber)}`, {
        headers: getHeaders()
      }, REQUEST_TIMEOUT_MS);
      if (!response.ok) return null;
      const data = await safeJson(response, 'getBatchByNumber');
      return data?.batches?.[0] || data?.[0] || null;
    } catch {
      return null;
    }
  },

  async findBatchByNumber(batchNumber: string): Promise<ExaminationBatch | null> {
    const local = await getLocalBatches();
    const found = local.find(b => b.batch_number === batchNumber || b.batchNumber === batchNumber);
    if (found) return found as ExaminationBatch;
    return this.getBatchByNumber(batchNumber);
  },

  async addClass(batchId: string, payload: Partial<ExaminationClass>): Promise<ExaminationClass> {
    if (!batchId || !batchId.trim()) {
      throw new Error('Batch ID is required to create a class');
    }
    if (!payload.class_name || !String(payload.class_name).trim()) {
      throw new Error('Class name is required');
    }
    if (payload.number_of_learners === undefined || payload.number_of_learners === null) {
      throw new Error('Number of learners is required');
    }
    if (Number(payload.number_of_learners) <= 0) {
      throw new Error('Number of learners must be greater than 0');
    }

    try {
      const response = await fetchWithTimeout('/classes', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ ...payload, batch_id: batchId }),
      }, HEAVY_REQUEST_TIMEOUT_MS);

      if (!response.ok) {
        throw new Error(await toServiceError(response, 'Failed to add class'));
      }

      return safeJson(response, 'addClass');
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const createdClass = {
        ...payload,
        id: generateLocalId(),
        batch_id: batchId,
        class_name: String(payload.class_name || '').trim(),
        number_of_learners: Math.max(1, Math.floor(Number(payload.number_of_learners) || 0)),
        subjects: Array.isArray(payload.subjects) ? payload.subjects : [],
        is_manual_override: false,
        manual_cost_per_learner: null,
        created_at: toIso(),
        updated_at: toIso()
      };

      const updatedBatch = await updateLocalBatch(batchId, (batch) => ({
        ...batch,
        classes: [...(Array.isArray(batch.classes) ? batch.classes : []), createdClass]
      }));
      const recalculated = await applyCalculatedBatchState(updatedBatch);
      const storedBatch = await updateLocalBatch(String(updatedBatch.id), () => ({
        ...recalculated,
        status: updatedBatch.status || 'Draft'
      }));
      return (Array.isArray((storedBatch as any).classes) ? (storedBatch as any).classes : []).find((row: any) => String(row.id) === String(createdClass.id));
    }
  },

  async updateClass(classId: string, payload: Partial<ExaminationClass>): Promise<ExaminationClass> {
    try {
      const response = await fetchWithTimeout(`/classes/${classId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      }, HEAVY_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to update class'));
      return safeJson(response, 'updateClass');
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const owner = await findLocalClassOwner(classId);
      if (!owner) throw new Error(`Class not found in local storage: ${classId}`);
      const updatedBatch = await updateLocalBatch(String(owner.batch.id), (batch) => {
        const classes = Array.isArray(batch.classes) ? [...batch.classes] : [];
        classes[owner.classIndex] = {
          ...classes[owner.classIndex],
          ...payload,
          id: classId,
          updated_at: toIso()
        };
        return { ...batch, classes };
      });
      const recalculated = await applyCalculatedBatchState(updatedBatch);
      const storedBatch = await updateLocalBatch(String(updatedBatch.id), () => recalculated);
      return (Array.isArray((storedBatch as any).classes) ? (storedBatch as any).classes : []).find((row: any) => String(row.id) === String(classId));
    }
  },

  async updateClassPricing(
    classId: string,
    payload: { cost_per_learner?: number; is_manual_override?: boolean; override_reason?: string },
    canOverrideSuggestedCost = false
  ): Promise<ExaminationBatch> {
    try {
      const headers = getHeaders();
      headers['x-can-override-exam-cost'] = canOverrideSuggestedCost ? 'true' : 'false';

      const response = await fetchWithTimeout(`/classes/${classId}/pricing`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload),
      }, HEAVY_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to update class pricing'));
      return response.json();
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const owner = await findLocalClassOwner(classId);
      if (!owner) throw new Error(`Class not found in local storage: ${classId}`);
      const updatedBatch = await updateLocalBatch(String(owner.batch.id), (batch) => {
        const classes = Array.isArray(batch.classes) ? [...batch.classes] : [];
        const existing = classes[owner.classIndex] || {};
        const learners = Math.max(1, Math.floor(Number(existing.number_of_learners) || 0));
        const manualFee = Number(payload.cost_per_learner ?? existing.manual_cost_per_learner ?? 0) || 0;
        classes[owner.classIndex] = {
          ...existing,
          is_manual_override: payload.is_manual_override ?? existing.is_manual_override ?? true,
          manual_cost_per_learner: manualFee,
          final_fee_per_learner: manualFee,
          price_per_learner: manualFee,
          live_total_preview: Number((manualFee * learners).toFixed(2)),
          override_reason: payload.override_reason || existing.override_reason,
          updated_at: toIso()
        };
        return summarizeBatchTotals({ ...batch, classes });
      });
      return updatedBatch as ExaminationBatch;
    }
  },

  async getClassPricingHistory(classId: string, limit = 100): Promise<any[]> {
    try {
      const response = await fetchWithTimeout(`/classes/${classId}/pricing-history?limit=${limit}`, {
        headers: getHeaders()
      }, REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to fetch class pricing history'));
      return response.json();
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      return [];
    }
  },

  async deleteClass(classId: string): Promise<void> {
    try {
      const response = await fetchWithTimeout(`/classes/${classId}`, {
        method: 'DELETE',
        headers: getHeaders()
      }, HEAVY_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to delete class'));
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const owner = await findLocalClassOwner(classId);
      if (!owner) return;
      const updatedBatch = await updateLocalBatch(String(owner.batch.id), (batch) => ({
        ...batch,
        classes: (Array.isArray(batch.classes) ? batch.classes : []).filter((row: any) => String(row?.id) !== String(classId))
      }));
      const recalculated = await applyCalculatedBatchState(updatedBatch);
      await updateLocalBatch(String(updatedBatch.id), () => recalculated);
    }
  },

  // Subject methods
  async addSubject(classId: string, payload: Partial<ExaminationSubject>): Promise<ExaminationSubject> {
    try {
      const response = await fetchWithTimeout('/subjects', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ ...payload, class_id: classId }),
      }, HEAVY_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to add subject'));
      return response.json();
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const owner = await findLocalClassOwner(classId);
      if (!owner) throw new Error(`Class not found in local storage: ${classId}`);
      const createdSubject = {
        ...payload,
        id: generateLocalId(),
        class_id: classId,
        subject_name: String((payload as any).subject_name || payload.name || 'Subject').trim(),
        name: String(payload.name || (payload as any).subject_name || 'Subject').trim(),
        pages: Math.max(1, Math.floor(Number((payload as any).pages || 0) || 1)),
        extra_copies: Math.max(0, Math.floor(Number((payload as any).extra_copies || 0))),
        created_at: toIso(),
        updated_at: toIso()
      };
      const updatedBatch = await updateLocalBatch(String(owner.batch.id), (batch) => {
        const classes = Array.isArray(batch.classes) ? [...batch.classes] : [];
        const currentClass = { ...classes[owner.classIndex] };
        currentClass.subjects = [...(Array.isArray(currentClass.subjects) ? currentClass.subjects : []), createdSubject];
        classes[owner.classIndex] = currentClass;
        return { ...batch, classes };
      });
      const recalculated = await applyCalculatedBatchState(updatedBatch);
      await updateLocalBatch(String(updatedBatch.id), () => recalculated);
      return createdSubject as ExaminationSubject;
    }
  },

  async updateSubject(subjectId: string, payload: Partial<ExaminationSubject>): Promise<ExaminationSubject> {
    try {
      const response = await fetchWithTimeout(`/subjects/${subjectId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      }, HEAVY_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to update subject'));
      return response.json();
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const owner = await findLocalSubjectOwner(subjectId);
      if (!owner) throw new Error(`Subject not found in local storage: ${subjectId}`);
      const updatedBatch = await updateLocalBatch(String(owner.batch.id), (batch) => {
        const classes = Array.isArray(batch.classes) ? [...batch.classes] : [];
        const currentClass = { ...classes[owner.classIndex] };
        const subjects = Array.isArray(currentClass.subjects) ? [...currentClass.subjects] : [];
        subjects[owner.subjectIndex] = {
          ...subjects[owner.subjectIndex],
          ...payload,
          id: subjectId,
          updated_at: toIso()
        };
        currentClass.subjects = subjects;
        classes[owner.classIndex] = currentClass;
        return { ...batch, classes };
      });
      const recalculated = await applyCalculatedBatchState(updatedBatch);
      await updateLocalBatch(String(updatedBatch.id), () => recalculated);
      const currentClass = (Array.isArray((updatedBatch as any).classes) ? (updatedBatch as any).classes : [])[owner.classIndex];
      return (Array.isArray(currentClass?.subjects) ? currentClass.subjects : []).find((row: any) => String(row.id) === String(subjectId));
    }
  },

  async deleteSubject(subjectId: string): Promise<void> {
    try {
      const response = await fetchWithTimeout(`/subjects/${subjectId}`, {
        method: 'DELETE',
        headers: getHeaders()
      }, HEAVY_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to delete subject'));
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const owner = await findLocalSubjectOwner(subjectId);
      if (!owner) return;
      const updatedBatch = await updateLocalBatch(String(owner.batch.id), (batch) => {
        const classes = Array.isArray(batch.classes) ? [...batch.classes] : [];
        const currentClass = { ...classes[owner.classIndex] };
        currentClass.subjects = (Array.isArray(currentClass.subjects) ? currentClass.subjects : []).filter((row: any) => String(row?.id) !== String(subjectId));
        classes[owner.classIndex] = currentClass;
        return { ...batch, classes };
      });
      const recalculated = await applyCalculatedBatchState(updatedBatch);
      await updateLocalBatch(String(updatedBatch.id), () => recalculated);
    }
  },

  // Settings methods
  async getPricingSettings(): Promise<ExaminationPricingSettings> {
    try {
      const response = await fetchWithTimeout('/settings/pricing', {
        headers: getHeaders()
      }, REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to fetch examination pricing settings'));
      const result = await response.json();
      await dbService.saveSetting(EXAM_PRICING_SETTINGS_KEY, result);
      return result;
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      return getLocalPricingSettings();
    }
  },

  async updatePricingSettings(payload: {
    paper_item_id?: string | null;
    toner_item_id?: string | null;
    conversion_rate?: number;
    trigger_recalculate?: boolean;
    lock_batch_id?: string;
    lock_pricing_snapshot?: boolean;
    lock_reason?: string;
  }): Promise<{
    success: boolean;
    recalculation?: any;
    pricing_lock?: any;
  }> {
    try {
      const response = await fetchWithTimeout('/settings/pricing', {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(payload)
      }, HEAVY_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to update examination pricing settings'));
      const result = await response.json();
      await dbService.saveSetting(EXAM_PRICING_SETTINGS_KEY, result);
      return result;
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const settings = await saveLocalPricingSettings(payload);
      if (payload.lock_batch_id) {
        await updateLocalBatch(String(payload.lock_batch_id), (batch) => ({
          ...batch,
          pricing_settings_snapshot: settings,
          pricing_lock: payload.lock_pricing_snapshot ? {
            locked: true,
            reason: payload.lock_reason || 'Offline pricing snapshot',
            locked_at: toIso()
          } : batch.pricing_lock
        }));
      }
      return {
        success: true,
        pricing_lock: payload.lock_pricing_snapshot ? {
          locked: true,
          reason: payload.lock_reason || 'Offline pricing snapshot'
        } : undefined
      };
    }
  },

  async getExamPricingSettings() {
    return this.getPricingSettings();
  },

  async updateExamPricingSettings(payload: {
    paper_item_id?: string | null;
    toner_item_id?: string | null;
    conversion_rate?: number;
    trigger_recalculate?: boolean;
    lock_batch_id?: string;
    lock_pricing_snapshot?: boolean;
    lock_reason?: string;
  }) {
    return this.updatePricingSettings(payload);
  },

  // New methods for Examination Pricing Redesign

  async getClass(classId: string): Promise<ExaminationClass> {
    try {
      const response = await fetchWithTimeout(`/classes/${classId}`, {
        headers: getHeaders()
      }, REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to fetch class'));
      return response.json();
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const owner = await findLocalClassOwner(classId);
      if (!owner) throw new Error(`Class not found in local storage: ${classId}`);
      return owner.batch.classes?.[owner.classIndex] as ExaminationClass;
    }
  },

  async getClassPreview(
    classId: string,
    options?: {
      paperId?: string;
      tonerId?: string;
      paperUnitCost?: number;
      tonerUnitCost?: number;
      tonerPagesPerUnit?: number;
      paperConversionRate?: number;
      applyRounding?: boolean;
      rounding_method?: string;
      rounding_value?: number;
      roundingMethod?: string;
      roundingValue?: number;
      adjustments?: MarketAdjustment[];
    }
  ): Promise<{
    classId: string;
    className: string;
    learners: number;
    totalSheets: number;
    totalPages: number;
    paperQuantity: number;
    tonerQuantity: number;
    paperCost: number;
    tonerCost: number;
    totalBomCost: number;
    totalAdjustments: number;
    totalCost: number;
    expectedFeePerLearner: number;
    materialTotalCost: number;
    adjustmentTotalCost: number;
    calculatedTotalCost: number;
      adjustmentBreakdown: Array<{
        adjustmentId: string;
        adjustmentName: string;
      adjustmentType: string;
      adjustmentValue: number;
      baseAmount: number;
      originalAmount: number;
      redistributedAmount: number;
        allocationRatio: number;
      }>;
  }> {
    try {
      const response = await fetchWithTimeout(`/classes/${classId}/preview`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(options || {})
      }, MEDIUM_REQUEST_TIMEOUT_MS);

      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to fetch class preview'));
      return response.json();
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const owner = await findLocalClassOwner(classId);
      if (!owner) throw new Error(`Class not found in local storage: ${classId}`);
      const recalculated = await applyCalculatedBatchState(owner.batch, {
        paper_item_id: options?.paperId || null,
        toner_item_id: options?.tonerId || null,
        paper_unit_cost: options?.paperUnitCost,
        toner_unit_cost: options?.tonerUnitCost,
        conversion_rate: options?.paperConversionRate
      }, options?.adjustments);
      const classRow = (Array.isArray(recalculated.classes) ? recalculated.classes : []).find((row: any) => String(row.id) === String(classId));
      if (!classRow) throw new Error(`Class not found in local storage: ${classId}`);
      return {
        classId: String(classRow.id),
        className: String(classRow.class_name || 'Class'),
        learners: Math.max(0, Math.floor(Number(classRow.number_of_learners) || 0)),
        totalSheets: Number(classRow.total_sheets || 0),
        totalPages: Number(classRow.total_pages || 0),
        paperQuantity: Number((Number(classRow.total_sheets || 0) / Math.max(1, Number(options?.paperConversionRate || DEFAULT_PAPER_CONVERSION_RATE))).toFixed(4)),
        tonerQuantity: Number((Number(classRow.total_pages || 0) / DEFAULT_TONER_PAGES_PER_UNIT).toFixed(6)),
        paperCost: Number(classRow.material_total_cost || 0),
        tonerCost: 0,
        totalBomCost: Number(classRow.material_total_cost || 0),
        totalAdjustments: Number(classRow.adjustment_total_cost || 0),
        totalCost: Number(classRow.calculated_total_cost || classRow.live_total_preview || 0),
        expectedFeePerLearner: Number(classRow.expected_fee_per_learner || 0),
        materialTotalCost: Number(classRow.material_total_cost || 0),
        adjustmentTotalCost: Number(classRow.adjustment_total_cost || 0),
        calculatedTotalCost: Number(classRow.calculated_total_cost || classRow.live_total_preview || 0),
        adjustmentBreakdown: []
      };
    }
  },

  async updateClassFinancialMetrics(
    classId: string,
    payload: {
      expected_fee_per_learner?: number;
      final_fee_per_learner?: number;
      live_total_preview?: number;
      material_total_cost?: number;
      adjustment_total_cost?: number;
      market_adjustment_total?: number;
      rounding_adjustment?: number;
      calculated_total_cost?: number;
      financial_metrics_source?: 'SYSTEM_CALCULATION' | 'MANUAL_OVERRIDE' | 'PRICING_SETTINGS_SYNC';
      financial_metrics_updated_by?: string;
      financial_metrics_updated_at?: string;
    }
  ): Promise<ExaminationClass> {
    try {
      const response = await fetchWithTimeout(`/classes/${classId}/financial-metrics`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      }, HEAVY_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to update class financial metrics'));
      return response.json();
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const owner = await findLocalClassOwner(classId);
      if (!owner) throw new Error(`Class not found in local storage: ${classId}`);
      const updatedBatch = await updateLocalBatch(String(owner.batch.id), (batch) => {
        const classes = Array.isArray(batch.classes) ? [...batch.classes] : [];
        classes[owner.classIndex] = {
          ...classes[owner.classIndex],
          ...payload,
          id: classId,
          updated_at: toIso()
        };
        return summarizeBatchTotals({ ...batch, classes });
      });
      return (Array.isArray((updatedBatch as any).classes) ? (updatedBatch as any).classes : []).find((row: any) => String(row.id) === String(classId));
    }
  },

  async syncPricingToBatch(
    batchId: string,
    payload: {
      settings: ExaminationPricingSettings;
      adjustments: MarketAdjustment[];
      triggerSource: 'SYSTEM_CALCULATION' | 'MANUAL_OVERRIDE' | 'PRICING_SETTINGS_SYNC';
    }
  ): Promise<{
    success: boolean;
    classesUpdated: number;
    errors: Array<{ classId: string; error: string }>;
  }> {
    try {
      const headers = getHeaders();
      headers['x-user-id'] = headers['x-user-id'] || 'System';

      const response = await fetchWithTimeout(`/batches/${batchId}/sync-pricing`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      }, HEAVY_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(await toServiceError(response, 'Failed to sync pricing to batch'));
      return response.json();
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      const updatedSettings = await saveLocalPricingSettings(payload.settings || {});
      const localBatch = await this.getBatch(batchId);
      const recalculated = await applyCalculatedBatchState(localBatch as any, updatedSettings, payload.adjustments);
      const storedBatch = await updateLocalBatch(String((localBatch as any).id || batchId), () => ({
        ...recalculated,
        pricing_settings_snapshot: updatedSettings
      }));
      return {
        success: true,
        classesUpdated: Array.isArray((storedBatch as any).classes) ? (storedBatch as any).classes.length : 0,
        errors: []
      };
    }
  }
};
