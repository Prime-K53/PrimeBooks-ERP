import React, { useState, useEffect } from 'react';
import { Plus, ShoppingCart, FileText, Receipt, MessageSquare, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface QuickAction {
  label: string;
  icon: React.ElementType;
  path: string;
  color: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: 'New Order', icon: ShoppingCart, path: '/portal/new-request?type=order', color: '#1f8577' },
  { label: 'New Quotation', icon: FileText, path: '/portal/new-request?type=quotation', color: '#7c3aed' },
  { label: 'New Request', icon: Receipt, path: '/portal/new-request?type=request', color: '#2563eb' },
  { label: 'Pay Invoice', icon: Receipt, path: '/portal/invoices?status=Unpaid', color: '#d99a3f' },
  { label: 'Contact Support', icon: MessageSquare, path: '/portal/support', color: '#059669' },
];

const PortalQuickActions: React.FC = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const handleNavigate = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <div className="fixed bottom-6 right-4 md:right-8 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="flex flex-col gap-2 mb-2" style={{ animation: 'fadeIn .15s ease' }}>
          {QUICK_ACTIONS.map((action, idx) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                onClick={() => handleNavigate(action.path)}
                className="glass-panel flex items-center gap-3 pl-3 pr-4 py-2.5 rounded-full shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all group"
                style={{ animationDelay: `${idx * 30}ms` }}
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0"
                  style={{ background: action.color, boxShadow: `0 4px 10px -4px ${action.color}80` }}>
                  <Icon size={16} />
                </div>
                <span className="text-sm font-semibold text-slate-700 whitespace-nowrap">{action.label}</span>
              </button>
            );
          })}
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-14 h-14 rounded-full flex items-center justify-center text-white shadow-lg transition-all hover:shadow-xl ${open ? 'rotate-45' : 'hover:scale-105'}`}
        style={{
          background: open ? 'linear-gradient(135deg, #dc2626, #b91c1c)' : 'linear-gradient(135deg, #1f8577, #0f544c)',
          boxShadow: open ? '0 10px 25px -8px rgba(185,28,28,.5)' : '0 10px 25px -8px rgba(15,84,76,.5)',
        }}
        aria-label={open ? 'Close quick actions' : 'Open quick actions'}
      >
        {open ? <X size={22} /> : <Plus size={22} />}
      </button>
    </div>
  );
};

export default PortalQuickActions;
