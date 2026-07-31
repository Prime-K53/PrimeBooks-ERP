import React, { useEffect, useState } from 'react';
import { Bell, Info, AlertCircle, CheckCircle, CreditCard, ShoppingCart, FileText, MessageCircle } from 'lucide-react';
import { portalApi } from '../../services/portalApiClient';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  is_read: boolean;
  created_at: string;
}

const typeIcons: Record<string, React.ReactNode> = {
  info: <Info size={18} />,
  alert: <AlertCircle size={18} />,
  success: <CheckCircle size={18} />,
  payment: <CreditCard size={18} />,
  order: <ShoppingCart size={18} />,
  invoice: <FileText size={18} />,
  message: <MessageCircle size={18} />,
};

const typeColors: Record<string, string> = {
  info: 'bg-blue-500/20 text-blue-400',
  alert: 'bg-amber-500/20 text-amber-400',
  success: 'bg-emerald-500/20 text-emerald-600',
  payment: 'bg-cyan-500/20 text-cyan-400',
  order: 'bg-violet-500/20 text-violet-400',
  invoice: 'bg-rose-500/20 text-rose-600',
  message: 'bg-indigo-500/20 text-indigo-400',
};

const CustomerNotifications: React.FC = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = () => {
    portalApi.get<Notification[]>('/notifications')
      .then(setNotifications)
      .catch((err) => setError(err.message || 'Failed to load notifications'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const markAsRead = async (id: string) => {
    try {
      await portalApi.put(`/notifications/${id}/read`, {});
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
    } catch {
      // ignore errors
    }
  };

  if (loading) return <div className="p-6 max-w-4xl mx-auto"><PortalLoadingSkeleton type="list" count={6} /></div>;
  if (error) return <div className="p-6 max-w-4xl mx-auto"><div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 text-sm">{error}</div></div>;

  const unread = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
          <p className="text-sm text-slate-500 mt-1">
            {unread > 0 ? `You have ${unread} unread notification${unread > 1 ? 's' : ''}` : 'No unread notifications'}
          </p>
        </div>
        <div className="relative">
          <Bell size={24} className="text-slate-500" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {unread}
            </span>
          )}
        </div>
      </div>

      {notifications.length === 0 ? (
        <EmptyState icon={<Bell size={28} />} title="No notifications" description="You're all caught up! Notifications will appear here." />
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => {
            const icon = typeIcons[n.type] || typeIcons.info;
            const colorClass = typeColors[n.type] || typeColors.info;

            return (
              <div
                key={n.id}
                onClick={() => !n.is_read && markAsRead(n.id)}
                className={`bg-white border rounded-xl p-4 flex items-start gap-3 transition-colors cursor-pointer ${
                  n.is_read ? 'border-slate-200 opacity-70' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${colorClass}`}>
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className={`text-sm font-medium ${n.is_read ? 'text-slate-500' : 'text-slate-900'}`}>{n.title}</p>
                    {!n.is_read && <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />}
                  </div>
                  {n.body && <p className="text-xs text-slate-400 line-clamp-2">{n.body}</p>}
                  <p className="text-[10px] text-slate-600 mt-1">{new Date(n.created_at).toLocaleDateString()} {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CustomerNotifications;
