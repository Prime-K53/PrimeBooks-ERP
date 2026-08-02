import { ensureSessionAuthState, getStoredUserSession } from './authSession';

type HeaderMap = Record<string, string>;

const FALLBACK_HEADERS: HeaderMap = {
  'x-user-id': 'USR-0001',
  'x-user-role': 'Admin',
  'x-user-is-super-admin': 'true',
};

const applyIdentityHeaders = (headers: HeaderMap): HeaderMap => {
  if (typeof sessionStorage === 'undefined') {
    return { ...headers, ...FALLBACK_HEADERS };
  }

  const user = getStoredUserSession();
  if (!user) {
    const authState = ensureSessionAuthState();
    const nextHeaders = { ...headers, ...FALLBACK_HEADERS };
    if (authState.accessToken) {
      nextHeaders.Authorization = `Bearer ${authState.accessToken}`;
    }
    nextHeaders['x-auth-mode'] = authState.authMode;
    return nextHeaders;
  }

  const authState = ensureSessionAuthState();
  const nextHeaders = { ...headers };

  if (user?.id) nextHeaders['x-user-id'] = String(user.id);
  if (user?.role) nextHeaders['x-user-role'] = String(user.role);
  if (user?.email) nextHeaders['x-user-email'] = String(user.email);
  nextHeaders['x-user-is-super-admin'] = user?.isSuperAdmin === true ? 'true' : 'false';
  nextHeaders['x-auth-mode'] = authState.authMode;
  if (authState.accessToken) {
    nextHeaders.Authorization = `Bearer ${authState.accessToken}`;
  }

  return nextHeaders;
};

export const getRequestIdentityHeaders = (headers: HeaderMap = {}): HeaderMap =>
  applyIdentityHeaders(headers);

export const getJsonRequestHeaders = (headers: HeaderMap = {}): HeaderMap =>
  applyIdentityHeaders({
    'Content-Type': 'application/json',
    ...headers,
  });
