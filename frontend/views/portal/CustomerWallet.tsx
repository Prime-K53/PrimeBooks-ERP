import React, { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { portalLifecycle } from '../../services/portalApiClient';
import PortalPageHeader from './components/PortalPageHeader';
import PortalCard from './components/PortalCard';
import ErrorBanner from './components/ErrorBanner';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { portalTheme } from '../constants';

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

  useEffect(() => {
    portalLifecycle.wallet.get()
      .then(setData)
      .catch((err) => setError(err.message || 'Failed to load wallet'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={5} /></div>;

  return (
    <div style={{ background: portalTheme.paper, borderRadius: 14, overflow: 'hidden' }}>
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
                K {Number(data.balance || 0).toFixed(2)}
              </div>
            </div>
          </PortalCard>
        )}
      </div>

      <div style={{ padding: '0 28px 28px' }}>
        <div style={{ background: portalTheme.paper, borderRadius: 14, border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #e4ddd1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>
              Transaction History
            </h2>
          </div>
          {!data ? null : data.transactions.length === 0 ? (
            <EmptyState icon={<Wallet size={28} />} title="No transactions" description="Your wallet transactions will appear here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13px] table-fixed">
                <thead>
                  <tr style={{ background: portalTheme.teal[50] }}>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Date</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Description</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: portalTheme.inkSoft }}>Amount</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100/50">
                  {data.transactions.map((t, i) => (
                    <tr key={`${t.date}-${t.reference}-${i}`} className="text-slate-700 hover:bg-[#eef7f6] transition-colors">
<td className="px-5 py-3 whitespace-nowrap" style={{ color: portalTheme.inkSoft }} data-label="Date">{new Date(t.date).toLocaleDateString()}</td>
                       <td className="px-5 py-3" data-label="Description">{t.type}</td>
                       <td className="px-5 py-3 text-right font-mono" style={{ color: Number(t.amount) >= 0 ? portalTheme.teal[600] : portalTheme.danger }} data-label="Amount">
                         {Number(t.amount) >= 0 ? '+' : ''}K {Number(t.amount).toFixed(2)}
                       </td>
                       <td className="px-5 py-3" style={{ color: portalTheme.inkSoft }} data-label="Reference">{t.reference}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CustomerWallet;
