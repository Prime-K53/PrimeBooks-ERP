import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, Loader2 } from 'lucide-react';

const CustomerForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/portal/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (response.ok) {
        setSent(true);
      } else {
        const data = await response.json().catch(() => ({}));
        setError(data.error || 'Failed to send reset email.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[var(--dashboard-bg)] font-sans">
      <div className="min-h-full flex items-center justify-center p-6">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-gradient-to-br from-teal-500/10 to-emerald-400/5 rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-[420px] relative z-10 bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-white" style={{ background: 'linear-gradient(160deg, #3fa294, #0f544c)' }}>
            <Mail size={20} />
          </div>
          <div>
            <div className="font-bold text-lg tracking-tight" style={{ color: '#23282A' }}>
              Prime<span style={{ color: '#b97e2b' }}>PORTAL</span>
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: '#5c6567' }}>Reset Password</div>
          </div>
        </div>

        {sent ? (
          <div>
            <h1 className="text-[1.65rem] font-bold tracking-tight leading-snug" style={{ color: '#23282A' }}>Check your email</h1>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: '#5c6567' }}>
              If an account exists for <strong className="text-slate-700">{email}</strong>, we've sent password reset instructions.
            </p>
            <Link
              to="/portal/login"
              className="mt-6 inline-flex items-center gap-2 text-sm text-teal-600 hover:text-teal-700 transition-colors"
            >
              <ArrowLeft size={14} />
              Back to login
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <h1 className="text-[1.65rem] font-bold tracking-tight leading-snug" style={{ color: '#23282A' }}>Forgot password?</h1>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: '#5c6567' }}>Enter your email and we'll send you a reset link.</p>
            </div>

            {error && (
              <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl">
                <p className="text-xs text-rose-600 leading-relaxed">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Email Address</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full h-11 pl-10 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500/60 transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || !email.trim()}
                className="w-full h-11 text-white text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: 'linear-gradient(90deg, #146b60, #3fa294)', boxShadow: '0 8px 20px rgba(20,107,96,.25)' }}
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : 'Send Reset Link'}
              </button>
            </form>

            <div className="mt-6 text-center">
              <Link to="/portal/login" className="text-xs text-slate-400 hover:text-slate-700 transition-colors inline-flex items-center gap-1">
                <ArrowLeft size={12} />
                Back to login
              </Link>
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
};

export default CustomerForgotPassword;
