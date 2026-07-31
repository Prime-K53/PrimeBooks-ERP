import React, { useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import PortalSidebar from './components/PortalSidebar';
import PortalHeader from './components/PortalHeader';

const pageTitles: Record<string, string> = {
  '/portal/dashboard': 'Dashboard',
  '/portal/orders': 'Orders',
  '/portal/quotations': 'Quotations',
  '/portal/invoices': 'Invoices',
  '/portal/payments': 'Payments',
  '/portal/statements': 'Statements',
  '/portal/documents': 'Documents',
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
    <div className="min-h-screen bg-[var(--dashboard-bg)]">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      <PortalSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <PortalHeader title={currentTitle} onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <main className="fixed top-16 bottom-0 left-0 right-0 md:left-64 overflow-x-auto overflow-y-auto custom-scrollbar">
        <div className="p-4 md:p-6 min-w-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default CustomerLayout;
