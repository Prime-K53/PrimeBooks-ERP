import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, FileText, Receipt, CreditCard,
  FileBarChart, FolderOpen, Gift, Wallet, Bell, MessageSquare,
  User, LogOut, Globe, X, ClipboardList
} from 'lucide-react';
import { useCustomerAuth } from '../../../context/CustomerAuthContext';

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/portal/dashboard', icon: LayoutDashboard },
  { label: 'New Request', path: '/portal/new-request', icon: ClipboardList },
  { label: 'Requests', path: '/portal/requests', icon: ClipboardList },
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

  const sidebarHeader = (
    <div className="h-16 flex items-center gap-3 px-5 shrink-0 border-b border-white/5">
      <div className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center text-white font-['DM_Serif_Display']" style={{ background: 'linear-gradient(160deg, #3fa294, #0f544c)' }}>
        <Globe size={18} />
      </div>
      <div className="flex flex-col min-w-0">
        <span className="font-bold text-[16px] tracking-tight text-white truncate">
          Prime<span style={{ color: '#d99a3f' }}>PORTAL</span>
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider -mt-0.5 truncate" style={{ color: 'rgba(255,255,255,.4)' }}>
          Customer Portal
        </span>
      </div>
    </div>
  );

  const sidebarBody = (
    <div className="flex flex-col h-full">
      <nav className="flex-1 overflow-y-auto custom-scrollbar py-3 px-3 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <button
              key={item.path}
              onClick={() => handleNavigate(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 text-sm group ${
                isActive
                  ? 'bg-white/10 text-white border-l-2 border-[#d99a3f]'
                  : 'text-white/70 hover:text-white hover:bg-white/5 border-l-2 border-transparent'
              }`}
            >
              <item.icon size={18} className="shrink-0" />
              <span className="font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="border-t border-white/5 p-4 space-y-3">
        <div className="flex items-center gap-3 px-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: 'linear-gradient(160deg, #3fa294, #0f544c)' }}>
            {(user?.full_name || user?.email || 'C').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white truncate">{user?.full_name || 'Customer'}</p>
            <p className="text-xs truncate" style={{ color: 'rgba(255,255,255,.4)' }}>{user?.email || ''}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/70 hover:text-rose-300 hover:bg-rose-500/10 transition-all duration-200 border-l-2 border-transparent"
        >
          <LogOut size={18} className="shrink-0" />
          <span className="font-medium">Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="fixed top-0 left-0 z-40 h-full w-64 hidden md:flex flex-col text-white/70 border-r border-white/5" style={{ background: 'linear-gradient(180deg, #0b3e39, #082e2a)' }}>
        {sidebarHeader}
        {sidebarBody}
      </aside>

      {isOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
          <aside className="absolute top-0 left-0 h-full w-64 flex flex-col text-white/70 border-r border-white/5" style={{ background: 'linear-gradient(180deg, #0b3e39, #082e2a)' }}>
            <div className="flex items-center justify-between h-16 px-5 border-b border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center text-white font-['DM_Serif_Display']" style={{ background: 'linear-gradient(160deg, #3fa294, #0f544c)' }}>
                  <Globe size={18} />
                </div>
                <div className="flex flex-col">
                  <span className="font-bold text-[16px] tracking-tight text-white truncate">
                    Prime<span style={{ color: '#d99a3f' }}>PORTAL</span>
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider -mt-0.5 truncate" style={{ color: 'rgba(255,255,255,.4)' }}>
                    Customer Portal
                  </span>
                </div>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors">
                <X size={18} />
              </button>
            </div>
            {sidebarBody}
          </aside>
        </div>
      )}
    </>
  );
};

export default PortalSidebar;
