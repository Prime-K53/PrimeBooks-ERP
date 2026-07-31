import React from 'react';

interface Props {
  type?: 'card' | 'table' | 'detail';
  count?: number;
}

const SkeletonBlock: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse bg-slate-200 rounded-lg ${className}`} />
);

const CardSkeleton: React.FC = () => (
  <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
    <div className="flex items-center justify-between">
      <SkeletonBlock className="h-3 w-20" />
      <SkeletonBlock className="h-8 w-8 rounded-xl" />
    </div>
    <SkeletonBlock className="h-7 w-28" />
    <SkeletonBlock className="h-3 w-16" />
  </div>
);

const TableSkeleton: React.FC = () => (
  <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
    <div className="flex gap-4 pb-3 border-b border-slate-200">
      <SkeletonBlock className="h-3 flex-1" />
      <SkeletonBlock className="h-3 flex-1" />
      <SkeletonBlock className="h-3 w-24" />
      <SkeletonBlock className="h-3 w-20" />
    </div>
    {Array.from({ length: 5 }).map((_, i) => (
      <div key={i} className="flex gap-4">
        <SkeletonBlock className="h-4 flex-1" />
        <SkeletonBlock className="h-4 flex-1" />
        <SkeletonBlock className="h-4 w-24" />
        <SkeletonBlock className="h-4 w-20" />
      </div>
    ))}
  </div>
);

const DetailSkeleton: React.FC = () => (
  <div className="space-y-6">
    <SkeletonBlock className="h-7 w-56" />
    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-2">
          <SkeletonBlock className="h-3 w-16" />
          <SkeletonBlock className="h-5 w-36" />
        </div>
        <div className="space-y-2">
          <SkeletonBlock className="h-3 w-16" />
          <SkeletonBlock className="h-5 w-36" />
        </div>
        <div className="space-y-2">
          <SkeletonBlock className="h-3 w-16" />
          <SkeletonBlock className="h-5 w-36" />
        </div>
        <div className="space-y-2">
          <SkeletonBlock className="h-3 w-16" />
          <SkeletonBlock className="h-5 w-36" />
        </div>
      </div>
      <div className="border-t border-slate-200 pt-5 space-y-3">
        <SkeletonBlock className="h-3 w-32" />
        <SkeletonBlock className="h-4 w-full" />
        <SkeletonBlock className="h-4 w-3/4" />
        <SkeletonBlock className="h-4 w-5/6" />
      </div>
    </div>
  </div>
);

const PortalLoadingSkeleton: React.FC<Props> = ({ type = 'card', count = 4 }) => {
  if (type === 'table') {
    return <TableSkeleton />;
  }

  if (type === 'detail') {
    return <DetailSkeleton />;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
};

export default PortalLoadingSkeleton;
