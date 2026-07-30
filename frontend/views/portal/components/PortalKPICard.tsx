import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface Props {
  label: string;
  value: string | number;
  icon: React.ElementType;
  trend?: { value: number; positive: boolean };
  color?: 'emerald' | 'blue' | 'amber' | 'rose' | 'violet';
}

const colorConfig: Record<string, { bg: string; circle: string; icon: string }> = {
  emerald: { bg: 'bg-emerald-500/10', circle: 'bg-emerald-500/15', icon: 'text-emerald-400' },
  blue: { bg: 'bg-blue-500/10', circle: 'bg-blue-500/15', icon: 'text-blue-400' },
  amber: { bg: 'bg-amber-500/10', circle: 'bg-amber-500/15', icon: 'text-amber-400' },
  rose: { bg: 'bg-rose-500/10', circle: 'bg-rose-500/15', icon: 'text-rose-400' },
  violet: { bg: 'bg-violet-500/10', circle: 'bg-violet-500/15', icon: 'text-violet-400' },
};

const PortalKPICard: React.FC<Props> = ({ label, value, icon: Icon, trend, color = 'emerald' }) => {
  const colors = colorConfig[color];

  return (
    <div className="bg-slate-800/80 border border-slate-700/50 rounded-xl p-5 hover:border-slate-600/50 transition-all">
      <div className="flex items-start justify-between mb-4">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
        <div className={`p-2.5 rounded-xl ${colors.circle}`}>
          <Icon size={18} className={colors.icon} />
        </div>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-2xl font-bold text-slate-100">{value}</span>
        {trend && (
          <span className={`inline-flex items-center gap-1 text-xs font-semibold ${trend.positive ? 'text-emerald-400' : 'text-rose-400'}`}>
            {trend.positive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {trend.value}%
          </span>
        )}
      </div>
    </div>
  );
};

export default PortalKPICard;
