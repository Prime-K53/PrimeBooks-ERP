import React, { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { portalApi } from '../../services/portalApiClient';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

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

  if (loading) return <div className="p-6 max-w-7xl mx-auto"><PortalLoadingSkeleton type="table" count={5} /></div>;
  if (error) return <div className="p-6 max-w-7xl mx-auto"><div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 text-sm">{error}</div></div>;
  if (!data) return null;

  const txns = data.transactions || [];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Wallet</h1>
        <p className="text-sm text-slate-500 mt-1">Your digital wallet balance and transactions</p>
      </div>

      <div className="bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 border border-emerald-500/30 rounded-xl p-6 mb-8 max-w-md">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
            <Wallet size={22} className="text-emerald-600" />
          </div>
          <span className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Wallet Balance</span>
        </div>
        <div className="text-3xl font-bold text-slate-900">K {Number(data.balance || 0).toFixed(2)}</div>
      </div>

      <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200/60">
          <h2 className="text-sm font-semibold text-slate-800">Transaction History</h2>
        </div>
        {txns.length === 0 ? (
          <EmptyState icon={Wallet} title="No transactions" description="Your wallet transactions will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px] table-fixed">
              <thead className="bg-slate-50/80 backdrop-blur text-slate-500 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left">Date</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left">Description</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right">Amount</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/50">
                {txns.map((t, i) => (
                  <tr key={i} className="text-slate-700 hover:bg-blue-50/50 transition-colors border-l-4 border-l-transparent">
                    <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{new Date(t.date).toLocaleDateString()}</td>
                    <td className="px-5 py-3">{t.type}</td>
                    <td className={`px-5 py-3 text-right font-mono ${Number(t.amount) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {Number(t.amount) >= 0 ? '+' : ''}K {Number(t.amount).toFixed(2)}
                    </td>
                    <td className="px-5 py-3 text-slate-500">{t.reference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomerWallet;
