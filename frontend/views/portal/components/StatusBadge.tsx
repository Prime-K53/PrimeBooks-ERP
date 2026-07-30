import React from 'react';

interface Props {
  status: string;
  size?: 'sm' | 'md';
}

const statusColorMap: Record<string, { bg: string; text: string; dot: string }> = {
  active: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  paid: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  confirmed: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  complete: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  fulfilled: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  delivered: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  unpaid: { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
  pending: { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
  draft: { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
  overdue: { bg: 'bg-rose-500/10', text: 'text-rose-400', dot: 'bg-rose-400' },
  cancelled: { bg: 'bg-rose-500/10', text: 'text-rose-400', dot: 'bg-rose-400' },
  voided: { bg: 'bg-rose-500/10', text: 'text-rose-400', dot: 'bg-rose-400' },
  processing: { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-400' },
  inprogress: { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-400' },
  in_progress: { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-400' },
};

const StatusBadge: React.FC<Props> = ({ status, size = 'md' }) => {
  const key = status?.toLowerCase().replace(/\s+/g, '') || '';
  const colors = statusColorMap[key] || { bg: 'bg-slate-500/10', text: 'text-slate-400', dot: 'bg-slate-400' };
  const isSmall = size === 'sm';

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-semibold rounded-full whitespace-nowrap ${
        colors.bg
      } ${colors.text} ${isSmall ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1'}`}
    >
      <span className={`rounded-full ${colors.dot} ${isSmall ? 'w-1.5 h-1.5' : 'w-2 h-2'}`} />
      {status}
    </span>
  );
};

export default StatusBadge;
