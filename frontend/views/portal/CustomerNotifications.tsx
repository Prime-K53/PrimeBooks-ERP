import React, { useEffect, useState } from 'react';
import { Bell, Info, AlertCircle, CheckCircle, CreditCard, ShoppingCart, FileText, MessageCircle } from 'lucide-react';
import { portalApi, portalLifecycle, PortalNotification } from '../../services/portalApiClient';
import PortalPageHeader from './components/PortalPageHeader';
import PortalButton from './components/PortalButton';
import ErrorBanner from './components/ErrorBanner';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { useToast } from './hooks/useConfirmDialog';
import { useNavigate } from 'react-router-dom';
import { portalTheme } from '../constants';

const teal = {
  50: '#eef7f6', 100: '#d3ece9', 200: '#a6d9d3', 300: '#72c0b7',
  400: '#3fa294', 500: '#1f8577', 600: '#146b60', 700: '#0f544c',
  800: '#0b3e39', 900: '#082e2a'
};
const amber = { 100: '#fbead0', 300: '#eec27a', 500: '#d99a3f', 600: '#b97e2b' };
const paper = '#FEFDFB';
const ink = '#23282A';
const inkSoft = '#5c6567';
const hairline = '#e4ddd1';

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
    (async () => {
      const sub = await portalLifecycle.subscribe({
        onEvent: (type) => {
          if (type === 'notification' && !cancelled) fetchNotifications();
        },
      });
      if (!cancelled) return sub;
    })();
    return () => { cancelled = true; };
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
    <div style={{
      background: paper,
      borderRadius: 14,
      overflow: 'hidden'
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '22px 28px 18px',
        borderBottom: `1px solid ${hairline}`,
        background: paper
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 10px -3px rgba(15,84,76,.6)', flexShrink: 0
          }}>
            <Bell size={19} color="#fff" />
          </div>
          <div>
            <h1 style={{
              fontFamily: "'DM Serif Display', 'Georgia', serif", fontWeight: 400,
              fontSize: 22, margin: 0, color: teal[800], letterSpacing: 0.2
            }}>
              Notifications
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 11.5, color: inkSoft, letterSpacing: 0.02 }}>
              {unread > 0 ? `You have ${unread} unread notification${unread > 1 ? 's' : ''}` : 'No unread notifications'}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {unread > 0 && (
            <button onClick={markAllAsRead} style={{ fontSize: 11.5, fontWeight: 700, color: teal[600], background: 'none', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 8, transition: 'all .15s' }} onMouseEnter={e => { e.currentTarget.style.background = teal[50]; }} onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}>
              Mark all read
            </button>
          )}
          <div style={{ position: 'relative' }}>
            <Bell size={24} style={{ color: inkSoft }} />
            {unread > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4, width: 16, height: 16,
                borderRadius: '50%', background: teal[500], color: '#fff',
                fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                {unread}
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 30px 8px' }}>
        {notifications.length === 0 ? (
          <EmptyState icon={<Bell size={28} />} title="No notifications" description="You're all caught up! Notifications will appear here." />
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => {
              const icon = typeIcons[n.type] || typeIcons.info;

              return (
                <button
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 14,
                    width: '100%', padding: '14px 20px', textAlign: 'left',
                    background: paper, borderRadius: 14,
                    border: `1.4px solid ${hairline}`,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(255,255,255,.04)',
                    cursor: 'pointer', transition: 'all .15s ease',
                    opacity: n.is_read ? 0.7 : 1
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = teal[50]; e.currentTarget.style.borderColor = teal[200]; }}
                  onMouseLeave={e => { e.currentTarget.style.background = paper; e.currentTarget.style.borderColor = hairline; }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: 9,
                    background: teal[50], color: teal[600],
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                  }}>
                    {icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, color: n.is_read ? inkSoft : ink }}>{n.title}</p>
                      {!n.is_read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: teal[400], flexShrink: 0 }} />}
                    </div>
                    {n.body && <p style={{ fontSize: 11, color: inkSoft, marginTop: 1, lineHeight: 1.4 }}>{n.body}</p>}
                    <p style={{ fontSize: 10, color: inkSoft, marginTop: 2 }}>
                      {new Date(n.created_at).toLocaleDateString()} {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomerNotifications;
