import React, { useEffect, useState } from 'react';
import { Gift, Star, Wallet } from 'lucide-react';
import { portalLifecycle } from '../../services/portalApiClient';
import PortalPageHeader from './components/PortalPageHeader';
import PortalCard from './components/PortalCard';
import ErrorBanner from './components/ErrorBanner';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { portalTheme, formatK } from './constants';

const teal = { 50:'#eef7f6', 400:'#3fa294', 600:'#146b60', 700:'#0f544c' };
const paper = '#FEFDFB';
const ink = '#23282A';
const inkSoft = '#5c6567';
const hairline = '#e4ddd1';

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

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      unsubscribe = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          if (type === 'entity_changed' && (payload?.docType === 'invoice' || payload?.event === 'payment_allocated') && !cancelled) {
            portalLifecycle.loyalty.get()
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

  if (loading) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="card" count={3} /></div>;

  return (
    <div>
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
  {formatK(data.cashback || 0)}
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
            <div className="space-y-2">
              {(data.pointsHistory || []).length === 0 ? (
                <p style={{ textAlign: 'center', color: inkSoft, padding: '24px 0' }}>No points history yet</p>
              ) : (
                (data.pointsHistory || []).map((h, i) => (
                  <div key={`${h.date}-${h.description}-${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', background: paper, borderRadius: 12, border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: ink, margin: 0 }}>{h.description}</p>
                      <p style={{ fontSize: 11, color: inkSoft, marginTop: 2 }}>{new Date(h.date).toLocaleDateString()}</p>
                    </div>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: Number(h.points) >= 0 ? teal[600] : portalTheme.danger }}>
                        {Number(h.points) >= 0 ? '+' : ''}{h.points} pts
                      </span>
                      <span style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: ink }}>
                        Balance: {h.balance?.toLocaleString() || 0}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomerLoyalty;
