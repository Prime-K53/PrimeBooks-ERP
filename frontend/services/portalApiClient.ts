import { API_BASE_URL } from '../config/api.js';

const PORTAL_SESSION_KEY = 'portal_session';

export interface PortalSessionData {
  access_token: string;
  refresh_token: string;
  expires_in: string;
  user: {
    id: string;
    customer_id: string;
    email: string;
    full_name?: string;
    phone?: string;
  };
}

export function getPortalSession(): PortalSessionData | null {
  try {
    const raw = sessionStorage.getItem(PORTAL_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    sessionStorage.removeItem(PORTAL_SESSION_KEY);
    return null;
  }
}

export function savePortalSession(session: PortalSessionData | null): void {
  if (session) {
    sessionStorage.setItem(PORTAL_SESSION_KEY, JSON.stringify(session));
  } else {
    sessionStorage.removeItem(PORTAL_SESSION_KEY);
  }
}

export function clearPortalSession(): void {
  sessionStorage.removeItem(PORTAL_SESSION_KEY);
}

export function getPortalAccessToken(): string | null {
  return getPortalSession()?.access_token || null;
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}/portal${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  const token = getPortalAccessToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error: any = new Error(body.message || body.error || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return response.json();
}

export const portalApi = {
  get<T>(endpoint: string): Promise<T> {
    return request<T>(endpoint, { method: 'GET' });
  },

  post<T>(endpoint: string, body?: any): Promise<T> {
    return request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  put<T>(endpoint: string, body?: any): Promise<T> {
    return request<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  delete<T>(endpoint: string): Promise<T> {
    return request<T>(endpoint, { method: 'DELETE' });
  },

  rawRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    return request<T>(endpoint, options);
  },
};

// ---------------------------------------------------------------------------
// Document lifecycle (requests, quotations, downloads, timeline, realtime)
// ---------------------------------------------------------------------------

export interface RequestLineItem {
  productId?: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface PortalAttachment {
  name: string;
  url: string;
  type: string;
}

export type PortalRequestStatus =
  | 'draft'
  | 'submitted'
  | 'assigned'
  | 'under_review'
  | 'waiting_for_customer'
  | 'ready_for_conversion'
  | 'converted'
  | 'rejected'
  | 'cancelled';

export interface QuotationRequestRecord {
  id: string;
  request_number: string;
  customer_id: string;
  customer_name: string;
  company_id: string;
  request_type: string;
  items: RequestLineItem[];
  subtotal: number;
  notes: string | null;
  status: PortalRequestStatus;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  quotation_id: string | null;
  quotation_number: string | null;
  requested_delivery_date: string | null;
  attachments: PortalAttachment[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface QuotationRecord {
  id: string;
  quotation_number: string;
  request_id: string | null;
  customer_id: string;
  customer_name: string;
  company_id: string;
  items: RequestLineItem[];
  subtotal: number;
  discount: number;
  tax_rate: number;
  tax_amount: number;
  delivery_fee: number;
  total: number;
  currency: string;
  payment_terms: string | null;
  valid_until: string | null;
  status: 'ready' | 'accepted' | 'rejected' | 'revision_requested' | 'converted';
  revision_note: string | null;
  rejection_reason: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  revision_requested_at: string | null;
  converted_at: string | null;
  order_id: string | null;
  source_request_number: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TimelineEvent {
  id: string;
  doc_type: string;
  doc_id: string;
  event_type: string;
  title: string;
  description: string | null;
  actor_type: string;
  actor_name: string | null;
  created_at: string;
}

export interface DownloadGateResult {
  allowed: boolean;
  docType: string;
  docId: string;
  docNumber: string;
  downloadId: string;
}

export interface CreateRequestPayload {
  requestType?: string;
  items: { name: string; productId?: string | null; quantity: number; unitPrice: number }[];
  notes?: string;
  requestedDeliveryDate?: string | null;
  attachments?: PortalAttachment[];
}

export interface QuotationDecisionPayload {
  acceptedBy?: string;
  reason?: string;
  comments?: string;
}

export const portalLifecycle = {
  requests: {
    list(): Promise<QuotationRequestRecord[]> {
      return portalApi.get<QuotationRequestRecord[]>('/requests');
    },
    get(id: string): Promise<QuotationRequestRecord> {
      return portalApi.get<QuotationRequestRecord>(`/requests/${id}`);
    },
    create(payload: CreateRequestPayload): Promise<QuotationRequestRecord> {
      return portalApi.post<QuotationRequestRecord>('/requests', payload);
    },
    cancel(id: string): Promise<QuotationRequestRecord> {
      return portalApi.post<QuotationRequestRecord>(`/requests/${id}/cancel`);
    },
  },

  quotations: {
    list(): Promise<QuotationRecord[]> {
      return portalApi.get<QuotationRecord[]>('/quotations');
    },
    get(id: string): Promise<QuotationRecord> {
      return portalApi.get<QuotationRecord>(`/quotations/${id}`);
    },
    accept(id: string, payload?: QuotationDecisionPayload): Promise<QuotationRecord> {
      return portalApi.post<QuotationRecord>(`/quotations/${id}/accept`, payload);
    },
    reject(id: string, payload?: QuotationDecisionPayload): Promise<QuotationRecord> {
      return portalApi.post<QuotationRecord>(`/quotations/${id}/reject`, payload);
    },
    requestRevision(id: string, payload?: QuotationDecisionPayload): Promise<QuotationRecord> {
      return portalApi.post<QuotationRecord>(`/quotations/${id}/revision`, payload);
    },
  },

  downloads: {
    record(docType: 'quotation' | 'order', docId: string): Promise<DownloadGateResult> {
      return portalApi.post<DownloadGateResult>('/downloads', { docType, docId });
    },
  },

  timeline: {
    get(docType: 'request' | 'quotation' | 'order', docId: string): Promise<TimelineEvent[]> {
      return portalApi.get<TimelineEvent[]>(`/timeline?docType=${docType}&docId=${encodeURIComponent(docId)}`);
    },
  },

  /** SSE realtime stream (EventSource cannot send headers — token goes in query). */
  subscribe(callbacks: { onEvent?: (type: string, payload: any) => void; onError?: (err: any) => void }): () => void {
    const token = getPortalAccessToken();
    if (!token) return () => {};
    const url = `${API_BASE_URL}/portal/events?token=${encodeURIComponent(token)}`;
    const source = new EventSource(url);
    source.addEventListener('entity_changed', (e: MessageEvent) => {
      try {
        callbacks.onEvent?.('entity_changed', JSON.parse(e.data));
      } catch { /* ignore malformed payloads */ }
    });
    source.addEventListener('notification', (e: MessageEvent) => {
      try {
        callbacks.onEvent?.('notification', JSON.parse(e.data));
      } catch { /* ignore malformed payloads */ }
    });
    source.onerror = () => callbacks.onError?.(new Error('Realtime connection lost'));
    return () => source.close();
  },
};
