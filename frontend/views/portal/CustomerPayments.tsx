import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, Plus } from 'lucide-react';
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

  useEffect(() => {
    portalApi.get<Payment[]>('/payments')
      .then(setPayments)
      .catch((err) => setError(err.message || 'Failed to load payments'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={6} /></div>;
  if (error) return <div className="p-8 max-w-4xl mx-auto"><div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 text-sm">{error}</div></div>;

  return (
    <div>
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
              <CreditCard size={19} color="#fff" />
            </div>
            <div>
              <h1 style={{
                fontFamily: "'DM Serif Display', 'Georgia', serif", fontWeight: 400,
                fontSize: 22, margin: 0, color: teal[800], letterSpacing: 0.2
              }}>
                Payments
              </h1>
              <p style={{ margin: '2px 0 0', fontSize: 11.5, color: inkSoft, letterSpacing: 0.02 }}>
                Your payment history
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate('/portal/new-request')}
            style={{
              fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
              padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid transparent',
              background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
              color: '#fff', display: 'flex', alignItems: 'center', gap: 7,
              boxShadow: '0 6px 16px -6px rgba(15,84,76,.55)',
              transition: 'all .15s ease'
            }}
          >
            <Plus size={14} /> New Payment
          </button>
        </div>

        <div style={{ padding: '24px 30px 8px' }}>
          {error && (
            <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-600">{error}</div>
          )}

          {payments.length === 0 ? (
            <EmptyState icon={CreditCard} title="No payments yet" description="Your payment transactions will appear here." />
          ) : (
            <div style={{
              background: paper, borderRadius: 14,
              border: `1.4px solid ${hairline}`,
              boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(255,255,255,.04)',
              overflow: 'hidden'
            }}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[13px] table-fixed">
                  <thead style={{ background: teal[50] }}>
                    <tr>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: inkSoft }}>Date</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: inkSoft }}>Reference</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: inkSoft }}>Method</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: inkSoft }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100/50">
                    {payments.map((p) => (
                      <tr
                        key={p.id}
                        onClick={() => navigate(`/portal/payments/${p.id}`)}
                        className="transition-colors cursor-pointer group hover:bg-[#eef7f6]"
                      >
                        <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{new Date(p.date).toLocaleDateString()}</td>
                        <td className="px-5 py-3 font-medium text-slate-900">{p.reference}</td>
                        <td className="px-5 py-3">{p.payment_method}</td>
                        <td className="px-5 py-3 text-right font-medium" style={{ color: teal[600] }}>K {Number(p.amount).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CustomerPayments;
