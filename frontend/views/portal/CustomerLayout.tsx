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
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/portal/login" replace />;
  }

  return (
    <div className="min-h-screen bg-slate-900">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      <PortalSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <PortalHeader title={currentTitle} onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <main className="pt-16 md:ml-64 min-h-screen">
        <div className="p-4 md:p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default CustomerLayout;
