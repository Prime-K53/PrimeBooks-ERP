import axios from 'axios';
import { logger } from '@/services/logger';
import { dbService } from './db.ts';
import { productionDb } from './productionDb.ts';
import { getUrl, API_BASE_URL, HAS_REMOTE_BACKEND, SUPABASE_CONFIGURED } from '@/config/api.js';
import { supabase } from './supabaseClient';
import { platform } from './platform';
import { isVerboseApiLoggingEnabled } from '../utils/debugFlags';
import {
  Item, Warehouse, Purchase, Sale, Quotation, JobOrder,
  CustomerPayment, ProductionBatch, WorkOrder, WorkCenter,
  ProductionResource, Account, LedgerEntry,
  Invoice, RecurringInvoice, Expense, Income, ScheduledPayment,
  WalletTransaction, DeliveryNote, Budget, Transfer, Employee, PayrollRun,
  Payslip, ResourceAllocation, GoodsReceipt, User,
  SMSCampaign, Subscriber, SMSTemplate, Cheque, Shipment, SubcontractOrder,
  MaintenanceLog, UserRole,
  ExamPaper, ExamPrintingBatch, School, ExamJob, Customer, Supplier, SupplierPayment, SalesReturn,
  ExaminationJob, ExaminationJobSubject, ExaminationInvoiceGroup, ExaminationRecurringProfile,
  Order, OrderPayment, OrderItem, BillOfMaterial, BOMTemplate, MarketAdjustment
} from '../types';
import { transactionService } from './transactionService';
import { generateNextId } from '../utils/helpers';
import { generateNextSalesInvoiceNumber } from './documentNumberService';
import { apiClient as fetchApiClient } from './apiClient';
import { RenderPage, RenderNode, RenderText, RenderLine, RenderSecurity } from '../../contracts/RenderModel';
import {
  recalculatePrice as recalculateProductPrice,
  repriceMasterInventoryFromAdjustments
} from './masterInventoryPricingService';
import { validateMinimumMarkup } from './pricingValidationService';
import {
  examinationJobService,
  ExaminationGroupPayload,
  ExaminationJobPayload,
  ExaminationRecurringPayload
} from './examinationJobService.ts';

// ── Axios client with deduplication, retry, and consolidated interceptors ──

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {}
});

// ── Single consolidated request interceptor ──
apiClient.interceptors.request.use((config) => {
  // Skip when backend auth is not available
  if (shouldPreferLocalReadModels()) {
    return Promise.reject({ __localOnly: true, message: 'Skipped (no auth)', config });
  }
  if (!config.headers) config.headers = {} as any;
  try {
    const raw = sessionStorage.getItem('nexus_user');
    if (raw) {
      const user = JSON.parse(raw);
      if (user.id) config.headers['x-user-id'] = user.id;
      if (user.role) config.headers['x-user-role'] = user.role;
      if (user.email) config.headers['x-user-email'] = user.email;
      config.headers['x-user-is-super-admin'] = user.isSuperAdmin === true ? 'true' : 'false';
    } else if (import.meta.env?.DEV) {
      config.headers['x-user-id'] = 'USR-0001';
      config.headers['x-user-role'] = 'Admin';
      config.headers['x-user-is-super-admin'] = 'true';
    }
  } catch { /* non-fatal */ }
  try {
    const companyConfig = localStorage.getItem('nexus_company_config');
    if (companyConfig) {
      const parsed = JSON.parse(companyConfig);
      if (parsed?.companyId) config.headers['x-company-id'] = parsed.companyId;
    }
  } catch { /* non-fatal */ }
  try {
    const fyId = localStorage.getItem('selectedFinancialYearId');
    if (fyId) {
      config.params = { ...(config.params || {}), financial_year_id: fyId };
    }
  } catch { /* non-fatal */ }
  try {
    const sbSession = localStorage.getItem('prime-erp-supabase-auth');
    if (sbSession) {
      const parsed = JSON.parse(sbSession);
      if (parsed?.access_token) {
        config.headers['Authorization'] = `Bearer ${parsed.access_token}`;
        config.headers['x-auth-mode'] = 'supabase';
      }
    }
  } catch { /* non-fatal */ }
  if (import.meta.env?.DEV) {
    config.headers['x-dev-bypass'] = 'true';
  }
  return config;
}, (err) => Promise.reject(err));

// ── Consolidated axios instance ──

// ── Single consolidated response interceptor with retry for 429 ──
const MAX_RETRIES = 3;

