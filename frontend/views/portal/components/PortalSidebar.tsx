import React, { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, FileText, Receipt, CreditCard,
  FileBarChart, Wallet, MessageSquare, ChevronLeft, ChevronRight,
  User, LogOut, Globe, X, ClipboardList, Users, Truck
} from 'lucide-react';
import { useCustomerAuth } from '../../../context/CustomerAuthContext';
import ThemeSwitcher from './ThemeSwitcher';
import DensityToggle from './DensityToggle';

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    title: 'Main',
    items: [
      { label: 'Dashboard', path: '/portal/dashboard', icon: LayoutDashboard },
    ],
  },
  {
    title: 'Commerce',
    items: [
      { label: 'Orders', path: '/portal/orders', icon: ShoppingCart },
    ],
  },
  {
    title: 'Documents & Billing',
    items: [
      { label: 'Invoices', path: '/portal/invoices', icon: Receipt },
      { label: 'Statements', path: '/portal/statements', icon: FileBarChart },
    ],
  },
  {
    title: 'Finance',
    items: [
      { label: 'Payments', path: '/portal/payments', icon: CreditCard },
      { label: 'Wallet', path: '/portal/wallet', icon: Wallet },
    ],
  },
  {
    title: 'Logistics',
    items: [
      { label: 'Shipments & Tracking', path: '/portal/shipments', icon: Truck },
    ],
  },
  {
    title: 'Rewards',
    items: [
      { label: 'Referrals', path: '/portal/referrals', icon: Users },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Support', path: '/portal/support', icon: MessageSquare },
      { label: 'Profile', path: '/portal/profile', icon: User },
    ],
  },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  density?: 'comfortable' | 'compact';
  onDensityChange?: (density: 'comfortable' | 'compact') => void;
}

const SIDEBAR_COLLAPSED_KEY = 'prime-portal-sidebar-collapsed';
const DENSITY_KEY = 'prime-portal-density';

