import React, { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { portalApi } from '../../services/portalApiClient';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

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
    portalApi.get<WalletData>('/wallet')
      .then(setData)
      .catch((err) => setError(err.message || 'Failed to load wallet'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={5} /></div>;
  if (error) return <div className="p-8 max-w-4xl mx-auto"><div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 text-sm">{error}</div></div>;
  if (!data) return null;

  const txns = data.transactions || [];

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
            <Wallet size={19} color="#fff" />
          </div>
          <div>
            <h1 style={{
              fontFamily: "'DM Serif Display', 'Georgia', serif", fontWeight: 400,
              fontSize: 22, margin: 0, color: teal[800], letterSpacing: 0.2
            }}>
              Wallet
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 11.5, color: inkSoft, letterSpacing: 0.02 }}>
              Your digital wallet balance and transactions
            </p>
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 30px 8px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '20px 24px', marginBottom: 18,
          background: paper, borderRadius: 14,
          border: `1.4px solid ${hairline}`,
          boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(255,255,255,.04)'
        }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: teal[50], display: 'flex', alignItems: 'center', justifyContent: 'center', color: teal[600], flexShrink: 0 }}>
            <Wallet size={22} />
          </div>
          <div style={{ minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>Wallet Balance</span>
            <div style={{ fontSize: 22, fontWeight: 700, color: ink, fontFamily: "'JetBrains Mono', monospace" }}>
              K {Number(data.balance || 0).toFixed(2)}
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
              Transaction History
            </h2>
          </div>
          {txns.length === 0 ? (
            <EmptyState icon={<Wallet size={28} />} title="No transactions" description="Your wallet transactions will appear here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13px] table-fixed">
                <thead style={{ background: teal[50] }}>
                  <tr>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: inkSoft }}>Date</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: inkSoft }}>Description</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: inkSoft }}>Amount</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: inkSoft }}>Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100/50">
                  {txns.map((t, i) => (
                    <tr key={i} className="text-slate-700 hover:bg-[#eef7f6] transition-colors">
                      <td className="px-5 py-3 whitespace-nowrap" style={{ color: inkSoft }}>{new Date(t.date).toLocaleDateString()}</td>
                      <td className="px-5 py-3">{t.type}</td>
                      <td className="px-5 py-3 text-right font-mono" style={{ color: Number(t.amount) >= 0 ? teal[600] : '#b5493f' }}>
                        {Number(t.amount) >= 0 ? '+' : ''}K {Number(t.amount).toFixed(2)}
                      </td>
                      <td className="px-5 py-3" style={{ color: inkSoft }}>{t.reference}</td>
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
