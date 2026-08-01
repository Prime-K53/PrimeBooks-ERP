import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Plus, ArrowUpRight } from 'lucide-react';
import { portalLifecycle, QuotationRecord } from '../../services/portalApiClient';
import EmptyState from './components/EmptyState';
import StatusBadge from './components/StatusBadge';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

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

const quotationStatusLabel: Record<string, string> = {
  ready: 'Ready',
  accepted: 'Accepted',
  rejected: 'Rejected',
  revision_requested: 'Revision Requested',
  converted: 'Converted to Order',
};

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Plus, ArrowUpRight, Search } from 'lucide-react';
import { portalLifecycle, QuotationRecord } from '../../services/portalApiClient';
import PortalPageHeader from './components/PortalPageHeader';
import PortalInput from './components/PortalInput';
import EmptyState from './components/EmptyState';
import StatusBadge from './components/StatusBadge';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { portalTheme, QUOTATION_STATUS_META, DEFAULT_PAGE_SIZE, FRIENDLY_STATUS_MAP } from '../constants';

const CustomerQuotations: React.FC = () => {
  const navigate = useNavigate();
  const [quotations, setQuotations] = useState<QuotationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
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
    const sub = await portalLifecycle.subscribe({
      onEvent: (type, payload) => {
        if (type === 'entity_changed' && payload.docType === 'quotation') load();
      },
    });
    return sub;
  }, [load]);

  const sorted = useMemo(
    () => [...quotations].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()),
    [quotations]
  );

  if (loading && page === 1) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={6} /></div>;

  return (
    <div style={{ background: portalTheme.paper, borderRadius: 14, overflow: 'hidden' }}>
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
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[13px] table-fixed">
                  <thead>
                    <tr style={{ background: portalTheme.teal[50] }}>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Quotation #</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Date</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: portalTheme.inkSoft }}>Total</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-center" style={{ color: portalTheme.inkSoft }}>Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100/50">
                    {sorted.map((q) => {
                      const friendlyStatus = FRIENDLY_STATUS_MAP[q.status] || q.status;
                      return (
                        <tr key={q.id} onClick={() => navigate(`/portal/quotations/${q.id}`)} className="transition-colors cursor-pointer group hover:bg-[#eef7f6]">
                          <td className="px-5 py-3 font-mono text-slate-500 font-bold truncate">{q.quotation_number || q.id.slice(0, 8)}</td>
                          <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{new Date(q.created_at).toLocaleDateString()}</td>
                          <td className="px-5 py-3 text-right font-medium">K {Number(q.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          <td className="px-5 py-3 text-center"><StatusBadge status={friendlyStatus} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
