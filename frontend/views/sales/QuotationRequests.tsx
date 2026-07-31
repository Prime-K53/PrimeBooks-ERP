import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, CheckCircle2, XCircle, FileText, RefreshCw, Loader2, MessageSquare,
  PackageCheck, Inbox, History, ChevronDown, Trash2, Plus, ArrowUpRight,
} from 'lucide-react';
import {
  adminLifecycle, subscribeAdminEvents,
  AdminQuotationRequest, AdminQuotation, AdminNotification,
} from '../../services/adminPortalClient';

const teal = { main: '#0f766e', soft: '#e6f4f2', accent: '#0d9488', dark: '#134e4a' };
const paper = '#ffffff';
const ink = '#0f172a';
const muted = '#64748b';
const hairline = '#e2e8f0';
const bg = '#f6f8fa';

const REQUEST_TABS = [
  { key: 'inbox', label: 'Inbox', icon: Inbox, statuses: ['submitted', 'under_review'] },
  { key: 'quotations', label: 'Quotations', icon: FileText, statuses: [] },
  { key: 'history', label: 'History', icon: History, statuses: ['rejected', 'cancelled'] },
] as const;

const requestStatusMeta: Record<string, { label: string; color: string; bg: string }> = {
  submitted: { label: 'Submitted', color: '#1d4ed8', bg: '#eff6ff' },
  under_review: { label: 'Under Review', color: '#b45309', bg: '#fffbeb' },
  quotation_ready: { label: 'Quotation Ready', color: '#047857', bg: '#ecfdf5' },
  rejected: { label: 'Rejected', color: '#b91c1c', bg: '#fef2f2' },
  cancelled: { label: 'Cancelled', color: '#64748b', bg: '#f1f5f9' },
};

const quotationStatusMeta: Record<string, { label: string; color: string; bg: string }> = {
  ready: { label: 'Ready', color: '#047857', bg: '#ecfdf5' },
  accepted: { label: 'Accepted', color: '#1d4ed8', bg: '#eff6ff' },
  rejected: { label: 'Rejected', color: '#b91c1c', bg: '#fef2f2' },
  revision_requested: { label: 'Revision Requested', color: '#7c3aed', bg: '#f5f3ff' },
  converted: { label: 'Converted', color: '#0f766e', bg: '#f0fdfa' },
};

