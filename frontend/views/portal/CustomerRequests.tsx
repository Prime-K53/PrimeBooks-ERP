import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Plus, Loader2, ArrowUpRight, Search } from 'lucide-react';
import { portalLifecycle, QuotationRequestRecord } from '../../services/portalApiClient';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { useToast } from './hooks/useConfirmDialog';
import PortalPageHeader from './components/PortalPageHeader';
import PortalCard from './components/PortalCard';
import PortalButton from './components/PortalButton';
import PortalInput from './components/PortalInput';
import EmptyState from './components/EmptyState';
import StatusBadge from './components/StatusBadge';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { portalTheme, REQUEST_STATUS_META, DEFAULT_PAGE_SIZE, FRIENDLY_STATUS_MAP } from '../constants';

const CustomerRequests: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useCustomerAuth();
  const { addToast } = useToast();
  const [requests, setRequests] = useState<QuotationRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [confirmState, setConfirmState] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await portalLifecycle.requests.list({ page, pageSize: DEFAULT_PAGE_SIZE, search: search || undefined, status: statusFilter || undefined });
      if ('requests' in data) {
        setRequests(data.requests);
        setTotalPages(data.totalPages);
        setTotal(data.total);
      } else {
        setRequests(data);
        setTotalPages(1);
        setTotal(data.length);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const sub = await portalLifecycle.subscribe({
      onEvent: (type, payload) => {
        if (type === 'entity_changed' && payload.docType === 'request') load();
      },
    });
    return sub;
  }, [load]);

  const handleCancelClick = (id: string) => {
    setConfirmState({ open: true, id });
  };

  const handleCancelConfirm = async () => {
    if (!confirmState.id) return;
    const id = confirmState.id;
    setConfirmState({ open: false, id: null });
    setCancellingId(id);
    try {
      await portalLifecycle.requests.cancel(id);
      addToast('success', 'Request cancelled successfully');
      await load();
    } catch (err: any) {
      addToast('error', err.message || 'Failed to cancel request');
    } finally {
      setCancellingId(null);
    }
  };

  const sorted = useMemo(
    () => [...requests].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()),
    [requests]
  );

  const statusOptions = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of requests) {
      const raw = r.status || '';
      const friendly = FRIENDLY_STATUS_MAP[raw] || raw;
      if (friendly && !map[friendly]) map[friendly] = raw;
    }
    return map;
  }, [requests]);

  if (loading && page === 1) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={6} /></div>;

  return (
    <div style={{
      background: portalTheme.paper,
      borderRadius: 14,
      overflow: 'hidden'
    }}>
      <PortalPageHeader
        title="Requests"
        subtitle="Track your quotation and order requests"
        icon={ClipboardList}
        action={{ label: 'New Request', onClick: () => navigate('/portal/new-request'), icon: Plus }}
      />

      <div style={{ padding: '20px 28px 8px' }}>
        {error && (
          <div className="mb-5">
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 12, padding: '12px 16px', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{error}</span>
              <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', padding: 2 }} aria-label="Dismiss error"><ArrowUpRight size={14} style={{ transform: 'rotate(45deg)' }} /></button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 240px' }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: portalTheme.inkSoft }} />
            <PortalInput
              label=""
              placeholder="Search requests..."
              value={search}
              onChange={(v) => { setPage(1); setSearch(v); }}
              onFocus={() => {}}
              onBlur={() => {}}
              style={{ paddingLeft: 32 }}
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setPage(1); setStatusFilter(e.target.value); }}
            style={{
              fontFamily: "'Inter', sans-serif", fontSize: 13, padding: '10px 32px 10px 12px',
              border: '1.4px solid #e4ddd1', borderRadius: 9, background: '#FEFDFB', color: '#23282A',
              appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%235c6567'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', cursor: 'pointer',
            }}
          >
            <option value="">All Statuses</option>
            {Object.entries(statusOptions).map(([label, raw]) => (
              <option key={raw} value={raw}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ padding: '16px 28px 28px' }}>
        {sorted.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No requests yet"
            description="Submit a quotation or order request and track it here."
            action={{ label: 'New Request', onClick: () => navigate('/portal/new-request') }}
          />
        ) : (
          <>
            <div style={{ fontSize: 11, color: portalTheme.inkSoft, marginBottom: 8 }}>
              Showing {requests.length} of {total} request{total !== 1 ? 's' : ''}
            </div>
            <div className="space-y-2">
              {sorted.map((r) => {
                const itemCount = (r.items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0);
                const friendlyStatus = FRIENDLY_STATUS_MAP[r.status] || r.status;
                return (
                  <PortalCard key={r.id} hoverable onClick={() => navigate(`/portal/requests/${r.id}`)}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: 1 }}>
                        <div style={{
                          padding: 8, borderRadius: 10,
                          background: portalTheme.teal[50], color: portalTheme.teal[600], flexShrink: 0
                        }}>
                          <ClipboardList size={18} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontWeight: 500, fontSize: 13, color: portalTheme.ink, margin: 0 }}>{r.request_number}</p>
                          <p style={{ fontSize: 11, color: portalTheme.inkSoft, marginTop: 2 }}>
                            {new Date(r.created_at).toLocaleDateString()} • {itemCount} item{itemCount === 1 ? '' : 's'} • K {Number(r.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                          {r.quotation_number && (
                            <span className="inline-flex items-center gap-1 mt-1 text-xs font-semibold" style={{ color: portalTheme.teal[600] }}>
                              Quotation {r.quotation_number} issued <ArrowUpRight size={12} />
                            </span>
                          )}
                          {!r.quotation_number && r.quotation_id && (
                            <span className="inline-flex items-center gap-1 mt-1 text-xs font-semibold" style={{ color: portalTheme.teal[600] }}>
                              Quotation ready <ArrowUpRight size={12} />
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                        <StatusBadge status={friendlyStatus} />
                        {(r.status === 'submitted' || r.status === 'assigned' || r.status === 'under_review' || r.status === 'waiting_for_customer') && (
                          <PortalButton
                            variant="ghost"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); handleCancelClick(r.id); }}
                            disabled={cancellingId === r.id}
                            style={{ color: portalTheme.danger, border: `1.4px solid ${portalTheme.hairline}` }}
                          >
                            {cancellingId === r.id ? <Loader2 size={12} className="animate-spin" /> : 'Cancel'}
                          </PortalButton>
                        )}
                      </div>
                    </div>
                  </PortalCard>
                );
              })}
            </div>
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, fontSize: 12, color: portalTheme.inkSoft }}>
                <span>Page {page} of {totalPages}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={{
                    padding: '6px 12px', borderRadius: 8, border: `1.4px solid ${portalTheme.hairline}`, background: portalTheme.paper, cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.5 : 1, fontSize: 12, color: portalTheme.ink
                  }}>Previous</button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{
                    padding: '6px 12px', borderRadius: 8, border: `1.4px solid ${portalTheme.hairline}`, background: portalTheme.paper, cursor: page >= totalPages ? 'not-allowed' : 'pointer', opacity: page >= totalPages ? 0.5 : 1, fontSize: 12, color: portalTheme.ink
                  }}>Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ConfirmDialog for cancel action */}
      {confirmState.open && (
        <div className="confirm-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmState({ open: false, id: null }); }}>
          <div className="confirm-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="cancel-request-title">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid #e4ddd1' }}>
              <h2 id="cancel-request-title" style={{ fontSize: 16, fontWeight: 700, color: portalTheme.ink, margin: 0 }}>Cancel Request</h2>
              <button onClick={() => setConfirmState({ open: false, id: null })} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 8, color: portalTheme.inkSoft }} aria-label="Close dialog"><ArrowUpRight size={18} style={{ transform: 'rotate(45deg)' }} /></button>
            </div>
            <div style={{ padding: '18px 22px', fontSize: 14, color: portalTheme.inkSoft, lineHeight: 1.5 }}>
              Are you sure you want to cancel this request? This action cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '14px 22px', borderTop: '1px solid #e4ddd1' }}>
              <button onClick={() => setConfirmState({ open: false, id: null })} style={{
                padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid #e4ddd1', background: portalTheme.paper, color: portalTheme.inkSoft, fontSize: 13, fontWeight: 600
              }}>Keep Request</button>
              <button onClick={handleCancelConfirm} style={{
                padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid transparent',
                background: 'linear-gradient(155deg, #dc2626, #b91c1c)', color: '#fff', fontSize: 13, fontWeight: 600,
                boxShadow: '0 6px 16px -6px rgba(185,28,28,.55)'
              }}>Cancel Request</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerRequests;
