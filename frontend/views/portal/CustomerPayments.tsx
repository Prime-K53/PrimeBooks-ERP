import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, Search, Calendar } from 'lucide-react';
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

  return (
    <div>
      <PortalPageHeader title="Payments" subtitle="Your payment history" icon={CreditCard} />

      <div style={{ padding: '20px 28px 8px' }}>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ position: 'relative', flex: '1 1 240px' }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: portalTheme.inkSoft }} />
            <PortalInput label="" placeholder="Search payments..." value={search} onChange={(v) => { setPage(1); setSearch(v); }} onFocus={() => {}} onBlur={() => {}} style={{ paddingLeft: 32 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <PortalInput label="From" type="date" value={dateFrom} onChange={setDateFrom} />
            <PortalInput label="To" type="date" value={dateTo} onChange={setDateTo} />
          </div>
        </div>
      </div>

      <div style={{ padding: '16px 28px 28px' }}>
        {payments.length === 0 ? (
          <EmptyState icon={<CreditCard size={28} />} title="No payments found" description="You have no payment history yet." />
        ) : (
          <>
            {/* Summary Cards */}
            {(() => {
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
              const avgPayment = filteredPayments.length > 0 ? totalPaid / filteredPayments.length : 0;

              return (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 12,
                  marginBottom: 18
                }}>
                  <PortalCard style={{ padding: '18px 20px' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: portalTheme.inkSoft, marginBottom: 4, display: 'block' }}>Total Paid</span>
<div style={{ fontSize: 20, fontWeight: 700, color: portalTheme.ink, fontFamily: "'JetBrains Mono', monospace" }}>
  {formatK(totalPaid)}
</div>
                  </PortalCard>
                  <PortalCard style={{ padding: '18px 20px' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: portalTheme.inkSoft, marginBottom: 4, display: 'block' }}>This Month</span>
<div style={{ fontSize: 20, fontWeight: 700, color: portalTheme.teal[700], fontFamily: "'JetBrains Mono', monospace" }}>
  {formatK(paidThisMonth)}
</div>
                  </PortalCard>
                  <PortalCard style={{ padding: '18px 20px' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: portalTheme.inkSoft, marginBottom: 4, display: 'block' }}>This Year</span>
<div style={{ fontSize: 20, fontWeight: 700, color: portalTheme.ink, fontFamily: "'JetBrains Mono', monospace" }}>
  {formatK(paidThisYear)}
</div>
                  </PortalCard>
                  <PortalCard style={{ padding: '18px 20px' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: portalTheme.inkSoft, marginBottom: 4, display: 'block' }}>Avg Payment</span>
<div style={{ fontSize: 20, fontWeight: 700, color: portalTheme.ink, fontFamily: "'JetBrains Mono', monospace" }}>
  {formatK(avgPayment)}
</div>
                  </PortalCard>
                </div>
              );
            })()}

            <div style={{ fontSize: 11, color: portalTheme.inkSoft, marginBottom: 8 }}>
              Showing {filteredPayments.length} of {total} payment{total !== 1 ? 's' : ''}
            </div>
            <div className="space-y-2">
              {filteredPayments.map((p) => (
                <div
                  key={p.id}
                  onClick={() => navigate(`/portal/payments/${p.id}`)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                    padding: '14px 18px', background: portalTheme.paper, borderRadius: 12,
                    border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                    cursor: 'pointer', transition: 'all .15s ease', flexWrap: 'wrap'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#a6d9d3'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,.08)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#e4ddd1'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: portalTheme.teal[50], display: 'flex', alignItems: 'center', justifyContent: 'center', color: portalTheme.teal[600], flexShrink: 0 }}>
                      <CreditCard size={16} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: portalTheme.ink, margin: 0, fontFamily: "'JetBrains Mono', monospace" }}>{p.reference || p.id.slice(0, 8)}</p>
                      <p style={{ fontSize: 11, color: portalTheme.inkSoft, marginTop: 2 }}>{new Date(p.date).toLocaleDateString()} • {p.payment_method || '-'}</p>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 700, color: portalTheme.ink, margin: 0, fontFamily: "'JetBrains Mono', monospace" }}>{formatK(p.amount)}</p>
                  </div>
                </div>
              ))}
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
