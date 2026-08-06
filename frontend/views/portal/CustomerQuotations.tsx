import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Plus, ArrowUpRight, Search } from 'lucide-react';
import { portalLifecycle, QuotationRecord } from '../../services/portalApiClient';
import PortalPageHeader from './components/PortalPageHeader';
import PortalInput from './components/PortalInput';
import EmptyState from './components/EmptyState';
import StatusBadge from './components/StatusBadge';
import PortalCard from './components/PortalCard';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { portalTheme, QUOTATION_STATUS_META, DEFAULT_PAGE_SIZE, FRIENDLY_STATUS_MAP } from './constants';

const CustomerQuotations: React.FC = () => {
  const navigate = useNavigate();
  const [quotations, setQuotations] = useState<QuotationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await portalLifecycle.quotations.list({ page, pageSize: DEFAULT_PAGE_SIZE, search: search || undefined });
      if ('quotations' in data) {
        setQuotations((data as any).quotations);
        setTotalPages((data as any).totalPages);
        setTotal((data as any).total);
      } else {
        setQuotations(data as QuotationRecord[]);
        setTotalPages(1);
        setTotal((data as QuotationRecord[]).length);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load quotations');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      unsubscribe = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          if (type === 'entity_changed' && payload.docType === 'quotation' && !cancelled) load();
        },
      });

    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [load]);

  const sorted = useMemo(
    () => [...quotations]
      .filter((q) => statusFilter === 'all' || q.status === statusFilter)
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()),
    [quotations, statusFilter]
  );

  if (loading && page === 1) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={6} /></div>;

  return (
    <div>
      <PortalPageHeader
        title="Quotations"
        subtitle="View your quotations"
        icon={FileText}
        action={{ label: 'New Quotation', onClick: () => navigate('/portal/new-request?type=quotation'), icon: Plus }}
      />

      <div style={{ padding: '20px 28px 8px' }}>
        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 12, padding: '12px 16px', fontSize: 13, marginBottom: 12 }}>{error}</div>
        )}
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: portalTheme.inkSoft }} />
          <PortalInput label="" placeholder="Search quotations..." value={search} onChange={(v) => { setPage(1); setSearch(v); }} onFocus={() => {}} onBlur={() => {}} style={{ paddingLeft: 32 }} />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          style={{
            fontFamily: "'Inter', sans-serif", fontSize: 12.5, fontWeight: 500,
            color: portalTheme.ink, background: portalTheme.paper,
            border: `1.4px solid ${portalTheme.hairline}`, borderRadius: 8,
            padding: '6px 10px', outline: 'none', cursor: 'pointer',
            minWidth: 130
          }}
        >
          <option value="all">All Statuses</option>
          <option value="ready">Ready</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="revision_requested">Revision Requested</option>
          <option value="converted">Converted</option>
        </select>
      </div>

      <div style={{ padding: '16px 28px 28px' }}>
        {sorted.length === 0 ? (
          <EmptyState icon={<FileText size={28} />} title="No quotations yet" description="Your quotations will appear here once created." />
        ) : (
          <>
            <div style={{ fontSize: 11, color: portalTheme.inkSoft, marginBottom: 8 }}>
              Showing {quotations.length} of {total} quotation{total !== 1 ? 's' : ''}
            </div>
            <div style={{ background: portalTheme.paper, borderRadius: 14, border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
              <div className="p-4 space-y-2">
                {sorted.map((q) => {
                  const friendlyStatus = FRIENDLY_STATUS_MAP[q.status] || q.status;
                  const isExpired = q.status === 'expired' || (q.valid_until && new Date(q.valid_until) < new Date());
                  const isExpiringSoon = q.valid_until && !isExpired && (new Date(q.valid_until).getTime() - Date.now()) < 7 * 86400000;
                  const quotationNumber = q.quotation_number || q.id.slice(0, 8);
                  const date = new Date(q.created_at).toLocaleDateString();
                  const total = Number(q.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 });
                  return (
                    <PortalCard hoverable key={q.id} onClick={() => navigate(`/portal/quotations/${q.id}`)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#eef7f6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <FileText size={15} className="text-teal-600" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: '#23282A' }}>{quotationNumber}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <StatusBadge status={friendlyStatus} />
                          {isExpired && (
                            <span className="text-[10px] font-bold text-rose-500" title="Expired">⚠</span>
                          )}
                          {isExpiringSoon && !isExpired && (
                            <span className="text-[10px] font-bold text-amber-500" title={`Expires ${new Date(q.valid_until!).toLocaleDateString()}`}>⚠</span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11, color: '#5c6567', marginTop: 8 }}>
                        <span>Date: <span style={{ color: '#23282A' }}>{date}</span></span>
                        <span>Total: <span style={{ color: '#23282A' }}>K {total}</span></span>
                        {q.valid_until && <span>Valid until: <span style={{ color: '#23282A' }}>{new Date(q.valid_until).toLocaleDateString()}</span></span>}
                      </div>
                    </PortalCard>
                  );
                })}
              </div>
            </div>
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, fontSize: 12, color: portalTheme.inkSoft }}>
                <span>Page {page} of {totalPages}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={{ padding: '6px 12px', borderRadius: 8, border: `1.4px solid ${portalTheme.hairline}`, background: portalTheme.paper, cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.5 : 1, fontSize: 12, color: portalTheme.ink }}>Previous</button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{ padding: '6px 12px', borderRadius: 8, border: `1.4px solid ${portalTheme.hairline}`, background: portalTheme.paper, cursor: page >= totalPages ? 'not-allowed' : 'pointer', opacity: page >= totalPages ? 0.5 : 1, fontSize: 12, color: portalTheme.ink }}>Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default CustomerQuotations;
