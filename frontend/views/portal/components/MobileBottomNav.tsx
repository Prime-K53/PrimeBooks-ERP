import React from 'react';
import { LayoutDashboard, ShoppingCart, Wallet, MessageSquare, User } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

const MobileBottomNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const items = [
    { label: 'Dashboard', icon: LayoutDashboard, path: '/portal/dashboard' },
    { label: 'Orders', icon: ShoppingCart, path: '/portal/orders' },
    { label: 'Wallet', icon: Wallet, path: '/portal/wallet' },
    { label: 'Messages', icon: MessageSquare, path: '/portal/support' },
    { label: 'Profile', icon: User, path: '/portal/profile' },
  ];

  return (
    <nav className="mobile-bottom-nav md:hidden" aria-label="Mobile navigation">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
        return (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={`mobile-bottom-nav-item ${isActive ? 'active' : ''}`}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon size={20} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export default MobileBottomNav;
