import React, { useState, useEffect, useCallback, Component, ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { portalLifecycle } from '../../services/portalApiClient';
import PortalSidebar from './components/PortalSidebar';
import PortalHeader from './components/PortalHeader';
import { ToastProvider } from './components/Toast';
import { AlertTriangle, RefreshCw } from 'lucide-react';

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

  // ─── Browser Notifications ───
  useEffect(() => {
    if (!isAuthenticated) return;

    const enabled = localStorage.getItem('portal_browser_notifications') !== 'false';
    if (!enabled) return;

    if (!('Notification' in window)) return;

    const requestPermission = async () => {
      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    };

    requestPermission();

    let unsubscribe: (() => void) | null = null;

    const setupSubscription = async () => {
      try {
        unsubscribe = await portalLifecycle.subscribe({
          onEvent: (type, payload) => {
            if (type !== 'notification' || Notification.permission !== 'granted') return;

            const notif = payload?.notification || payload;
            const title = notif?.title || 'New notification';
            const body = notif?.message || notif?.body || '';

            new Notification(title, {
              body,
              icon: '/favicon.ico',
              tag: notif?.id || `portal-${Date.now()}`,
            });
          },
          onError: () => {},
        });
      } catch {
        // Silent fail — SSE is optional, real-time still works via polling
      }
    };

    setupSubscription();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [isAuthenticated]);

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
            <PortalErrorBoundary>
              <Outlet />
            </PortalErrorBoundary>
          </div>
        </main>
      </div>
    </ToastProvider>
  );
};

export default CustomerLayout;