function StatusPill({ meta, status }: { meta: Record<string, any>; status: string }) {
  const m = meta[status] || { label: status, color: '#475569', bg: '#f8fafc' };
  return (
    <span style={{ background: m.bg, color: m.color, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap' }}>
      {m.label}
    </span>
  );
}

const QuotationRequests: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const initialTab = (location.state as any)?.tab || 'inbox';
  const [tab, setTab] = useState<string>(initialTab);
  const [requests, setRequests] = useState<AdminQuotationRequest[]>([]);
  const [quotations, setQuotations] = useState<AdminQuotation[]>([]);
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const [analytics, setAnalytics] = useState<any>(null);
  const bellRef = useRef<HTMLDivElement | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [reqs, quotes, notifs, analyticsData] = await Promise.all([
        adminLifecycle.requests.list(),
        adminLifecycle.quotations.list(),
        adminLifecycle.notifications.list(),
        adminLifecycle.analytics.get(),
      ]);
      setRequests(reqs || []);
      setQuotations(quotes || []);
      setNotifications(notifs || []);
      setAnalytics(analyticsData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const unsubscribePromise = subscribeAdminEvents({
      onNotification: () => loadAll(),
      onEntityChange: (payload) => {
        if (payload.docType === 'request' || payload.docType === 'quotation') loadAll();
      },
    });
    return () => {
      unsubscribePromise.then((unsub) => unsub());
    };
  }, [loadAll]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const unread = useMemo(() => notifications.filter((n) => !n.is_read).length, [notifications]);
  const inboxCount = useMemo(() => requests.filter((r) => r.status === 'submitted' || r.status === 'under_review').length, [requests]);

  const activeRequests = useMemo(() => {
    if (tab === 'history') return requests.filter((r) => r.status === 'rejected' || r.status === 'cancelled');
    return requests.filter((r) => r.status === 'submitted' || r.status === 'under_review');
  }, [requests, tab]);

  const markAllRead = async () => {
    await adminLifecycle.notifications.markAllRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
  };

  const action = async (key: string, fn: () => Promise<any>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 16, marginBottom: 20, flexWrap: 'wrap',
  };
  const cardStyle: React.CSSProperties = {
    background: paper, border: `1px solid ${hairline}`, borderRadius: 14,
  };
  const chipStyle = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 10,
    fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none', background: active ? teal.main : '#eef1f4',
    color: active ? '#ffffff' : '#475569', transition: 'all .15s ease',
  });
  const btnPrimary: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 10,
    fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none', color: '#fff',
    background: `linear-gradient(135deg, ${teal.accent}, ${teal.main})`, transition: 'all .15s ease',
  };
  const btnGhost: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 10,
    fontSize: 13, fontWeight: 700, cursor: 'pointer', border: `1px solid ${hairline}`, background: paper,
    color: '#334155', transition: 'all .15s ease',
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 10, border: `1px solid ${hairline}`,
    fontSize: 13, color: ink, background: paper, outline: 'none', boxSizing: 'border-box',
  };

  if (loading) {
    return (
      <div style={{ padding: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Loader2 size={26} className="animate-spin" style={{ color: teal.main }} />
      </div>
    );
  }

  return (
    <div style={{ padding: 28, maxWidth: 1100, margin: '0 auto' }}>
      <div style={headerStyle}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: ink, margin: 0 }}>Quotation Requests</h1>
          <p style={{ fontSize: 13, color: muted, margin: '4px 0 0' }}>
            Review customer requests, issue official quotations, and convert accepted quotes into orders.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }} ref={bellRef}>
          {analytics && (
            <span style={{ fontSize: 12, color: muted }}>
              <b style={{ color: ink }}>{analytics.totalRequests || 0}</b> requests •{' '}
              <b style={{ color: ink }}>{analytics.convertedQuotations || 0}</b> converted •{' '}
              <b style={{ color: ink }}>{analytics.totalDownloads || 0}</b> downloads
            </span>
          )}
          <button
            onClick={() => setBellOpen((v) => !v)}
            style={{ position: 'relative', background: paper, border: `1px solid ${hairline}`, borderRadius: 10, padding: '8px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            <Bell size={17} style={{ color: ink }} />
            {unread > 0 && (
              <span style={{ position: 'absolute', top: -6, right: -6, background: '#e11d48', color: '#fff', fontSize: 10, fontWeight: 800, minWidth: 18, height: 18, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {unread}
              </span>
            )}
          </button>
          {bellOpen && (
            <div style={{ position: 'absolute', top: 46, right: 0, width: 340, maxHeight: 420, overflowY: 'auto', background: paper, border: `1px solid ${hairline}`, borderRadius: 14, boxShadow: '0 12px 40px rgba(15,23,42,.14)', zIndex: 60 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: `1px solid ${hairline}` }}>
                <b style={{ fontSize: 13, color: ink }}>Notifications</b>
                <button onClick={markAllRead} style={{ fontSize: 11, fontWeight: 700, color: teal.accent, background: 'none', border: 'none', cursor: 'pointer' }}>
                  Mark all read
                </button>
              </div>
              {notifications.length === 0 ? (
                <p style={{ padding: 20, textAlign: 'center', fontSize: 12, color: muted }}>No notifications yet.</p>
              ) : (
                notifications.slice(0, 30).map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      adminLifecycle.notifications.markRead(n.id).catch(() => {});
                      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: 1 } : x)));
                      if (n.link) navigate(n.link.startsWith('#') ? n.link.slice(1) : n.link);
                      setBellOpen(false);
                    }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '11px 14px',
                      borderBottom: `1px solid ${hairline}`, background: n.is_read ? paper : teal.soft, cursor: 'pointer', borderLeft: `3px solid ${n.is_read ? 'transparent' : teal.accent}`,
                    }}
                  >
                    <p style={{ fontSize: 12.5, fontWeight: 700, color: ink, margin: 0 }}>{n.title}</p>
                    <p style={{ fontSize: 11.5, color: muted, margin: '2px 0 0' }}>{n.body}</p>
                    <p style={{ fontSize: 10, color: muted, margin: '4px 0 0' }}>{new Date(n.created_at).toLocaleString()}</p>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 12, padding: '12px 16px', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {REQUEST_TABS.map((t) => {
          const count = t.key === 'inbox' ? inboxCount : t.key === 'quotations' ? quotations.length : requests.filter((r) => r.status === 'rejected' || r.status === 'cancelled').length;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={chipStyle(tab === t.key)}>
              <t.icon size={15} /> {t.label}
              {count > 0 && <span style={{ background: tab === t.key ? 'rgba(255,255,255,.22)' : '#e2e8f0', borderRadius: 999, padding: '1px 8px', fontSize: 11 }}>{count}</span>}
            </button>
          );
        })}
      </div>

      {tab === 'inbox' && <RequestInbox requests={activeRequests} busy={busy} onAction={action} cardStyle={cardStyle} inputStyle={inputStyle} btnPrimary={btnPrimary} btnGhost={btnGhost} setExpanded={setExpandedId} expandedId={expandedId} />}
      {tab === 'quotations' && <QuotationPanel quotations={quotations} busy={busy} onAction={action} cardStyle={cardStyle} inputStyle={inputStyle} btnPrimary={btnPrimary} btnGhost={btnGhost} />}
      {tab === 'history' && (
        <div style={cardStyle}>
          {activeRequests.length === 0 ? (
            <p style={{ padding: 40, textAlign: 'center', fontSize: 13, color: muted }}>No rejected or cancelled requests.</p>
          ) : (
            activeRequests.map((r) => (
              <div key={r.id} style={{ padding: 16, borderBottom: `1px solid ${hairline}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <b style={{ fontSize: 13.5, color: ink }}>{r.request_number}</b>
                  <span style={{ fontSize: 12, color: muted, marginLeft: 10 }}>{r.customer_name}</span>
                  <span style={{ fontSize: 12, color: muted, marginLeft: 10 }}>{new Date(r.created_at).toLocaleDateString()}</span>
                  {r.review_note && <p style={{ fontSize: 12, color: muted, margin: '4px 0 0' }}>Reason: {r.review_note}</p>}
                </div>
                <StatusPill meta={requestStatusMeta} status={r.status} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

/* ─── Inbox: review requests ─────────────────────────────────── */

interface PanelProps {
  requests: AdminQuotationRequest[];
  busy: string | null;
  onAction: (key: string, fn: () => Promise<any>) => void;
  cardStyle: React.CSSProperties;
  inputStyle: React.CSSProperties;
  btnPrimary: React.CSSProperties;
  btnGhost: React.CSSProperties;
  setExpanded: (id: string | null) => void;
  expandedId: string | null;
}

const RequestInbox: React.FC<PanelProps> = ({ requests, busy, onAction, cardStyle, inputStyle, btnPrimary, btnGhost, setExpanded, expandedId }) => {
  const [reviewState, setReviewState] = useState<Record<string, { items: any[]; notes: string }>>({});
  const [quoteForm, setQuoteForm] = useState<Record<string, any>>({});
  const [clarifyNote, setClarifyNote] = useState<Record<string, string>>({});
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});

  const stateFor = (r: AdminQuotationRequest) =>
    reviewState[r.id] || { items: r.items.map((i) => ({ ...i })), notes: r.notes || '' };

  const updateItem = (r: AdminQuotationRequest, index: number, patch: Partial<any>) => {
    setReviewState((prev) => {
      const current = prev[r.id] || { items: r.items.map((i) => ({ ...i })), notes: r.notes || '' };
      const items = current.items.map((i, idx) => (idx === index ? { ...i, ...patch } : i));
      return { ...prev, [r.id]: { ...current, items } };
    });
  };

  const saveReview = (r: AdminQuotationRequest) => {
    const state = stateFor(r);
    onAction(`save_${r.id}`, () =>
      adminLifecycle.requests.update(r.id, {
        items: state.items.map((i) => ({ name: i.name, quantity: Number(i.quantity) || 1, unitPrice: Number(i.unitPrice) || 0 })),
        notes: state.notes,
      })
    );
  };

  const generateQuote = (r: AdminQuotationRequest) => {
    const f = quoteForm[r.id] || { discount: 0, taxRate: 0, deliveryFee: 0, paymentTerms: 'Net 7', validUntil: '' };
    const state = stateFor(r);
    onAction(`quote_${r.id}`, () =>
      adminLifecycle.requests.generateQuotation(r.id, {
        items: state.items.map((i) => ({ name: i.name, quantity: Number(i.quantity) || 1, unitPrice: Number(i.unitPrice) || 0 })),
        discount: Number(f.discount) || 0,
        taxRate: Number(f.taxRate) || 0,
        deliveryFee: Number(f.deliveryFee) || 0,
        paymentTerms: f.paymentTerms || 'Net 7',
        validUntil: f.validUntil || null,
      })
    );
  };

  if (requests.length === 0) {
    return (
      <div style={cardStyle}>
        <p style={{ padding: 40, textAlign: 'center', fontSize: 13, color: muted }}>Inbox is clear — no pending requests.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {requests.map((r) => {
        const expanded = expandedId === r.id;
        const state = stateFor(r);
        const subtotal = state.items.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
        return (
          <div key={r.id} style={cardStyle}>
            <div
              onClick={() => setExpanded(expanded ? null : r.id)}
              style={{ padding: '16px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                <div style={{ background: teal.soft, color: teal.dark, borderRadius: 10, padding: 9, display: 'flex' }}>
                  <MessageSquare size={17} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 14, color: ink }}>{r.request_number}</b>
                    <StatusPill meta={requestStatusMeta} status={r.status} />
                  </div>
                  <p style={{ fontSize: 12.5, color: muted, margin: '3px 0 0' }}>
                    {r.customer_name} • {new Date(r.created_at).toLocaleString()} • {r.request_type || 'quotation'}
                    {r.quotation_id ? ' • Quotation issued' : ''}
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: ink }}>K {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <ChevronDown size={16} style={{ color: muted, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
              </div>
            </div>

            {expanded && (
              <div style={{ padding: '0 18px 18px', borderTop: `1px solid ${hairline}` }}>
                <div style={{ overflowX: 'auto', marginTop: 14 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ color: muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: .4 }}>
                        <th style={{ textAlign: 'left', padding: '6px 8px' }}>Item</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px' }}>Qty</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px' }}>Unit Price</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.items.map((item, idx) => (
                        <tr key={idx} style={{ borderTop: `1px solid ${hairline}` }}>
                          <td style={{ padding: '6px 8px' }}>
                            <input
                              value={item.name}
                              onChange={(e) => updateItem(r, idx, { name: e.target.value })}
                              style={{ ...inputStyle, minWidth: 180 }}
                            />
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                            <input
                              type="number"
                              min={1}
                              value={item.quantity}
                              onChange={(e) => updateItem(r, idx, { quantity: parseInt(e.target.value, 10) || 1 })}
                              style={{ ...inputStyle, width: 76, textAlign: 'right' }}
                            />
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                            <input
                              type="number"
                              min={0}
                              value={item.unitPrice}
                              onChange={(e) => updateItem(r, idx, { unitPrice: parseFloat(e.target.value) || 0 })}
                              style={{ ...inputStyle, width: 100, textAlign: 'right' }}
                            />
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            K {((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginTop: 12 }}>
                  <textarea
                    value={state.notes}
                    onChange={(e) => setReviewState((prev) => ({ ...prev, [r.id]: { ...state, notes: e.target.value } }))}
                    rows={2}
                    placeholder="Internal note for this request..."
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 13, color: muted }}>
                    Subtotal:{' '}
                    <b style={{ color: ink, fontSize: 15 }}>K {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => saveReview(r)}
                      disabled={busy === `save_${r.id}`}
                      style={{ ...btnGhost, opacity: busy === `save_${r.id}` ? .5 : 1 }}
                    >
                      {busy === `save_${r.id}` ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />} Save Review
                    </button>
                    <button
                      onClick={() => {
                        const reason = (rejectReason[r.id] || '').trim();
                        if (!reason) { setRejectReason((prev) => ({ ...prev, [r.id]: ' ' })); return; }
                        onAction(`reject_${r.id}`, () => adminLifecycle.requests.reject(r.id, reason));
                      }}
                      disabled={busy === `reject_${r.id}`}
                      style={{ ...btnGhost, color: '#b91c1c', borderColor: '#fecaca', background: '#fff7f7', opacity: busy === `reject_${r.id}` ? .5 : 1 }}
                    >
                      {busy === `reject_${r.id}` ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />} Reject
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginTop: 10 }}>
                  <div>
                    <input
                      value={rejectReason[r.id] || ''}
                      onChange={(e) => setRejectReason((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      placeholder="Rejection reason (required to reject)"
                      style={{ ...inputStyle, borderColor: rejectReason[r.id] === ' ' ? '#f87171' : hairline }}
                    />
                  </div>
                  <div>
                    <input
                      value={clarifyNote[r.id] || ''}
                      onChange={(e) => setClarifyNote((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      placeholder="Clarification note to send to the customer..."
                      style={inputStyle}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => {
                      const note = (clarifyNote[r.id] || '').trim();
                      if (!note) return;
                      onAction(`clarify_${r.id}`, () => adminLifecycle.requests.clarify(r.id, note));
                    }}
                    disabled={busy === `clarify_${r.id}`}
                    style={{ ...btnGhost, opacity: busy === `clarify_${r.id}` ? .5 : 1 }}
                  >
                    {busy === `clarify_${r.id}` ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />} Ask Customer
                  </button>
                </div>

                {/* Generate quotation */}
                <div style={{ background: '#f8fafc', border: `1px solid ${hairline}`, borderRadius: 12, padding: 14, marginTop: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <FileText size={15} style={{ color: teal.main }} />
                    <b style={{ fontSize: 13, color: ink }}>Generate Official Quotation</b>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                    {(['discount', 'taxRate', 'deliveryFee'] as const).map((field) => (
                      <div key={field}>
                        <label style={{ fontSize: 11, fontWeight: 700, color: muted, textTransform: 'capitalize', display: 'block', marginBottom: 4 }}>{field === 'taxRate' ? 'Tax Rate %' : field}</label>
                        <input
                          type="number"
                          min={0}
                          value={(quoteForm[r.id] || {})[field] ?? 0}
                          onChange={(e) => setQuoteForm((prev) => ({ ...prev, [r.id]: { ...(prev[r.id] || {}), [field]: e.target.value } }))}
                          style={inputStyle}
                        />
                      </div>
                    ))}
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: muted, display: 'block', marginBottom: 4 }}>Payment Terms</label>
                      <input
                        value={(quoteForm[r.id] || {}).paymentTerms || 'Net 7'}
                        onChange={(e) => setQuoteForm((prev) => ({ ...prev, [r.id]: { ...(prev[r.id] || {}), paymentTerms: e.target.value } }))}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: muted, display: 'block', marginBottom: 4 }}>Valid Until</label>
                      <input
                        type="date"
                        value={(quoteForm[r.id] || {}).validUntil || ''}
                        onChange={(e) => setQuoteForm((prev) => ({ ...prev, [r.id]: { ...(prev[r.id] || {}), validUntil: e.target.value } }))}
                        style={inputStyle}
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => generateQuote(r)}
                    disabled={busy === `quote_${r.id}`}
                    style={{ ...btnPrimary, marginTop: 12, opacity: busy === `quote_${r.id}` ? .6 : 1 }}
                  >
                    {busy === `quote_${r.id}` ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Generate Quotation
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/* ─── Quotations panel ───────────────────────────────────────── */

interface QuotePanelProps {
  quotations: AdminQuotation[];
  busy: string | null;
  onAction: (key: string, fn: () => Promise<any>) => void;
  cardStyle: React.CSSProperties;
  inputStyle: React.CSSProperties;
  btnPrimary: React.CSSProperties;
  btnGhost: React.CSSProperties;
}

const QuotationPanel: React.FC<QuotePanelProps> = ({ quotations, busy, onAction, cardStyle, inputStyle, btnPrimary, btnGhost }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [regenerateForm, setRegenerateForm] = useState<Record<string, any>>({});
  const [conversion, setConversion] = useState<Record<string, { deliveryDate: string; notes: string }>>({});
  if (quotations.length === 0) {
    return (
      <div style={cardStyle}>
        <p style={{ padding: 40, textAlign: 'center', fontSize: 13, color: muted }}>No official quotations yet.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {quotations.map((q) => {
        const open = expanded === q.id;
        return (
          <div key={q.id} style={cardStyle}>
            <div
              onClick={() => setExpanded(open ? null : q.id)}
              style={{ padding: '16px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ background: teal.soft, color: teal.dark, borderRadius: 10, padding: 9, display: 'flex' }}>
                  <FileText size={17} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <b style={{ fontSize: 14, color: ink }}>{q.quotation_number}</b>
                    <StatusPill meta={quotationStatusMeta} status={q.status} />
                  </div>
                  <p style={{ fontSize: 12.5, color: muted, margin: '3px 0 0' }}>
                    {q.customer_name} • {new Date(q.created_at).toLocaleDateString()}
                    {q.valid_until ? ` • valid until ${new Date(q.valid_until).toLocaleDateString()}` : ''}
                    {q.order_id ? ' • converted to order' : ''}
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: ink }}>K {Number(q.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <ChevronDown size={16} style={{ color: muted, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
              </div>
            </div>

            {open && (
              <div style={{ padding: '0 18px 18px', borderTop: `1px solid ${hairline}` }}>
                <div style={{ overflowX: 'auto', marginTop: 14 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ color: muted, fontSize: 11, textTransform: 'uppercase' }}>
                        <th style={{ textAlign: 'left', padding: '6px 8px' }}>Item</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px' }}>Qty</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px' }}>Unit Price</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(q.items || []).map((item, idx) => (
                        <tr key={idx} style={{ borderTop: `1px solid ${hairline}` }}>
                          <td style={{ padding: '6px 8px' }}>{item.name}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{item.quantity}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>K {Number(item.unitPrice).toFixed(2)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>K {Number(item.lineTotal ?? item.quantity * item.unitPrice).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, marginTop: 10, fontSize: 13 }}>
                  <span style={{ color: muted }}>Subtotal <b style={{ color: ink }}>K {Number(q.subtotal).toFixed(2)}</b></span>
                  {Number(q.discount) > 0 && <span style={{ color: muted }}>Discount <b style={{ color: ink }}>-K {Number(q.discount).toFixed(2)}</b></span>}
                  {Number(q.delivery_fee) > 0 && <span style={{ color: muted }}>Delivery <b style={{ color: ink }}>K {Number(q.delivery_fee).toFixed(2)}</b></span>}
                  <span style={{ color: ink, fontWeight: 800 }}>Total K {Number(q.total).toFixed(2)}</span>
                </div>
                {q.revision_note && (
                  <p style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', color: '#6d28d9', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, margin: '12px 0 0' }}>
                    <b>Customer change request:</b> {q.revision_note}
                  </p>
                )}
                {q.status === 'rejected' && q.rejection_reason && (
                  <p style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, margin: '12px 0 0' }}>
                    <b>Rejected:</b> {q.rejection_reason}
                  </p>
                )}

                {q.status === 'revision_requested' && (
                  <div style={{ background: '#f8fafc', border: `1px solid ${hairline}`, borderRadius: 12, padding: 14, marginTop: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <RefreshCw size={15} style={{ color: teal.main }} />
                      <b style={{ fontSize: 13, color: ink }}>Regenerate Quotation</b>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                      {(['discount', 'taxRate', 'deliveryFee'] as const).map((field) => (
                        <div key={field}>
                          <label style={{ fontSize: 11, fontWeight: 700, color: muted, textTransform: 'capitalize', display: 'block', marginBottom: 4 }}>{field === 'taxRate' ? 'Tax Rate %' : field}</label>
                          <input
                            type="number"
                            min={0}
                            value={(regenerateForm[q.id] || {})[field] ?? q[field === 'discount' ? 'discount' : field === 'taxRate' ? 'tax_rate' : 'delivery_fee']}
                            onChange={(e) => setRegenerateForm((prev) => ({ ...prev, [q.id]: { ...(prev[q.id] || {}), [field]: e.target.value } }))}
                            style={inputStyle}
                          />
                        </div>
                      ))}
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: muted, display: 'block', marginBottom: 4 }}>Valid Until</label>
                        <input
                          type="date"
                          value={(regenerateForm[q.id] || {}).validUntil || ''}
                          onChange={(e) => setRegenerateForm((prev) => ({ ...prev, [q.id]: { ...(prev[q.id] || {}), validUntil: e.target.value } }))}
                          style={inputStyle}
                        />
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        onAction(`regenerate_${q.id}`, () => {
                          const f = regenerateForm[q.id] || {};
                          return adminLifecycle.quotations.regenerate(q.id, {
                            discount: Number(f.discount ?? q.discount) || 0,
                            taxRate: Number(f.taxRate ?? q.tax_rate) || 0,
                            deliveryFee: Number(f.deliveryFee ?? q.delivery_fee) || 0,
                            validUntil: f.validUntil || null,
                          });
                        })
                      }
                      disabled={busy === `regenerate_${q.id}`}
                      style={{ ...btnPrimary, marginTop: 12, opacity: busy === `regenerate_${q.id}` ? .6 : 1 }}
                    >
                      {busy === `regenerate_${q.id}` ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Regenerate Quotation
                    </button>
                  </div>
                )}

                {q.status === 'accepted' && (
                  <div style={{ background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: 12, padding: 14, marginTop: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <CheckCircle2 size={15} style={{ color: teal.main }} />
                      <b style={{ fontSize: 13, color: ink }}>Customer accepted — convert to order</b>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: muted, display: 'block', marginBottom: 4 }}>Delivery Date</label>
                        <input
                          type="date"
                          value={(conversion[q.id] || {}).deliveryDate || ''}
                          onChange={(e) => setConversion((prev) => ({ ...prev, [q.id]: { ...(prev[q.id] || { deliveryDate: '', notes: '' }), deliveryDate: e.target.value } }))}
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: muted, display: 'block', marginBottom: 4 }}>Notes</label>
                        <input
                          value={(conversion[q.id] || {}).notes || ''}
                          onChange={(e) => setConversion((prev) => ({ ...prev, [q.id]: { ...(prev[q.id] || { deliveryDate: '', notes: '' }), notes: e.target.value } }))}
                          placeholder="Optional order notes"
                          style={inputStyle}
                        />
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        onAction(`convert_${q.id}`, () => {
                          const c = conversion[q.id] || { deliveryDate: '', notes: '' };
                          return adminLifecycle.quotations.convertToOrder(q.id, { deliveryDate: c.deliveryDate || undefined, notes: c.notes || undefined });
                        })
                      }
                      disabled={busy === `convert_${q.id}`}
                      style={{ ...btnPrimary, marginTop: 12, opacity: busy === `convert_${q.id}` ? .6 : 1 }}
                    >
                      {busy === `convert_${q.id}` ? <Loader2 size={14} className="animate-spin" /> : <ArrowUpRight size={14} />} Convert to Order
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default QuotationRequests;
