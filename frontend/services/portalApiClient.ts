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
