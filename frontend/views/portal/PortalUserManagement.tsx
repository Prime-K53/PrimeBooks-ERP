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

  // Styling constants (mirroring Add Customer modal)
  const teal: Record<string, string> = { 50: '#eef7f6', 100: '#d3ece9', 200: '#a6d9d3', 300: '#72c0b7', 400: '#3fa294', 500: '#1f8577', 600: '#146b60', 700: '#0f544c', 800: '#0b3e39', 900: '#082e2a' };
  const amber: Record<string, string> = { 100: '#fbead0', 300: '#eec27a', 500: '#d99a3f', 600: '#b97e2b' };
  const paper = '#FEFDFB';
  const ink = '#23282A';
  const inkSoft = '#5c6567';
  const hairline = '#e4ddd1';
  const danger = '#b5493f';

  const labelStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 12, fontWeight: 600, color: teal[800],
    marginBottom: 6, letterSpacing: 0.01
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', fontFamily: "'Inter', sans-serif", fontSize: 13.5,
    color: ink, background: paper,
    border: `1.4px solid ${hairline}`, borderRadius: 9,
    padding: '9px 12px', outline: 'none',
    transition: 'border-color .15s ease, box-shadow .15s ease, background .15s ease'
  };
  const btnGhostStyle: React.CSSProperties = {
    fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
    padding: '9px 18px', borderRadius: 9, cursor: 'pointer',
    background: paper, border: `1.4px solid ${hairline}`, color: inkSoft,
    display: 'flex', alignItems: 'center', gap: 7, transition: 'all .15s ease'
  };

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
          <h1 className="text-2xl font-bold text-slate-900">Portal Users</h1>
          <p className="text-sm text-slate-500 mt-1">Manage customer portal access</p>
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
        <div className={`mb-4 p-3.5 rounded-xl flex items-start gap-3 ${message.type === 'success' ? 'bg-emerald-50 border border-emerald-200' : 'bg-rose-50 border border-rose-200'}`}>
          {message.type === 'success' ? <Check size={16} className="text-emerald-600 mt-0.5" /> : <AlertCircle size={16} className="text-rose-600 mt-0.5" />}
          <p className={`text-xs ${message.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>{message.text}</p>
        </div>
      )}

        {showCreate && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15, 23, 42, 0.6)', padding: '40px 20px', fontFamily: "'Inter','DM Sans',sans-serif", fontSize: 13.5, color: ink
          }} onClick={() => { if (!submitting) setShowCreate(false); }}>
            <div style={{
              width: '100%', maxWidth: '32rem', maxHeight: '92vh',
              background: paper, borderRadius: 14,
              border: `1px solid ${hairline}`,
              boxShadow: '0 30px 70px -20px rgba(0,0,0,.55), 0 8px 24px -8px rgba(0,0,0,.35)',
              overflow: 'hidden', position: 'relative'
            }} onClick={e => e.stopPropagation()}>
              <div style={{ height: 4, background: `linear-gradient(90deg, ${teal[600]}, ${teal[400]} 40%, ${amber[500]} 100%)` }} />
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '22px 28px 18px', borderBottom: `1px solid ${hairline}`, background: paper
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: `0 4px 10px -3px rgba(15,84,76,.6)`, flexShrink: 0
                  }}>
                    <Plus size={16} color="#fff" />
                  </div>
                  <div>
                    <h2 style={{
                      fontFamily: "'DM Serif Display', 'Georgia', serif", fontWeight: 400,
                      fontSize: 22, margin: 0, color: teal[800], letterSpacing: 0.2
                    }}>
                      New Portal Account
                    </h2>
                    <p style={{ margin: '2px 0 0', fontSize: 11.5, color: inkSoft, letterSpacing: 0.02 }}>
                      Create a portal access account for a customer
                    </p>
                  </div>
                </div>
                <button onClick={() => { if (!submitting) setShowCreate(false); }} aria-label="Close" style={{
                  width: 32, height: 32, borderRadius: 8,
                  border: `1px solid ${hairline}`, background: paper, color: inkSoft,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', transition: 'all .15s ease', fontSize: 16
                }}>
                  <X size={15} />
                </button>
              </div>
              <form onSubmit={handleCreate} style={{ padding: '24px 28px 8px' }}>
                <div style={{ marginBottom: 18 }}>
                  <label style={labelStyle}>Customer ID <span style={{ color: danger, fontWeight: 700 }}>*</span></label>
                  <input value={createForm.customer_id} onChange={e => setCreateForm({ ...createForm, customer_id: e.target.value })}
                    style={inputStyle} placeholder="Customer ID from database" required />
                </div>
                <div style={{ marginBottom: 18 }}>
                  <label style={labelStyle}>Email <span style={{ color: danger, fontWeight: 700 }}>*</span></label>
                  <input type="email" value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })}
                    style={inputStyle} placeholder="customer@example.com" required />
                </div>
                <div style={{ marginBottom: 18 }}>
                  <label style={labelStyle}>Password <span style={{ color: danger, fontWeight: 700 }}>*</span></label>
                  <input type="password" value={createForm.password} onChange={e => setCreateForm({ ...createForm, password: e.target.value })}
                    style={inputStyle} placeholder="Min 6 characters" required minLength={6} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
                  <div>
                    <label style={labelStyle}>Full Name</label>
                    <input value={createForm.full_name} onChange={e => setCreateForm({ ...createForm, full_name: e.target.value })}
                      style={inputStyle} placeholder="John Doe" />
                  </div>
                  <div>
                    <label style={labelStyle}>Phone</label>
                    <input value={createForm.phone} onChange={e => setCreateForm({ ...createForm, phone: e.target.value })}
                      style={inputStyle} placeholder="+1 (555) 000-0000" />
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, padding: '16px 28px', borderTop: `1px solid ${hairline}`, background: paper }}>
                  <button type="button" onClick={() => setShowCreate(false)} disabled={submitting} style={btnGhostStyle}>
                    Cancel
                  </button>
                  <button type="submit" disabled={submitting}
                    style={{
                      fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
                      padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid transparent',
                      background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
                      color: '#fff', display: 'flex', alignItems: 'center', gap: 7,
                      boxShadow: `0 6px 16px -6px rgba(15,84,76,.55)`,
                      transition: 'all .15s ease', opacity: submitting ? 0.6 : 1
                    }}>
                    {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    Create Account
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}


      <div className="relative mb-4">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          className="w-full h-10 pl-10 pr-4 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          placeholder="Search customers or emails..." />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-emerald-600" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white">
                <th className="text-left p-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Customer</th>
                <th className="text-left p-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Portal Email</th>
                <th className="text-left p-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="text-left p-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Last Login</th>
                <th className="text-right p-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {filtered.map((u) => (
                <tr key={u.customer_id} className="hover:bg-white/40 transition-colors">
                  <td className="p-3">
                    <div className="font-medium text-slate-800">{u.customer_name}</div>
                    <div className="text-xs text-slate-400">{u.customer_email}</div>
                  </td>
                  <td className="p-3">
                    {u.portal_email ? (
                      <span className="text-slate-700">{u.portal_email}</span>
                    ) : (
                      <span className="text-slate-600 italic">No portal account</span>
                    )}
                  </td>
                  <td className="p-3">
                    {u.portal_status === 'active' ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 text-xs font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        Active
                      </span>
                    ) : u.portal_status === 'disabled' ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-600 text-xs font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                        Disabled
                      </span>
                    ) : (
                      <span className="text-slate-600 text-xs">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    {u.last_login_at ? (
                      <span className="text-xs text-slate-500 flex items-center gap-1.5">
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
                          className="p-2 rounded-lg hover:bg-slate-200 text-slate-500 hover:text-slate-900 transition-colors"
                          title={u.portal_status === 'active' ? 'Disable' : 'Enable'}
                        >
                          {u.portal_status === 'active' ? <ShieldOff size={14} /> : <Shield size={14} />}
                        </button>
                        <button
                          onClick={() => { setShowResetPw(u.portal_user_id); setResetPw(''); }}
                          className="p-2 rounded-lg hover:bg-slate-200 text-slate-500 hover:text-slate-900 transition-colors"
                          title="Reset Password"
                        >
                          <Key size={14} />
                        </button>
                        {showResetPw === u.portal_user_id && (
                          <div className="flex items-center gap-2">
                            <input type="password" value={resetPw} onChange={e => setResetPw(e.target.value)}
                              className="w-28 h-8 px-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                              placeholder="New password" minLength={6} />
                            <button onClick={() => handleResetPassword(u.portal_user_id!)}
                              disabled={submitting || resetPw.length < 6}
                              className="p-2 rounded-lg bg-emerald-600/20 text-emerald-600 hover:bg-emerald-600/30 disabled:opacity-50 transition-colors">
                              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                            </button>
                            <button onClick={() => setShowResetPw(null)}
                              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 transition-colors">
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
