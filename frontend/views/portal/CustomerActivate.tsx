import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Fingerprint, KeyRound, Lock, Loader2 } from 'lucide-react';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import ErrorBanner from './components/ErrorBanner';

const CustomerActivate: React.FC = () => {
  const navigate = useNavigate();
  const { activate } = useCustomerAuth();
  const [customerId, setCustomerId] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId.trim() || !inviteCode.trim() || !newPassword) return;
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setSubmitting(true);
    setError(null);

    const result = await activate(customerId.trim(), inviteCode.trim(), newPassword);
    if (result === 'SUCCESS') {
      navigate('/portal/dashboard', { replace: true });
      return;
    }
    setError('Invalid customer ID or invite code. Codes expire after 30 minutes.');
    setSubmitting(false);
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
              <KeyRound size={20} />
            </div>
            <div>
              <div className="font-bold text-lg tracking-tight" style={{ color: '#23282A' }}>
                Prime<span style={{ color: '#b97e2b' }}>PORTAL</span>
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: '#5c6567' }}>Customer Portal</div>
            </div>
          </div>

          <div className="mb-8">
            <h1 className="text-[1.65rem] font-bold tracking-tight leading-snug" style={{ color: '#23282A' }}>Activate Account</h1>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: '#5c6567' }}>Use the invite code from your email to set your password.</p>
          </div>

          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

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

          <div className="mt-10 pt-6 border-t border-slate-200 text-center">
            <Link to="/portal/login" className="text-xs text-slate-400 hover:text-slate-700 transition-colors">
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomerActivate;