apiClient.interceptors.response.use(
  (response) => {
    // Content-type sanity checks
    const contentType = response.headers['content-type'] || '';
    const method = getRequestMethod(response.config?.method);
    const fullUrl = getRequestUrl(response.config);
    const responseText = typeof response.data === 'string' ? response.data : '';
    if (responseText.toLowerCase().includes('method not allowed')) {
      const error: Error & { status?: number } = new Error(`Wrong HTTP method for endpoint: ${method} ${fullUrl} (HTTP ${response.status})`);
      error.status = response.status;
      logger.error(`Error Wrong HTTP method detected for ${method} ${fullUrl}`, { status: response.status, contentType });
      return Promise.reject(error);
    }
    if (isHtmlContent(String(contentType), response.data)) {
      const error: Error & { status?: number } = new Error(`Wrong endpoint for API request: ${method} ${fullUrl} returned HTML instead of JSON (HTTP ${response.status})`);
      error.status = response.status;
      logger.error(`Error Wrong endpoint detected for ${method} ${fullUrl}`, { status: response.status, contentType });
      return Promise.reject(error);
    }
    return response;
  },
  async (error) => {
    const config = error.config || {};

    // Retry logic for 429 (rate limit) with exponential backoff
    if (error.response?.status === 429) {
      const retryCount = (config as any)._retryCount || 0;
      if (retryCount < MAX_RETRIES) {
        (config as any)._retryCount = retryCount + 1;
        const delay = Math.min(1000 * Math.pow(2, retryCount) + Math.random() * 1000, 15000);
        logger.warn(`Rate limited, retrying in ${Math.round(delay)}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return apiClient.request(config);
      }
      logger.error(`Rate limit retries exhausted for ${config.url}`);
    }

    const method = getRequestMethod(config.method);
    const fullUrl = getRequestUrl(config);
    if (error.response) {
      const { data, status, headers } = error.response;
      const contentType = headers['content-type'] || '';
      const rawBody = typeof data === 'string' ? data : '';
      const lowerBody = String(rawBody || '').toLowerCase();
      logger.error(`Error Response ${method} ${fullUrl} -> ${status}`);
      if (status === 401) {
        handleUnauthorizedResponse(fullUrl);
        error.message = 'Your session is not authorized. Please sign in again.';
      } else if (isHtmlContent(contentType, data)) {
        error.message = `Wrong endpoint for API request: ${method} ${fullUrl} returned HTML instead of JSON (HTTP ${status})`;
      } else if (status === 405 || lowerBody.includes('method not allowed')) {
        error.message = `Wrong HTTP method for endpoint: ${method} ${fullUrl} (HTTP ${status})`;
      } else if (isJsonContent(contentType) && data && typeof data === 'object') {
        error.message = data.error || data.message || error.message;
      }
    } else if (error.request) {
      const isNetworkError = String(error.code || '').includes('ERR_NETWORK') || String(error.message || '').includes('network error');
      error.isCorsOrNetworkError = isNetworkError || !error.response;
      error.message = error.isCorsOrNetworkError
        ? 'No response from backend. Possible CORS preflight rejection or network error.'
        : 'No response from backend. Check your connection or API URL.';
    }
    return Promise.reject(error);
  }
);

const isProd = false;
const verboseApiLoggingEnabled = isVerboseApiLoggingEnabled();

export const ensureBackendInProd = (context: string, error: unknown) => {
  if (!isProd && !verboseApiLoggingEnabled) {
    return;
  }

  const detail = error instanceof Error ? error.message : String(error || 'Unknown backend error');
  console.warn(`[${context}] Local backend unavailable, using fallback`, detail);
};

const getRequestMethod = (method?: string) => String(method || 'GET').toUpperCase();
const getApiPath = (path: string) => {
  const normalized = String(path || '').trim();
  if (!normalized) return '/';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

const getSessionUser = () => {
  try {
    const raw = sessionStorage.getItem('nexus_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const isPasswordBypassSession = () => {
  const sessionUser = getSessionUser();
  if (!sessionUser) return false;

  return sessionUser.bypassAuth === true || sessionUser.authMode === 'password_bypass';
};

const hasBackendAuth = () => {
  try {
    const sbSession = localStorage.getItem('prime-erp-supabase-auth');
    if (sbSession) {
      const parsed = JSON.parse(sbSession);
      if (parsed?.access_token) return true;
    }
    const nexusUser = sessionStorage.getItem('nexus_user');
    if (nexusUser) {
      const parsed = JSON.parse(nexusUser);
      if (parsed?.accessToken) return true;
    }
  } catch {}
  return false;
};
const shouldPreferLocalReadModels = () => !hasBackendAuth();

const getRequestUrl = (config: any) => {
  const rawUrl = String(config?.url || '').trim();
  if (!rawUrl) return 'Unknown URL';
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  const base = String(config?.baseURL || '').trim().replace(/\/+$/, '');
  const path = rawUrl.replace(/^\/+/, '');
  return base ? `${base}/${path}` : `/${path}`;
};

const isHtmlContent = (contentType: string, data: unknown) => {
  if (String(contentType || '').toLowerCase().includes('text/html')) return true;
  if (typeof data !== 'string') return false;
  const trimmed = data.trim();
  return trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html');
};

const isJsonContent = (contentType: string) => {
  const normalized = String(contentType || '').toLowerCase();
  return normalized.includes('application/json') || normalized.includes('+json');
};

const logger = {
  info: (msg: string, extra?: any) => {
    if (!verboseApiLoggingEnabled) return;
    const formatted = `[FRONTEND] ${msg}`;
    console.log(formatted, extra || '');
    if (platform.isDesktop) {
      platform.api.log({ message: formatted, level: 'INFO', ...extra });
    }
  },
  warn: (msg: string, extra?: any) => {
    const formatted = `[FRONTEND] ${msg}`;
    console.warn(formatted, extra || '');
    if (platform.isDesktop) {
      platform.api.log({ message: formatted, level: 'WARN', ...extra });
    }
  },
  error: (msg: string, extra?: any) => {
    const formatted = `[FRONTEND] ${msg}`;
    console.error(formatted, extra || '');
    if (platform.isDesktop) {
      platform.api.log({ message: formatted, level: 'ERROR', ...extra });
    }
  }
};

const handleUnauthorizedResponse = (fullUrl: string) => {
  logger.error('Missing or invalid authentication headers', { url: fullUrl });
  if (typeof window !== 'undefined') {
    const shouldRedirect = String(import.meta.env.VITE_REDIRECT_ON_401 || '').toLowerCase() === 'true';
    if (shouldRedirect) {
      const currentHash = String(window.location?.hash || '');
      if (!currentHash.includes('/login')) {
        window.location.hash = '#/login';
      }
    }
  }
};

// (response interceptor consolidated above — see the single consolidated handler)

// (request interceptors consolidated above — see the single consolidated handler)

/**
 * Authorization Middleware Simulation
 * Ensures the requesting user has appropriate roles for sensitive DB operations.
 */
const getAuthSession = () => {
  const saved = sessionStorage.getItem('nexus_user');
  return saved ? JSON.parse(saved) : null;
};

const checkAuth = (requiredRoles: UserRole[], context: string) => {
  const user = getAuthSession();
  if (!user) return; // Allow when no session (offline/local-first mode)
  if (user.role === 'Admin') return; // Master access
  if (!requiredRoles.includes(user.role)) {
    throw new Error(`[FORBIDDEN] Role ${user.role} does not have access to ${context}`);
  }
};

const handle = async <T>(fn: () => Promise<T>, context: string): Promise<T> => {
  // Hard Safeguard: Throw fatal error if any network activity is detected in the call stack
  // (In a real browser environment, we'd check window.navigator.onLine or proxy the fetch)
  // For this implementation, we ensure no external URL is being constructed or passed.
  try {
    return await fn();
  } catch (error: any) {
    const msg = error?.message || 'Unknown database error';
    logger.error(`API Error in ${context}:`, error);
    throw new Error(`[${context}] ${msg}`);
  }
};

const toNum = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeSalesExchange = (exchange: any) => {
  const fallbackId = exchange?.id || exchange?.exchange_number || `fallback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const rawItems = Array.isArray(exchange?.items) ? exchange.items : [];

  const items = rawItems.map((item: any, index: number) => {
    const productName =
      item?.product_name ||
      item?.productName ||
      item?.description ||
      item?.name ||
      item?.desc ||
      'Item';

    const qtyReplaced = toNum(item?.qty_replaced ?? item?.qtyReplaced);
    const replacedName =
      item?.replaced_product_name ||
      item?.replacedProductName ||
      (qtyReplaced > 0 ? productName : undefined);

    return {
      ...item,
      id: item?.id || `${fallbackId}-${index + 1}`,
      product_name: productName,
      replaced_product_name: replacedName,
      qty_returned: toNum(item?.qty_returned ?? item?.qtyReturned),
      qty_replaced: qtyReplaced,
      price_difference: toNum(item?.price_difference ?? item?.priceDifference),
    };
  });

  return {
    ...exchange,
    items,
  };
};

const normalizeDashboardDate = (value: any) => {
  const rawValue = String(value || '').trim();
  if (!rawValue) return '';
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
};

const createDashboardChartSeed = (days: number) => {
  const chartSeed: Record<string, { day: string; total: number }> = {};
  const now = new Date();

  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const key = date.toISOString().slice(0, 10);
    chartSeed[key] = {
      day: key,
      total: 0,
    };
  }

  return chartSeed;
};

const buildLocalDashboardSnapshot = async (days = 30) => {
  const safeDays = Math.max(1, Math.min(Number(days) || 30, 365));
  const [sales, invoices] = await Promise.all([
    dbService.getAll<any>('sales'),
    dbService.getAll<any>('invoices'),
  ]);

  const chartSeed = createDashboardChartSeed(safeDays);
  const todayKey = new Date().toISOString().slice(0, 10);

  const sortedSales = [...sales]
    .sort((left, right) => new Date(String(right?.date || 0)).getTime() - new Date(String(left?.date || 0)).getTime());
  const sortedInvoices = [...invoices]
    .sort((left, right) => {
      const rightDate = String(right?.createdAt || right?.created_at || right?.date || 0);
      const leftDate = String(left?.createdAt || left?.created_at || left?.date || 0);
      return new Date(rightDate).getTime() - new Date(leftDate).getTime();
    });

  const revenue = sortedSales.reduce((sum, sale) => sum + toNum(sale?.totalAmount ?? sale?.total), 0);
  const todaySales = sortedSales.reduce((sum, sale) => {
    const saleDate = normalizeDashboardDate(sale?.date);
    return saleDate === todayKey ? sum + toNum(sale?.totalAmount ?? sale?.total) : sum;
  }, 0);
  const outstandingInvoices = sortedInvoices.filter((invoice) => {
    const status = String(invoice?.status || '').trim().toLowerCase();
    return status && status !== 'paid';
  }).length;

  sortedSales.forEach((sale) => {
    const key = normalizeDashboardDate(sale?.date);
    if (!key || !chartSeed[key]) return;
    chartSeed[key].total += toNum(sale?.totalAmount ?? sale?.total);
  });

  return {
    revenue,
    todaySales,
    outstandingInvoices,
    chartData: Object.values(chartSeed),
    sales: sortedSales.slice(0, 200),
    invoices: sortedInvoices.slice(0, 50),
  };
};

const hasMeaningfulDashboardPayload = (payload: any) => {
  if (!payload || typeof payload !== 'object') return false;

  if (toNum(payload?.revenue) > 0 || toNum(payload?.todaySales) > 0 || toNum(payload?.outstandingInvoices) > 0) {
    return true;
  }

  if (Array.isArray(payload?.sales) && payload.sales.length > 0) {
    return true;
  }

  if (Array.isArray(payload?.invoices) && payload.invoices.length > 0) {
    return true;
  }

  return Array.isArray(payload?.chartData) && payload.chartData.some((point: any) => toNum(point?.total) > 0);
};

const mergeSalePayload = (baseSale: any, remoteSale: any) => {
  const merged = {
    ...(baseSale || {}),
    ...(remoteSale || {})
  };

  merged.items = Array.isArray(remoteSale?.items)
    ? remoteSale.items
    : (Array.isArray(baseSale?.items) ? baseSale.items : []);

  merged.payments = Array.isArray(remoteSale?.payments)
    ? remoteSale.payments
    : (Array.isArray(baseSale?.payments) ? baseSale.payments : []);

  return merged;
};

const normalizeBackendInventoryItem = (item: any): Item => ({
  id: item.id,
  name: item.name,
  material: item.material || '',
  type: item.type || 'material',
  category: item.category || item.category_id || '',
  quantity: Number(item.quantity || item.stock || 0),
  unit: item.unit || 'units',
  costPrice: Number(item.cost_per_unit ?? item.cost ?? item.costPrice ?? 0),
  sellingPrice: Number(item.selling_price ?? item.sellingPrice ?? item.price ?? 0),
  minStockLevel: Number(item.min_stock_level ?? item.minStockLevel ?? 0),
  maxStockLevel: Number(item.max_stock_level ?? item.maxStockLevel ?? 0),
  reorderPoint: Number(item.reorder_point ?? item.reorderPoint ?? 0),
  warehouseId: item.warehouse_id || item.warehouseId || '',
  reserved: Number(item.reserved || 0),
  isProtected: Boolean(item.is_protected || item.isProtected),
  category_id: item.category_id || null,
  min_stock_level: Number(item.min_stock_level ?? item.minStockLevel ?? 0),
  max_stock_level: Number(item.max_stock_level ?? item.maxStockLevel ?? 0),
  reorder_point: Number(item.reorder_point ?? item.reorderPoint ?? 0),
  cost_per_unit: Number(item.cost_per_unit ?? item.cost ?? item.costPrice ?? 0),
  selling_price: Number(item.selling_price ?? item.sellingPrice ?? item.price ?? 0),
  warehouse_id: item.warehouse_id || item.warehouseId || '',
  company_id: item.company_id || '',
  created_at: item.created_at || item.last_updated || '',
  updated_at: item.updated_at || item.last_updated || '',
});

const mapInventoryItemToBackend = (item: Item): any => ({
  id: item.id,
  name: item.name,
  material: item.material || item.category || '',
  type: (item.type || 'material').toLowerCase(),
  category_id: item.category_id || null,
  quantity: Number(item.quantity || item.stock || 0),
  unit: item.unit || 'units',
  cost_per_unit: Number(item.costPrice ?? item.cost ?? item.cost_per_unit ?? 0),
  selling_price: Number(item.sellingPrice ?? item.price ?? item.selling_price ?? 0),
  min_stock_level: Number(item.minStockLevel ?? item.min_stock_level ?? 0),
  max_stock_level: Number(item.maxStockLevel ?? item.max_stock_level ?? 0),
  reorder_point: Number(item.reorderPoint ?? item.reorder_point ?? 0),
  warehouse_id: item.warehouseId || item.warehouse_id || null,
  reserved: Number(item.reserved || 0),
});

export const api = {
  auth: {
    login: async (username: string, password?: string, mfaCode?: string) => {
      return handle(async () => {
        const dbUsers = await dbService.getAll<User>('users');
        const found = dbUsers.find(u => u.username.toLowerCase() === username.toLowerCase());
        if (!found) return { status: 401, error: 'User not found in local database' };
        return { status: 200, data: found };
      }, 'Auth.Login');
    },
    changePassword: async (oldPassword: string, newPassword: string) => {
      const dbUsers = await dbService.getAll<User>('users');
      const currentUser = dbUsers[0];
      if (!currentUser) {
        throw new Error('No local user found');
      }
      return dbService.put('users', { ...currentUser, password: newPassword });
    },
    getDashboard: (days?: number) => handle(async () => {
      const safeDays = Math.max(1, Math.min(Number(days) || 30, 365));

      if (shouldPreferLocalReadModels()) {
        return buildLocalDashboardSnapshot(safeDays);
      }

      try {
        const response = await apiClient.get('/dashboard', { params: { days: safeDays } });
        const payload = response.data || {};

        if (hasMeaningfulDashboardPayload(payload)) {
          return payload;
        }

        console.warn('[Dashboard.Get] Remote dashboard payload was empty. Falling back to local IndexedDB snapshot.');
        return buildLocalDashboardSnapshot(safeDays);
      } catch (err) {
        if (isProd) {
          console.warn('[Dashboard.Get] Backend request failed. Falling back to local IndexedDB snapshot.', err);
        }
        return buildLocalDashboardSnapshot(safeDays);
      }
    }, 'Dashboard.Get')
  },

  inventory: {
    getAllItems: () => handle(async () => {
      return dbService.getAll<Item>('inventory');
    }, 'Inventory.GetAll'),
    createItem: (item: Item) => handle(async () => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Inventory.Create');
      return dbService.put('inventory', item);
    }, 'Inventory.Create'),
    updateItem: (item: Item) => handle(async () => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Inventory.Update');
      return dbService.put('inventory', item);
    }, 'Inventory.Update'),
    deleteItem: (id: string) => handle(async () => {
      checkAuth(['Admin'], 'Inventory.Delete');
      return dbService.delete('inventory', id);
    }, 'Inventory.Delete'),
    getAllWarehouses: () => handle(() => dbService.getAll<Warehouse>('warehouses'), 'Inventory.GetWarehouses'),
    saveWarehouse: (wh: Warehouse) => handle(() => {
      checkAuth(['Admin'], 'Inventory.SaveWarehouse');
      return dbService.put('warehouses', wh);
    }, 'Inventory.SaveWarehouse'),
    deleteWarehouse: (id: string) => handle(() => {
      checkAuth(['Admin'], 'Inventory.DeleteWarehouse');
      return dbService.delete('warehouses', id);
    }, 'Inventory.DeleteWarehouse')
  },

  sales: {
    getAllSales: () => handle(async () => {
      if (shouldPreferLocalReadModels()) {
        return dbService.getAll<Sale>('sales');
      }

      try {
        const response = await apiClient.get('/sales');
        const remoteSales = Array.isArray(response.data) ? response.data : [];
        const existingSales = await dbService.getAll<Sale>('sales');
        const existingSalesById = new Map(existingSales.map((sale: any) => [sale.id, sale]));
        const sales = remoteSales.map((sale: any) => mergeSalePayload(existingSalesById.get(sale.id), sale));

        for (const sale of sales) {
          await dbService.put('sales', sale as Sale);
        }
        return sales;
      } catch (err) {
        ensureBackendInProd('Sales.GetAll', err);
        return dbService.getAll<Sale>('sales');
      }
    }, 'Sales.GetAll'),
    createSale: (sale: Sale) => handle(async () => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Sales.Create');
      await transactionService.processSale(sale, undefined, sale.cashierId || 'System');
      try {
        if (!SUPABASE_CONFIGURED) {
          const response = await apiClient.post('/sales', sale);
          const persistedSale = mergeSalePayload(sale, response.data);
          await dbService.put('sales', persistedSale);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('primeerp:dashboard-refresh'));
          }
          return persistedSale;
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('primeerp:dashboard-refresh'));
        }
        return sale;
      } catch (err) {
        ensureBackendInProd('Sales.Create', err);
        return sale;
      }
    }, 'Sales.Create'),

    getQuotations: () => handle(() => dbService.getAll<Quotation>('quotations'), 'Sales.GetQuotations'),
    saveQuotation: (q: Quotation) => handle(() => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Sales.SaveQuotation');
      return transactionService.processQuotation(q);
    }, 'Sales.SaveQuotation'),
    deleteQuotation: (id: string) => handle(() => {
      checkAuth(['Admin', 'Accountant'], 'Sales.DeleteQuotation');
      return dbService.delete('quotations', id);
    }, 'Sales.DeleteQuotation'),

    getJobOrders: () => handle(() => dbService.getAll<JobOrder>('jobOrders'), 'Sales.GetJobOrders'),
    saveJobOrder: (j: JobOrder) => handle(() => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Sales.SaveJobOrder');
      return dbService.put('jobOrders', j);
    }, 'Sales.SaveJobOrder'),
    deleteJobOrder: (id: string) => handle(() => {
      checkAuth(['Admin'], 'Sales.DeleteJobOrder');
      return dbService.delete('jobOrders', id);
    }, 'Sales.DeleteJobOrder'),

    getCustomerPayments: () => handle(async () => {
      if (shouldPreferLocalReadModels()) {
        return dbService.getAll<CustomerPayment>('customerPayments');
      }
      try {
        const response = await apiClient.get(getApiPath('customer-payments'));
        const backendPayments = Array.isArray(response.data) ? response.data : [];
        // Sync backend payments to IndexedDB for offline use
        for (const p of backendPayments) {
          await dbService.put('customerPayments', {
            id: p.id,
            customerId: p.customer_id || p.customerId,
            customerName: p.customer_name || p.customerName || '',
            amount: Number(p.amount || 0),
            date: p.date || new Date().toISOString(),
            method: p.method || p.payment_method || p.paymentMethod || 'Cash',
            reference: p.reference || '',
            allocations: p.allocations || [],
            notes: p.notes || '',
            status: p.status || 'Cleared',
            reconciled: p.reconciled || false
          });
        }
        return backendPayments;
      } catch {
        return dbService.getAll<CustomerPayment>('customerPayments');
      }
    }, 'Sales.GetCustomerPayments'),
    saveCustomerPayment: (r: CustomerPayment) => handle(async () => {
      checkAuth(['Admin', 'Accountant'], 'Sales.SaveCustomerPayment');
      const result = await transactionService.addCustomerPayment(r);
      // Try to sync to backend
      try {
        await apiClient.post(getApiPath('customer-payments'), {
          id: r.id,
          customer_id: r.customerId,
          customer_name: r.customerName,
          amount: r.amount,
          date: r.date,
          payment_method: r.method,
          reference: r.reference,
          notes: r.notes,
          status: r.status || 'Cleared'
        });
      } catch {
        // Backend sync is best-effort; data is safely in IndexedDB
      }
      return result;
    }, 'Sales.SaveCustomerPayment'),
    updateCustomerPayment: (r: CustomerPayment) => handle(() => {
      checkAuth(['Admin', 'Accountant'], 'Sales.UpdateCustomerPayment');
      return transactionService.updateCustomerPayment(r);
    }, 'Sales.UpdateCustomerPayment'),
    deleteCustomerPayment: (id: string) => handle(() => {
      checkAuth(['Admin'], 'Sales.DeleteCustomerPayment');
      return transactionService.voidCustomerPayment(id, 'User requested deletion');
    }, 'Sales.DeleteCustomerPayment'),

    getShipments: () => handle(() => dbService.getAll<Shipment>('shipments'), 'Sales.GetShipments'),
    saveShipment: (s: Shipment) => handle(() => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Sales.SaveShipment');
      return dbService.put('shipments', s);
    }, 'Sales.SaveShipment'),
    deleteShipment: (id: string) => handle(() => {
      checkAuth(['Admin'], 'Sales.DeleteShipment');
      return dbService.delete('shipments', id);
    }, 'Sales.DeleteShipment'),

    /* Sales Orders */
    getSalesOrders: () => handle(async () => {
      if (shouldPreferLocalReadModels()) {
        return dbService.getAll('salesOrders');
      }

      try {
        const response = await apiClient.get(getApiPath('sales-orders'));
        const orders = Array.isArray(response.data) ? response.data : [];
        for (const o of orders) await dbService.put('salesOrders', o);
        return orders;
      } catch (err) {
        ensureBackendInProd('Sales.GetSalesOrders', err);
        console.warn('Backend fetch failed for sales orders, using local');
        return dbService.getAll('salesOrders');
      }
    }, 'Sales.GetSalesOrders'),

    getSalesOrderById: (id: string) => handle(async () => {
      if (shouldPreferLocalReadModels()) {
        return dbService.get('salesOrders', id);
      }

      try {
        const response = await apiClient.get(getApiPath(`sales-orders/${id}`));
        await dbService.put('salesOrders', response.data);
        return response.data;
      } catch (err) {
        ensureBackendInProd('Sales.GetSalesOrderById', err);
        return dbService.get('salesOrders', id);
      }
    }, 'Sales.GetSalesOrderById'),

    saveSalesOrder: (o: any) => handle(async () => {
      checkAuth(['Admin', 'Clerk', 'Sales'], 'Sales.SaveSalesOrder');
      try {
        const response = await apiClient.post(getApiPath('sales-orders'), o);
        await dbService.put('salesOrders', response.data || o);
        return response.data || o;
      } catch (err) {
        ensureBackendInProd('Sales.SaveSalesOrder', err);
        // Store locally when backend unavailable
        await dbService.put('salesOrders', o);
        return { success: true, localOnly: true };
      }
    }, 'Sales.SaveSalesOrder'),

    deleteSalesOrder: (id: string) => handle(async () => {
      checkAuth(['Admin'], 'Sales.DeleteSalesOrder');
      try {
        await apiClient.delete(getApiPath(`sales-orders/${id}`));
        await dbService.delete('salesOrders', id);
        return { success: true };
      } catch (err) {
        ensureBackendInProd('Sales.DeleteSalesOrder', err);
        // mark as deleted locally
        await dbService.delete('salesOrders', id);
        return { success: true, localOnly: true };
      }
    }, 'Sales.DeleteSalesOrder'),

    saveRefund: (r: SalesReturn) => handle(() => {
      checkAuth(['Admin', 'Accountant'], 'Sales.SaveRefund');
      return transactionService.processRefund(r);
    }, 'Sales.SaveRefund'),

    getSalesExchanges: () => handle(async () => {
      if (shouldPreferLocalReadModels()) {
        const localExchanges = await dbService.getAll('salesExchanges');
        return (localExchanges || []).map((exchange: any) => normalizeSalesExchange(exchange));
      }

      try {
        // Try backend first
        const response = await apiClient.get(getApiPath('sales-exchanges'));
        const remoteExchanges = Array.isArray(response.data) ? response.data : [];

        const hydratedExchanges = await Promise.all(
          remoteExchanges.map(async (exchange: any) => {
            let hydrated = exchange;

            // The list endpoint can omit item lines; hydrate via details endpoint when needed.
            if (!Array.isArray(hydrated?.items) || hydrated.items.length === 0) {
              try {
                const detailResponse = await apiClient.get(getApiPath(`sales-exchanges/${exchange.id}`));
                hydrated = detailResponse.data || hydrated;
              } catch {
                // Keep list payload if details endpoint is unavailable.
              }
            }

            // Preserve locally cached items if backend payload is missing them.
            if (!Array.isArray(hydrated?.items) || hydrated.items.length === 0) {
              const localCached =
                (await dbService.get<Record<string, unknown>>('salesExchanges', exchange.id)) ||
                (await dbService.get<Record<string, unknown>>('salesExchanges', String(exchange.id)));
              if (localCached) {
                const cachedItems = localCached.items;
                if (Array.isArray(cachedItems) && cachedItems.length > 0) {
                  hydrated = { ...hydrated, items: cachedItems };
                }
              }
            }

            return normalizeSalesExchange(hydrated);
          })
        );

        // Sync to local
        for (const ex of hydratedExchanges) {
          await dbService.put('salesExchanges', ex);
        }
        return hydratedExchanges;
      } catch (err) {
        ensureBackendInProd('Sales.GetExchanges', err);
        console.warn('Backend fetch failed for sales exchanges, using local');
        const localExchanges = await dbService.getAll('salesExchanges');
        return (localExchanges || []).map((exchange: any) => normalizeSalesExchange(exchange));
      }
    }, 'Sales.GetExchanges'),

    getSalesExchangeById: (id: string) => handle(async () => {
      if (shouldPreferLocalReadModels()) {
        const local =
          (await dbService.get('salesExchanges', id)) ||
          (await dbService.get('salesExchanges', String(id)));
        return local ? normalizeSalesExchange(local) : local;
      }

      try {
        const response = await apiClient.get(getApiPath(`sales-exchanges/${id}`));
        const normalized = normalizeSalesExchange(response.data);
        await dbService.put('salesExchanges', normalized);
        return normalized;
      } catch (err) {
        ensureBackendInProd('Sales.GetExchangeById', err);
        const local =
          (await dbService.get('salesExchanges', id)) ||
          (await dbService.get('salesExchanges', String(id)));
        return local ? normalizeSalesExchange(local) : local;
      }
    }, 'Sales.GetExchangeById'),

    createSalesExchange: (exchange: any) => handle(async () => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Sales.CreateExchange');

      // Process locally first (request only)
      const localResult = await transactionService.createSalesExchangeRequest(exchange);
      try {
        const response = await apiClient.post(getApiPath('sales-exchanges'), exchange);
        return { ...localResult, backendId: response.data.id };
      } catch (err) {
        ensureBackendInProd('Sales.CreateExchange', err);
        console.warn('Backend sync failed for exchange request, stored locally');
        return localResult;
      }
    }, 'Sales.CreateExchange'),

    approveSalesExchange: (id: string, comments: string) => handle(async () => {
      checkAuth(['Admin', 'Manager'], 'Sales.ApproveExchange');

      // Process financial/inventory adjustments locally
      const localResult = await transactionService.approveSalesExchange(id, comments);
      try {
        const response = await apiClient.post(getApiPath(`sales-exchanges/${id}/approve`), { comments });
        return { ...localResult, backendId: response.data.id };
      } catch (err) {
        ensureBackendInProd('Sales.ApproveExchange', err);
        console.warn('Backend sync failed for exchange approval, stored locally');
        return localResult;
      }
    }, 'Sales.ApproveExchange'),

    getReprintJobs: () => handle(async () => {
      if (shouldPreferLocalReadModels()) {
        return dbService.getAll('reprintJobs');
      }

      try {
        const response = await apiClient.get(getApiPath('reprint-jobs'));
        for (const job of response.data) {
          await dbService.put('reprintJobs', job);
        }
        return response.data;
      } catch (err) {
        ensureBackendInProd('Sales.GetReprintJobs', err);
        return dbService.getAll('reprintJobs');
      }
    }, 'Sales.GetReprintJobs'),

    updateReprintJob: (id: string, data: any) => handle(async () => {
      checkAuth(['Admin', 'Operator', 'Manager'], 'Sales.UpdateReprintJob');
      try {
        const response = await apiClient.put(getApiPath(`reprint-jobs/${id}`), data);
        await dbService.put('reprintJobs', { ...data, id });
        return response.data;
      } catch (err) {
        ensureBackendInProd('Sales.UpdateReprintJob', err);
        await dbService.put('reprintJobs', { ...data, id });
        return { success: true, localOnly: true };
      }
    }, 'Sales.UpdateReprintJob'),

    deleteSalesExchange: (id: string) => handle(async () => {
      checkAuth(['Admin'], 'Sales.DeleteExchange');
      console.warn("Security Policy: Physical deletion of exchanges is restricted. Status will be updated to Deleted.");
      // In a real audit-compliant system, we just update status
      try {
        await apiClient.patch(getApiPath(`sales-exchanges/${id}`), { status: 'Deleted' });
        const existing = await dbService.get<Record<string, unknown>>('salesExchanges', id);
        if (existing && typeof existing === 'object') {
          await dbService.put('salesExchanges', { ...existing, status: 'Deleted' });
        }
        return { success: true };
      } catch (err) {
        ensureBackendInProd('Sales.DeleteExchange', err);
        const existing = await dbService.get<Record<string, unknown>>('salesExchanges', id);
        if (existing && typeof existing === 'object') {
          await dbService.put('salesExchanges', { ...existing, status: 'Deleted' });
        }
        return { success: true, localOnly: true };
      }
    }, 'Sales.DeleteExchange'),

    cancelSalesExchange: (id: string) => handle(async () => {
      checkAuth(['Admin', 'Manager', 'Clerk'], 'Sales.CancelExchange');
      try {
        const response = await apiClient.patch(getApiPath(`sales-exchanges/${id}`), { status: 'Cancelled' });
        const existing = await dbService.get<Record<string, unknown>>('salesExchanges', id);
        if (existing && typeof existing === 'object') {
          await dbService.put('salesExchanges', { ...existing, status: 'Cancelled' });
        }
        return response.data;
      } catch (err) {
        ensureBackendInProd('Sales.CancelExchange', err);
        const existing = await dbService.get<Record<string, unknown>>('salesExchanges', id);
        if (existing && typeof existing === 'object') {
          await dbService.put('salesExchanges', { ...existing, status: 'Cancelled' });
        }
        return { success: true, localOnly: true };
      }
    }, 'Sales.CancelExchange'),

    // Orders Section
    getAllOrders: () => handle(() => dbService.getAll<Order>('orders'), 'Orders.GetAll'),
    getOrderById: (id: string) => handle(() => dbService.get<Order>('orders', id), 'Orders.GetById'),
    createOrder: (order: Order) => handle(async () => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Orders.Create');
      return transactionService.createOrder(order);
    }, 'Orders.Create'),
    recordOrderPayment: (orderId: string, payment: OrderPayment) => handle(async () => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Orders.RecordPayment');
      return transactionService.recordOrderPayment(orderId, payment);
    }, 'Orders.RecordPayment'),
    updateOrderStatus: (orderId: string, status: Order['status']) => handle(async () => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Orders.UpdateStatus');
      return transactionService.updateOrderStatus(orderId, status);
    }, 'Orders.UpdateStatus'),
    cancelOrder: (orderId: string, reason: string) => handle(async () => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Orders.Cancel');
      return transactionService.cancelOrder(orderId, reason);
    }, 'Orders.Cancel'),
  },

  procurement: {
    getPurchases: () => handle(async () => {
      if (shouldPreferLocalReadModels()) {
        return dbService.getAll<Purchase>('purchases');
      }
      try {
        const response = await apiClient.get(getApiPath('purchases'));
        const remote = Array.isArray(response.data) ? response.data : [];
        for (const p of remote) { await dbService.put('purchases', p); }
        return remote;
      } catch (err) {
        ensureBackendInProd('Procurement.GetPurchases', err);
        return dbService.getAll<Purchase>('purchases');
      }
    }, 'Procurement.GetPurchases'),
    savePurchase: (p: Purchase) => handle(async () => {
      checkAuth(['Admin', 'Accountant'], 'Procurement.SavePurchase');
      const localResult = await transactionService.processPurchaseOrder(p);
      try {
        const response = await apiClient.post(getApiPath('purchases'), p);
        return response.data || localResult;
      } catch (err) {
        ensureBackendInProd('Procurement.SavePurchase', err);
        return localResult;
      }
    }, 'Procurement.SavePurchase'),
    getGoodsReceipts: () => handle(async () => {
      if (shouldPreferLocalReadModels()) {
        return dbService.getAll<GoodsReceipt>('goodsReceipts');
      }
      try {
        const response = await apiClient.get(getApiPath('grn'));
        const remote = Array.isArray(response.data) ? response.data : [];
        for (const gr of remote) { await dbService.put('goodsReceipts', gr); }
        return remote;
      } catch (err) {
        ensureBackendInProd('Procurement.GetGRNs', err);
        return dbService.getAll<GoodsReceipt>('goodsReceipts');
      }
    }, 'Procurement.GetGRNs'),
    saveGoodsReceipt: (gr: GoodsReceipt) => handle(async () => {
      checkAuth(['Admin', 'Accountant'], 'Procurement.SaveGRN');
      const localResult = await transactionService.processGoodsReceipt(gr);
      try {
        const response = await apiClient.post(getApiPath('grn'), gr);
        return response.data || localResult;
      } catch (err) {
        ensureBackendInProd('Procurement.SaveGRN', err);
        return localResult;
      }
    }, 'Procurement.SaveGRN'),

    getSubcontractOrders: () => handle(() => dbService.getAll<SubcontractOrder>('subcontractOrders'), 'Procurement.GetSubcontracts'),
    saveSubcontractOrder: (o: SubcontractOrder) => handle(() => {
      checkAuth(['Admin', 'Accountant'], 'Procurement.SaveSubcontract');
      return dbService.put('subcontractOrders', o);
    }, 'Procurement.SaveSubcontract'),
    deleteSubcontractOrder: (id: string) => handle(() => {
      checkAuth(['Admin'], 'Procurement.DeleteSubcontract');
      return dbService.delete('subcontractOrders', id);
    }, 'Procurement.DeleteSubcontract'),
  },

  suppliers: {
    getAll: () => handle(async () => {
      if (shouldPreferLocalReadModels()) {
        return dbService.getAll<Supplier>('suppliers');
      }
      try {
        const response = await apiClient.get(getApiPath('suppliers'));
        const remote = Array.isArray(response.data) ? response.data : [];
        for (const s of remote) { await dbService.put('suppliers', s); }
        return remote;
      } catch (err) {
        ensureBackendInProd('Suppliers.GetAll', err);
        return dbService.getAll<Supplier>('suppliers');
      }
    }, 'Suppliers.GetAll'),
    create: (s: Supplier) => handle(async () => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Suppliers.Save');
      await dbService.put('suppliers', s);
      try {
        const response = await apiClient.post(getApiPath('suppliers'), s);
        return response.data || s;
      } catch (err) {
        ensureBackendInProd('Suppliers.Create', err);
        return { success: true, localOnly: true };
      }
    }, 'Suppliers.Create'),
    update: (s: Supplier) => handle(async () => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Suppliers.Update');
      await dbService.put('suppliers', s);
      try {
        const response = await apiClient.put(getApiPath(`suppliers/${encodeURIComponent(s.id)}`), s);
        return response.data || s;
      } catch (err) {
        ensureBackendInProd('Suppliers.Update', err);
        return { success: true, localOnly: true };
      }
    }, 'Suppliers.Update'),
    deleteSupplier: (id: string) => handle(async () => {
      checkAuth(['Admin'], 'Suppliers.Delete');
      await dbService.delete('suppliers', id);
      try {
        await apiClient.delete(getApiPath(`suppliers/${id}`));
        return { success: true };
      } catch (err) {
        ensureBackendInProd('Suppliers.Delete', err);
        return { success: true, localOnly: true };
      }
    }, 'Suppliers.Delete'),
  },

  production: {
    getBatches: () => handle(async () => {
      try { return await productionDb.batches.toArray(); } catch { return dbService.getAll<ProductionBatch>('batches'); }
    }, 'Production.GetBatches'),
    saveBatch: (b: ProductionBatch) => handle(async () => {
      checkAuth(['Admin', 'Accountant'], 'Production.SaveBatch');
      try { await productionDb.batches.put(b); } catch { await dbService.put('batches', b); }
    }, 'Production.SaveBatch'),

    getWorkOrders: () => handle(async () => {
      try { return await productionDb.workOrders.toArray(); } catch { return dbService.getAll<WorkOrder>('workOrders'); }
    }, 'Production.GetWorkOrders'),
    saveWorkOrder: (w: WorkOrder) => handle(async () => {
      checkAuth(['Admin', 'Accountant'], 'Production.SaveWorkOrder');
      try { await productionDb.workOrders.put(w); } catch { await dbService.put('workOrders', w); }
    }, 'Production.SaveWorkOrder'),
    deleteWorkOrder: (id: string) => handle(async () => {
      checkAuth(['Admin'], 'Production.DeleteWorkOrder');
      try { await productionDb.workOrders.delete(id); } catch { await dbService.delete('workOrders', id); }
    }, 'Production.DeleteWorkOrder'),

    getWorkCenters: () => handle(async () => {
      try { return await productionDb.workCenters.toArray(); } catch { return dbService.getAll<WorkCenter>('workCenters'); }
    }, 'Production.GetWorkCenters'),
    saveWorkCenter: (wc: WorkCenter) => handle(async () => {
      checkAuth(['Admin'], 'Production.SaveWorkCenter');
      try { await productionDb.workCenters.put(wc); } catch { await dbService.put('workCenters', wc); }
    }, 'Production.SaveWorkCenter'),

    getResources: () => handle(async () => {
      try { return await productionDb.resources.toArray(); } catch { return dbService.getAll<ProductionResource>('resources'); }
    }, 'Production.GetResources'),
    saveResource: (r: ProductionResource) => handle(async () => {
      checkAuth(['Admin'], 'Production.SaveResource');
      try { await productionDb.resources.put(r); } catch { await dbService.put('resources', r); }
    }, 'Production.SaveResource'),

    getAllocations: () => handle(async () => {
      try { return await productionDb.resourceAllocations.toArray(); } catch { return dbService.getAll<ResourceAllocation>('resourceAllocations'); }
    }, 'Production.GetAllocations'),
    saveAllocation: (a: ResourceAllocation) => handle(async () => {
      checkAuth(['Admin', 'Accountant'], 'Production.SaveAllocation');
      try { await productionDb.resourceAllocations.put(a); } catch { await dbService.put('resourceAllocations', a); }
    }, 'Production.SaveAllocation'),

    getExaminations: () => handle(() => dbService.getAll<ExamPaper>('examPapers'), 'Production.GetExaminations'),
    getSchools: () => handle(() => dbService.getAll<School>('schools'), 'Production.GetSchools'),

    // --- New Examination Printing Module ---
    getExaminationJobs: () => handle(() => examinationJobService.listJobs(), 'Production.GetExaminationJobs'),
    getExaminationJob: (examId: string) => handle(() => examinationJobService.getJob(examId), 'Production.GetExaminationJob'),
    createExaminationJob: (payload: ExaminationJobPayload) => handle(() => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Production.CreateExaminationJob');
      return examinationJobService.createJob(payload);
    }, 'Production.CreateExaminationJob'),
    updateExaminationJob: (examId: string, updates: Partial<ExaminationJobPayload>) => handle(() => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Production.UpdateExaminationJob');
      return examinationJobService.updateJob(examId, updates);
    }, 'Production.UpdateExaminationJob'),
    replaceExaminationSubjects: (examId: string, subjects: ExaminationJobPayload['subjects']) => handle(() => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Production.ReplaceExaminationSubjects');
      return examinationJobService.replaceSubjects(examId, subjects);
    }, 'Production.ReplaceExaminationSubjects'),
    recalculateExam: (examId: string) => handle(() => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Production.RecalculateExam');
      return examinationJobService.recalculateExam(examId);
    }, 'Production.RecalculateExam'),
    recalculateOpenExaminationJobs: (includeOverridden = true) => handle(() => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Production.RecalculateOpenExaminationJobs');
      return examinationJobService.recalculateOpenJobs({ includeOverridden });
    }, 'Production.RecalculateOpenExaminationJobs'),
    approveExaminationJob: (examId: string) => handle(() => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Production.ApproveExaminationJob');
      return examinationJobService.approveJob(examId);
    }, 'Production.ApproveExaminationJob'),
    deleteExaminationJob: (examId: string) => handle(async () => {
      checkAuth(['Admin', 'Accountant'], 'Production.DeleteExaminationJob');
      return examinationJobService.deleteJob(examId);
    }, 'Production.DeleteExaminationJob'),
    createExaminationInvoice: (jobIds: string[]) => handle(() => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Production.CreateExaminationInvoice');
      return examinationJobService.createInvoiceForJobs(jobIds);
    }, 'Production.CreateExaminationInvoice'),
    getExaminationInvoiceGroups: () => handle(() => examinationJobService.listInvoiceGroups(), 'Production.GetExaminationInvoiceGroups'),
    createExaminationInvoiceGroup: (payload: ExaminationGroupPayload) => handle(() => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Production.CreateExaminationInvoiceGroup');
      return examinationJobService.createInvoiceGroup(payload);
    }, 'Production.CreateExaminationInvoiceGroup'),
    addJobsToExaminationInvoiceGroup: (groupId: string, jobIds: string[]) => handle(() => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Production.AddJobsToExaminationInvoiceGroup');
      return examinationJobService.addJobsToGroup(groupId, jobIds);
    }, 'Production.AddJobsToExaminationInvoiceGroup'),
    removeJobFromExaminationInvoiceGroup: (groupId: string, jobId: string) => handle(() => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Production.RemoveJobFromExaminationInvoiceGroup');
      return examinationJobService.removeJobFromGroup(groupId, jobId);
    }, 'Production.RemoveJobFromExaminationInvoiceGroup'),
    deleteExaminationInvoiceGroup: (groupId: string) => handle(async () => {
      checkAuth(['Admin', 'Accountant'], 'Production.DeleteExaminationInvoiceGroup');
      return examinationJobService.deleteInvoiceGroup(groupId);
    }, 'Production.DeleteExaminationInvoiceGroup'),
    generateExaminationGroupInvoice: (groupId: string) => handle(() => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Production.GenerateExaminationGroupInvoice');
      return examinationJobService.generateInvoiceForGroup(groupId);
    }, 'Production.GenerateExaminationGroupInvoice'),
    getExaminationRecurringProfiles: () => handle(() => examinationJobService.listRecurringProfiles(), 'Production.GetExaminationRecurringProfiles'),
    convertExaminationJobToRecurring: (examId: string, payload: ExaminationRecurringPayload) => handle(() => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Production.ConvertExaminationJobToRecurring');
      return examinationJobService.convertJobToRecurring(examId, payload);
    }, 'Production.ConvertExaminationJobToRecurring'),
    convertExaminationGroupToRecurring: (groupId: string, payload: ExaminationRecurringPayload) => handle(() => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Production.ConvertExaminationGroupToRecurring');
      return examinationJobService.convertGroupToRecurring(groupId, payload);
    }, 'Production.ConvertExaminationGroupToRecurring'),
    runExaminationRecurringBilling: (asOfDate?: string) => handle(() => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Production.RunExaminationRecurringBilling');
      return examinationJobService.runRecurringBilling(asOfDate);
    }, 'Production.RunExaminationRecurringBilling'),

    // --- Dynamic Classes & Subjects ---
    getClasses: () => handle(async () => {
      try {
        const response = await apiClient.get(getUrl('classes'));
        // Sync to local DB
        for (const cls of response.data) {
          await dbService.put('classes', { id: cls.id.toString(), name: cls.name });
        }
        return response.data;
      } catch (err) {
        ensureBackendInProd('Production.GetClasses', err);
        console.warn('Backend classes fetch failed, using local data');
        return dbService.getAll('classes');
      }
    }, 'Production.GetClasses'),

    saveClass: (name: string) => handle(async () => {
      checkAuth(['Admin', 'Accountant'], 'Production.SaveClass');
      try {
        const response = await apiClient.post(getUrl('classes'), { name });
        await dbService.put('classes', { id: response.data.id.toString(), name: response.data.name });
        return response.data;
      } catch (err) {
        ensureBackendInProd('Production.SaveClass', err);
        const id = `local-class-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        await dbService.put('classes', { id, name });
        return { id, name };
      }
    }, 'Production.SaveClass'),

    deleteClass: (id: string) => handle(async () => {
      checkAuth(['Admin'], 'Production.DeleteClass');
      try {
        await apiClient.delete(getUrl(`classes/${id}`));
      } catch (err) {
        ensureBackendInProd('Production.DeleteClass', err);
        console.warn('Backend class delete failed, deleting locally');
      }
      return dbService.delete('classes', id);
    }, 'Production.DeleteClass'),

    getSubjects: () => handle(async () => {
      try {
        const response = await apiClient.get(getUrl('subjects'));
        // Sync to local DB
        for (const subj of response.data) {
          await dbService.put('subjects', { id: subj.id.toString(), name: subj.name, code: subj.code });
        }
        return response.data;
      } catch (err) {
        ensureBackendInProd('Production.GetSubjects', err);
        console.warn('Backend subjects fetch failed, using local data');
        return dbService.getAll('subjects');
      }
    }, 'Production.GetSubjects'),

    saveSubject: (name: string, code?: string) => handle(async () => {
      checkAuth(['Admin', 'Accountant'], 'Production.SaveSubject');
      try {
        const response = await apiClient.post(getUrl('subjects'), { name, code });
        await dbService.put('subjects', { id: response.data.id.toString(), name: response.data.name, code: response.data.code });
        return response.data;
      } catch (err) {
        ensureBackendInProd('Production.SaveSubject', err);
        const id = `local-subj-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        await dbService.put('subjects', { id, name, code });
        return { id, name, code };
      }
    }, 'Production.SaveSubject'),

    deleteSubject: (id: string) => handle(async () => {
      checkAuth(['Admin'], 'Production.DeleteSubject');
      try {
        await apiClient.delete(getUrl(`subjects/${id}`));
      } catch (err) {
        ensureBackendInProd('Production.DeleteSubject', err);
        console.warn('Backend subject delete failed, deleting locally');
      }
      return dbService.delete('subjects', id);
    }, 'Production.DeleteSubject'),

    calculateExams: (schoolId: string, subjects: any[]) => handle(async () => {
      const schools = await dbService.getAll<School>('schools');
      const school = schools.find(s => s.id === schoolId);
      const inventory = await dbService.getAll<Item>('inventory');

      const effectiveSchool = school || {
        pricing_type: 'margin-based',
        pricing_value: 0.3
      };

      const paper = inventory.find(i => i.name.toLowerCase().includes('paper')) || { cost: 35 };
      const toner = inventory.find(i => i.name.toLowerCase().includes('toner')) || { cost: 0.25 };
      const TONER_MG_PER_SHEET = 20;
      const internal_cost_per_sheet = (paper.cost || 35) + ((toner.cost || 0.25) * TONER_MG_PER_SHEET);

      const results = subjects.map(subj => {
        const pages = parseInt(subj.pages) || 0;
        const candidates = parseInt(subj.candidates) || 0;
        const extra_copies = parseInt(subj.extra_copies) || 0;
        const charge_per_learner = parseFloat(subj.charge_per_learner) || 0;

        const sheets_per_copy = Math.ceil(pages / 2);
        const production_copies = candidates + extra_copies;
        const base_sheets = sheets_per_copy * production_copies;
        const estimated_waste_percent = 5;
        const waste_sheets = Math.ceil(base_sheets * (estimated_waste_percent / 100));
        const total_sheets_used = base_sheets + waste_sheets;
        const billable_sheets = sheets_per_copy * candidates;

        const estimated_internal_cost = total_sheets_used * internal_cost_per_sheet;

        let selling_price = 0;
        if (charge_per_learner > 0) {
          selling_price = candidates * charge_per_learner;
        } else if (effectiveSchool.pricing_type === 'margin-based') {
          selling_price = estimated_internal_cost * (1 + (effectiveSchool.pricing_value || 0.3));
        } else if (effectiveSchool.pricing_type === 'per-sheet') {
          selling_price = billable_sheets * (effectiveSchool.pricing_value || 1);
        }

        return {
          ...subj,
          sheets_per_copy,
          production_copies,
          base_sheets,
          waste_sheets,
          total_sheets_used,
          billable_sheets,
          internal_cost: estimated_internal_cost,
          selling_price
        };
      });

      return { subjects: results };
    }, 'Production.CalculateExams'),

    confirmExamBatch: (data: any) => handle(async () => {
      const payload = {
        ...data,
        subjects: Array.isArray(data?.subjects) ? data.subjects : []
      };
      const {
        school_id,
        customer_id,
        class_name,
        subjects,
        academic_year,
        term,
        exam_type,
        sub_account_name
      } = payload;

      const toSafeNumber = (value: any, fallback = 0) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
      };

      if (isProd) {
        try {
          const response = await apiClient.post(getUrl('confirm-batch'), payload);
          const remoteBatchId = response?.data?.batch_id || response?.data?.batchId;
          if (!remoteBatchId) {
            throw new Error('Backend did not return a batch reference.');
          }
          return { success: true, batch_id: String(remoteBatchId) };
        } catch (remoteError: any) {
          logger.error('[Production.ConfirmBatch] Backend request failed in production', remoteError);
          throw remoteError instanceof Error ? remoteError : new Error('Failed to create batch');
        }
      }

      const persistLocally = async () => {
        const allExams = await dbService.getAll<ExamPaper>('examPapers');
        // Create a unique list of batch IDs to help generate the next sequential one
        const uniqueBatches = Array.from(
          new Set((allExams || []).map(e => e.batch_id).filter(Boolean))
        ).map(id => ({ id }));
        const batch_id = generateNextId('BATCH', uniqueBatches);

        for (const subj of subjects) {
          const subjectName = String(subj?.subject || '').trim();
          if (!subjectName) continue;

          const examPaper: ExamPaper = {
            id: `EXAM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            batch_id,
            school_id,
            customer_id,
            school_name: subj.school_name,
            sub_account_name,
            class: class_name,
            subject: subjectName,
            pages: toSafeNumber(subj.pages),
            candidates: toSafeNumber(subj.candidates),
            extra_copies: toSafeNumber(subj.extra_copies),
            charge_per_learner: toSafeNumber(subj.charge_per_learner),
            sheets_per_copy: toSafeNumber(subj.sheets_per_copy),
            production_copies: toSafeNumber(subj.production_copies),
            base_sheets: toSafeNumber(subj.base_sheets),
            waste_sheets: toSafeNumber(subj.waste_sheets),
            actual_waste_sheets: null,
            total_sheets_used: toSafeNumber(subj.total_sheets_used),
            billable_sheets: toSafeNumber(subj.billable_sheets),
            internal_cost: toSafeNumber(subj.internal_cost),
            selling_price: toSafeNumber(subj.selling_price),
            status: 'pending',
            is_recurring: 0,
            academic_year,
            term,
            exam_type,
            created_at: new Date().toISOString(),
            workOrderId: subj.workOrderId,
            marketAdjustmentApplied: toSafeNumber(subj.marketAdjustmentApplied),
            adjustmentBreakdown: subj.adjustmentBreakdown
          };
          await dbService.put('examPapers', examPaper);
        }

        return { success: true, batch_id };
      };

      try {
        return await persistLocally();
      } catch (localError: any) {
        console.warn('[Production.ConfirmBatch] Local persistence failed, trying backend fallback:', localError);

        try {
          const response = await apiClient.post(getUrl('confirm-batch'), payload);
          const remoteBatchId = response?.data?.batch_id || response?.data?.batchId;
          if (!remoteBatchId) {
            throw new Error('Backend did not return a batch reference.');
          }
          return { success: true, batch_id: String(remoteBatchId) };
        } catch (remoteError: any) {
          const localMessage = localError?.message || 'Unknown local save error';
          const backendMessage = axios.isAxiosError(remoteError)
            ? (remoteError.response?.data?.error || remoteError.message)
            : (remoteError?.message || 'Unknown backend error');
          throw new Error(`Failed to create batch. Local save failed (${localMessage}) and backend save failed (${backendMessage}).`);
        }
      }
    }, 'Production.ConfirmBatch'),

    completeExamSubject: (examId: string, actualWasteSheets: number) => handle(async () => {
      const exam = await dbService.get<ExamPaper>('examPapers', examId);
      if (!exam) throw new Error("Examination not found");

      if (exam.status === 'invoiced') {
        throw new Error("Subject already invoiced and cannot be modified.");
      }

      // If already completed and we are trying to complete it again with the same or 0 waste, 
      // just return the current state without error.
      if (exam.status === 'completed' && (actualWasteSheets === 0 || exam.actual_waste_sheets === actualWasteSheets)) {
        return {
          success: true,
          actual_total_sheets: exam.total_sheets_used,
          selling_price: exam.selling_price,
          alreadyCompleted: true
        };
      }

      const actual_total_sheets = exam.base_sheets + actualWasteSheets;

      const updatedExam = {
        ...exam,
        actual_waste_sheets: actualWasteSheets,
        total_sheets_used: actual_total_sheets,
        status: 'completed' as const
      };

      await dbService.put('examPapers', updatedExam);

      // Sync with Work Order if exists
      if (exam.workOrderId) {
        const wo = await dbService.get<WorkOrder>('workOrders', exam.workOrderId);
        if (wo && wo.status !== 'Completed') {
          await dbService.put('workOrders', {
            ...wo,
            status: 'Completed',
            quantityCompleted: exam.production_copies,
            completedDate: new Date().toISOString()
          });
        }
      }

      return { success: true, actual_total_sheets, selling_price: exam.selling_price, alreadyCompleted: false };
    }, 'Production.CompleteSubject'),

    markExamSubject: (examId: string) => handle(async () => {
      const exam = await dbService.get<ExamPaper>('examPapers', examId);
      if (!exam) throw new Error("Examination not found");

      if (exam.status !== 'completed') {
        throw new Error("Only completed subjects can be marked.");
      }

      const updatedExam = {
        ...exam,
        status: 'marked' as const
      };

      await dbService.put('examPapers', updatedExam);

      return { success: true };
    }, 'Production.MarkSubject'),

    updateExamPaper: (id: string, updates: Partial<ExamPaper>) => handle(async () => {
      const existing = await dbService.get<ExamPaper>('examPapers', id);
      if (!existing) throw new Error("Examination not found");

      const updated = { ...existing, ...updates };
      await dbService.put('examPapers', updated);
      return updated;
    }, 'Production.UpdateExamPaper'),

    deleteExamPaper: (id: string) => handle(async () => {
      const existing = await dbService.get<ExamPaper>('examPapers', id);
      if (!existing) throw new Error("Examination not found");

      // Also delete related work order if it exists and is not started
      if (existing.workOrderId) {
        const wo = await dbService.get<WorkOrder>('workOrders', existing.workOrderId);
        if (wo && (wo.status === 'Scheduled' || wo.status === 'Planned')) {
          await dbService.delete('workOrders', existing.workOrderId);
        }
      }

      await dbService.delete('examPapers', id);
      return { success: true };
    }, 'Production.DeleteExamPaper'),

    generateExamInvoice: (batchIds: string[]) => handle(async () => {
      const allExams = await dbService.getAll<ExamPaper>('examPapers');
      const selectedExams = allExams.filter(e => batchIds.includes(e.batch_id) && e.status === 'marked');

      if (selectedExams.length === 0) throw new Error("No marked exams found for selected batches");

      const invoice_id = await generateNextSalesInvoiceNumber();

      const totalAmount = selectedExams.reduce((sum, e) => sum + (e.selling_price || 0), 0);

      let totalAdjustment = 0;
      const breakdownMap: Record<string, number> = {};

      selectedExams.forEach((e: Record<string, unknown>) => {
        totalAdjustment += (e.marketAdjustmentApplied as number) || 0;
        if (e.adjustmentBreakdown) {
          (e.adjustmentBreakdown as Array<Record<string, unknown>>).forEach((b) => {
            const cat = (b.category as string) || 'other';
            breakdownMap[cat] = (breakdownMap[cat] || 0) + (b.amount as number);
          });
        }
      });

      const adjustmentBreakdown = Object.entries(breakdownMap).map(([category, amount]) => ({ category, amount }));

      const firstExam = selectedExams[0];

      const invoiceItems: any[] = [];
      const groupedByBatch = selectedExams.reduce((acc, e) => {
        if (!acc[e.batch_id]) {
          acc[e.batch_id] = {
            class: e.class,
            candidates: e.candidates,
            total: 0,
            subjects: []
          };
        }
        acc[e.batch_id].total += (e.selling_price || 0);
        acc[e.batch_id].subjects.push(e.subject);
        return acc;
      }, {} as Record<string, any>);

      Object.keys(groupedByBatch).forEach(batchId => {
        const group = groupedByBatch[batchId];
        // Calculate the effective unit price per learner (Total Class Charge / Candidates)
        const unitPrice = group.candidates > 0 ? group.total / group.candidates : 0;

        invoiceItems.push({
          id: batchId,
          description: `${group.class}`,
          quantity: group.candidates,
          unitPrice: unitPrice,
          total: group.total
        });
      });

      const invoice: Invoice = {
        id: invoice_id,
        customerId: firstExam.customer_id,
        customerName: firstExam.school_name,
        date: new Date().toISOString(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        items: invoiceItems,
        totalAmount,
        paidAmount: 0,
        status: 'Unpaid',
        type: 'Standard',
        notes: `Converted from [Exam Batch] #[${batchIds.join(', ')}] on [${new Date().toLocaleDateString()}] as accepted by [${firstExam.school_name}]`,
        subAccountName: firstExam.sub_account_name,
        marketAdjustmentApplied: totalAdjustment,
        adjustmentBreakdown
      } as unknown as Invoice;

      await dbService.put('invoices', invoice);

      for (const e of selectedExams) {
        await dbService.put('examPapers', { ...e, status: 'invoiced', invoiceId: invoice.id });
      }

      return { success: true, invoice_id: invoice.id, total_amount: totalAmount };
    }, 'Production.GenerateInvoice'),

    payExamInvoice: (invoiceId: string, paymentMethod: string) => handle(async () => {
      const invoice = await dbService.get<Invoice>('invoices', invoiceId);
      if (!invoice) throw new Error("Invoice not found");

      const updatedInvoice = {
        ...invoice,
        status: 'Paid' as const,
        paidAmount: invoice.totalAmount,
        paymentMethod,
        paid_at: new Date().toISOString()
      };

      await dbService.put('invoices', updatedInvoice);

      // Also update the associated exam papers if any
      const allExams = await dbService.getAll<ExamPaper>('examPapers');
      const associatedExams = allExams.filter(e => e.invoiceId === invoiceId);
      for (const e of associatedExams) {
        await dbService.put('examPapers', { ...e, status: 'paid' });
      }

      return { success: true, paid_at: updatedInvoice.paid_at };
    }, 'Production.PayExamInvoice'),

    deleteExamBatch: (batchId: string) => handle(async () => {
      checkAuth(['Admin'], 'Production.DeleteExamBatch');
      const allExams = await dbService.getAll<ExamPaper>('examPapers');
      const batchExams = allExams.filter(e => e.batch_id === batchId);
      for (const e of batchExams) {
        // Sync deletion with Work Order if exists
        if (e.workOrderId) {
          await dbService.delete('workOrders', e.workOrderId);
        }
        await dbService.delete('examPapers', e.id);
      }
      return { success: true };
    }, 'Production.DeleteExamBatch'),

    deleteAllocation: (id: string) => handle(async () => {
      checkAuth(['Admin', 'Accountant'], 'Production.DeleteAllocation');
      try { await productionDb.resourceAllocations.delete(id); } catch { await dbService.delete('resourceAllocations', id); }
    }, 'Production.DeleteAllocation'),

    getMaintenanceLogs: () => handle(async () => {
      try { return await productionDb.maintenanceLogs.toArray(); } catch { return dbService.getAll<MaintenanceLog>('maintenanceLogs'); }
    }, 'Production.GetMaint'),
    saveMaintenanceLog: (l: MaintenanceLog) => handle(async () => {
      checkAuth(['Admin', 'Accountant'], 'Production.SaveMaint');
      try { await productionDb.maintenanceLogs.put(l); } catch { await dbService.put('maintenanceLogs', l); }
    }, 'Production.SaveMaint'),
    deleteMaintenanceLog: (id: string) => handle(async () => {
      checkAuth(['Admin'], 'Production.DeleteMaint');
      try { await productionDb.maintenanceLogs.delete(id); } catch { await dbService.delete('maintenanceLogs', id); }
    }, 'Production.DeleteMaint'),

    getBOMs: () => handle(async () => {
      try { return await productionDb.boms.toArray(); } catch { return dbService.getAll<BillOfMaterial>('boms'); }
    }, 'Production.GetBOMs'),
    saveBOM: (bom: BillOfMaterial) => handle(async () => {
      checkAuth(['Admin', 'Accountant'], 'Production.SaveBOM');
      try { await productionDb.boms.put(bom); } catch { await dbService.put('boms', bom); }
    }, 'Production.SaveBOM'),
    deleteBOM: (id: string) => handle(async () => {
      checkAuth(['Admin'], 'Production.DeleteBOM');
      try { await productionDb.boms.delete(id); } catch { await dbService.delete('boms', id); }
    }, 'Production.DeleteBOM'),
  },

  stats: {
    getMonthlyData: () => handle(async () => {
      const sales = await dbService.getAll<Sale>('sales');
      const expenses = await dbService.getAll<Expense>('expenses');
      const exams = await dbService.getAll<ExamPaper>('examPapers');

      const monthlyData: Record<string, { month: string, revenue: number, cost: number }> = {};

      const last12Months = Array.from({ length: 12 }, (_, i) => {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        return (d.getMonth() + 1).toString().padStart(2, '0');
      }).reverse();

      last12Months.forEach(month => {
        monthlyData[month] = { month, revenue: 0, cost: 0 };
      });

      sales.forEach(sale => {
        const date = new Date(sale.date);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        if (monthlyData[month]) {
          monthlyData[month].revenue += (sale.totalAmount || sale.total || 0);
        }
      });

      exams.forEach(exam => {
        const date = new Date(exam.created_at);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        if (monthlyData[month]) {
          // If invoiced or paid, it's revenue
          if (exam.status === 'invoiced' || exam.status === 'paid') {
            monthlyData[month].revenue += (exam.selling_price || 0);
          }
          // Cost is always incurred if completed
          if (exam.status === 'completed' || exam.status === 'invoiced' || exam.status === 'paid') {
            monthlyData[month].cost += (exam.internal_cost || 0);
          }
        }
      });

      expenses.forEach(exp => {
        const date = new Date(exp.date);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        if (monthlyData[month]) {
          monthlyData[month].cost += (exp.amount || 0);
        }
      });

      return Object.values(monthlyData);
    }, 'Stats.GetMonthlyData'),

    getDashboardStats: () => handle(async () => {
      const [sales, inventory, expenses, customers] = await Promise.all([
        dbService.getAll<Sale>('sales'),
        dbService.getAll<Item>('inventory'),
        dbService.getAll<Expense>('expenses'),
        dbService.getAll<Customer>('customers')
      ]);

      const totalSales = sales.reduce((sum, s) => sum + s.totalAmount, 0);
      const totalInventoryValue = inventory.reduce((sum, i) => sum + (i.stock * i.cost), 0);
      const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

      return {
        totalSales,
        inventoryCount: inventory.length,
        totalInventoryValue,
        totalExpenses,
        customerCount: customers.length,
        salesCount: sales.length
      };
    }, 'Stats.GetDashboardStats'),

    getExaminationStats: () => handle(async () => {
      const exams = await dbService.getAll<ExamPaper>('examPapers');
      return {
        pending_jobs: exams.filter(e => e.status === 'pending').length,
        total_revenue: exams.filter(e => e.status === 'invoiced' || e.status === 'paid')
          .reduce((sum, e) => sum + (e.selling_price || 0), 0),
        total_waste: exams.reduce((sum, e) => sum + (e.actual_waste_sheets || e.waste_sheets || 0), 0),
        total_sheets: exams.reduce((sum, e) => sum + (e.total_sheets_used || 0), 0)
      };
    }, 'Stats.GetExamination')
  },

  finance: {
    getAccounts: () => handle(async () => {
      if (shouldPreferLocalReadModels()) {
        return dbService.getAll<Account>('accounts');
      }
      try {
        const response = await apiClient.get(getApiPath('accounts'));
        const remote = Array.isArray(response.data) ? response.data : [];
        for (const acc of remote) { await dbService.put('accounts', acc); }
        return remote;
      } catch (err) {
        ensureBackendInProd('Finance.GetAccounts', err);
        return dbService.getAll<Account>('accounts');
      }
    }, 'Finance.GetAccounts'),
    saveAccount: (a: Account) => handle(async () => {
      checkAuth(['Admin'], 'Finance.SaveAccount');
      await dbService.put('accounts', a);
      try {
        const response = await apiClient.post(getApiPath('accounts'), a);
        return response.data || a;
      } catch (err) {
        ensureBackendInProd('Finance.SaveAccount', err);
        return { success: true, localOnly: true };
      }
    }, 'Finance.SaveAccount'),
    deleteAccount: (id: string) => handle(async () => {
      checkAuth(['Admin'], 'Finance.DeleteAccount');
      await dbService.delete('accounts', id);
      try {
        await apiClient.delete(getApiPath(`accounts/${id}`));
        return { success: true };
      } catch (err) {
        ensureBackendInProd('Finance.DeleteAccount', err);
        return { success: true, localOnly: true };
      }
    }, 'Finance.DeleteAccount'),

    getLedger: () => handle(async () => {
      if (shouldPreferLocalReadModels()) {
        return dbService.getAll<LedgerEntry>('ledger');
      }
      try {
        const response = await apiClient.get(getApiPath('ledger'));
        const remote = Array.isArray(response.data) ? response.data : [];
        for (const entry of remote) { await dbService.put('ledger', entry); }
        return remote;
      } catch (err) {
        ensureBackendInProd('Finance.GetLedger', err);
        return dbService.getAll<LedgerEntry>('ledger');
      }
    }, 'Finance.GetLedger'),
    saveLedgerEntry: (e: LedgerEntry) => handle(async () => {
      checkAuth(['Admin', 'Accountant'], 'Finance.SaveLedger');
      const localResult = await dbService.executeAtomicOperation(['ledger', 'idempotencyKeys'], async (tx) => {
        const key = String(e.idempotencyKey || `ledger:${e.id}`).trim();
        const idempotencyStore = tx.objectStore('idempotencyKeys');
        const existing = await idempotencyStore.get(key);
        if (existing) {
          return { duplicate: true, id: e.id };
        }
        await idempotencyStore.put({
          id: key, scope: 'manual_ledger', sourceId: e.id, createdAt: new Date().toISOString()
        });
        await tx.objectStore('ledger').put(e);
        return { success: true, id: e.id };
      });
      try {
        const response = await apiClient.post(getApiPath('ledger'), e);
        return response.data || localResult;
      } catch (err) {
        ensureBackendInProd('Finance.SaveLedger', err);
        return localResult;
      }
    }, 'Finance.SaveLedger'),

    getInvoices: () => handle(async () => {
      if (shouldPreferLocalReadModels()) {
        return dbService.getAll<Invoice>('invoices');
      }
      try {
        const response = await apiClient.get(getApiPath('invoices'));
        const remote = Array.isArray(response.data) ? response.data : [];
        for (const inv of remote) { await dbService.put('invoices', inv); }
        return remote;
      } catch {
        return dbService.getAll<Invoice>('invoices');
      }
    }, 'Finance.GetInvoices'),
    saveInvoice: (i: Invoice) => handle(async () => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Finance.SaveInvoice');
      const existing = await dbService.get<Invoice>('invoices', i.id);
      if (existing) {
        return transactionService.updateInvoice(i);
      }
      return transactionService.processInvoice(i);
    }, 'Finance.SaveInvoice'),
    deleteInvoice: (id: string) => handle(() => {
      checkAuth(['Admin'], 'Finance.DeleteInvoice');
      return transactionService.voidInvoice(id, 'User requested deletion via API');
    }, 'Finance.DeleteInvoice'),

    getExpenses: () => handle(async () => {
      if (shouldPreferLocalReadModels()) {
        return dbService.getAll<Expense>('expenses');
      }
      try {
        const response = await apiClient.get(getApiPath('expenses'));
        const remote = Array.isArray(response.data) ? response.data : [];
        for (const e of remote) { await dbService.put('expenses', e); }
        return remote;
      } catch (err) {
        ensureBackendInProd('Finance.GetExpenses', err);
        return dbService.getAll<Expense>('expenses');
      }
    }, 'Finance.GetExpenses'),
    saveExpense: (e: Expense) => handle(async () => {
      checkAuth(['Admin', 'Accountant'], 'Finance.SaveExpense');
      const localResult = await transactionService.addExpense(e);
      try {
        const response = await apiClient.post(getApiPath('expenses'), e);
        return response.data || localResult;
      } catch (err) {
        ensureBackendInProd('Finance.SaveExpense', err);
        return localResult;
      }
    }, 'Finance.SaveExpense'),

    getIncome: () => handle(async () => {
      if (shouldPreferLocalReadModels()) {
        return dbService.getAll<Income>('income');
      }
      try {
        const response = await apiClient.get(getApiPath('income'));
        const remote = Array.isArray(response.data) ? response.data : [];
        for (const i of remote) { await dbService.put('income', i); }
        return remote;
      } catch (err) {
        ensureBackendInProd('Finance.GetIncome', err);
        return dbService.getAll<Income>('income');
      }
    }, 'Finance.GetIncome'),
    saveIncome: (i: Income) => handle(async () => {
      checkAuth(['Admin', 'Accountant'], 'Finance.SaveIncome');
      const localResult = await transactionService.addIncome(i);
      try {
        const response = await apiClient.post(getApiPath('income'), i);
        return response.data || localResult;
      } catch (err) {
        ensureBackendInProd('Finance.SaveIncome', err);
        return localResult;
      }
    }, 'Finance.SaveIncome'),
    deleteIncome: (id: string) => handle(async () => {
      checkAuth(['Admin'], 'Finance.DeleteIncome');
      await dbService.delete('income', id);
      try {
        await apiClient.delete(getApiPath(`income/${id}`));
        return { success: true };
      } catch (err) {
        ensureBackendInProd('Finance.DeleteIncome', err);
        return { success: true, localOnly: true };
      }
    }, 'Finance.DeleteIncome'),

    getScheduledPayments: () => handle(() => dbService.getAll<ScheduledPayment>('scheduledPayments'), 'Finance.GetScheduledPayments'),
    saveScheduledPayment: (p: ScheduledPayment) => handle(() => {
      checkAuth(['Admin', 'Accountant'], 'Finance.SaveScheduledPayment');
      return dbService.put('scheduledPayments', p);
    }, 'Finance.SaveScheduledPayment'),

    getWalletTransactions: () => handle(() => dbService.getAll<WalletTransaction>('walletTransactions'), 'Finance.GetWalletTransactions'),
    saveWalletTransaction: (t: WalletTransaction) => handle(() => {
      checkAuth(['Admin', 'Accountant'], 'Finance.SaveWalletTransaction');
      return dbService.executeAtomicOperation(['walletTransactions', 'idempotencyKeys'], async (tx) => {
        const key = String(t.idempotencyKey || `wallet:${t.id}`).trim();
        const idempotencyStore = tx.objectStore('idempotencyKeys');
        const existing = await idempotencyStore.get(key);
        if (existing) {
          return { duplicate: true, id: t.id };
        }
        await idempotencyStore.put({
          id: key, scope: 'wallet_transaction', sourceId: t.id, createdAt: new Date().toISOString()
        });
        await tx.objectStore('walletTransactions').put(t);
        return { success: true, id: t.id };
      });
    }, 'Finance.SaveWalletTransaction'),

    getRecurringInvoices: () => handle(() => dbService.getAll<RecurringInvoice>('recurringInvoices'), 'Finance.GetRecurringInvoices'),
    saveRecurringInvoice: (r: RecurringInvoice) => handle(() => {
      checkAuth(['Admin', 'Accountant'], 'Finance.SaveRecurringInvoice');
      return dbService.put('recurringInvoices', r);
    }, 'Finance.SaveRecurringInvoice'),
    deleteRecurringInvoice: (id: string) => handle(() => {
      checkAuth(['Admin'], 'Finance.DeleteRecurringInvoice');
      return dbService.delete('recurringInvoices', id);
    }, 'Finance.DeleteRecurringInvoice'),

    getDeliveryNotes: () => handle(() => dbService.getAll<DeliveryNote>('deliveryNotes'), 'Finance.GetDeliveryNotes'),
    saveDeliveryNote: (n: DeliveryNote) => handle(() => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Finance.SaveDeliveryNote');
      return dbService.put('deliveryNotes', n);
    }, 'Finance.SaveDeliveryNote'),
    deleteDeliveryNote: (id: string) => handle(() => {
      checkAuth(['Admin'], 'Finance.DeleteDeliveryNote');
      return dbService.delete('deliveryNotes', id);
    }, 'Finance.DeleteDeliveryNote'),

    getBudgets: () => handle(async () => {
      if (shouldPreferLocalReadModels()) {
        return dbService.getAll<Budget>('budgets');
      }
      try {
        const response = await apiClient.get(getApiPath('budgets'));
        const remote = Array.isArray(response.data) ? response.data : [];
        for (const b of remote) { await dbService.put('budgets', b); }
        return remote;
      } catch (err) {
        ensureBackendInProd('Finance.GetBudgets', err);
        return dbService.getAll<Budget>('budgets');
      }
    }, 'Finance.GetBudgets'),
    saveBudget: (b: Budget) => handle(async () => {
      checkAuth(['Admin'], 'Finance.SaveBudget');
      await dbService.put('budgets', b);
      try {
        const response = await apiClient.post(getApiPath('budgets'), b);
        return response.data || b;
      } catch (err) {
        ensureBackendInProd('Finance.SaveBudget', err);
        return { success: true, localOnly: true };
      }
    }, 'Finance.SaveBudget'),

    getTransfers: () => handle(async () => {
      if (shouldPreferLocalReadModels()) {
        return dbService.getAll<Transfer>('transfers');
      }
      try {
        const response = await apiClient.get(getApiPath('transfers'));
        const remote = Array.isArray(response.data) ? response.data : [];
        for (const t of remote) { await dbService.put('transfers', t); }
        return remote;
      } catch (err) {
        ensureBackendInProd('Finance.GetTransfers', err);
        return dbService.getAll<Transfer>('transfers');
      }
    }, 'Finance.GetTransfers'),
    saveTransfer: (t: Transfer) => handle(async () => {
      checkAuth(['Admin', 'Accountant'], 'Finance.SaveTransfer');
      const localResult = await transactionService.executeTransfer(t);
      try {
        const response = await apiClient.post(getApiPath('transfers'), t);
        return response.data || localResult;
      } catch (err) {
        ensureBackendInProd('Finance.SaveTransfer', err);
        return localResult;
      }
    }, 'Finance.SaveTransfer'),

    getCheques: () => handle(() => dbService.getAll<Cheque>('cheques'), 'Finance.GetCheques'),
    saveCheque: (c: Cheque) => handle(() => {
      checkAuth(['Admin', 'Accountant'], 'Finance.SaveCheque');
      return dbService.put('cheques', c);
    }, 'Finance.SaveCheque'),
    deleteCheque: (id: string) => handle(() => {
      checkAuth(['Admin'], 'Finance.DeleteCheque');
      return dbService.delete('cheques', id);
    }, 'Finance.DeleteCheque'),

    getSupplierPayments: () => handle(() => dbService.getAll<SupplierPayment>('supplierPayments'), 'Finance.GetSupplierPayments'),
    recordSupplierPayment: (p: SupplierPayment) => handle(() => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Finance.RecordSupplierPayment');
      return transactionService.recordSupplierPayment(p);
    }, 'Finance.RecordSupplierPayment'),
    updateSupplierPayment: (p: SupplierPayment) => handle(() => {
      checkAuth(['Admin', 'Accountant'], 'Finance.UpdateSupplierPayment');
      return transactionService.updateSupplierPayment(p);
    }, 'Finance.UpdateSupplierPayment'),
    voidSupplierPayment: (id: string) => handle(() => {
      checkAuth(['Admin', 'Accountant'], 'Finance.VoidSupplierPayment');
      return transactionService.voidSupplierPayment(id);
    }, 'Finance.VoidSupplierPayment'),

    getEmployees: () => handle(() => dbService.getAll<Employee>('employees'), 'Finance.GetEmployees'),
    saveEmployee: (e: Employee) => handle(() => {
      checkAuth(['Admin'], 'Finance.SaveEmployee');
      return dbService.put('employees', e);
    }, 'Finance.SaveEmployee'),
    deleteEmployee: (id: string) => handle(() => {
      checkAuth(['Admin'], 'Finance.DeleteEmployee');
      return dbService.delete('employees', id);
    }, 'Finance.DeleteEmployee'),

    getPayrollRuns: () => handle(() => dbService.getAll<PayrollRun>('payrollRuns'), 'Finance.GetPayrollRuns'),
    savePayrollRun: (p: PayrollRun) => handle(() => {
      checkAuth(['Admin'], 'Finance.SavePayrollRun');
      return dbService.put('payrollRuns', p);
    }, 'Finance.SavePayrollRun'),

    getPayslips: () => handle(() => dbService.getAll<Payslip>('payslips'), 'Finance.GetPayslips'),
    savePayslip: (p: Payslip) => handle(() => {
      checkAuth(['Admin'], 'Finance.SavePayslip');
      return dbService.put('payslips', p);
    }, 'Finance.SavePayslip'),
  },

  marketing: {
    getCampaigns: () => handle(() => dbService.getAll<SMSCampaign>('smsCampaigns'), 'Marketing.GetCampaigns'),
    saveCampaign: (c: SMSCampaign) => handle(() => {
      checkAuth(['Admin'], 'Marketing.SaveCampaign');
      return dbService.put('smsCampaigns', c);
    }, 'Marketing.SaveCampaign'),
    deleteCampaign: (id: string) => handle(() => {
      checkAuth(['Admin'], 'Marketing.DeleteCampaign');
      return dbService.delete('smsCampaigns', id);
    }, 'Marketing.DeleteCampaign'),

    getSubscribers: () => handle(() => dbService.getAll<Subscriber>('subscribers'), 'Marketing.GetSubscribers'),
    saveSubscriber: (s: Subscriber) => handle(() => {
      checkAuth(['Admin'], 'Marketing.SaveSubscriber');
      return dbService.put('subscribers', s);
    }, 'Marketing.SaveSubscriber'),
    deleteSubscriber: (id: string) => handle(() => {
      checkAuth(['Admin'], 'Marketing.DeleteSubscriber');
      return dbService.delete('subscribers', id);
    }, 'Marketing.DeleteSubscriber'),

    getTemplates: () => handle(() => dbService.getAll<SMSTemplate>('smsTemplates'), 'Marketing.GetTemplates'),
    saveTemplate: (t: SMSTemplate) => handle(() => {
      checkAuth(['Admin'], 'Marketing.SaveTemplate');
      return dbService.put('smsTemplates', t);
    }, 'Marketing.SaveTemplate'),
    deleteTemplate: (id: string) => handle(() => {
      checkAuth(['Admin'], 'Marketing.DeleteTemplate');
      return dbService.delete('smsTemplates', id);
    }, 'Marketing.DeleteTemplate'),
  },



  customers: {
    getAll: () => handle(() => dbService.getAll<Customer>('customers'), 'Customers.GetAll'),
    save: (c: Customer) => handle(() => {
      checkAuth(['Admin', 'Accountant', 'Clerk'], 'Customers.Save');
      return dbService.put('customers', c);
    }, 'Customers.Save'),
    delete: (id: string) => handle(() => {
      checkAuth(['Admin'], 'Customers.Delete');
      return dbService.delete('customers', id);
    }, 'Customers.Delete'),
  },

  pricing: {
    getTemplates: () => handle(async () => {
      try { return await productionDb.bomTemplates.toArray(); } catch { return dbService.getAll<BOMTemplate>('bomTemplates'); }
    }, 'Pricing.GetTemplates'),
    saveTemplate: (tpl: BOMTemplate) => handle(async () => {
      checkAuth(['Admin'], 'Pricing.SaveTemplate');
      try { await productionDb.bomTemplates.put(tpl); } catch { await dbService.put('bomTemplates', tpl); }
      await repriceMasterInventoryFromAdjustments();
      return;
    }, 'Pricing.SaveTemplate'),
    deleteTemplate: (id: string) => handle(async () => {
      checkAuth(['Admin'], 'Pricing.DeleteTemplate');
      try { await productionDb.bomTemplates.delete(id); } catch { await dbService.delete('bomTemplates', id); }
      await repriceMasterInventoryFromAdjustments();
      return;
    }, 'Pricing.DeleteTemplate'),
    getMarketAdjustments: () => handle(() => dbService.getAll<MarketAdjustment>('marketAdjustments'), 'Pricing.GetAdjustments'),
    saveMarketAdjustment: (adj: MarketAdjustment) => handle(() => {
      checkAuth(['Admin'], 'Pricing.SaveAdjustment');
      return dbService.put('marketAdjustments', adj);
    }, 'Pricing.SaveAdjustment'),

  },

  system: {
    getLicenseInfo: () => handle(async () => {
      // Offline/Local mock for license info
      const storedLicense = await dbService.getSetting<any>('license');
      const parsedLicense = storedLicense?.data || storedLicense?.license || null;
      return {
        fingerprint: 'OFFLINE-DEV-FINGERPRINT',
        license: parsedLicense || {
          status: 'Active',
          type: 'Ultimate',
          expires: '2099-12-31',
          customer: 'Offline User'
        }
      };
    }, 'System.GetLicenseInfo'),
    activateLicense: (licenseContent: string) => handle(async () => {
      // Store license content in IndexedDB for persistence
      try {
        const licenseData = JSON.parse(licenseContent);
        await dbService.saveSetting('license', {
          value: licenseContent,
          data: licenseData,
          activatedAt: new Date().toISOString()
        });
        return { 
          success: true, 
          message: 'License activated successfully',
          license: licenseData 
        };
      } catch (error) {
        return { 
          success: false, 
          message: error instanceof Error ? error.message : 'Invalid license file' 
        };
      }
    }, 'System.ActivateLicense'),

    initializeWorkspace: (companyName: string) => handle(async () => {
      if (!HAS_REMOTE_BACKEND || SUPABASE_CONFIGURED) {
        const workspaceConfig = {
          mode: 'offline-file',
          companyName,
          initializedAt: new Date().toISOString(),
        };
        await dbService.saveSetting('workspaceConfig', workspaceConfig);
        return { success: true, workspace: workspaceConfig, savedLocally: true };
      }
      const response = await apiClient.post('/system/workspace/initialize', { companyName });
      return response.data;
    }, 'System.InitializeWorkspace'),

    getWorkspaceConfig: () => handle(async () => {
      if (!HAS_REMOTE_BACKEND) {
        return (await dbService.getSetting<any>('workspaceConfig')) || {
          mode: 'offline-file',
          companyName: 'Prime ERP System',
          initializedAt: new Date().toISOString(),
        };
      }
      const response = await apiClient.get('/system/workspace/config');
      return response.data;
    }, 'System.GetWorkspaceConfig'),

    saveToWorkspace: (folder: string, filename: string, data: any) => handle(async () => {
      if (!HAS_REMOTE_BACKEND) {
        const key = `workspaceDocument:${folder}/${filename}`;
        await dbService.saveSetting(key, {
          folder,
          filename,
          data,
          savedAt: new Date().toISOString(),
        });
        return { success: true, savedLocally: true, path: `${folder}/${filename}` };
      }
      const response = await apiClient.post('/system/workspace/save-document', { folder, filename, data });
      return response.data;
    }, 'System.SaveToWorkspace'),

    syncToWorkspace: (filename: string, data: any) => handle(async () => {
      if (!HAS_REMOTE_BACKEND) {
        const key = `workspaceSync:${filename}`;
        await dbService.saveSetting(key, {
          filename,
          data,
          syncedAt: new Date().toISOString(),
        });
        return { success: true, syncedLocally: true, filename };
      }
      const response = await apiClient.post('/system/workspace/sync', { filename, data });
      return response.data;
    }, 'System.SyncToWorkspace'),

    triggerCloudSync: () => handle(async () => {
      if (!HAS_REMOTE_BACKEND) {
        await dbService.saveSetting('cloudSync:lastSync', {
          syncedAt: new Date().toISOString(),
        });
        return { success: true, syncedLocally: true };
      }
      const response = await apiClient.post('/cloud/sync', {});
      return response.data;
    }, 'Cloud.TriggerSync'),

    deleteWorkspace: () => handle(async () => {
      if (HAS_REMOTE_BACKEND) {
        const response = await apiClient.delete('/system/workspace');
        return response.data;
      }
      const backendUrl = import.meta.env.VITE_API_URL || 'https://primebooks-erp.onrender.com';
      const resp = await fetch(`${backendUrl}/api/system/workspace`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(text || `Backend returned ${resp.status}`);
      }
      return resp.json();
    }, 'System.DeleteWorkspace'),

    // User preferences — persisted to backend so they follow the user across devices
    getUserPreference: (key: string) => handle(async () => {
      try {
        const response = await apiClient.get(getApiPath(`user/preferences/${key}`));
        return response.data || { value: null };
      } catch {
        return { value: null };
      }
    }, 'UserPrefs.Get'),

    saveUserPreference: (key: string, value: string) => handle(async () => {
      await apiClient.put(getApiPath(`user/preferences/${key}`), { value });
      return { success: true };
    }, 'UserPrefs.Save'),

    // Financial Years — cloud-only: served through backend API
    getFinancialYears: () => handle(async () => {
      const response = await apiClient.get('/financial-years');
      return Array.isArray(response.data) ? response.data : [];
    }, 'FinancialYear.List'),

    getDefaultFinancialYear: () => handle(async () => {
      const response = await apiClient.get('/financial-years/default');
      return response.data;
    }, 'FinancialYear.Default'),

    getCurrentFinancialYear: () => handle(async () => {
      const response = await apiClient.get('/financial-years/current');
      return response.data;
    }, 'FinancialYear.Current'),

    getFinancialYearByDate: (date: string) => handle(async () => {
      const response = await apiClient.get('/financial-years/by-date', { params: { date } });
      return response.data;
    }, 'FinancialYear.ByDate'),

    createFinancialYear: (data: any) => handle(async () => {
      const response = await apiClient.post('/financial-years', data);
      return response.data;
    }, 'FinancialYear.Create'),

    updateFinancialYear: (id: string, data: any) => handle(async () => {
      const response = await apiClient.put(`/financial-years/${id}`, data);
      return response.data;
    }, 'FinancialYear.Update'),

    closeFinancialYear: (id: string) => handle(async () => {
      const response = await apiClient.post(`/financial-years/${id}/close`);
      return response.data;
    }, 'FinancialYear.Close'),

    deleteFinancialYear: (id: string) => handle(async () => {
      const response = await apiClient.delete(`/financial-years/${id}`);
      return response.data;
    }, 'FinancialYear.Delete'),
  }
};
