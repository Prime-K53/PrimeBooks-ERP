import React, { useEffect, useState } from 'react';
import { Gift, Star, Wallet } from 'lucide-react';
import { portalLifecycle } from '../../services/portalApiClient';
import PortalPageHeader from './components/PortalPageHeader';
import PortalCard from './components/PortalCard';
import ErrorBanner from './components/ErrorBanner';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { portalTheme } from './constants';

interface PointsHistory {
  date: string;
  description: string;
  points: number;
  balance: number;
}

interface LoyaltyData {
  points: number;
  cashback: number;
  tier: string;
  pointsHistory: PointsHistory[];
}

const CustomerLoyalty: React.FC = () => {
  const [data, setData] = useState<LoyaltyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    portalLifecycle.loyalty.get()
      .then(setData)
      .catch((err) => setError(err.message || 'Failed to load loyalty data'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="card" count={3} /></div>;

  return (
    <div style={{ background: portalTheme.paper, borderRadius: 14, overflow: 'hidden' }}>
      <PortalPageHeader title="Loyalty Program" subtitle="Your rewards and membership benefits" icon={Gift} />

      <div style={{ padding: '20px 28px 8px' }}>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {data && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 18 }}>
            <PortalCard style={{ padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: portalTheme.teal[50], display: 'flex', alignItems: 'center', justifyContent: 'center', color: portalTheme.teal[600] }}>
                  <Gift size={18} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>Points Balance</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: portalTheme.ink, fontFamily: "'JetBrains Mono', monospace" }}>
                {data.points?.toLocaleString() || 0}
              </div>
            </PortalCard>

            <PortalCard style={{ padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: portalTheme.teal[50], display: 'flex', alignItems: 'center', justifyContent: 'center', color: portalTheme.teal[600] }}>
                  <Wallet size={18} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>Cashback Available</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: portalTheme.ink, fontFamily: "'JetBrains Mono', monospace" }}>
                K {Number(data.cashback || 0).toFixed(2)}
              </div>
            </PortalCard>

            <PortalCard style={{ padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: portalTheme.teal[50], display: 'flex', alignItems: 'center', justifyContent: 'center', color: portalTheme.teal[600] }}>
                  <Star size={18} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>Membership Tier</span>
              </div>
              <div style={{
                display: 'inline-block', padding: '6px 14px', borderRadius: 20,
                fontSize: 13, fontWeight: 700, border: `1.4px solid ${portalTheme.teal[200]}`, background: portalTheme.teal[50], color: portalTheme.teal[700]
              }}>
                {data.tier || 'Bronze'}
              </div>
            </PortalCard>
          </div>
        )}
      </div>

      <div style={{ padding: '0 28px 28px' }}>
        {!data ? null : (
          <div style={{ background: portalTheme.paper, borderRadius: 14, border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #e4ddd1' }}>
              <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>
                Points History
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13px] table-fixed">
                <thead>
                  <tr style={{ background: portalTheme.teal[50] }}>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Date</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Description</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: portalTheme.inkSoft }}>Points</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: portalTheme.inkSoft }}>Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100/50">
                  {(data.pointsHistory || []).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center" style={{ color: portalTheme.inkSoft }}>No points history yet</td>
                    </tr>
                  ) : (
                    (data.pointsHistory || []).map((h, i) => (
                      <tr key={`${h.date}-${h.description}-${i}`} className="text-slate-700 hover:bg-[#eef7f6] transition-colors">
<td className="px-5 py-3 whitespace-nowrap" style={{ color: portalTheme.inkSoft }} data-label="Date">{new Date(h.date).toLocaleDateString()}</td>
                         <td className="px-5 py-3" data-label="Description">{h.description}</td>
                         <td className="px-5 py-3 text-right font-mono" style={{ color: Number(h.points) >= 0 ? portalTheme.teal[600] : portalTheme.danger }} data-label="Points">
                           {Number(h.points) >= 0 ? '+' : ''}{h.points}
                         </td>
                         <td className="px-5 py-3 text-right font-mono font-semibold" data-label="Balance">{h.balance?.toLocaleString() || 0}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomerLoyalty;
