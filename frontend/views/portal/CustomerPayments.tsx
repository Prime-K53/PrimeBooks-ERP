import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, Search, Calendar, ChevronRight } from 'lucide-react';
import { portalLifecycle } from '../../services/portalApiClient';
import PortalPageHeader from './components/PortalPageHeader';
import PortalInput from './components/PortalInput';
import PortalCard from './components/PortalCard';
import ErrorBanner from './components/ErrorBanner';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { portalTheme, DEFAULT_PAGE_SIZE, formatK } from './constants';

interface Payment {
  id: string;
  amount: number;
  payment_method: string;
  date: string;
  reference: string;
}

const CustomerPayments: React.FC = () => {
  const navigate = useNavigate();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await portalLifecycle.payments.list({ page, pageSize: DEFAULT_PAGE_SIZE, search: search || undefined });
      if ('payments' in data) {
        setPayments((data as any).payments);
        setTotalPages((data as any).totalPages);
        setTotal((data as any).total);
      } else {
        setPayments(data as Payment[]);
        setTotalPages(1);
        setTotal((data as Payment[]).length);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  const filteredPayments = useMemo(() => {
    let result = payments;
    if (dateFrom) {
      result = result.filter((p) => new Date(p.date) >= new Date(dateFrom));
    }
    if (dateTo) {
      result = result.filter((p) => new Date(p.date) <= new Date(dateTo + 'T23:59:59'));
    }
    return result;
  }, [payments, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      unsubscribe = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          if (type !== 'entity_changed' || cancelled) return;
          const event = payload?.event;
          if (event === 'payment_allocated' || event === 'payment_recorded' || event === 'payment_made' || event === 'balance_changed') load();
        },
      });
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [load]);

  if (loading && page === 1) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={6} /></div>;

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const totalPaid = filteredPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const paidThisMonth = filteredPayments
    .filter((p) => new Date(p.date).getMonth() === currentMonth && new Date(p.date).getFullYear() === currentYear)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const paidThisYear = filteredPayments
    .filter((p) => new Date(p.date).getFullYear() === currentYear)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  return (
    <div>
      <PortalPageHeader title="Payments" subtitle="Your complete payment history" icon={CreditCard} />

      <div className="space-y-6">
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {/* Summary Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="glass-panel-premium rounded-2xl p-4 border border-slate-200/80 shadow-xs">
            <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">Total Paid</span>
            <span className="text-xl font-extrabold text-slate-900" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatK(totalPaid)}</span>
          </div>
          <div className="glass-panel-premium rounded-2xl p-4 border border-slate-200/80 shadow-xs">
            <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">This Month</span>
            <span className="text-xl font-extrabold text-teal-700" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatK(paidThisMonth)}</span>
          </div>
          <div className="glass-panel-premium rounded-2xl p-4 border border-slate-200/80 shadow-xs">
            <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">This Year</span>
            <span className="text-xl font-extrabold text-slate-900" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatK(paidThisYear)}</span>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="glass-panel-premium rounded-2xl p-4 flex flex-col md:flex-row gap-3 border border-slate-200/80 shadow-xs items-center">
          <div className="relative flex-1 w-full">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search reference or method..."
              value={search}
              onChange={(e) => { setPage(1); setSearch(e.target.value); }}
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-50/80 border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:bg-white focus:border-teal-500/60 focus:ring-4 focus:ring-teal-500/10 transition-all shadow-2xs"
            />
          </div>
          <div className="flex items-center gap-2.5 w-full md:w-auto">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-700 outline-none focus:border-teal-500/60"
            />
            <span className="text-xs text-slate-400 font-bold">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-700 outline-none focus:border-teal-500/60"
            />
          </div>
        </div>

        {/* Payment History List */}
        {filteredPayments.length === 0 ? (
          <EmptyState icon={<CreditCard size={32} />} title="No payments found" description="You have no payment history matching your filter." />
        ) : (
          <div className="space-y-3">
            <div className="text-xs font-semibold text-slate-500 px-1">
              Showing {filteredPayments.length} of {total} payment{total !== 1 ? 's' : ''}
            </div>
            <div className="space-y-2.5">
              {filteredPayments.map((p) => (
                <div
                  key={p.id}
                  onClick={() => navigate(`/portal/payments/${p.id}`)}
                  className="glass-panel-interactive rounded-2xl p-4 flex items-center justify-between gap-4 border border-slate-200/80 cursor-pointer"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100/60 shadow-2xs">
                      <CreditCard size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-extrabold text-slate-900 font-mono truncate">{p.reference || p.id.slice(0, 8)}</div>
                      <div className="text-[11px] font-medium text-slate-500 mt-0.5">
                        {new Date(p.date).toLocaleDateString()} • {p.payment_method || 'Standard Method'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="text-sm font-extrabold text-emerald-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatK(p.amount)}
                      </div>
                      <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Amount Paid</div>
                    </div>
                    <div className="p-1.5 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 transition-colors">
                      <ChevronRight size={16} />
                    </div>
                  </div>
                </div>
              ))}
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

export default CustomerPayments;