const PortalSidebar: React.FC<Props> = ({ isOpen, onClose, collapsed: collapsedExternal, onCollapsedChange, density: densityExternal, onDensityChange }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useCustomerAuth();
  const [internalCollapsed, setInternalCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      return stored ? JSON.parse(stored) : false;
    } catch {
      return false;
    }
  });
  const [internalDensity, setInternalDensity] = useState<'comfortable' | 'compact'>(() => {
    try {
      const stored = localStorage.getItem(DENSITY_KEY) as 'comfortable' | 'compact' | null;
      return stored || 'comfortable';
    } catch {
      return 'comfortable';
    }
  });
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  const collapsed = collapsedExternal ?? internalCollapsed;
  const setCollapsed = (value: boolean) => {
    setInternalCollapsed(value);
    onCollapsedChange?.(value);
  };
  const density = densityExternal ?? internalDensity;
  const setDensity = (value: 'comfortable' | 'compact') => {
    setInternalDensity(value);
    onDensityChange?.(value);
    try {
      localStorage.setItem(DENSITY_KEY, value);
    } catch { /* noop */ }
  };
  const navRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const [indicator, setIndicator] = useState({ top: 0, height: 0 });

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, JSON.stringify(collapsed));
    } catch { /* noop */ }
  }, [collapsed]);

  useEffect(() => {
    if (collapsed && activeRef.current && navRef.current) {
      const navRect = navRef.current.getBoundingClientRect();
      const activeRect = activeRef.current.getBoundingClientRect();
      setIndicator({
        top: activeRect.top - navRect.top,
        height: activeRect.height,
      });
    }
  }, [collapsed, location.pathname]);

  const handleNavigate = (path: string) => {
    navigate(path);
    if (window.innerWidth < 768) onClose();
  };

  const handleLogout = () => {
    logout();
    navigate('/portal/login');
  };

  const renderNavItem = (item: NavItem, isActive: boolean) => {
    const Icon = item.icon;
    return (
      <button
        key={item.path}
        ref={isActive ? activeRef : undefined}
        onClick={() => handleNavigate(item.path)}
        onMouseEnter={() => setHoveredItem(item.path)}
        onMouseLeave={() => setHoveredItem(null)}
        className={`
          relative w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 text-sm group
          ${isActive
            ? 'text-white bg-white/[0.08]'
            : 'text-white/70 hover:text-white hover:bg-white/[0.04]'
          }
          ${collapsed ? 'justify-center px-2' : ''}
        `}
        style={isActive ? { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' } : undefined}
      >
        {isActive && !collapsed && (
          <span
            className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full"
            style={{ background: 'linear-gradient(180deg, #f0b35c, #d99a3f)', boxShadow: '0 0 8px rgba(217,154,63,0.4)' }}
          />
        )}
        <Icon size={18} className="shrink-0" style={{ color: isActive ? '#f0b35c' : undefined }} />
        {!collapsed && <span className="font-medium whitespace-nowrap">{item.label}</span>}
        {collapsed && hoveredItem === item.path && (
          <div
            className="absolute left-full ml-2 px-3 py-1.5 rounded-lg text-xs font-medium text-white whitespace-nowrap z-50 pointer-events-none"
            style={{
              background: 'rgba(15,84,76,0.95)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              backdropFilter: 'blur(8px)',
            }}
          >
            {item.label}
          </div>
        )}
      </button>
    );
  };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="h-16 flex items-center gap-3 px-5 shrink-0 border-b border-white/5">
        <div className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center text-white" style={{ background: 'linear-gradient(160deg, #3fa294, #0f544c)' }}>
          <Globe size={18} />
        </div>
        {!collapsed && (
          <div className="flex flex-col min-w-0">
            <span className="font-bold text-[16px] tracking-tight text-white truncate">
              Prime<span style={{ color: '#d99a3f' }}>PORTAL</span>
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider -mt-0.5 truncate" style={{ color: 'rgba(255,255,255,.4)' }}>
              Customer Portal
            </span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden md:flex ml-auto w-6 h-6 items-center justify-center rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-all"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      <nav ref={navRef} className="flex-1 overflow-y-auto custom-scrollbar py-3 px-3 space-y-4 relative">
        {collapsed && indicator.height > 0 && (
          <div
            className="absolute left-0 right-0 mx-auto w-8 rounded-r-lg pointer-events-none"
            style={{
              top: indicator.top,
              height: indicator.height,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 0 12px rgba(15,84,76,0.2)',
              transition: 'all var(--motion-normal) ease',
            }}
          />
        )}
        {navSections.map((section) => (
          <div key={section.title}>
            {!collapsed && (
              <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40">{section.title}</p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = location.pathname.startsWith(item.path);
                return renderNavItem(item, isActive);
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/5 p-4 space-y-3">
        <div className={`flex items-center gap-3 px-2 ${collapsed ? 'justify-center' : ''}`}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: 'linear-gradient(160deg, #3fa294, #0f544c)' }}>
            {(user?.full_name || user?.email || 'C').charAt(0).toUpperCase()}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white truncate">{user?.full_name || 'Customer'}</p>
              <p className="text-xs truncate" style={{ color: 'rgba(255,255,255,.4)' }}>{user?.email || ''}</p>
            </div>
          )}
        </div>
        {!collapsed && (
          <div className="px-1 space-y-2">
            <ThemeSwitcher />
            <DensityToggle value={density} onChange={setDensity} />
          </div>
        )}
        <button
          onClick={handleLogout}
          className={`
            w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-white/70 hover:text-rose-300 hover:bg-rose-500/10 transition-all duration-200
            ${collapsed ? 'justify-center' : ''}
          `}
        >
          <LogOut size={18} className="shrink-0" />
          {!collapsed && <span className="font-medium">Sign Out</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 z-40 h-full flex flex-col text-white/70 border-r border-white/5
          hidden md:flex transition-all duration-200 ease-out
          ${collapsed ? 'w-16' : 'w-64'}
        `}
        style={{ background: 'linear-gradient(180deg, #0b3e39, #082e2a)' }}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Sidebar */}
      {isOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
          <aside
            className="absolute top-0 left-0 h-full w-64 flex flex-col text-white/70 border-r border-white/5"
            style={{ background: 'linear-gradient(180deg, #0b3e39, #082e2a)' }}
          >
            <div className="flex items-center justify-between h-16 px-5 border-b border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center text-white" style={{ background: 'linear-gradient(160deg, #3fa294, #0f544c)' }}>
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
              <button onClick={onClose} className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors" aria-label="Close sidebar">
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
