import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, Search } from 'lucide-react';
import { portalLifecycle } from '../../services/portalApiClient';
import PortalPageHeader from './components/PortalPageHeader';
import PortalInput from './components/PortalInput';
import ErrorBanner from './components/ErrorBanner';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { portalTheme, DEFAULT_PAGE_SIZE } from './constants';

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

  useEffect(() => {
    load();
  }, [load]);

  if (loading && page === 1) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={6} /></div>;

  return (
    <div style={{ background: portalTheme.paper, borderRadius: 14, overflow: 'hidden' }}>
      <PortalPageHeader title="Payments" subtitle="Your payment history" icon={CreditCard} />

      <div style={{ padding: '20px 28px 8px' }}>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: portalTheme.inkSoft }} />
          <PortalInput label="" placeholder="Search payments..." value={search} onChange={(v) => { setPage(1); setSearch(v); }} onFocus={() => {}} onBlur={() => {}} style={{ paddingLeft: 32 }} />
        </div>
      </div>

      <div style={{ padding: '16px 28px 28px' }}>
        {payments.length === 0 ? (
          <EmptyState icon={<CreditCard size={28} />} title="No payments found" description="You have no payment history yet." />
        ) : (
          <>
            <div style={{ fontSize: 11, color: portalTheme.inkSoft, marginBottom: 8 }}>
              Showing {payments.length} of {total} payment{total !== 1 ? 's' : ''}
            </div>
            <div style={{ background: portalTheme.paper, borderRadius: 14, border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[13px] table-fixed">
                  <thead>
                    <tr style={{ background: portalTheme.teal[50] }}>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Reference</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Date</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: portalTheme.inkSoft }}>Amount</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Method</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100/50">
                    {payments.map((p) => (
                      <tr key={p.id} onClick={() => navigate(`/portal/payments/${p.id}`)} className="transition-colors cursor-pointer group hover:bg-[#eef7f6]">
<td className="px-5 py-3 font-mono text-slate-500 font-bold truncate" data-label="Reference">{p.reference || p.id.slice(0, 8)}</td>
                         <td className="px-5 py-3 text-slate-500 whitespace-nowrap" data-label="Date">{new Date(p.date).toLocaleDateString()}</td>
                         <td className="px-5 py-3 text-right font-medium" data-label="Amount">K {Number(p.amount).toFixed(2)}</td>
                         <td className="px-5 py-3 text-slate-500" data-label="Method">{p.payment_method || '-'}</td>
                      </tr>
                    ))}
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

export default CustomerPayments;
