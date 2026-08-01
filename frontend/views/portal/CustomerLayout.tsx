import React, { useState, useEffect, useCallback } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import PortalSidebar from './components/PortalSidebar';
import PortalHeader from './components/PortalHeader';
import { ToastProvider } from './components/Toast';

const pageTitles: Record<string, string> = {
  '/portal/dashboard': 'Dashboard',
  '/portal/requests': 'Requests',
  '/portal/orders': 'Orders',
  '/portal/quotations': 'Quotations',
  '/portal/invoices': 'Invoices',
  '/portal/payments': 'Payments',
  '/portal/statements': 'Statements',
  '/portal/documents': 'Documents',
  '/portal/referrals': 'Referrals',
  '/portal/loyalty': 'Loyalty',
  '/portal/wallet': 'Wallet',
  '/portal/notifications': 'Notifications',
  '/portal/support': 'Support',
  '/portal/profile': 'Profile',
};

const CustomerLayout: React.FC = () => {
  const { isAuthenticated, loading } = useCustomerAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const currentTitle = pageTitles[location.pathname] || 'Customer Portal';

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--dashboard-bg)] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-teal-500/30 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/portal/login" replace />;
  }

  return (
    <ToastProvider>
      <div className="min-h-screen bg-[var(--dashboard-bg)]">
        <a href="#main-content" className="skip-nav">Skip to main content</a>
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 md:hidden" onClick={closeSidebar} />
        )}
        <PortalSidebar isOpen={sidebarOpen} onClose={closeSidebar} />
        <PortalHeader title={currentTitle} onMenuToggle={toggleSidebar} />
        <main id="main-content" className="fixed top-16 bottom-0 left-0 right-0 md:left-64 overflow-x-auto overflow-y-auto custom-scrollbar">
          <div className="p-4 md:p-6 min-w-0">
            <Outlet />
          </div>
        </main>
      </div>
    </ToastProvider>
  );
};

export default CustomerLayout;
