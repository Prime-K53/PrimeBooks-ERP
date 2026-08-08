import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, Search, FileText, ChevronRight } from 'lucide-react';
import { portalLifecycle } from '../../services/portalApiClient';
import PortalPageHeader from './components/PortalPageHeader';
import PortalInput from './components/PortalInput';
import ErrorBanner from './components/ErrorBanner';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import StatusBadge from './components/StatusBadge';
import { portalTheme, DEFAULT_PAGE_SIZE, formatK } from './constants';

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
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const status = searchParams.get('status');
    if (status !== filter) {
      setFilter(status || 'All');
      setPage(1);
    }
  }, [searchParams]);

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

      <div className="space-y-4">
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {/* Filters Bar */}
        <div className="glass-panel-premium rounded-2xl p-4 flex flex-col sm:flex-row gap-3 border border-slate-200/80 shadow-xs">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search invoice number, amount..."
              value={search}
              onChange={(e) => { setPage(1); setSearch(e.target.value); }}
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-50/80 border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:bg-white focus:border-teal-500/60 focus:ring-4 focus:ring-teal-500/10 transition-all shadow-2xs"
            />
          </div>
          <select
            value={filter}
            onChange={(e) => { setPage(1); const val = e.target.value; setFilter(val); setSearchParams(prev => { const next = new URLSearchParams(prev); if (val === 'All') { next.delete('status'); } else { next.set('status', val); } return next; }); }}
            aria-label="Filter by status"
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 outline-none focus:border-teal-500/60 transition-all shadow-2xs cursor-pointer"
          >
            <option value="All">All Statuses</option>
            <option value="Paid">Paid</option>
            <option value="Unpaid">Unpaid</option>
            <option value="Overdue">Overdue</option>
            <option value="Partially Paid">Partially Paid</option>
          </select>
        </div>

        {/* Invoices List */}
        {filtered.length === 0 ? (
          <EmptyState icon={<FileText size={32} />} title="No invoices found" description={filter === 'All' ? 'You have no invoices yet.' : `No invoices with status "${filter}".`} />
        ) : (
          <div className="space-y-3">
            <div className="text-xs font-semibold text-[#5c6567] px-1">
              Showing {invoices.length} of {total} invoice{total !== 1 ? 's' : ''}
            </div>
            <div className="space-y-2.5">
              {filtered.map((inv) => {
                const date = new Date(inv.created_at).toLocaleDateString();
                return (
                  <div
                    key={inv.id}
                    onClick={() => navigate(`/portal/invoices/${inv.id}`)}
                    className="glass-panel-interactive rounded-2xl p-4 flex items-center justify-between gap-4 border border-slate-200/80 cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0 border border-teal-100/60 shadow-2xs">
                        <FileText size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-extrabold text-slate-900 truncate">{inv.invoice_number}</div>
                        <div className="text-[11px] font-medium text-slate-500 mt-0.5">
                          {date} • Due {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : 'N/A'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <StatusBadge status={inv.status || 'Unpaid'} size="sm" />
                      <div className="text-right">
                        <div className="text-sm font-extrabold text-slate-900" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {formatK(inv.total_amount)}
                        </div>
                        <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Total</div>
                      </div>
                      <div className="p-1.5 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 transition-colors">
                        <ChevronRight size={16} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2 px-1 text-xs text-slate-500 font-semibold">
                <span>Page {page} of {totalPages}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all">Previous</button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all">Next</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomerInvoices;
