import { getJsonRequestHeaders } from './requestHeaders';
import { logger } from './logger';

/**
 * ERP → Portal bridge (frontend side).
 *
 * The ERP runs offline-first against IndexedDB + Supabase and never talks to
 * the backend REST layer, so documents it creates never reach the customer
 * Portal (which reads backend SQLite). This module mirrors ERP records to
 * the backend `/api/erp-portal/mirror` endpoint, which upserts them into the
 * portal SQLite layer and broadcasts SSE + notifications.
 *
 * All calls are fire-and-forget: failures are logged and never break the
 * core ERP transaction.
 */

const MIRROR_ENDPOINT = '/api/erp-portal/mirror';

export type MirrorEntity =
  | 'invoice'
  | 'salesOrder'
  | 'quotation'
  | 'customerPayment'
  | 'wallet'
  | 'customer'
  | 'deliveryNote'
  | 'shipment'
  | 'receipt'
  | 'creditNote'
  | 'debitNote'
  | 'walletTransaction'
  | 'jobTicket'
  | 'workOrder'
  | 'productionBatch'
  | 'inventoryTransaction'
  | 'ledgerEntry'
  | 'supportTicket'
  | 'notification'
  | 'engagement'
  | 'bulk';

async function postMirror(entity: MirrorEntity, data: Record<string, unknown>): Promise<void> {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return;
  try {
    const res = await fetch(MIRROR_ENDPOINT, {
      method: 'POST',
      headers: getJsonRequestHeaders(),
      body: JSON.stringify({ entity, data }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || `Mirror ${entity} failed (${res.status})`);
    }
  } catch (err) {
    logger.warn(`[PortalBridge] ${entity} mirror skipped:`, err);
  }
}

export const portalBridge = {
  mirrorInvoice(data: Record<string, unknown>): void {
    void postMirror('invoice', data);
  },
  mirrorSalesOrder(data: Record<string, unknown>): void {
    void postMirror('salesOrder', data);
  },
  mirrorQuotation(data: Record<string, unknown>): void {
    void postMirror('quotation', data);
  },
  mirrorCustomerPayment(data: Record<string, unknown>): void {
    void postMirror('customerPayment', data);
  },
  mirrorWallet(data: Record<string, unknown>): void {
    void postMirror('wallet', data);
  },
  mirrorCustomer(data: Record<string, unknown>): void {
    void postMirror('customer', data);
  },
  mirrorDeliveryNote(data: Record<string, unknown>): void {
    void postMirror('deliveryNote', data);
  },
  mirrorShipment(data: Record<string, unknown>): void {
    void postMirror('shipment', data);
  },
  mirrorReceipt(data: Record<string, unknown>): void {
    void postMirror('receipt', data);
  },
  mirrorCreditNote(data: Record<string, unknown>): void {
    void postMirror('creditNote', data);
  },
  mirrorDebitNote(data: Record<string, unknown>): void {
    void postMirror('debitNote', data);
  },
  mirrorWalletTransaction(data: Record<string, unknown>): void {
    void postMirror('walletTransaction', data);
  },
  mirrorJobTicket(data: Record<string, unknown>): void {
    void postMirror('jobTicket', data);
  },
  mirrorWorkOrder(data: Record<string, unknown>): void {
    void postMirror('workOrder', data);
  },
  mirrorProductionBatch(data: Record<string, unknown>): void {
    void postMirror('productionBatch', data);
  },
  mirrorInventoryTransaction(data: Record<string, unknown>): void {
    void postMirror('inventoryTransaction', data);
  },
  mirrorLedgerEntry(data: Record<string, unknown>): void {
    void postMirror('ledgerEntry', data);
  },
  mirrorSupportTicket(data: Record<string, unknown>): void {
    void postMirror('supportTicket', data);
  },
  mirrorNotification(data: Record<string, unknown>): void {
    void postMirror('notification', data);
  },
  mirrorEngagement(data: Record<string, unknown>): void {
    void postMirror('engagement', data);
  },
  mirrorBulk(data: Record<string, unknown>): void {
    void postMirror('bulk', data);
  },
  mirror(storeName: string, record: Record<string, unknown>): void {
    void mirrorByStoreName(storeName, record);
  },
  /**
   * Explicit awaitable call for call sites that want to know the outcome
   * (e.g. unit tests). Errors are still swallowed by postMirror.
   */
  async mirrorNow(entity: MirrorEntity, data: Record<string, unknown>): Promise<void> {
    await postMirror(entity, data);
  },
};

const STORE_TO_MIRROR: Record<string, (data: Record<string, unknown>) => void> = {
  customers: portalBridge.mirrorCustomer,
  deliveries: portalBridge.mirrorDeliveryNote,
  deliveryNotes: portalBridge.mirrorDeliveryNote,
  shipments: portalBridge.mirrorShipment,
  customerPayments: portalBridge.mirrorCustomerPayment,
  invoices: portalBridge.mirrorInvoice,
  quotations: portalBridge.mirrorQuotation,
  salesOrders: portalBridge.mirrorSalesOrder,
  walletTransactions: portalBridge.mirrorWalletTransaction,
  jobTickets: portalBridge.mirrorJobTicket,
  workOrders: portalBridge.mirrorWorkOrder,
  batches: portalBridge.mirrorProductionBatch,
  productionBatches: portalBridge.mirrorProductionBatch,
  inventoryTransactions: portalBridge.mirrorInventoryTransaction,
  ledger: portalBridge.mirrorLedgerEntry,
  engagementPoints: portalBridge.mirrorEngagement,
  engagementCashback: portalBridge.mirrorEngagement,
  engagementCustomerRewards: portalBridge.mirrorEngagement,
  referralRewards: portalBridge.mirrorEngagement,
};

export function mirrorByStoreName(storeName: string, record: Record<string, unknown>): void {
  const mirrorFn = STORE_TO_MIRROR[storeName];
  if (mirrorFn) {
    mirrorFn(record);
  }
}

export const PORTAL_MIRROR_STORES = new Set(Object.keys(STORE_TO_MIRROR));
