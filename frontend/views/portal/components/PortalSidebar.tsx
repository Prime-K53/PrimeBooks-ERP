import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, FileText, Receipt, CreditCard,
  FileBarChart, FolderOpen, Gift, Wallet, Bell, MessageSquare,
  User, LogOut, Globe, X
} from 'lucide-react';
import { useCustomerAuth } from '../../../context/CustomerAuthContext';

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/portal/dashboard', icon: LayoutDashboard },
  { label: 'Orders', path: '/portal/orders', icon: ShoppingCart },
  { label: 'Quotations', path: '/portal/quotations', icon: FileText },
  { label: 'Invoices', path: '/portal/invoices', icon: Receipt },
  { label: 'Payments', path: '/portal/payments', icon: CreditCard },
  { label: 'Statements', path: '/portal/statements', icon: FileBarChart },
  { label: 'Documents', path: '/portal/documents', icon: FolderOpen },
  { label: 'Loyalty', path: '/portal/loyalty', icon: Gift },
  { label: 'Wallet', path: '/portal/wallet', icon: Wallet },
  { label: 'Notifications', path: '/portal/notifications', icon: Bell },
  { label: 'Support', path: '/portal/support', icon: MessageSquare },
  { label: 'Profile', path: '/portal/profile', icon: User },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const PortalSidebar: React.FC<Props> = ({ isOpen, onClose }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useCustomerAuth();

  const handleNavigate = (path: string) => {
    navigate(path);
    if (window.innerWidth < 768) onClose();
  };

  const handleLogout = () => {
    logout();
    navigate('/portal/login');
  };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="h-16 flex items-center gap-3 px-5 shrink-0 border-b border-slate-700/40">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-green-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
          <Globe size={18} className="text-white" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-bold text-slate-100 tracking-tight">Customer Portal</span>
          <span className="text-[9px] text-emerald-400 uppercase tracking-[0.18em] font-semibold">Prime ERP</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto custom-scrollbar py-3 px-3 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <button
              key={item.path}
              onClick={() => handleNavigate(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 text-sm group ${
                isActive
                  ? 'bg-emerald-500/10 text-emerald-400 border-l-2 border-emerald-400'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 border-l-2 border-transparent'
              }`}
            >
              <item.icon size={18} className="shrink-0" />
              <span className="font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="border-t border-slate-700/40 p-4 space-y-3">
        <div className="flex items-center gap-3 px-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-green-400 flex items-center justify-center text-white text-xs font-bold shadow-lg shadow-emerald-500/20 shrink-0">
            {(user?.full_name || user?.email || 'C').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-200 truncate">{user?.full_name || 'Customer'}</p>
            <p className="text-xs text-slate-500 truncate">{user?.email || ''}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all duration-200 border-l-2 border-transparent"
        >
          <LogOut size={18} className="shrink-0" />
          <span className="font-medium">Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="fixed top-0 left-0 z-40 h-full w-64 bg-slate-800/95 border-r border-slate-700/40 hidden md:flex flex-col backdrop-blur-sm">
        {sidebarContent}
      </aside>

      {isOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
          <aside className="absolute top-0 left-0 h-full w-64 bg-slate-800 border-r border-slate-700/40 flex flex-col">
            <div className="flex items-center justify-between h-16 px-5 border-b border-slate-700/40">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-green-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                  <Globe size={18} className="text-white" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-slate-100 tracking-tight">Customer Portal</span>
                  <span className="text-[9px] text-emerald-400 uppercase tracking-[0.18em] font-semibold">Prime ERP</span>
                </div>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 transition-colors">
                <X size={18} />
              </button>
            </div>
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
};

export default PortalSidebar;
