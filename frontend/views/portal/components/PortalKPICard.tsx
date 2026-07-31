import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface Props {
  label: string;
  value: string | number;
  icon: React.ElementType;
  trend?: { value: number; positive: boolean };
  color?: 'emerald' | 'blue' | 'amber' | 'rose' | 'violet';
}

const colorConfig: Record<string, { circle: string; icon: string }> = {
  emerald: { circle: 'bg-emerald-100', icon: 'text-emerald-600' },
  blue: { circle: 'bg-blue-100', icon: 'text-blue-600' },
  amber: { circle: 'bg-amber-100', icon: 'text-amber-600' },
  rose: { circle: 'bg-rose-100', icon: 'text-rose-600' },
  violet: { circle: 'bg-violet-100', icon: 'text-violet-600' },
};

const PortalKPICard: React.FC<Props> = ({ label, value, icon: Icon, trend, color = 'emerald' }) => {
  const colors = colorConfig[color];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 hover:shadow-md hover:shadow-slate-200/60 transition-all">
      <div className="flex items-start justify-between mb-4">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
        <div className={`p-2.5 rounded-xl ${colors.circle}`}>
          <Icon size={18} className={colors.icon} />
        </div>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-2xl font-bold text-slate-900">{value}</span>
        {trend && (
          <span className={`inline-flex items-center gap-1 text-xs font-semibold ${trend.positive ? 'text-emerald-600' : 'text-rose-600'}`}>
            {trend.positive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {trend.value}%
          </span>
        )}
      </div>
    </div>
  );
};

export default PortalKPICard;
