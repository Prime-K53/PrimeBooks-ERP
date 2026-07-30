import React, { useState, useEffect } from 'react';
import {
  Users, Plus, Shield, ShieldOff, Key, Mail, Lock, Loader2,
  Search, X, Check, AlertCircle, Clock
} from 'lucide-react';

interface PortalUserRecord {
  customer_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  customer_status: string;
  portal_user_id: string | null;
  portal_email: string | null;
  full_name: string | null;
  portal_phone: string | null;
  portal_status: string | null;
  last_login_at: string | null;
  portal_created_at: string | null;
}

function getSessionUser(): Record<string, any> | null {
  try {
    const raw = sessionStorage.getItem('nexus_user');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const user = getSessionUser();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  const token = user?.accessToken || user?.token;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else if (user?.id) {
    headers['x-user-id'] = user.id;
    headers['x-user-role'] = user.role || 'Admin';
    if (user.email) headers['x-user-email'] = user.email;
    if (user.isSuperAdmin) headers['x-user-is-super-admin'] = 'true';
  }
  const res = await fetch(`/api${path}`, { ...options, headers });

  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();

  if (!res.ok) {
    let body: any = {};
    try {
      if (contentType.includes('application/json') && text.trim()) {
        body = JSON.parse(text);
      }
    } catch { /* ignore parse errors */ }
    const err: any = new Error(body.error || body.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }

  if (!text.trim()) {
    return {} as T;
  }

  if (contentType.includes('application/json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try {
      return JSON.parse(text) as T;
    } catch (parseError) {
      throw new Error('Invalid JSON response from server');
    }
  }

  throw new Error('Expected JSON response but received non-JSON content');
}

const PortalUserManagement: React.FC = () => {
  const [users, setUsers] = useState<PortalUserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showResetPw, setShowResetPw] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({ customer_id: '', email: '', password: '', full_name: '', phone: '' });
  const [resetPw, setResetPw] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<PortalUserRecord[]>('/portal/admin/users');
      setUsers(data);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to load' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadUsers(); }, []);

  const filtered = users.filter(u =>
    u.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.portal_email?.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      await apiFetch('/portal/admin/users', {
        method: 'POST',
        body: JSON.stringify(createForm),
      });
      setMessage({ type: 'success', text: 'Portal account created' });
      setShowCreate(false);
      setCreateForm({ customer_id: '', email: '', password: '', full_name: '', phone: '' });
      loadUsers();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.body?.error || err.message || 'Failed to create' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (userId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
    try {
      await apiFetch(`/portal/admin/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      setMessage({ type: 'success', text: `Account ${newStatus === 'active' ? 'enabled' : 'disabled'}` });
      loadUsers();
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Failed to update status' });
    }
  };

  const handleResetPassword = async (userId: string) => {
    if (!resetPw || resetPw.length < 6) return;
    setSubmitting(true);
    try {
      await apiFetch(`/portal/admin/users/${userId}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ new_password: resetPw }),
      });
      setMessage({ type: 'success', text: 'Password reset successfully' });
      setShowResetPw(null);
      setResetPw('');
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Failed to reset password' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Portal Users</h1>
          <p className="text-sm text-slate-400 mt-1">Manage customer portal access</p>
        </div>
        <button
          onClick={() => { setShowCreate(!showCreate); setMessage(null); }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          <Plus size={16} />
          Create Portal Account
        </button>
      </div>

      {message && (
        <div className={`mb-4 p-3.5 rounded-xl flex items-start gap-3 ${message.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-rose-500/10 border border-rose-500/20'}`}>
          {message.type === 'success' ? <Check size={16} className="text-emerald-400 mt-0.5" /> : <AlertCircle size={16} className="text-rose-400 mt-0.5" />}
          <p className={`text-xs ${message.type === 'success' ? 'text-emerald-300' : 'text-rose-300'}`}>{message.text}</p>
        </div>
      )}

      {showCreate && (
        <div className="mb-6 p-5 bg-slate-800/80 border border-slate-700/50 rounded-2xl">
          <h3 className="text-sm font-bold text-slate-200 mb-4">New Portal Account</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">Customer ID</label>
              <input value={createForm.customer_id} onChange={e => setCreateForm({ ...createForm, customer_id: e.target.value })}
                className="w-full h-10 px-3 bg-slate-900/60 border border-slate-700/60 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                placeholder="Customer ID from database" required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">Email</label>
              <input type="email" value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })}
                className="w-full h-10 px-3 bg-slate-900/60 border border-slate-700/60 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                placeholder="customer@example.com" required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">Password</label>
              <input type="password" value={createForm.password} onChange={e => setCreateForm({ ...createForm, password: e.target.value })}
                className="w-full h-10 px-3 bg-slate-900/60 border border-slate-700/60 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                placeholder="Min 6 characters" required minLength={6} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">Full Name (optional)</label>
              <input value={createForm.full_name} onChange={e => setCreateForm({ ...createForm, full_name: e.target.value })}
                className="w-full h-10 px-3 bg-slate-900/60 border border-slate-700/60 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                placeholder="John Doe" />
            </div>
            <div className="md:col-span-2 flex items-center gap-3">
              <button type="submit" disabled={submitting}
                className="px-5 h-10 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors flex items-center gap-2">
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Create Account
              </button>
              <button type="button" onClick={() => setShowCreate(false)}
                className="px-5 h-10 text-slate-400 hover:text-slate-200 text-sm font-medium rounded-xl transition-colors">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          className="w-full h-10 pl-10 pr-4 bg-slate-800/60 border border-slate-700/60 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          placeholder="Search customers or emails..." />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-emerald-400" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-700/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/80">
                <th className="text-left p-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Customer</th>
                <th className="text-left p-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Portal Email</th>
                <th className="text-left p-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                <th className="text-left p-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Last Login</th>
                <th className="text-right p-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {filtered.map((u) => (
                <tr key={u.customer_id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="p-3">
                    <div className="font-medium text-slate-200">{u.customer_name}</div>
                    <div className="text-xs text-slate-500">{u.customer_email}</div>
                  </td>
                  <td className="p-3">
                    {u.portal_email ? (
                      <span className="text-slate-300">{u.portal_email}</span>
                    ) : (
                      <span className="text-slate-600 italic">No portal account</span>
                    )}
                  </td>
                  <td className="p-3">
                    {u.portal_status === 'active' ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        Active
                      </span>
                    ) : u.portal_status === 'disabled' ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400 text-xs font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                        Disabled
                      </span>
                    ) : (
                      <span className="text-slate-600 text-xs">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    {u.last_login_at ? (
                      <span className="text-xs text-slate-400 flex items-center gap-1.5">
                        <Clock size={12} />
                        {new Date(u.last_login_at).toLocaleDateString()}
                      </span>
                    ) : (
                      <span className="text-slate-600 text-xs">Never</span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    {u.portal_user_id ? (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleToggleStatus(u.portal_user_id!, u.portal_status || 'disabled')}
                          className="p-2 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors"
                          title={u.portal_status === 'active' ? 'Disable' : 'Enable'}
                        >
                          {u.portal_status === 'active' ? <ShieldOff size={14} /> : <Shield size={14} />}
                        </button>
                        <button
                          onClick={() => { setShowResetPw(u.portal_user_id); setResetPw(''); }}
                          className="p-2 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors"
                          title="Reset Password"
                        >
                          <Key size={14} />
                        </button>
                        {showResetPw === u.portal_user_id && (
                          <div className="flex items-center gap-2">
                            <input type="password" value={resetPw} onChange={e => setResetPw(e.target.value)}
                              className="w-28 h-8 px-2 bg-slate-900/60 border border-slate-700/60 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                              placeholder="New password" minLength={6} />
                            <button onClick={() => handleResetPassword(u.portal_user_id!)}
                              disabled={submitting || resetPw.length < 6}
                              className="p-2 rounded-lg bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 disabled:opacity-50 transition-colors">
                              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                            </button>
                            <button onClick={() => setShowResetPw(null)}
                              className="p-2 rounded-lg text-slate-500 hover:text-slate-300 transition-colors">
                              <X size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-600 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default PortalUserManagement;
