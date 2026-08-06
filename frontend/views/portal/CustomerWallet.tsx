import React, { useEffect, useState, useMemo } from 'react';
import { Wallet, Filter, TrendingUp, TrendingDown } from 'lucide-react';
import { portalLifecycle } from '../../services/portalApiClient';
import PortalPageHeader from './components/PortalPageHeader';
import PortalCard from './components/PortalCard';
import PortalInput from './components/PortalInput';
import PortalButton from './components/PortalButton';
import ErrorBanner from './components/ErrorBanner';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { portalTheme, formatK } from './constants';

const teal = { 50:'#eef7f6', 400:'#3fa294', 600:'#146b60', 700:'#0f544c' };
const paper = '#FEFDFB';
const ink = '#23282A';
const inkSoft = '#5c6567';
const hairline = '#e4ddd1';

interface WalletTransaction {
  date: string;
  amount: number;
  type: string;
  reference: string;
}

interface WalletData {
  balance: number;
  transactions: WalletTransaction[];
}

const CustomerWallet: React.FC = () => {
  const [data, setData] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  useEffect(() => {
    portalLifecycle.wallet.get()
      .then(setData)
      .catch((err) => setError(err.message || 'Failed to load wallet'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      unsubscribe = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          if (type === 'entity_changed' && (payload?.docType === 'invoice' || payload?.docType === 'wallet' || payload?.docType === 'payment' || payload?.event === 'payment_allocated') && !cancelled) {
            portalLifecycle.wallet.get()
              .then(setData)
              .catch(() => {});
          }
        },
      });

    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const filteredTransactions = useMemo(() => {
    if (!data?.transactions) return [];
    return data.transactions.filter((t) => {
      const matchesType = typeFilter === 'all' || t.type === typeFilter;
      const matchesDate = !dateFrom || new Date(t.date) >= new Date(dateFrom);
      const matchesDateTo = !dateTo || new Date(t.date) <= new Date(dateTo);
      return matchesType && matchesDate && matchesDateTo;
    });
  }, [data, typeFilter, dateFrom, dateTo]);

  if (loading) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={5} /></div>;

  return (
    <div>
      <PortalPageHeader title="Wallet" subtitle="Your digital wallet balance and transactions" icon={Wallet} />

      <div style={{ padding: '20px 28px 8px' }}>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {data && (
          <PortalCard style={{ padding: '20px 24px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: portalTheme.teal[50], display: 'flex', alignItems: 'center', justifyContent: 'center', color: portalTheme.teal[600], flexShrink: 0 }}>
              <Wallet size={22} />
            </div>
            <div style={{ minWidth: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>Wallet Balance</span>
<div style={{ fontSize: 22, fontWeight: 700, color: portalTheme.ink, fontFamily: "'JetBrains Mono', monospace" }}>
  {formatK(data.balance || 0)}
</div>
            </div>
          </PortalCard>
        )}
      </div>

      <div style={{ padding: '0 28px 28px' }}>
        <div style={{ background: portalTheme.paper, borderRadius: 14, border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #e4ddd1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>
              Transaction History
            </h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                style={{
                  fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 500,
                  color: ink, background: paper,
                  border: `1.4px solid ${hairline}`, borderRadius: 8,
                  padding: '5px 8px', outline: 'none', cursor: 'pointer',
                  minWidth: 110
                }}
              >
                <option value="all">All Types</option>
                <option value="credit">Credits</option>
                <option value="debit">Debits</option>
              </select>
              <PortalInput label="" type="date" value={dateFrom} onChange={setDateFrom} placeholder="From" style={{ width: 130, padding: '4px 8px', fontSize: 12 }} />
              <PortalInput label="" type="date" value={dateTo} onChange={setDateTo} placeholder="To" style={{ width: 130, padding: '4px 8px', fontSize: 12 }} />
            </div>
          </div>
          {!data ? null : filteredTransactions.length === 0 ? (
            <EmptyState icon={<Wallet size={28} />} title="No transactions" description={typeFilter !== 'all' || dateFrom || dateTo ? 'No transactions match your filters.' : 'Your wallet transactions will appear here.'} />
          ) : (
            <div className="space-y-2">
              {filteredTransactions.map((t, i) => {
                const isCredit = Number(t.amount) >= 0;
                return (
                  <PortalCard key={`${t.date}-${t.reference}-${i}`} hoverable style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 8, background: isCredit ? '#ecfdf5' : '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isCredit ? '#059669' : '#dc2626', flexShrink: 0 }}>
                          {isCredit ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                        </div>
                        <div>
                          <p style={{ fontSize: 13, fontWeight: 600, color: ink, margin: 0 }}>{t.type}</p>
                          <p style={{ fontSize: 11, color: inkSoft, marginTop: 1 }}>{new Date(t.date).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontSize: 15, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: isCredit ? '#059669' : '#dc2626', margin: 0 }}>
                          {formatK(t.amount)}
                        </p>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: inkSoft, marginTop: 4 }}>
                      Reference: <span style={{ color: ink, fontWeight: 500 }}>{t.reference || '—'}</span>
                    </div>
                  </PortalCard>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CustomerWallet;
