import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Plus, Loader2, ArrowUpRight, Search, RefreshCw, SlidersHorizontal, Trash2, ChevronRight } from 'lucide-react';
import { portalLifecycle, QuotationRequestRecord } from '../../services/portalApiClient';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { useToast } from './components/Toast';
import PortalPageHeader from './components/PortalPageHeader';
import PortalCard from './components/PortalCard';
import PortalButton from './components/PortalButton';
import PortalInput from './components/PortalInput';
import EmptyState from './components/EmptyState';
import StatusBadge from './components/StatusBadge';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { portalTheme, DEFAULT_PAGE_SIZE, FRIENDLY_STATUS_MAP } from './constants';

const SWIPE_THRESHOLD = 80;

const CustomerRequests: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useCustomerAuth();
  const { addToast } = useToast();
  const [requests, setRequests] = useState<QuotationRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [confirmState, setConfirmState] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  const [swipedId, setSwipedId] = useState<string | null>(null);
  const touchStartX = useRef<number>(0);
  const touchCurrentX = useRef<number>(0);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
      setRefreshing(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      unsubscribe = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          if (type === 'entity_changed' && payload.docType === 'request' && !cancelled) load();
        },
      });
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
  };

  const handleCancelClick = (id: string) => {
    setConfirmState({ open: true, id });
    setSwipedId(null);
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

  const handleTouchStart = (id: string, e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchCurrentX.current = e.touches[0].clientX;
    setSwipedId(prev => prev === id ? null : prev);
  };

  const handleTouchMove = (id: string, e: React.TouchEvent) => {
    touchCurrentX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (id: string) => {
    const diff = touchStartX.current - touchCurrentX.current;
    if (diff > SWIPE_THRESHOLD) {
      setSwipedId(id);
    } else if (diff < -SWIPE_THRESHOLD) {
      setSwipedId(null);
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

  const activeFilterCount = (statusFilter ? 1 : 0) + (search ? 1 : 0);

  if (loading && page === 1) return <div className="p-4"><PortalLoadingSkeleton type="table" count={6} /></div>;

  return (
    <div style={{ background: portalTheme.paper, borderRadius: 20, overflow: 'hidden' }}>
      <PortalPageHeader
        title="Requests"
        subtitle="Track your quotation and order requests"
        icon={ClipboardList}
        action={{ label: 'New', onClick: () => navigate('/portal/new-request'), icon: Plus }}
      />

      <div style={{ padding: '16px 20px 0' }}>
        {error && (
          <div className="mb-4" style={{
            background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 14, padding: '14px 16px', fontSize: 13,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12
          }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', padding: 4, flexShrink: 0 }} aria-label="Dismiss error">
              <ArrowUpRight size={14} style={{ transform: 'rotate(45deg)' }} />
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: portalTheme.inkSoft }} />
            <PortalInput
              label=""
              placeholder="Search requests..."
              value={search}
              onChange={(v) => { setPage(1); setSearch(v); }}
              onFocus={() => {}}
              onBlur={() => {}}
              style={{ paddingLeft: 42, borderRadius: 14, height: 48, fontSize: 15 }}
            />
          </div>
          <button
            onClick={() => setShowFilterSheet(true)}
            style={{
              width: 48, height: 48, borderRadius: 14, border: `1.4px solid ${activeFilterCount ? portalTheme.teal[400] : portalTheme.hairline}`,
              background: activeFilterCount ? portalTheme.teal[50] : portalTheme.paper, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', flexShrink: 0
            }}
          >
            <SlidersHorizontal size={18} color={activeFilterCount ? portalTheme.teal[600] : portalTheme.inkSoft} />
            {activeFilterCount > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: '50%',
                background: `linear-gradient(135deg, ${portalTheme.teal[500]}, ${portalTheme.teal[700]})`, color: '#fff',
                fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {refreshing && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 0', color: portalTheme.teal[600] }}>
            <RefreshCw size={16} className="animate-spin" />
            <span style={{ fontSize: 12, fontWeight: 600 }}>Refreshing...</span>
          </div>
        )}
      </div>

      <div style={{ padding: '12px 20px 28px' }}>
        {sorted.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No requests yet"
            description="Submit a quotation or order request and track it here."
            action={{ label: 'New Request', onClick: () => navigate('/portal/new-request') }}
          />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: portalTheme.inkSoft, fontWeight: 500 }}>
                {total} request{total !== 1 ? 's' : ''} {statusFilter ? '• filtered' : ''}
              </span>
              <button onClick={handleRefresh} style={{ background: 'none', border: 'none', cursor: 'pointer', color: portalTheme.teal[600], display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600 }}>
                <RefreshCw size={14} /> Refresh
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {sorted.map((r, idx) => {
                const itemCount = (r.items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0);
                const friendlyStatus = FRIENDLY_STATUS_MAP[r.status] || r.status;
                const isSwiped = swipedId === r.id;
                const canCancel = r.status === 'submitted' || r.status === 'assigned' || r.status === 'under_review' || r.status === 'waiting_for_customer';
                return (
                  <div
                    key={r.id}
                    style={{ position: 'relative', overflow: 'hidden', borderRadius: 18 }}
                    onTouchStart={(e) => handleTouchStart(r.id, e)}
                    onTouchMove={(e) => handleTouchMove(r.id, e)}
                    onTouchEnd={() => handleTouchEnd(r.id)}
                  >
                    <div style={{
                      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 8px',
                      background: `linear-gradient(135deg, ${portalTheme.danger}15, ${portalTheme.danger}25)`, borderRadius: 18,
                      transform: isSwiped ? 'translateX(0)' : 'translateX(100%)', transition: 'transform .25s cubic-bezier(.4,0,.2,1)'
                    }}>
                      {canCancel && (
                        <button
                          onClick={() => handleCancelClick(r.id)}
                          disabled={cancellingId === r.id}
                          style={{
                            width: 72, height: '100%', border: 'none', borderRadius: 18, cursor: 'pointer',
                            background: `linear-gradient(135deg, ${portalTheme.danger}, ${portalTheme.danger}dd)`, color: '#fff',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                            boxShadow: '0 4px 12px -4px rgba(220,38,38,.5)'
                          }}
                        >
                          {cancellingId === r.id ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                          <span style={{ fontSize: 10, fontWeight: 700 }}>Cancel</span>
                        </button>
                      )}
                    </div>

                    <PortalCard
                      hoverable
                      onClick={() => navigate(`/portal/requests/${r.id}`)}
                      style={{ transform: isSwiped ? 'translateX(-88px)' : 'translateX(0)', transition: 'transform .25s cubic-bezier(.4,0,.2,1)', position: 'relative', padding: 0, overflow: 'visible' }}
                    >
                      <div
                        className="rounded-[10px] p-[12px_14px] bg-[#FEFDFB] border-[1.4px] border-[#e4ddd1] border-l-[4px] flex items-center gap-3 text-left w-full shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
                        style={{ borderLeftColor: portalTheme.amber[500], cursor: 'pointer' }}
                      >
                        <div style={{ width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: portalTheme.amber[50], flexShrink: 0 }}>
                          <ClipboardList size={16} color={portalTheme.amber[600]} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#23282A' }}>{r.request_number}</div>
                          <div style={{ fontSize: 10, color: '#5c6567', marginTop: 1, lineHeight: 1.3 }}>
                            {new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} • {itemCount} item{itemCount === 1 ? '' : 's'} • K {Number(r.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        </div>
                        <div style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, background: portalTheme.teal[50], fontSize: 10, fontWeight: 600, color: portalTheme.teal[700], display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0, border: `1px solid ${portalTheme.teal[100]}` }}>
                          View
                          <ChevronRight size={10} />
                        </div>
                      </div>
                    </PortalCard>
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, gap: 12 }}>
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  style={{
                    flex: 1, padding: '12px 16px', borderRadius: 14, border: `1.4px solid ${portalTheme.hairline}`, background: portalTheme.paper,
                    cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.4 : 1, fontSize: 13, fontWeight: 700, color: portalTheme.ink,
                    transition: 'all .15s ease'
                  }}
                >
                  Previous
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      style={{
                        width: 36, height: 36, borderRadius: 10, border: p === page ? 'none' : `1.4px solid ${portalTheme.hairline}`,
                        background: p === page ? `linear-gradient(135deg, ${portalTheme.teal[500]}, ${portalTheme.teal[700]})` : portalTheme.paper,
                        color: p === page ? '#fff' : portalTheme.ink, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        boxShadow: p === page ? '0 4px 10px -4px rgba(15,84,76,.5)' : 'none', transition: 'all .15s ease'
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  style={{
                    flex: 1, padding: '12px 16px', borderRadius: 14, border: `1.4px solid ${portalTheme.hairline}`, background: portalTheme.paper,
                    cursor: page >= totalPages ? 'not-allowed' : 'pointer', opacity: page >= totalPages ? 0.4 : 1, fontSize: 13, fontWeight: 700, color: portalTheme.ink,
                    transition: 'all .15s ease'
                  }}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Floating Action Button */}
      <button
        onClick={() => navigate('/portal/new-request')}
        style={{
          position: 'fixed', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 18, border: 'none', cursor: 'pointer',
          background: `linear-gradient(135deg, ${portalTheme.teal[500]}, ${portalTheme.teal[700]})`,
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 24px -8px rgba(15,84,76,.6)', zIndex: 40, transition: 'transform .15s ease'
        }}
        onTouchStart={() => {}}
      >
        <Plus size={24} strokeWidth={3} />
      </button>

      {/* Filter Bottom Sheet */}
      {showFilterSheet && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
          onClick={() => setShowFilterSheet(false)}
        >
          <div style={{ background: 'rgba(0,0,0,.4)', backdropFilter: 'blur(4px)', flex: 1 }} />
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: portalTheme.paper, borderRadius: '24px 24px 0 0', padding: '20px 24px 28px',
              boxShadow: '0 -8px 32px -16px rgba(0,0,0,.3)', animation: 'slideUp .3s cubic-bezier(.4,0,.2,1)'
            }}
          >
            <div style={{ width: 40, height: 4, borderRadius: 2, background: portalTheme.hairline, margin: '0 auto 16px' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: portalTheme.ink, margin: 0 }}>Filters</h3>
              <button onClick={() => { setStatusFilter(''); setSearch(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: portalTheme.teal[600], fontSize: 13, fontWeight: 600 }}>
                Clear all
              </button>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.06, marginBottom: 8, display: 'block' }}>Status</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  onClick={() => { setStatusFilter(''); setShowFilterSheet(false); }}
                  style={{
                    padding: '10px 16px', borderRadius: 12, border: `1.4px solid ${!statusFilter ? portalTheme.teal[400] : portalTheme.hairline}`,
                    background: !statusFilter ? portalTheme.teal[50] : '#fff', color: !statusFilter ? portalTheme.teal[700] : portalTheme.ink,
                    fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all .15s ease'
                  }}
                >
                  All
                </button>
                {Object.entries(statusOptions).map(([label, raw]) => (
                  <button
                    key={raw}
                    onClick={() => { setStatusFilter(raw); setShowFilterSheet(false); }}
                    style={{
                      padding: '10px 16px', borderRadius: 12, border: `1.4px solid ${statusFilter === raw ? portalTheme.teal[400] : portalTheme.hairline}`,
                      background: statusFilter === raw ? portalTheme.teal[50] : '#fff', color: statusFilter === raw ? portalTheme.teal[700] : portalTheme.ink,
                      fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all .15s ease'
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => setShowFilterSheet(false)}
              style={{
                width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', cursor: 'pointer',
                background: `linear-gradient(135deg, ${portalTheme.teal[500]}, ${portalTheme.teal[700]})`, color: '#fff',
                fontSize: 15, fontWeight: 700, boxShadow: '0 6px 16px -6px rgba(15,84,76,.5)'
              }}
            >
              Show {total} result{total !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmState.open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(6px)', animation: 'fadeIn .2s ease' }} onClick={() => setConfirmState({ open: false, id: null })}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: portalTheme.paper, borderRadius: 24, width: '100%', maxWidth: 360, overflow: 'hidden',
            boxShadow: '0 20px 40px -12px rgba(0,0,0,.4)', animation: 'scaleIn .2s cubic-bezier(.4,0,.2,1)'
          }}>
            <div style={{ padding: '22px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: portalTheme.ink, margin: 0 }}>Cancel Request</h3>
              <button onClick={() => setConfirmState({ open: false, id: null })} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 10, color: portalTheme.inkSoft }} aria-label="Close">
                <ArrowUpRight size={18} style={{ transform: 'rotate(45deg)' }} />
              </button>
            </div>
            <div style={{ padding: '16px 24px 24px', fontSize: 14, color: portalTheme.inkSoft, lineHeight: 1.6 }}>
              Are you sure you want to cancel this request? This action cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 10, padding: '0 24px 24px' }}>
              <button onClick={() => setConfirmState({ open: false, id: null })} style={{
                flex: 1, padding: '14px 0', borderRadius: 14, border: `1.4px solid ${portalTheme.hairline}`, background: portalTheme.paper,
                color: portalTheme.ink, fontSize: 14, fontWeight: 700, cursor: 'pointer', transition: 'all .15s ease'
              }}>
                Keep Request
              </button>
              <button onClick={handleCancelConfirm} style={{
                flex: 1, padding: '14px 0', borderRadius: 14, border: 'none', cursor: 'pointer',
                background: `linear-gradient(135deg, ${portalTheme.danger}, ${portalTheme.danger}dd)`, color: '#fff',
                fontSize: 14, fontWeight: 700, boxShadow: '0 6px 16px -6px rgba(185,28,28,.5)', transition: 'all .15s ease'
              }}>
                Cancel Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerRequests;
