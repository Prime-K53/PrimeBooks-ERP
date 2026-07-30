import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Bell, LogOut, User, ChevronDown } from 'lucide-react';
import { useCustomerAuth } from '../../../context/CustomerAuthContext';

interface Props {
  title: string;
  onMenuToggle: () => void;
}

const PortalHeader: React.FC<Props> = ({ title, onMenuToggle }) => {
  const navigate = useNavigate();
  const { user, logout } = useCustomerAuth();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = () => {
    setShowDropdown(false);
    logout();
    navigate('/portal/login');
  };

  return (
    <header className="fixed top-0 left-0 right-0 md:left-64 z-30 h-16 bg-slate-800/90 border-b border-slate-700/40 backdrop-blur-md flex items-center justify-between px-4 md:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuToggle}
          className="md:hidden p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 transition-colors"
          aria-label="Toggle menu"
        >
          <Menu size={20} />
        </button>
        <h1 className="text-lg font-bold text-slate-100 tracking-tight">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        <button className="relative p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 transition-colors">
          <Bell size={20} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-slate-800" />
        </button>

        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-700/50 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-green-400 flex items-center justify-center text-white text-xs font-bold shadow-lg shadow-emerald-500/20">
              {(user?.full_name || user?.email || 'C').charAt(0).toUpperCase()}
            </div>
            <span className="hidden sm:block text-sm font-medium text-slate-200 max-w-[120px] truncate">
              {user?.full_name || 'Customer'}
            </span>
            <ChevronDown size={14} className="text-slate-400 hidden sm:block" />
          </button>

          {showDropdown && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-slate-800 border border-slate-700/60 rounded-xl shadow-xl shadow-slate-900/50 overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-slate-700/40">
                <p className="text-sm font-medium text-slate-200 truncate">{user?.full_name || 'Customer'}</p>
                <p className="text-xs text-slate-500 truncate">{user?.email || ''}</p>
              </div>
              <div className="p-1.5">
                <button
                  onClick={() => { setShowDropdown(false); navigate('/portal/profile'); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-300 hover:text-slate-100 hover:bg-slate-700/50 transition-colors"
                >
                  <User size={16} className="text-slate-500" />
                  Profile
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
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
