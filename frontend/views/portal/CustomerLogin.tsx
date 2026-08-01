import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { User, Fingerprint, Loader2, Lock, Mail, KeyRound } from 'lucide-react';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import ErrorBanner from './components/ErrorBanner';

const CustomerLogin: React.FC = () => {
  const navigate = useNavigate();
  const { login, loginPassword, activate } = useCustomerAuth();
  const [mode, setMode] = useState<'id' | 'password' | 'activate'>('id');
  const [customerId, setCustomerId] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'id') {
      if (!customerId.trim() || !fullName.trim()) return;
    } else if (mode === 'password') {
      if (!email.trim() || !password) return;
    } else {
      if (!customerId.trim() || !inviteCode.trim() || !newPassword) return;
      if (newPassword !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
      if (newPassword.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }
    }
    setSubmitting(true);
    setError(null);

    try {
      const result = mode === 'id'
        ? await login(customerId.trim(), fullName.trim())
        : mode === 'password'
          ? await loginPassword(email.trim(), password)
          : await activate(customerId.trim(), inviteCode.trim(), newPassword);
      if (result === 'SUCCESS') {
        navigate('/portal/dashboard', { replace: true });
        return;
      }
      if (result === 'INVALID') {
        setError(mode === 'id'
          ? 'Customer ID and full name do not match our records.'
          : mode === 'password'
            ? 'Email and password do not match our records.'
            : 'Invalid customer ID or invite code. Codes expire after 30 minutes.');
      } else {
        setError('Login failed. Please try again.');
      }
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = "w-full h-11 pl-10 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500/60 transition-all";

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[var(--dashboard-bg)] font-sans">
      <div className="min-h-full flex items-center justify-center p-6">
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-gradient-to-br from-teal-500/10 to-emerald-400/5 rounded-full blur-[120px]" />
          <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-gradient-to-tr from-amber-500/10 to-teal-500/10 rounded-full blur-[100px]" />
        </div>

        <div className="w-full max-w-[420px] relative z-10 bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-white" style={{ background: 'linear-gradient(160deg, #3fa294, #0f544c)' }}>
            <Lock size={20} />
          </div>
          <div>
            <div className="font-bold text-lg tracking-tight" style={{ color: '#23282A' }}>
              Prime<span style={{ color: '#b97e2b' }}>PORTAL</span>
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: '#5c6567' }}>Customer Sign In</div>
          </div>
        </div>

        <div className="mb-8">
          <h1 className="text-[1.65rem] font-bold tracking-tight leading-snug" style={{ color: '#23282A' }}>Welcome back</h1>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: '#5c6567' }}>Sign in to your account to view invoices, orders, and more.</p>
        </div>

        <div className="mb-6 grid grid-cols-3 gap-1.5 p-1.5 bg-slate-100 rounded-xl">
          <button type="button" onClick={() => { setMode('id'); setError(null); }}
            className={`h-9 rounded-lg text-xs font-bold transition-all ${mode === 'id' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            Customer ID
          </button>
          <button type="button" onClick={() => { setMode('password'); setError(null); }}
            className={`h-9 rounded-lg text-xs font-bold transition-all ${mode === 'password' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            Email & Password
          </button>
          <button type="button" onClick={() => { setMode('activate'); setError(null); }}
            className={`h-9 rounded-lg text-xs font-bold transition-all ${mode === 'activate' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            Activate Account
          </button>
        </div>

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {mode === 'id' && (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Customer ID</label>
            <div className="relative">
              <Fingerprint size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                placeholder="Enter your customer ID"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Full Name</label>
            <div className="relative">
              <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your full name (exact match)"
                className={inputClass}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || !customerId.trim() || !fullName.trim()}
            className="w-full h-11 text-white text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: 'linear-gradient(90deg, #146b60, #3fa294)', boxShadow: '0 8px 20px rgba(20,107,96,.25)' }}
          >
            {submitting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              'Sign In'
            )}
          </button>
        </form>
        )}

        {mode === 'password' && (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Email</label>
            <div className="relative">
              <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Password</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className={inputClass}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || !email.trim() || !password}
            className="w-full h-11 text-white text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: 'linear-gradient(90deg, #146b60, #3fa294)', boxShadow: '0 8px 20px rgba(20,107,96,.25)' }}
          >
            {submitting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              'Sign In'
            )}
          </button>
        </form>
        )}

        {mode === 'activate' && (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Customer ID</label>
            <div className="relative">
              <Fingerprint size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                placeholder="Enter your customer ID"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Invite Code</label>
            <div className="relative">
              <KeyRound size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="6-digit code from your invite"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">New Password</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Confirm Password</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat your password"
                className={inputClass}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || !customerId.trim() || !inviteCode.trim() || !newPassword || !confirmPassword}
            className="w-full h-11 text-white text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: 'linear-gradient(90deg, #b97e2b, #d99a3f)', boxShadow: '0 8px 20px rgba(185,126,43,.25)' }}
          >
            {submitting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              'Activate & Sign In'
            )}
          </button>
        </form>
        )}

        <div className="mt-4 flex items-center justify-end text-xs">
          <Link to="/portal/forgot-password" className="text-slate-500 hover:text-teal-600 transition-colors">
            Forgot password?
          </Link>
        </div>

        <div className="mt-10 pt-6 border-t border-slate-200 text-center">
          <Link to="/login" className="text-xs text-slate-400 hover:text-slate-700 transition-colors">
            Admin Login
          </Link>
        </div>
      </div>
      </div>
    </div>
  );
};

export default CustomerLogin;
