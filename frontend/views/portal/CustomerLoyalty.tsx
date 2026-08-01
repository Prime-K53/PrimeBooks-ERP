import React, { useEffect, useState } from 'react';
import { Gift, Star, Wallet } from 'lucide-react';
import { portalApi } from '../../services/portalApiClient';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

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
    portalApi.get<LoyaltyData>('/loyalty')
      .then(setData)
      .catch((err) => setError(err.message || 'Failed to load loyalty data'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="card" count={3} /></div>;
  if (error) return <div className="p-8 max-w-4xl mx-auto"><div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 text-sm">{error}</div></div>;
  if (!data) return null;

  return (
    <div style={{
      background: paper,
      borderRadius: 14,
      overflow: 'hidden'
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '22px 28px 18px',
        borderBottom: `1px solid ${hairline}`,
        background: paper
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 10px -3px rgba(15,84,76,.6)', flexShrink: 0
          }}>
            <Gift size={19} color="#fff" />
          </div>
          <div>
            <h1 style={{
              fontFamily: "'DM Serif Display', 'Georgia', serif", fontWeight: 400,
              fontSize: 22, margin: 0, color: teal[800], letterSpacing: 0.2
            }}>
              Loyalty Program
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 11.5, color: inkSoft, letterSpacing: 0.02 }}>
              Your rewards and membership benefits
            </p>
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 30px 8px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 18 }}>
          <div style={{
            background: paper, borderRadius: 14,
            border: `1.4px solid ${hairline}`,
            boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(255,255,255,.04)',
            padding: '20px 24px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: teal[50], display: 'flex', alignItems: 'center', justifyContent: 'center', color: teal[600] }}>
                <Gift size={18} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>Points Balance</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: ink, fontFamily: "'JetBrains Mono', monospace" }}>
              {data.points?.toLocaleString() || 0}
            </div>
          </div>

          <div style={{
            background: paper, borderRadius: 14,
            border: `1.4px solid ${hairline}`,
            boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(255,255,255,.04)',
            padding: '20px 24px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: teal[50], display: 'flex', alignItems: 'center', justifyContent: 'center', color: teal[600] }}>
                <Wallet size={18} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>Cashback Available</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: ink, fontFamily: "'JetBrains Mono', monospace" }}>
              K {Number(data.cashback || 0).toFixed(2)}
            </div>
          </div>

          <div style={{
            background: paper, borderRadius: 14,
            border: `1.4px solid ${hairline}`,
            boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(255,255,255,.04)',
            padding: '20px 24px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: teal[50], display: 'flex', alignItems: 'center', justifyContent: 'center', color: teal[600] }}>
                <Star size={18} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>Membership Tier</span>
            </div>
            <div style={{
              display: 'inline-block', padding: '6px 14px', borderRadius: 20,
              fontSize: 13, fontWeight: 700, border: `1.4px solid ${teal[200]}`, background: teal[50], color: teal[700]
            }}>
              {data.tier || 'Bronze'}
            </div>
          </div>
        </div>

        <div style={{
          background: paper, borderRadius: 14,
          border: `1.4px solid ${hairline}`,
          boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(255,255,255,.04)',
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '14px 16px',
            borderBottom: `1px solid ${hairline}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6
          }}>
            <h2 style={{
              margin: 0, fontSize: 12, fontWeight: 600,
              color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06
            }}>
              Points History
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px] table-fixed">
              <thead style={{ background: teal[50] }}>
                <tr>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: inkSoft }}>Date</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: inkSoft }}>Description</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: inkSoft }}>Points</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: inkSoft }}>Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/50">
                {(data.pointsHistory || []).length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center" style={{ color: inkSoft }}>No points history yet</td>
                  </tr>
                ) : (
                  (data.pointsHistory || []).map((h, i) => (
                    <tr key={i} className="text-slate-700 hover:bg-[#eef7f6] transition-colors">
                      <td className="px-5 py-3 whitespace-nowrap" style={{ color: inkSoft }}>{new Date(h.date).toLocaleDateString()}</td>
                      <td className="px-5 py-3">{h.description}</td>
                      <td className={`px-5 py-3 text-right font-mono ${Number(h.points) >= 0 ? '' : ''}`} style={{ color: Number(h.points) >= 0 ? teal[600] : '#b5493f' }}>
                        {Number(h.points) >= 0 ? '+' : ''}{h.points}
                      </td>
                      <td className="px-5 py-3 text-right font-mono font-semibold">{h.balance?.toLocaleString() || 0}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomerLoyalty;
