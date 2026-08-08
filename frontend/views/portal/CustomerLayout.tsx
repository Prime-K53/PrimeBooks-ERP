import React, { useState, useEffect, useCallback, Component, ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { portalLifecycle } from '../../services/portalApiClient';
import PortalSidebar from './components/PortalSidebar';
import PortalHeader from './components/PortalHeader';
import { ToastProvider } from './components/Toast';
import CommandPalette from './components/CommandPalette';
import PortalQuickActions from './components/PortalQuickActions';
import OfflineIndicator from './components/OfflineIndicator';
import { ThemeProvider } from './context/ThemeContext';
import { AlertTriangle, RefreshCw, Search } from 'lucide-react';

// Error Boundary for catching errors in portal pages
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class PortalErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[PortalErrorBoundary] Caught error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 max-w-7xl mx-auto">
          <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-rose-50 flex items-center justify-center">
              <AlertTriangle size={32} className="text-rose-500" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Something went wrong</h2>
            <p className="text-slate-600 mb-6">
              An unexpected error occurred while loading this page. Please try again or contact support if the problem persists.
            </p>
            <button
              onClick={this.handleRetry}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white"
              style={{ background: 'linear-gradient(90deg, #146b60, #3fa294)' }}
            >
              <RefreshCw size={16} />
              Try Again
            </button>
            {this.state.error && (
              <details className="mt-6 text-left">
                <summary className="text-xs text-slate-400 cursor-pointer">Error details</summary>
                <pre className="mt-2 p-3 bg-slate-50 rounded text-xs text-slate-500 overflow-auto max-h-48">
                  {this.state.error.message}
                  {this.state.error.stack && `\n\n${this.state.error.stack}`}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const pageTitles: Record<string, string> = {
  '/portal/dashboard': 'Dashboard',
  '/portal/requests': 'Requests',
  '/portal/orders': 'Orders',
  '/portal/quotations': 'Quotations',
   '/portal/invoices': 'Invoices',
   '/portal/payments': 'Payments',
   '/portal/statements': 'Statements',
   '/portal/referrals': 'Referrals',
   '/portal/wallet': 'Wallet',
   '/portal/support': 'Support',
   '/portal/profile': 'Profile',
};

const CustomerLayout: React.FC = () => {
  const { isAuthenticated, loading } = useCustomerAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem('prime-portal-sidebar-collapsed');
      return stored ? JSON.parse(stored) : false;
    } catch {
      return false;
    }
  });
  const [commandOpen, setCommandOpen] = useState(false);
  const [density, setDensity] = useState<'comfortable' | 'compact'>(() => {
    try {
      const stored = localStorage.getItem('prime-portal-density') as 'comfortable' | 'compact' | null;
      return stored || 'comfortable';
    } catch {
      return 'comfortable';
    }
  });

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

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
    <ThemeProvider>
      <ToastProvider>
        <div className={`min-h-screen bg-gradient-to-b from-[#f8fafc] to-[#f1f5f9] density-${density}`}>
          <a href="#main-content" className="skip-nav">Skip to main content</a>
          {sidebarOpen && (
            <div className="fixed inset-0 z-40 md:hidden" onClick={closeSidebar} />
          )}
          <PortalSidebar isOpen={sidebarOpen} onClose={closeSidebar} collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed} />
          <PortalHeader title={currentTitle} onMenuToggle={toggleSidebar} sidebarCollapsed={sidebarCollapsed} onCommandToggle={() => setCommandOpen((v) => !v)} />
           <main
            id="main-content"
            className={`fixed top-14 md:top-16 right-0 overflow-x-auto overflow-y-auto custom-scrollbar transition-all duration-200 ease-out md:bottom-0 bottom-16 ${sidebarCollapsed ? 'md:left-16 left-0' : 'md:left-[286px] left-0'}`}
          >
            <div className="page-shell py-4 md:py-6 min-w-0">
              <div className="mx-auto w-full" style={{ maxWidth: '920px', padding: '28px 20px 64px' }}>
                <div className="page-content min-h-[calc(100vh-56px-48px)] bg-gradient-to-b from-[#f8fafc] to-[#f1f5f9] px-0">
                  <PortalErrorBoundary>
                    <Outlet />
                  </PortalErrorBoundary>
                </div>
              </div>
            </div>
          </main>
          <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
          <PortalQuickActions />
        </div>
      </ToastProvider>
    </ThemeProvider>
  );
};

export default CustomerLayout;
