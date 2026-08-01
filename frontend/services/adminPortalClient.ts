const API_BASE = '/api';

interface AdminUserInfo {
  id: string;
  role?: string;
  email?: string;
  isSuperAdmin?: boolean;
}

function getAdminUser(): AdminUserInfo | null {
  try {
    const raw = sessionStorage.getItem('nexus_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function adminRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const user = getAdminUser();
  if (user) {
    headers['x-user-id'] = user.id;
    headers['x-user-role'] = user.role || 'Admin';
    if (user.email) headers['x-user-email'] = user.email;
    if (user.isSuperAdmin) headers['x-user-is-super-admin'] = 'true';
  }
  const res = await fetch(`${API_BASE}/portal/admin${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error: any = new Error(body.message || body.error || `Request failed with status ${res.status}`);
    error.status = res.status;
    error.body = body;
    throw error;
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return undefined as T;
}

export const adminPortalApi = {
  get<T>(path: string): Promise<T> {
    return adminRequest<T>(path, { method: 'GET' });
  },
  post<T>(path: string, body?: any): Promise<T> {
    return adminRequest<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
  },
  put<T>(path: string, body?: any): Promise<T> {
    return adminRequest<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined });
  },
};

export interface AdminNotification {
  id: string;
  company_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  customer_id: string | null;
  customer_name: string | null;
  is_read: number;
  created_at: string;
}

export interface AdminRequestItem {
  id: string;
  productId?: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export type AdminRequestStatus =
  | 'draft'
  | 'submitted'
  | 'assigned'
  | 'under_review'
  | 'waiting_for_customer'
  | 'ready_for_conversion'
  | 'converted'
  | 'rejected'
  | 'cancelled';

export interface AdminAttachment {
  name: string;
  url: string;
  type: string;
}

export interface AdminQuotationRequest {
  id: string;
  request_number: string;
  customer_id: string;
  customer_name: string;
  company_id: string;
  request_type: string;
  items: AdminRequestItem[];
  subtotal: number;
  notes: string | null;
  status: AdminRequestStatus;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  quotation_id: string | null;
  quotation_number: string | null;
  requested_delivery_date: string | null;
  attachments: AdminAttachment[];
  assigned_to: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
  converted_at: string | null;
  converted_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface QuotationPrefillPayload {
  id: string;
  requestNumber: string;
  requestType: string;
  customer_id: string;
  customer_name: string;
  items: AdminRequestItem[];
  subtotal: number;
  notes: string | null;
  requestedDeliveryDate: string | null;
  attachments: AdminAttachment[];
  status: string;
  assignedTo: string | null;
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    billingAddress: string;
    shippingAddress: string;
    city: string | null;
    segment: string | null;
    paymentTerms: string | null;
    currency: string | null;
  } | null;
}

export interface AdminQuotation {
  id: string;
  quotation_number: string;
  request_id: string | null;
  customer_id: string;
  customer_name: string;
  company_id: string;
  items: AdminRequestItem[];
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
  created_by: string;
  source_request_number: string | null;
  erp_quotation_id: string | null;
  created_at: string;
  updated_at: string;
}

/** SSE realtime stream with a short-lived ticket (EventSource cannot send headers). */
export async function subscribeAdminEvents(callbacks: {
  onNotification?: (n: any) => void;
  onEntityChange?: (payload: any) => void;
  onError?: (err: any) => void;
}): Promise<() => void> {
  let source: EventSource | null = null;
  try {
    const { ticket } = await adminPortalApi.post<{ ticket: string; expiresIn: number }>('/events-ticket', { purpose: 'notifications' });
    source = new EventSource(`${API_BASE}/portal/admin/events?token=${encodeURIComponent(ticket)}`);
    source.addEventListener('notification', (e: MessageEvent) => {
      try {
        callbacks.onNotification?.(JSON.parse(e.data));
      } catch { /* ignore malformed payloads */ }
    });
    source.addEventListener('entity_changed', (e: MessageEvent) => {
      try {
        callbacks.onEntityChange?.(JSON.parse(e.data));
      } catch { /* ignore malformed payloads */ }
    });
    source.onerror = () => callbacks.onError?.(new Error('Realtime connection lost'));
  } catch {
    // Ticket issuance failed — admin will poll instead.
  }
  return () => source?.close();
}

export interface AdminUser {
  customer_id: string;
  customer_name: string;
  customer_email?: string;
  customer_phone?: string;
  customer_status?: string;
  portal_user_id?: string;
  portal_email?: string;
  full_name?: string;
  portal_phone?: string;
  portal_status?: string;
  last_login_at?: string;
  portal_created_at?: string;
}

export const adminLifecycle = {
  requests: {
    list(status?: string): Promise<AdminQuotationRequest[]> {
      return adminPortalApi.get<AdminQuotationRequest[]>(`/requests${status ? `?status=${status}` : ''}`);
    },
    get(id: string): Promise<AdminQuotationRequest> {
      return adminPortalApi.get<AdminQuotationRequest>(`/requests/${id}`);
    },
    update(id: string, body: { items?: { name: string; quantity: number; unitPrice: number }[]; notes?: string }): Promise<AdminQuotationRequest> {
      return adminPortalApi.put<AdminQuotationRequest>(`/requests/${id}`, body);
    },
    reject(id: string, reason: string): Promise<AdminQuotationRequest> {
      return adminPortalApi.post<AdminQuotationRequest>(`/requests/${id}/reject`, { reason });
    },
    clarify(id: string, note: string): Promise<AdminQuotationRequest> {
      return adminPortalApi.post<AdminQuotationRequest>(`/requests/${id}/clarify`, { note });
    },
    open(id: string): Promise<AdminQuotationRequest> {
      return adminPortalApi.post<AdminQuotationRequest>(`/requests/${id}/open`, {});
    },
    assign(id: string, body: { assignTo?: string; assignToName?: string }): Promise<AdminQuotationRequest> {
      return adminPortalApi.post<AdminQuotationRequest>(`/requests/${id}/assign`, body);
    },
    /**
     * Starts quotation generation. Does NOT create a quotation and does NOT
     * reserve a quotation number — returns the prefill payload for the standard
     * ERP quotation editor.
     */
    startQuotation(id: string): Promise<QuotationPrefillPayload> {
      return adminPortalApi.post<QuotationPrefillPayload>(`/requests/${id}/generate-quotation`, {});
    },
    /**
     * Links the saved ERP quotation to the request (request becomes converted).
     */
    completeQuotation(id: string, body: { quotationNumber: string; erpQuotationId?: string; quotationSnapshot?: any }): Promise<AdminQuotation> {
      return adminPortalApi.post<AdminQuotation>(`/requests/${id}/complete-quotation`, body);
    },
  },
  quotations: {
    list(): Promise<AdminQuotation[]> {
      return adminPortalApi.get<AdminQuotation[]>('/quotations');
    },
    get(id: string): Promise<AdminQuotation> {
      return adminPortalApi.get<AdminQuotation>(`/quotations/${id}`);
    },
    regenerate(id: string, body: any): Promise<AdminQuotation> {
      return adminPortalApi.post<AdminQuotation>(`/quotations/${id}/regenerate`, body);
    },
    convertToOrder(id: string, body: { deliveryDate?: string; notes?: string }): Promise<any> {
      return adminPortalApi.post<any>(`/quotations/${id}/convert-to-order`, body);
    },
  },
  notifications: {
    list(): Promise<AdminNotification[]> {
      return adminPortalApi.get<AdminNotification[]>('/notifications');
    },
    unreadCount(): Promise<{ count: number }> {
      return adminPortalApi.get<{ count: number }>('/notifications/unread-count');
    },
    markRead(id: string): Promise<void> {
      return adminPortalApi.put<void>(`/notifications/${id}/read`, {});
    },
    markAllRead(): Promise<void> {
      return adminPortalApi.put<void>('/notifications/read-all', {});
    },
  },
  activity: {
    list(limit = 50): Promise<any[]> {
      return adminPortalApi.get<any[]>(`/activity?limit=${limit}`);
    },
  },
  analytics: {
    get(): Promise<any> {
      return adminPortalApi.get<any>('/analytics');
    },
  },
  users: {
    list(): Promise<AdminUser[]> {
      return adminPortalApi.get<AdminUser[]>('/users');
    },
  },
  staff: {
    list(): Promise<{ id: string; username: string; email: string | null; role: string }[]> {
      return adminPortalApi.get<{ id: string; username: string; email: string | null; role: string }[]>('/staff');
    },
  },
};
