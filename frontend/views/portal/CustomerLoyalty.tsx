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

const tierColors: Record<string, string> = {
  bronze: 'bg-amber-600/20 text-amber-300 border-amber-500/30',
  silver: 'bg-slate-400/20 text-slate-300 border-slate-400/30',
  gold: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  platinum: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  diamond: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
};

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

  if (loading) return <div className="p-6 max-w-7xl mx-auto"><PortalLoadingSkeleton type="card" count={3} /></div>;
  if (error) return <div className="p-6 max-w-7xl mx-auto"><div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 text-rose-300 text-sm">{error}</div></div>;
  if (!data) return null;

  const tierClass = tierColors[data.tier?.toLowerCase()] || tierColors.bronze;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-100">Loyalty Program</h1>
        <p className="text-sm text-slate-400 mt-1">Your rewards and membership benefits</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-gradient-to-br from-violet-500/20 to-violet-600/10 border border-violet-500/30 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
              <Gift size={22} className="text-violet-400" />
            </div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Points Balance</span>
          </div>
          <div className="text-3xl font-bold text-slate-100">{data.points?.toLocaleString() || 0}</div>
        </div>

        <div className="bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 border border-emerald-500/30 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <Wallet size={22} className="text-emerald-400" />
            </div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Cashback Available</span>
          </div>
          <div className="text-3xl font-bold text-slate-100">K {Number(data.cashback || 0).toFixed(2)}</div>
        </div>

        <div className="bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/30 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
              <Star size={22} className="text-amber-400" />
            </div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Membership Tier</span>
          </div>
          <div className={`inline-block px-4 py-1.5 rounded-full text-sm font-bold border ${tierClass} mt-1 capitalize`}>
            {data.tier || 'Bronze'}
          </div>
        </div>
      </div>

      <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-700/60">
          <h2 className="text-sm font-semibold text-slate-200">Points History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 uppercase tracking-wider bg-slate-800/80">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Description</th>
                <th className="px-5 py-3 font-medium text-right">Points</th>
                <th className="px-5 py-3 font-medium text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/60">
              {(data.pointsHistory || []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-slate-500">No points history yet</td>
                </tr>
              ) : (
                (data.pointsHistory || []).map((h, i) => (
                  <tr key={i} className="text-slate-300 hover:bg-slate-700/30 transition-colors">
                    <td className="px-5 py-3 text-slate-400 whitespace-nowrap">{new Date(h.date).toLocaleDateString()}</td>
                    <td className="px-5 py-3">{h.description}</td>
                    <td className={`px-5 py-3 text-right font-mono ${Number(h.points) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
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
  );
};

export default CustomerLoyalty;
