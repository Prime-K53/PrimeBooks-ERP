import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, CheckCircle2, XCircle, FileText, RefreshCw, Loader2, MessageSquare,
  PackageCheck, Inbox, History, ChevronDown, ArrowUpRight,
} from 'lucide-react';
import {
  adminLifecycle, subscribeAdminEvents,
  AdminQuotationRequest, AdminQuotation, AdminNotification, AdminRequestStatus,
} from '../../services/adminPortalClient';

const teal = {
  50: '#eef7f6', 100: '#d3ece9', 200: '#a6d9d3', 300: '#72c0b7',
  400: '#3fa294', 500: '#1f8577', 600: '#146b60', 700: '#0f544c',
  800: '#0b3e39', 900: '#082e2a'
};
const amber = { 100: '#fbead0', 300: '#eec27a', 500: '#d99a3f', 600: '#b97e2b' };
const paper = '#FEFDFB';
const ink = '#23282A';
const inkSoft = '#5c6567';
const hairline = '#e4ddd1';
const danger = '#b5493f';

const REQUEST_TABS = [
  { key: 'inbox', label: 'Inbox', icon: Inbox, statuses: ['submitted', 'assigned', 'under_review', 'waiting_for_customer', 'ready_for_conversion'] },
  { key: 'quotations', label: 'Quotations', icon: FileText, statuses: [] },
  { key: 'history', label: 'History', icon: History, statuses: ['rejected', 'cancelled', 'converted'] },
] as const;

const INBOX_STATUSES: AdminRequestStatus[] = ['submitted', 'assigned', 'under_review', 'waiting_for_customer', 'ready_for_conversion'];

const requestStatusMeta: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: '#64748b', bg: '#f1f5f9' },
  submitted: { label: 'Submitted', color: '#1d4ed8', bg: '#eff6ff' },
  assigned: { label: 'Assigned', color: '#0f766e', bg: '#f0fdfa' },
  under_review: { label: 'Under Review', color: '#b45309', bg: '#fffbeb' },
  waiting_for_customer: { label: 'Waiting for Customer', color: '#7c3aed', bg: '#f5f3ff' },
  ready_for_conversion: { label: 'Ready for Conversion', color: '#047857', bg: '#ecfdf5' },
  converted: { label: 'Converted', color: '#0f766e', bg: '#f0fdfa' },
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

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%235c6567'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  paddingRight: 30,
  cursor: 'pointer'
};

const sectionLabelStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  margin: '26px 0 14px'
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
  const [customerNameMap, setCustomerNameMap] = useState<Record<string, string>>({});
  const [staff, setStaff] = useState<{ id: string; username: string; email: string | null }[]>([]);
  const [staffNameMap, setStaffNameMap] = useState<Record<string, string>>({});

  const bellRef = useRef<HTMLDivElement | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [reqs, quotes, notifs, analyticsData, users, staffList] = await Promise.all([
        adminLifecycle.requests.list(),
        adminLifecycle.quotations.list(),
        adminLifecycle.notifications.list(),
        adminLifecycle.analytics.get(),
        adminLifecycle.users.list().catch(() => []),
        adminLifecycle.staff.list().catch(() => []),
      ]);
      setRequests(reqs || []);
      setQuotations(quotes || []);
      setNotifications(notifs || []);
      setAnalytics(analyticsData);
      const nameMap: Record<string, string> = {};
      for (const u of (users as any[]) || []) {
        if (u.customer_id && u.customer_name) {
          nameMap[u.customer_id] = u.customer_name;
        }
      }
      setCustomerNameMap(nameMap);
      const sMap: Record<string, string> = {};
      for (const s of staffList || []) {
        sMap[s.id] = s.username;
      }
      setStaff(staffList || []);
      setStaffNameMap(sMap);
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
  const inboxCount = useMemo(
    () => requests.filter((r) => INBOX_STATUSES.includes(r.status)).length,
    [requests]
  );

  const activeRequests = useMemo(() => {
    if (tab === 'history') return requests.filter((r) => r.status === 'rejected' || r.status === 'cancelled' || r.status === 'converted');
    return requests.filter((r) => INBOX_STATUSES.includes(r.status));
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

  /**
   * "Generate Quotation" does not create a quotation and does not reserve a
   * number. It marks the request ready for conversion and opens the STANDARD
   * ERP quotation editor pre-filled with the request.
   */
  const startQuoteFlow = async (r: AdminQuotationRequest) => {
    setBusy(`quote_${r.id}`);
    setError(null);
    try {
      const prefill = await adminLifecycle.requests.startQuotation(r.id);
      navigate('/sales-flow/quotations', { state: { action: 'create', quotationPrefill: prefill } });
    } catch (err: any) {
      setError(err.message || 'Failed to start quotation generation');
    } finally {
      setBusy(null);
    }
  };

  const btnPrimary: React.CSSProperties = {
    fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
    padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid transparent',
    background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
    color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 7,
    boxShadow: '0 6px 16px -6px rgba(15,84,76,.55)',
    transition: 'all .15s ease'
  };

  const btnGhost: React.CSSProperties = {
    fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
    padding: '9px 18px', borderRadius: 9, cursor: 'pointer',
    background: paper, border: `1.4px solid ${hairline}`, color: inkSoft,
    display: 'inline-flex', alignItems: 'center', gap: 7, transition: 'all .15s ease'
  };

  const cardStyle: React.CSSProperties = {
    background: paper, border: `1.4px solid ${hairline}`, borderRadius: 14,
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
  };

  const chipStyle = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 10,
    fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none',
    background: active ? teal[500] : '#eef1f4',
    color: active ? '#ffffff' : '#475569', transition: 'all .15s ease',
  });

  if (loading) {
    return (
      <div style={{ padding: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 10px -3px rgba(15,84,76,.6)'
        }}>
          <Loader2 size={20} color="#fff" className="animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 28, maxWidth: 1100, margin: '0 auto' }}>
      {/* Accent stripe */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 4,
        background: `linear-gradient(90deg, ${teal[600]}, ${teal[400]} 40%, ${amber[500]} 100%)`
      }} />

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, marginBottom: 20, flexWrap: 'wrap',
        position: 'relative'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 10px -3px rgba(15,84,76,.6)', flexShrink: 0
          }}>
            <FileText size={19} color="#fff" />
          </div>
          <div>
            <h1 style={{
              fontFamily: "'DM Serif Display', 'Georgia', serif", fontWeight: 400,
              fontSize: 22, margin: 0, color: teal[800], letterSpacing: 0.2
            }}>
              Quotation Requests
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 11.5, color: inkSoft, letterSpacing: 0.02 }}>
              Review customer requests, issue official quotations, and convert accepted quotes into orders.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }} ref={bellRef}>
          {analytics && (
            <span style={{ fontSize: 12, color: inkSoft }}>
              <b style={{ color: ink }}>{analytics.totalRequests || 0}</b> requests •{' '}
              <b style={{ color: ink }}>{analytics.convertedQuotations || 0}</b> converted •{' '}
              <b style={{ color: ink }}>{analytics.totalDownloads || 0}</b> downloads
            </span>
          )}
          <button
            onClick={() => setBellOpen((v) => !v)}
            style={{ position: 'relative', background: paper, border: `1.4px solid ${hairline}`, borderRadius: 9, padding: '8px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'all .15s ease' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.color = teal[700]; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.color = inkSoft; }}
          >
            <Bell size={17} style={{ color: inkSoft }} />
            {unread > 0 && (
              <span style={{ position: 'absolute', top: -6, right: -6, background: '#e11d48', color: '#fff', fontSize: 10, fontWeight: 800, minWidth: 18, height: 18, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {unread}
              </span>
            )}
          </button>
          {bellOpen && (
            <div style={{ position: 'absolute', top: 46, right: 0, width: 340, maxHeight: 420, overflowY: 'auto', background: paper, border: `1.4px solid ${hairline}`, borderRadius: 14, boxShadow: '0 12px 40px rgba(15,23,42,.14)', zIndex: 60 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: `1px solid ${hairline}` }}>
                <b style={{ fontSize: 13, color: ink }}>Notifications</b>
                <button onClick={markAllRead} style={{ fontSize: 11, fontWeight: 700, color: teal[600], background: 'none', border: 'none', cursor: 'pointer' }}>
                  Mark all read
                </button>
              </div>
              {notifications.length === 0 ? (
                <p style={{ padding: 20, textAlign: 'center', fontSize: 12, color: inkSoft }}>No notifications yet.</p>
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
                      borderBottom: `1px solid ${hairline}`, background: n.is_read ? paper : teal[50], cursor: 'pointer', borderLeft: `3px solid ${n.is_read ? 'transparent' : teal[400]}`, transition: 'background .15s'
                    }}
                    onMouseEnter={e => { if (!n.is_read) e.currentTarget.style.background = teal[100]; }}
                    onMouseLeave={e => { e.currentTarget.style.background = n.is_read ? paper : teal[50]; }}
                  >
                    <p style={{ fontSize: 12.5, fontWeight: 700, color: ink, margin: 0 }}>{n.title}</p>
                    <p style={{ fontSize: 11.5, color: inkSoft, margin: '2px 0 0' }}>{n.body}</p>
                    <p style={{ fontSize: 10, color: inkSoft, margin: '4px 0 0' }}>{new Date(n.created_at).toLocaleString()}</p>
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

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {REQUEST_TABS.map((t) => {
          const count = t.key === 'inbox' ? inboxCount : t.key === 'quotations' ? quotations.length : requests.filter((r) => r.status === 'rejected' || r.status === 'cancelled' || r.status === 'converted').length;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={chipStyle(tab === t.key)}>
              <t.icon size={15} /> {t.label}
              {count > 0 && <span style={{ background: tab === t.key ? 'rgba(255,255,255,.22)' : '#e2e8f0', borderRadius: 999, padding: '1px 8px', fontSize: 11 }}>{count}</span>}
            </button>
          );
        })}
      </div>

      {tab === 'inbox' && <RequestInbox requests={activeRequests} busy={busy} onAction={action} cardStyle={cardStyle} inputStyle={inputStyle} btnPrimary={btnPrimary} btnGhost={btnGhost} setExpanded={setExpandedId} expandedId={expandedId} customerNameMap={customerNameMap} staff={staff} staffNameMap={staffNameMap} onGenerateQuote={startQuoteFlow} />}
      {tab === 'quotations' && <QuotationPanel quotations={quotations} busy={busy} onAction={action} cardStyle={cardStyle} inputStyle={inputStyle} btnPrimary={btnPrimary} btnGhost={btnGhost} customerNameMap={customerNameMap} />}
      {tab === 'history' && (
        <div style={cardStyle}>
          {activeRequests.length === 0 ? (
            <p style={{ padding: 40, textAlign: 'center', fontSize: 13, color: inkSoft }}>No rejected, cancelled or converted requests.</p>
          ) : (
            activeRequests.map((r) => (
              <div key={r.id} style={{ padding: 16, borderBottom: `1px solid ${hairline}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <b style={{ fontSize: 13.5, color: ink }}>{r.request_number}</b>
                  <span style={{ fontSize: 12, color: inkSoft, marginLeft: 10 }}>{customerNameMap[r.customer_id] || r.customer_name || 'Unknown Customer'}</span>
                  <span style={{ fontSize: 12, color: inkSoft, marginLeft: 10 }}>{new Date(r.created_at).toLocaleDateString()}</span>
                  {r.review_note && <p style={{ fontSize: 12, color: inkSoft, margin: '4px 0 0' }}>Reason: {r.review_note}</p>}
                  {r.status === 'converted' && r.quotation_number && (
                    <p style={{ fontSize: 12, color: teal[700], margin: '4px 0 0' }}>
                      Official quotation: <b>{r.quotation_number}</b>
                    </p>
                  )}
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
  customerNameMap: Record<string, string>;
  staff: { id: string; username: string }[];
  staffNameMap: Record<string, string>;
  onGenerateQuote: (r: AdminQuotationRequest) => void;
}

const RequestInbox: React.FC<PanelProps> = ({ requests, busy, onAction, cardStyle, inputStyle, btnPrimary, btnGhost, setExpanded, expandedId, customerNameMap, staff, staffNameMap, onGenerateQuote }) => {
  const [reviewState, setReviewState] = useState<Record<string, { items: any[]; notes: string }>>({});
  const [clarifyNote, setClarifyNote] = useState<Record<string, string>>({});
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const [assignTo, setAssignTo] = useState<Record<string, string>>({});
  const [assignName, setAssignName] = useState<Record<string, string>>({});

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

  const assignSales = (r: AdminQuotationRequest) => {
    const salesId = assignTo[r.id] || r.assigned_to || '';
    if (!salesId) return;
    const salesName = assignName[r.id] || staff.find((s) => s.id === salesId)?.username || salesId;
    onAction(`assign_${r.id}`, () =>
      adminLifecycle.requests.assign(r.id, { assignTo: salesId, assignToName: salesName })
    );
  };

  if (requests.length === 0) {
    return (
      <div style={cardStyle}>
        <p style={{ padding: 40, textAlign: 'center', fontSize: 13, color: inkSoft }}>Inbox is clear — no pending requests.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {requests.map((r) => {
        const expanded = expandedId === r.id;
        const state = stateFor(r);
        const subtotal = state.items.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
        const assignedName = staffNameMap[r.assigned_to || ''] || r.assigned_to || '';
        const canEdit = r.status !== 'ready_for_conversion' && r.status !== 'converted';
        return (
          <div key={r.id} style={{ ...cardStyle, overflow: 'hidden' }}>
            <div
              onClick={() => setExpanded(expanded ? null : r.id)}
              style={{ padding: '16px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                <div style={{ background: teal[50], color: teal[700], borderRadius: 10, padding: 9, display: 'flex' }}>
                  <MessageSquare size={17} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 14, color: ink }}>{r.request_number}</b>
                    <StatusPill meta={requestStatusMeta} status={r.status} />
                    {r.status === 'converted' && r.quotation_number && (
                      <span style={{ fontSize: 12, color: teal[700], fontWeight: 700 }}>→ {r.quotation_number}</span>
                    )}
                  </div>
                  <p style={{ fontSize: 12.5, color: inkSoft, margin: '3px 0 0' }}>
                    {customerNameMap[r.customer_id] || r.customer_name || 'Unknown Customer'} • {new Date(r.created_at).toLocaleDateString()} • {r.request_type || 'quotation'}
                    {assignedName ? ` • Assigned: ${assignedName}` : ''}
                    {r.review_note ? ` • Reason: ${r.review_note}` : ''}
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: ink, fontFamily: "'JetBrains Mono', monospace" }}>K {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <ChevronDown size={16} style={{ color: inkSoft, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
              </div>
            </div>

            {expanded && (
              <div style={{ padding: '0 18px 18px', borderTop: `1px solid ${hairline}` }}>
                <div style={{ overflowX: 'auto', marginTop: 14 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: teal[50] }}>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 700, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>Item</th>
                        <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 10, fontWeight: 700, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>Qty</th>
                        <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 10, fontWeight: 700, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>Unit Price</th>
                        <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 10, fontWeight: 700, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.items.map((item, idx) => (
                        <tr key={idx} style={{ borderTop: `1px solid ${hairline}` }}>
                          <td style={{ padding: '8px 12px' }}>
                            {canEdit ? (
                              <input
                                value={item.name}
                                onChange={(e) => updateItem(r, idx, { name: e.target.value })}
                                style={{ ...inputStyle, minWidth: 180 }}
                                onFocus={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.boxShadow = `0 0 0 3px ${teal[50]}`; }}
                                onBlur={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.boxShadow = 'none'; }}
                              />
                            ) : (
                              <span style={{ fontWeight: 600, color: ink }}>{item.name}</span>
                            )}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                            {canEdit ? (
                              <input
                                type="number"
                                min={1}
                                value={item.quantity}
                                onChange={(e) => updateItem(r, idx, { quantity: parseInt(e.target.value, 10) || 1 })}
                                style={{ ...inputStyle, width: 76, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}
                                onFocus={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.boxShadow = `0 0 0 3px ${teal[50]}`; }}
                                onBlur={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.boxShadow = 'none'; }}
                              />
                            ) : (
                              <span>{item.quantity}</span>
                            )}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                            {canEdit ? (
                              <input
                                type="number"
                                min={0}
                                value={item.unitPrice}
                                onChange={(e) => updateItem(r, idx, { unitPrice: parseFloat(e.target.value) || 0 })}
                                style={{ ...inputStyle, width: 100, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}
                                onFocus={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.boxShadow = `0 0 0 3px ${teal[50]}`; }}
                                onBlur={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.boxShadow = 'none'; }}
                              />
                            ) : (
                              <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{Number(item.unitPrice).toFixed(2)}</span>
                            )}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', fontFamily: "'JetBrains Mono', monospace" }}>
                            K {((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {canEdit && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginTop: 12 }}>
                      <textarea
                        value={state.notes}
                        onChange={(e) => setReviewState((prev) => ({ ...prev, [r.id]: { ...state, notes: e.target.value } }))}
                        rows={2}
                        placeholder="Internal note for this request..."
                        style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', minHeight: 66, lineHeight: 1.5 }}
                      />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 13, color: inkSoft }}>
                        Subtotal:{' '}
                        <b style={{ color: ink, fontSize: 15, fontFamily: "'JetBrains Mono', monospace" }}>K {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          onClick={() => saveReview(r)}
                          disabled={busy === `save_${r.id}`}
                          style={{ ...btnGhost, opacity: busy === `save_${r.id}` ? .5 : 1 }}
                          onMouseEnter={e => { e.currentTarget.style.background = teal[50]; e.currentTarget.style.color = teal[800]; e.currentTarget.style.borderColor = teal[200]; }}
                          onMouseLeave={e => { e.currentTarget.style.background = paper; e.currentTarget.style.color = inkSoft; e.currentTarget.style.borderColor = hairline; }}
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
                          style={{ ...btnGhost, color: danger, borderColor: '#fecaca', background: '#fff7f7', opacity: busy === `reject_${r.id}` ? .5 : 1 }}
                          onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.borderColor = '#fca5a5'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = '#fff7f7'; e.currentTarget.style.borderColor = '#fecaca'; }}
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
                        onMouseEnter={e => { e.currentTarget.style.background = teal[50]; e.currentTarget.style.color = teal[800]; e.currentTarget.style.borderColor = teal[200]; }}
                        onMouseLeave={e => { e.currentTarget.style.background = paper; e.currentTarget.style.color = inkSoft; e.currentTarget.style.borderColor = hairline; }}
                      >
                        {busy === `clarify_${r.id}` ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />} Ask Customer
                      </button>
                    </div>
                  </>
                )}

                {/* Assign salesperson */}
                <div style={{ background: '#f8fafc', border: `1px solid ${hairline}`, borderRadius: 12, padding: 14, marginTop: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <PackageCheck size={15} style={{ color: teal[600] }} />
                    <b style={{ fontSize: 13, color: ink }}>Assign Salesperson</b>
                    {assignedName && <span style={{ fontSize: 12, color: teal[700], fontWeight: 600 }}>Current: {assignedName}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <select
                      value={assignTo[r.id] || r.assigned_to || ''}
                      onChange={(e) => {
                        const id = e.target.value;
                        setAssignTo((prev) => ({ ...prev, [r.id]: id }));
                        setAssignName((prev) => ({ ...prev, [r.id]: staff.find((s) => s.id === id)?.username || '' }));
                      }}
                      style={{ ...selectStyle, flex: 1, minWidth: 220 }}
                    >
                      <option value="">Select salesperson...</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>{s.username}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => assignSales(r)}
                      disabled={busy === `assign_${r.id}` || !(assignTo[r.id] || r.assigned_to)}
                      style={{ ...btnGhost, opacity: busy === `assign_${r.id}` ? .5 : 1 }}
                      onMouseEnter={e => { e.currentTarget.style.background = teal[50]; e.currentTarget.style.color = teal[800]; e.currentTarget.style.borderColor = teal[200]; }}
                      onMouseLeave={e => { e.currentTarget.style.background = paper; e.currentTarget.style.color = inkSoft; e.currentTarget.style.borderColor = hairline; }}
                    >
                      {busy === `assign_${r.id}` ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />} Assign
                    </button>
                  </div>
                </div>

                {/* Generate quotation → standard ERP quotation editor */}
                <div style={{ background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: 12, padding: 14, marginTop: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <FileText size={15} style={{ color: teal[600] }} />
                    <b style={{ fontSize: 13, color: ink }}>
                      {r.status === 'ready_for_conversion' ? 'Quotation Editor' : 'Generate Official Quotation'}
                    </b>
                  </div>
                  <p style={{ fontSize: 12, color: inkSoft, margin: 0, lineHeight: 1.5 }}>
                    Opens the standard quotation editor pre-filled with this request. No quotation number is reserved until you save — the
                    official quotation is linked to <b>{r.request_number}</b> on save, and the customer is notified automatically.
                  </p>
                  <button
                    onClick={() => onGenerateQuote(r)}
                    disabled={busy === `quote_${r.id}`}
                    style={{ ...btnPrimary, marginTop: 12, opacity: busy === `quote_${r.id}` ? .6 : 1 }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 20px -6px rgba(15,84,76,.65)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 6px 16px -6px rgba(15,84,76,.55)'; }}
                  >
                    {busy === `quote_${r.id}` ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                    {r.status === 'ready_for_conversion' ? 'Open Quotation Editor' : 'Generate Quotation'}
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
  customerNameMap: Record<string, string>;
}

const QuotationPanel: React.FC<QuotePanelProps> = ({ quotations, busy, onAction, cardStyle, inputStyle, btnPrimary, btnGhost, customerNameMap }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [regenerateForm, setRegenerateForm] = useState<Record<string, any>>({});
  const [conversion, setConversion] = useState<Record<string, { deliveryDate: string; notes: string }>>({});
  if (quotations.length === 0) {
    return (
      <div style={cardStyle}>
        <p style={{ padding: 40, textAlign: 'center', fontSize: 13, color: inkSoft }}>No official quotations yet.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {quotations.map((q) => {
        const open = expanded === q.id;
        return (
          <div key={q.id} style={{ ...cardStyle, overflow: 'hidden' }}>
            <div
              onClick={() => setExpanded(open ? null : q.id)}
              style={{ padding: '16px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ background: teal[50], color: teal[700], borderRadius: 10, padding: 9, display: 'flex' }}>
                  <FileText size={17} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <b style={{ fontSize: 14, color: ink }}>{q.quotation_number}</b>
                    <StatusPill meta={quotationStatusMeta} status={q.status} />
                  </div>
                  <p style={{ fontSize: 12.5, color: inkSoft, margin: '3px 0 0' }}>
                    {customerNameMap[q.customer_id] || q.customer_name || 'Unknown Customer'} • {new Date(q.created_at).toLocaleDateString()}
                    {q.valid_until ? ` • valid until ${new Date(q.valid_until).toLocaleDateString()}` : ''}
                    {q.order_id ? ' • converted to order' : ''}
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: ink, fontFamily: "'JetBrains Mono', monospace" }}>K {Number(q.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <ChevronDown size={16} style={{ color: inkSoft, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
              </div>
            </div>

            {open && (
              <div style={{ padding: '0 18px 18px', borderTop: `1px solid ${hairline}` }}>
                <div style={{ overflowX: 'auto', marginTop: 14 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: teal[50] }}>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 700, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>Item</th>
                        <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 10, fontWeight: 700, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>Qty</th>
                        <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 10, fontWeight: 700, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>Unit Price</th>
                        <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 10, fontWeight: 700, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(q.items || []).map((item, idx) => (
                        <tr key={idx} style={{ borderTop: `1px solid ${hairline}` }}>
                          <td style={{ padding: '8px 12px', fontWeight: 600, color: ink }}>{item.name}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{item.quantity}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>K {Number(item.unitPrice).toFixed(2)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>K {Number(item.lineTotal ?? item.quantity * item.unitPrice).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, marginTop: 10, fontSize: 13 }}>
                  <span style={{ color: inkSoft }}>Subtotal <b style={{ color: ink, fontFamily: "'JetBrains Mono', monospace" }}>K {Number(q.subtotal).toFixed(2)}</b></span>
                  {Number(q.discount) > 0 && <span style={{ color: inkSoft }}>Discount <b style={{ color: ink, fontFamily: "'JetBrains Mono', monospace" }}>-K {Number(q.discount).toFixed(2)}</b></span>}
                  {Number(q.delivery_fee) > 0 && <span style={{ color: inkSoft }}>Delivery <b style={{ color: ink, fontFamily: "'JetBrains Mono', monospace" }}>K {Number(q.delivery_fee).toFixed(2)}</b></span>}
                  <span style={{ color: ink, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace" }}>Total K {Number(q.total).toFixed(2)}</span>
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
                      <RefreshCw size={15} style={{ color: teal[600] }} />
                      <b style={{ fontSize: 13, color: ink }}>Regenerate Quotation</b>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                      {(['discount', 'taxRate', 'deliveryFee'] as const).map((field) => (
                        <div key={field}>
                          <label style={{ ...labelStyle, marginBottom: 4 }}>{field === 'taxRate' ? 'Tax Rate %' : field}</label>
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
                        <label style={{ ...labelStyle, marginBottom: 4 }}>Valid Until</label>
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
                      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 20px -6px rgba(15,84,76,.65)'; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 6px 16px -6px rgba(15,84,76,.55)'; }}
                    >
                      {busy === `regenerate_${q.id}` ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Regenerate Quotation
                    </button>
                  </div>
                )}

                {q.status === 'accepted' && (
                  <div style={{ background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: 12, padding: 14, marginTop: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <CheckCircle2 size={15} style={{ color: teal[600] }} />
                      <b style={{ fontSize: 13, color: ink }}>Customer accepted — convert to order</b>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                      <div>
                        <label style={{ ...labelStyle, marginBottom: 4 }}>Delivery Date</label>
                        <input
                          type="date"
                          value={(conversion[q.id] || {}).deliveryDate || ''}
                          onChange={(e) => setConversion((prev) => ({ ...prev, [q.id]: { ...(prev[q.id] || { deliveryDate: '', notes: '' }), deliveryDate: e.target.value } }))}
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={{ ...labelStyle, marginBottom: 4 }}>Notes</label>
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
                      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 20px -6px rgba(15,84,76,.65)'; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 6px 16px -6px rgba(15,84,76,.55)'; }}
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
