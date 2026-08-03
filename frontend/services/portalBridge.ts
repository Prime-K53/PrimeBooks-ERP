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

export type MirrorEntity = 'invoice' | 'salesOrder' | 'quotation' | 'customerPayment' | 'wallet';

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
  /**
   * Explicit awaitable call for call sites that want to know the outcome
   * (e.g. unit tests). Errors are still swallowed by postMirror.
   */
  async mirrorNow(entity: MirrorEntity, data: Record<string, unknown>): Promise<void> {
    await postMirror(entity, data);
  },
};
