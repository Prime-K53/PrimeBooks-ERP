import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { User, Fingerprint, Loader2, Lock } from 'lucide-react';
import { useCustomerAuth } from '../../context/CustomerAuthContext';

const CustomerLogin: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useCustomerAuth();
  const [customerId, setCustomerId] = useState('');
  const [fullName, setFullName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId.trim() || !fullName.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const result = await login(customerId.trim(), fullName.trim());
      if (result === 'SUCCESS') {
        navigate('/portal/dashboard', { replace: true });
        return;
      }
      if (result === 'INVALID') {
        setError('Customer ID and full name do not match our records.');
      } else {
        setError('Login failed. Please try again.');
      }
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070B17] font-sans flex items-center justify-center p-6">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-gradient-to-br from-emerald-600/15 to-green-500/5 rounded-full blur-[120px]" />
        <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-gradient-to-tr from-teal-500/10 to-slate-800/20 rounded-full blur-[100px]" />
      </div>

      <div className="w-full max-w-[420px] relative z-10">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-400 flex items-center justify-center shadow-lg shadow-emerald-500/25">
            <Lock size={20} className="text-white" />
          </div>
          <div>
            <div className="text-slate-100 font-bold text-lg tracking-tight">Customer Portal</div>
            <div className="text-[10px] text-emerald-400 uppercase tracking-[0.18em] font-semibold">Prime ERP</div>
          </div>
        </div>

        <div className="mb-8">
          <h1 className="text-[1.65rem] font-bold text-slate-100 tracking-tight leading-snug">Welcome back</h1>
          <p className="mt-2 text-sm text-slate-400 leading-relaxed">Sign in to your account to view invoices, orders, and more.</p>
        </div>

        {error && (
          <div className="mb-5 p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-xl">
            <p className="text-xs text-rose-300 leading-relaxed">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Customer ID</label>
            <div className="relative">
              <Fingerprint size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                placeholder="Enter your customer ID"
                className="w-full h-11 pl-10 pr-4 bg-slate-800/60 border border-slate-700/60 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60 transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Full Name</label>
            <div className="relative">
              <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your full name (exact match)"
                className="w-full h-11 pl-10 pr-4 bg-slate-800/60 border border-slate-700/60 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60 transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || !customerId.trim() || !fullName.trim()}
            className="w-full h-11 bg-gradient-to-r from-emerald-600 to-green-500 hover:from-emerald-500 hover:to-green-400 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl shadow-lg shadow-emerald-600/25 transition-all flex items-center justify-center gap-2"
          >
            {submitting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-end text-xs">
          <Link to="/portal/forgot-password" className="text-slate-400 hover:text-emerald-400 transition-colors">
            Forgot password?
          </Link>
        </div>

        <div className="mt-10 pt-6 border-t border-slate-800/60 text-center">
          <Link to="/login" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
            Admin Login
          </Link>
        </div>
      </div>
    </div>
  );
};

export default CustomerLogin;
