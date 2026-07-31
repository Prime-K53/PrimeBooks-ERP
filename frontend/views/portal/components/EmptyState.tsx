import React from 'react';

interface Props {
  icon: React.ElementType | React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

const EmptyState: React.FC<Props> = ({ icon, title, description, action }) => {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="p-4 rounded-2xl bg-white border border-slate-200 mb-5 text-slate-400 shadow-sm">
        {React.isValidElement(icon) ? icon : React.createElement(icon as React.ElementType, { size: 36 })}
      </div>
      <h3 className="text-lg font-semibold text-slate-800 mb-1.5">{title}</h3>
      {description && (
        <p className="text-sm text-slate-500 max-w-sm leading-relaxed mb-6">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-green-500 hover:from-emerald-500 hover:to-green-400 text-white text-sm font-semibold rounded-xl shadow-lg shadow-emerald-600/25 transition-all"
        >
          {action.label}
        </button>
      )}
    </div>
  );
};

export default EmptyState;
