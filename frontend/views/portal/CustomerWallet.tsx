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
  if (error) return <div className="p-6 max-w-7xl mx-auto"><div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 text-rose-300 text-sm">{error}</div></div>;
  if (!data) return null;

  const txns = data.transactions || [];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-100">Wallet</h1>
        <p className="text-sm text-slate-400 mt-1">Your digital wallet balance and transactions</p>
      </div>

      <div className="bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 border border-emerald-500/30 rounded-xl p-6 mb-8 max-w-md">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
            <Wallet size={22} className="text-emerald-400" />
          </div>
          <span className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Wallet Balance</span>
        </div>
        <div className="text-3xl font-bold text-slate-100">K {Number(data.balance || 0).toFixed(2)}</div>
      </div>

      <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-700/60">
          <h2 className="text-sm font-semibold text-slate-200">Transaction History</h2>
        </div>
        {txns.length === 0 ? (
          <EmptyState icon={Wallet} title="No transactions" description="Your wallet transactions will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wider bg-slate-800/80">
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Description</th>
                  <th className="px-5 py-3 font-medium text-right">Amount</th>
                  <th className="px-5 py-3 font-medium">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {txns.map((t, i) => (
                  <tr key={i} className="text-slate-300 hover:bg-slate-700/30 transition-colors">
                    <td className="px-5 py-3 text-slate-400 whitespace-nowrap">{new Date(t.date).toLocaleDateString()}</td>
                    <td className="px-5 py-3">{t.type}</td>
                    <td className={`px-5 py-3 text-right font-mono ${Number(t.amount) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {Number(t.amount) >= 0 ? '+' : ''}K {Number(t.amount).toFixed(2)}
                    </td>
                    <td className="px-5 py-3 text-slate-400">{t.reference}</td>
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
