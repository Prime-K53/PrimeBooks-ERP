import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Plus, Search, ChevronRight } from 'lucide-react';
import { portalLifecycle, QuotationRecord } from '../../services/portalApiClient';
import PortalPageHeader from './components/PortalPageHeader';
import PortalInput from './components/PortalInput';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { portalTheme, DEFAULT_PAGE_SIZE, FRIENDLY_STATUS_MAP } from './constants';

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
            <div style={{ background: portalTheme.paper, borderRadius: 16, border: `1px solid ${portalTheme.border}`, boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 12px 30px -16px rgba(16,24,40,0.18)', overflow: 'hidden' }}>
              <div className="p-4 space-y-2">
                {sorted.map((q) => {
                  const friendlyStatus = FRIENDLY_STATUS_MAP[q.status] || q.status;
                  const isExpired = q.status === 'expired' || (q.valid_until && new Date(q.valid_until) < new Date());
                  const isExpiringSoon = q.valid_until && !isExpired && (new Date(q.valid_until).getTime() - Date.now()) < 7 * 86400000;
                  const quotationNumber = q.quotation_number || q.id.slice(0, 8);
                  const date = new Date(q.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                  const total = Number(q.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 });
                return (
                  <div
                    key={q.id}
                    onClick={() => navigate(`/portal/quotations/${q.id}`)}
                    className="rounded-[14px] p-[14px_16px] bg-[#FFFFFF] border-[1px] border-[rgba(16,24,40,0.05)] border-l-[4px] flex items-center gap-3 text-left w-full shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-all hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(16,24,40,0.08)]"
                    style={{ borderLeftColor: portalTheme.teal[400], cursor: 'pointer', borderColor: portalTheme.border }}
                  >
                    <div style={{ width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: portalTheme.teal[50], flexShrink: 0 }}>
                      <FileText size={16} color={portalTheme.teal[500]} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: portalTheme.ink }}>{quotationNumber}</div>
                      <div style={{ fontSize: 10, color: portalTheme.inkSoft, marginTop: 1, lineHeight: 1.3 }}>
                          {date} • {friendlyStatus}
                          {isExpired && ' • Expired'}
                          {isExpiringSoon && !isExpired && ' • Expiring soon'}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', minWidth: 80 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: portalTheme.ink, fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums', lineHeight: 1.35 }}>
                          K {total}
                        </div>
                        <div style={{ fontSize: 10, color: '#5c6567', textTransform: 'uppercase', marginTop: 1, lineHeight: 1.3 }}>
                          Total
                        </div>
                      </div>
                      <div style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, background: portalTheme.teal[50], fontSize: 10, fontWeight: 600, color: portalTheme.teal[700], display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0, border: `1px solid ${portalTheme.teal[100]}` }}>
                        View
                        <ChevronRight size={10} />
                      </div>
                    </div>
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
