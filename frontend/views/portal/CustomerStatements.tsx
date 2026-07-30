import React, { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { portalApi } from '../../services/portalApiClient';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

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

  if (loading) return <div className="p-6 max-w-7xl mx-auto"><PortalLoadingSkeleton type="table" count={6} /></div>;
  if (error) return <div className="p-6 max-w-7xl mx-auto"><div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 text-rose-300 text-sm">{error}</div></div>;
  if (!data) return null;

  const txns = data.transactions || [];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-100">Statements</h1>
        <p className="text-sm text-slate-400 mt-1">View account statements for any period</p>
      </div>

      <form onSubmit={handleFilter} className="flex flex-wrap items-end gap-3 mb-6">
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-10 px-3 bg-slate-800/60 border border-slate-700/60 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-10 px-3 bg-slate-800/60 border border-slate-700/60 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60"
          />
        </div>
        <button
          type="submit"
          className="h-10 px-5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          Filter
        </button>
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Opening Balance</span>
          <div className="text-2xl font-bold text-slate-100 mt-1">K {Number(data.opening_balance || 0).toFixed(2)}</div>
        </div>
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Closing Balance</span>
          <div className="text-2xl font-bold text-slate-100 mt-1">K {Number(data.closing_balance || 0).toFixed(2)}</div>
        </div>
      </div>

      {txns.length === 0 ? (
        <EmptyState icon={<FileText size={28} />} title="No transactions" description="No transactions found for the selected period." />
      ) : (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wider bg-slate-800/80">
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Description</th>
                  <th className="px-5 py-3 font-medium text-right">Debit</th>
                  <th className="px-5 py-3 font-medium text-right">Credit</th>
                  <th className="px-5 py-3 font-medium text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {txns.map((t, i) => (
                  <tr key={i} className="text-slate-300 hover:bg-slate-700/30 transition-colors">
                    <td className="px-5 py-3 text-slate-400 whitespace-nowrap">{new Date(t.date).toLocaleDateString()}</td>
                    <td className="px-5 py-3">{t.description}</td>
                    <td className="px-5 py-3 text-right font-mono text-rose-400">{t.debit ? `K ${Number(t.debit).toFixed(2)}` : '-'}</td>
                    <td className="px-5 py-3 text-right font-mono text-emerald-400">{t.credit ? `K ${Number(t.credit).toFixed(2)}` : '-'}</td>
                    <td className="px-5 py-3 text-right font-mono font-semibold">K {Number(t.balance).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerStatements;
