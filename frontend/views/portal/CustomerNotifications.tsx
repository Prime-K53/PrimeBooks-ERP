import React, { useEffect, useState } from 'react';
import { Bell, Info, AlertCircle, CheckCircle, CreditCard, ShoppingCart, FileText, MessageCircle } from 'lucide-react';
import { portalApi, portalLifecycle, PortalNotification } from '../../services/portalApiClient';
import PortalPageHeader from './components/PortalPageHeader';
import PortalButton from './components/PortalButton';
import ErrorBanner from './components/ErrorBanner';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { useToast } from './components/Toast';
import { useNavigate } from 'react-router-dom';
import { portalTheme } from './constants';

const typeIcons: Record<string, React.ReactNode> = {
  info: <Info size={18} />,
  alert: <AlertCircle size={18} />,
  success: <CheckCircle size={18} />,
  payment: <CreditCard size={18} />,
  order: <ShoppingCart size={18} />,
  invoice: <FileText size={18} />,
  message: <MessageCircle size={18} />,
};

const CustomerNotifications: React.FC = () => {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const fetchNotifications = () => {
    portalApi.get<PortalNotification[]>('/notifications')
      .then(setNotifications)
      .catch((err) => {
        setError(err.message || 'Failed to load notifications');
        addToast('error', err.message || 'Failed to load notifications');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      unsubscribe = await portalLifecycle.subscribe({
        onEvent: (type) => {
          if (type === 'notification' && !cancelled) fetchNotifications();
        },
      });

    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const markAsRead = async (id: string) => {
    try {
      await portalApi.put(`/notifications/${id}/read`, {});
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
    } catch (err: any) {
      addToast('error', err.message || 'Failed to mark as read');
    }
  };

  const markAllAsRead = async () => {
    try {
      await portalApi.put('/notifications/read-all', {});
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      addToast('success', 'All notifications marked as read');
    } catch (err: any) {
      addToast('error', err.message || 'Failed to mark all as read');
    }
  };

  const handleNotificationClick = (notif: PortalNotification) => {
    if (!notif.is_read) markAsRead(notif.id);
    if (notif.link) {
      const path = notif.link.startsWith('#') ? notif.link.slice(1) : notif.link;
      navigate(path);
    }
  };

  if (loading) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="card" count={6} /></div>;
  if (error) return <div className="p-8 max-w-4xl mx-auto"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>;

  const unread = notifications.filter((n) => !n.is_read).length;

  return (
    <div>
      <PortalPageHeader title="Notifications" subtitle={unread > 0 ? `You have ${unread} unread notification${unread > 1 ? 's' : ''}` : 'You\'re all caught up'} icon={Bell} />

      <div style={{ padding: '20px 28px 8px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{
              fontFamily: "'Inter', sans-serif", fontSize: 12.5, fontWeight: 500,
              color: portalTheme.ink, background: portalTheme.paper,
              border: `1px solid ${portalTheme.border}`, borderRadius: 9,
              padding: '6px 10px', outline: 'none', cursor: 'pointer',
              minWidth: 130
            }}
          >
            <option value="all">All Types</option>
            <option value="info">Info</option>
            <option value="alert">Alerts</option>
            <option value="success">Success</option>
            <option value="payment">Payments</option>
            <option value="order">Orders</option>
            <option value="invoice">Invoices</option>
            <option value="message">Messages</option>
          </select>
        </div>
      </div>

      <div style={{ padding: '0 28px 28px' }}>
        {notifications.length === 0 ? (
          <EmptyState icon={<Bell size={28} />} title="No notifications" description="You're all caught up! Notifications will appear here." />
        ) : (
          <PortalCard>
            <div className="space-y-2">
              {notifications.filter((n) => typeFilter === 'all' || n.type === typeFilter).map((n) => {
              const icon = typeIcons[n.type] || typeIcons.info;

              return (
                <button
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 14,
                    width: '100%', padding: '14px 20px', textAlign: 'left',
                    background: portalTheme.paper, borderRadius: 14,
                    border: `1px solid ${portalTheme.border}`,
                    boxShadow: '0 1px 2px rgba(16,24,40,0.04)',
                    cursor: 'pointer', transition: 'all .15s ease',
                    opacity: n.is_read ? 0.7 : 1
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = portalTheme.teal[50]; e.currentTarget.style.borderColor = portalTheme.teal[200]; }}
                  onMouseLeave={e => { e.currentTarget.style.background = portalTheme.paper; e.currentTarget.style.borderColor = portalTheme.border; }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: portalTheme.teal[50], color: portalTheme.teal[600],
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                  }}>
                    {icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, color: n.is_read ? portalTheme.inkSoft : portalTheme.ink }}>{n.title}</p>
                      {!n.is_read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: portalTheme.teal[400], flexShrink: 0 }} />}
                    </div>
                    {n.body && <p style={{ fontSize: 11, color: portalTheme.inkSoft, marginTop: 1, lineHeight: 1.4 }}>{n.body}</p>}
                    <p style={{ fontSize: 10, color: portalTheme.inkSoft, marginTop: 2 }}>
                      {new Date(n.created_at).toLocaleDateString()} {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </button>
              );
              })}
            </div>
          </PortalCard>
        )}
      </div>
    </div>
  );
};

export default CustomerNotifications;
