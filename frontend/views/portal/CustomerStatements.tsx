import React, { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
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

interface Transaction {
  date: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

interface StatementData {
  opening_balance: number;
  closing_balance: number;
  transactions: Transaction[];
}

const CustomerStatements: React.FC = () => {
  const [data, setData] = useState<StatementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchStatement = (start?: string, end?: string) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (start) params.set('startDate', start);
    if (end) params.set('endDate', end);
    const qs = params.toString();
    portalApi.get<StatementData>(`/statements${qs ? `?${qs}` : ''}`)
      .then(setData)
      .catch((err) => setError(err.message || 'Failed to load statement'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const end = new Date().toISOString().split('T')[0];
    const start = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
    setStartDate(start);
    setEndDate(end);
    fetchStatement(start, end);
  }, []);

  const handleFilter = (e: React.FormEvent) => {
    e.preventDefault();
    fetchStatement(startDate, endDate);
  };

  if (loading) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={6} /></div>;
  if (error) return <div className="p-8 max-w-4xl mx-auto"><div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 text-sm">{error}</div></div>;
  if (!data) return null;

  const txns = data.transactions || [];

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
              <FileText size={19} color="#fff" />
            </div>
            <div>
              <h1 style={{
                fontFamily: "'DM Serif Display', 'Georgia', serif", fontWeight: 400,
                fontSize: 22, margin: 0, color: teal[800], letterSpacing: 0.2
              }}>
                Statements
              </h1>
              <p style={{ margin: '2px 0 0', fontSize: 11.5, color: inkSoft, letterSpacing: 0.02 }}>
                View account statements for any period
              </p>
            </div>
          </div>
        </div>

        <div style={{ padding: '24px 30px 8px' }}>
          {error && (
            <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-600">{error}</div>
          )}

          <form onSubmit={handleFilter} style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12, marginBottom: 18
          }}>
            <div>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 600, color: teal[800],
                marginBottom: 6, letterSpacing: 0.01
              }}>
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{
                  width: '100%', fontFamily: "'Inter', sans-serif", fontSize: 13.5,
                  color: ink, background: paper,
                  border: `1.4px solid ${hairline}`, borderRadius: 9,
                  padding: '9px 12px', outline: 'none',
                  transition: 'border-color .15s ease, box-shadow .15s ease, background .15s ease'
                }}
                onFocus={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.boxShadow = `0 0 0 3px ${teal[50]}`; }}
                onBlur={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>
            <div>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 600, color: teal[800],
                marginBottom: 6, letterSpacing: 0.01
              }}>
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{
                  width: '100%', fontFamily: "'Inter', sans-serif", fontSize: 13.5,
                  color: ink, background: paper,
                  border: `1.4px solid ${hairline}`, borderRadius: 9,
                  padding: '9px 12px', outline: 'none',
                  transition: 'border-color .15s ease, box-shadow .15s ease, background .15s ease'
                }}
                onFocus={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.boxShadow = `0 0 0 3px ${teal[50]}`; }}
                onBlur={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>
            <button
              type="submit"
              style={{
                fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
                padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid transparent',
                background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
                color: '#fff', display: 'flex', alignItems: 'center', gap: 7,
                boxShadow: '0 6px 16px -6px rgba(15,84,76,.55)',
                transition: 'all .15s ease', height: 42
              }}
            >
              Filter
            </button>
          </form>

          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 18
          }}>
            <div style={{
              background: paper, borderRadius: 14,
              border: `1.4px solid ${hairline}`,
              boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(255,255,255,.04)',
              padding: '20px 24px'
            }}>
              <span style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 600, color: inkSoft,
                marginBottom: 6, letterSpacing: 0.01
              }}>
                Opening Balance
              </span>
              <div style={{ fontSize: 20, fontWeight: 700, color: ink, fontFamily: "'JetBrains Mono', monospace" }}>
                K {Number(data.opening_balance || 0).toFixed(2)}
              </div>
            </div>
            <div style={{
              background: paper, borderRadius: 14,
              border: `1.4px solid ${hairline}`,
              boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(255,255,255,.04)',
              padding: '20px 24px'
            }}>
              <span style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 600, color: inkSoft,
                marginBottom: 6, letterSpacing: 0.01
              }}>
                Closing Balance
              </span>
              <div style={{ fontSize: 20, fontWeight: 700, color: ink, fontFamily: "'JetBrains Mono', monospace" }}>
                K {Number(data.closing_balance || 0).toFixed(2)}
              </div>
            </div>
          </div>

          {txns.length === 0 ? (
            <EmptyState icon={<FileText size={28} />} title="No transactions" description="No transactions found for the selected period." />
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
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: inkSoft }}>Description</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: inkSoft }}>Debit</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: inkSoft }}>Credit</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: inkSoft }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100/50">
                    {txns.map((t, i) => (
                      <tr key={i} className="text-slate-700 hover:bg-[#eef7f6] transition-colors">
                        <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{new Date(t.date).toLocaleDateString()}</td>
                        <td className="px-5 py-3">{t.description}</td>
                        <td className="px-5 py-3 text-right font-mono" style={{ color: '#b5493f' }}>{t.debit ? `K ${Number(t.debit).toFixed(2)}` : '-'}</td>
                        <td className="px-5 py-3 text-right font-mono" style={{ color: teal[600] }}>{t.credit ? `K ${Number(t.credit).toFixed(2)}` : '-'}</td>
                        <td className="px-5 py-3 text-right font-mono font-semibold">K {Number(t.balance).toFixed(2)}</td>
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

export default CustomerStatements;
