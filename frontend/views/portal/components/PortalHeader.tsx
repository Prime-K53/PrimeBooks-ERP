import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Bell, LogOut, User, ChevronDown } from 'lucide-react';
import { useCustomerAuth } from '../../../context/CustomerAuthContext';
import { portalLifecycle } from '../../../services/portalApiClient';

interface Props {
  title: string;
  onMenuToggle: () => void;
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  is_read: boolean;
  created_at: string;
}

const PortalHeader: React.FC<Props> = ({ title, onMenuToggle }) => {
  const navigate = useNavigate();
  const { user, logout } = useCustomerAuth();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadNotifications = async () => {
    try {
      const [list, count] = await Promise.all([
        portalLifecycle.notifications.list(),
        portalLifecycle.notifications.unreadCount(),
      ]);
      setNotifications(list.slice(0, 10));
      setUnreadCount(count.count);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadNotifications();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sub = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          if (type === 'notification') {
            loadNotifications();
          }
        },
      });
      if (!cancelled) return sub;
    })();
    return () => { cancelled = true; };
  }, []);

  const handleLogout = () => {
    setShowDropdown(false);
    logout();
    navigate('/portal/login');
  };

  const handleNotificationClick = async (notif: NotificationItem) => {
    if (!notif.is_read) {
      await portalLifecycle.notifications.markRead(notif.id).catch(() => {});
      setNotifications((prev) => prev.map((n) => (n.id === notif.id ? { ...n, is_read: true } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    if (notif.link) {
      const path = notif.link.startsWith('#') ? notif.link.slice(1) : notif.link;
      navigate(path);
    }
    setShowNotifDropdown(false);
  };

  const handleMarkAllRead = async () => {
    await portalLifecycle.notifications.markAllRead().catch(() => {});
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
  };

  const teal = { 50: '#eef7f6', 400: '#3fa294', 600: '#146b60' };
  const amber = { 500: '#d99a3f' };
  const paper = '#FEFDFB';
  const ink = '#23282A';
  const inkSoft = '#5c6567';
  const hairline = '#e4ddd1';

  return (
    <header className="fixed top-0 left-0 right-0 md:left-64 z-30 h-16 flex items-center justify-between px-4 md:px-6" style={{
      background: paper,
      borderBottom: `1px solid ${hairline}`,
      color: ink
    }}>
      <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${teal[600]}, ${teal[400]} 40%, ${amber[500]} 100%)` }} />
      <div className="flex items-center gap-3">
          <button
            onClick={onMenuToggle}
            className="md:hidden p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            aria-label="Toggle navigation menu"
          >
            <Menu size={20} />
          </button>
        {title === 'Dashboard' ? (
          <h1 className="md:hidden text-lg font-bold text-slate-900 tracking-tight">
            Prime<span style={{ color: '#d99a3f' }}>PORTAL</span>
          </h1>
        ) : (
          <h1 className="md:hidden text-lg font-bold text-slate-900 tracking-tight">{title}</h1>
        )}
        <h1 className="hidden md:block text-lg font-bold text-slate-900 tracking-tight">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => { setShowNotifDropdown((v) => !v); setShowDropdown(false); }}
            className="relative p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold ring-2 ring-[#FEFDFB]">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          {showNotifDropdown && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white/90 backdrop-blur-xl border border-slate-200/80 rounded-2xl shadow-xl shadow-slate-200/60 overflow-hidden z-50">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200/60">
                <span className="text-sm font-bold text-slate-900">Notifications</span>
                {unreadCount > 0 && (
                  <button onClick={handleMarkAllRead} className="text-xs font-bold text-teal-600 hover:text-teal-700 transition-colors">
                    Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto custom-scrollbar">
                {notifications.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-slate-500">No notifications yet.</p>
                ) : (
                  notifications.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => handleNotificationClick(n)}
                      className={`w-full text-left px-4 py-3 border-b border-slate-100 last:border-b-0 transition-colors ${n.is_read ? 'bg-white hover:bg-slate-50' : 'bg-teal-50/60 hover:bg-teal-50'}`}
                    >
                      <p className={`text-xs font-bold ${n.is_read ? 'text-slate-700' : 'text-teal-900'}`}>{n.title}</p>
                      {n.body && <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{n.body}</p>}
                      <p className="text-[10px] text-slate-400 mt-1">{new Date(n.created_at).toLocaleString()}</p>
                    </button>
                  ))
                )}
              </div>
              <div className="px-4 py-2.5 border-t border-slate-200/60 bg-slate-50/50">
                <button onClick={() => { setShowNotifDropdown(false); navigate('/portal/notifications'); }} className="w-full text-center text-xs font-bold text-teal-600 hover:text-teal-700 transition-colors">
                  View all notifications
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => { setShowDropdown(!showDropdown); setShowNotifDropdown(false); }}
            className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: 'linear-gradient(160deg, #3fa294, #0f544c)' }}>
              {(user?.full_name || user?.email || 'C').charAt(0).toUpperCase()}
            </div>
            <span className="hidden sm:block text-sm font-medium text-slate-700 max-w-[120px] truncate">
              {user?.full_name || 'Customer'}
            </span>
            <ChevronDown size={14} className="text-slate-400 hidden sm:block" />
          </button>

          {showDropdown && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl shadow-xl shadow-slate-200/80 overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-slate-200/60">
                <p className="text-sm font-medium text-slate-900 truncate">{user?.full_name || 'Customer'}</p>
                <p className="text-xs text-slate-500 truncate">{user?.email || ''}</p>
              </div>
              <div className="p-1.5">
                <button
                  onClick={() => { setShowDropdown(false); navigate('/portal/profile'); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                >
                  <User size={16} className="text-slate-400" />
                  Profile
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-rose-600 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                >
                  <LogOut size={16} />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default PortalHeader;
