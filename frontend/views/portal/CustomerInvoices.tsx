import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, Search, FileText, ChevronRight } from 'lucide-react';
import { portalLifecycle } from '../../services/portalApiClient';
import PortalPageHeader from './components/PortalPageHeader';
import PortalInput from './components/PortalInput';
import ErrorBanner from './components/ErrorBanner';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { portalTheme, DEFAULT_PAGE_SIZE, formatK } from './constants';

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

interface Invoice {
  id: string;
  invoice_number: string;
  customer_name: string;
  total_amount: number;
  paid_amount: number;
  status: string;
  due_date: string;
  created_at: string;
}

const statuses = ['All', 'Paid', 'Unpaid', 'Overdue', 'Partially Paid'];

const CustomerInvoices: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState(searchParams.get('status') || 'All');

  useEffect(() => {
    const status = searchParams.get('status');
    if (status !== filter) {
      setFilter(status || 'All');
      setPage(1);
    }
  }, [searchParams]);

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await portalLifecycle.invoices.list({ page, pageSize: DEFAULT_PAGE_SIZE, search: search || undefined, status: filter === 'All' ? undefined : filter });
      if ('invoices' in data) {
        setInvoices((data as any).invoices);
        setTotalPages((data as any).totalPages);
        setTotal((data as any).total);
      } else {
        setInvoices(data as Invoice[]);
        setTotalPages(1);
        setTotal((data as Invoice[]).length);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [page, search, filter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      unsubscribe = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          if (type === 'entity_changed' && payload?.docType === 'invoice' && !cancelled) {
            load();
          }
        },
      });

    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [load]);

  const filtered = filter === 'All' ? invoices : invoices.filter((inv) => {
    const key = inv.status?.toLowerCase().replace(/\s+/g, '_');
    const filterKey = filter.toLowerCase().replace(/\s+/g, '_');
    return key === filterKey || key === filterKey.replace('_', '');
  });

  if (loading && page === 1) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={8} /></div>;

  return (
    <div>
      <PortalPageHeader title="Invoices" subtitle="View and manage your invoices" icon={Eye} />

      <div style={{ padding: '20px 28px 8px' }}>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 240px' }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: portalTheme.inkSoft }} />
            <PortalInput label="" placeholder="Search invoices..." value={search} onChange={(v) => { setPage(1); setSearch(v); }} onFocus={() => {}} onBlur={() => {}} style={{ paddingLeft: 32 }} />
          </div>
          <select
            value={filter}
            onChange={(e) => { setPage(1); const val = e.target.value; setFilter(val); setSearchParams(prev => { const next = new URLSearchParams(prev); if (val === 'All') { next.delete('status'); } else { next.set('status', val); } return next; }); }}
            aria-label="Filter by status"
            style={{
              fontFamily: "'Inter', sans-serif", fontSize: 13, padding: '10px 32px 10px 12px',
              border: '1.4px solid #e4ddd1', borderRadius: 9, background: portalTheme.paper, color: portalTheme.ink,
              appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%235c6567'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', cursor: 'pointer',
            }}
          >
            <option value="All">All Statuses</option>
            <option value="Paid">Paid</option>
            <option value="Unpaid">Unpaid</option>
            <option value="Overdue">Overdue</option>
            <option value="Partially Paid">Partially Paid</option>
          </select>
        </div>
      </div>

      <div style={{ padding: '16px 28px 28px' }}>
        {filtered.length === 0 ? (
          <EmptyState icon={<Eye size={28} />} title="No invoices found" description={filter === 'All' ? 'You have no invoices yet.' : `No invoices with status "${filter}".`} />
        ) : (
          <>
            <div style={{ fontSize: 11, color: portalTheme.inkSoft, marginBottom: 8 }}>
              Showing {invoices.length} of {total} invoice{total !== 1 ? 's' : ''}
            </div>
            <div style={{ background: portalTheme.paper, borderRadius: 14, border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
              <div className="p-4 space-y-2">
                {filtered.map((inv) => {
                  const date = new Date(inv.created_at).toLocaleDateString();
                  return (
                    <div
                      key={inv.id}
                      onClick={() => navigate(`/portal/invoices/${inv.id}`)}
                      className="rounded-[10px] p-[12px_14px] bg-[#FEFDFB] border-[1.4px] border-[#e4ddd1] border-l-[4px] flex items-center gap-3 text-left w-full shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
                      style={{ borderLeftColor: portalTheme.teal[500], cursor: 'pointer' }}
                    >
                      <div style={{ width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: portalTheme.teal[50], flexShrink: 0 }}>
                        <FileText size={16} color={portalTheme.teal[500]} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#23282A' }}>{inv.invoice_number}</div>
                        <div style={{ fontSize: 10, color: '#5c6567', marginTop: 1, lineHeight: 1.3 }}>
                          {date}
                          {inv.status ? ` • ${inv.status}` : ''}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', minWidth: 80 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: '#dc2626', fontFamily: "'Inter', sans-serif", fontVariantNumeric: 'tabular-nums' }}>
                          {formatK(inv.total_amount)}
                        </div>
                        <div style={{ fontSize: 10, color: '#5c6567', textTransform: 'uppercase', marginTop: 1 }}>
                          Invoice
                        </div>
                      </div>
                      <div style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, background: '#eef7f6', fontSize: 10, fontWeight: 600, color: '#1f8577', display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
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

export default CustomerInvoices;
