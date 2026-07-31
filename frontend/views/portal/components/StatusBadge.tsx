import React from 'react';

interface Props {
  status: string;
  size?: 'sm' | 'md';
}

const statusColorMap: Record<string, { bg: string; text: string; dot: string }> = {
  active: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  paid: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  confirmed: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  complete: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  fulfilled: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  delivered: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  unpaid: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' },
  pending: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' },
  draft: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' },
  overdue: { bg: 'bg-rose-100', text: 'text-rose-700', dot: 'bg-rose-500' },
  cancelled: { bg: 'bg-rose-100', text: 'text-rose-700', dot: 'bg-rose-500' },
  voided: { bg: 'bg-rose-100', text: 'text-rose-700', dot: 'bg-rose-500' },
  processing: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' },
  inprogress: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' },
  in_progress: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' },
};

const StatusBadge: React.FC<Props> = ({ status, size = 'md' }) => {
  const key = status?.toLowerCase().replace(/\s+/g, '') || '';
  const colors = statusColorMap[key] || { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' };
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
