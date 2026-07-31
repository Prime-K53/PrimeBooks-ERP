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
    <div className="fixed inset-0 overflow-y-auto bg-[#070B17] font-sans">
      <div className="min-h-full flex items-center justify-center p-6">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-gradient-to-br from-emerald-600/15 to-green-500/5 rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-[420px] relative z-10">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-400 flex items-center justify-center shadow-lg shadow-emerald-500/25">
            <Mail size={20} className="text-white" />
          </div>
          <div>
            <div className="text-slate-100 font-bold text-lg tracking-tight">Reset Password</div>
            <div className="text-[10px] text-emerald-400 uppercase tracking-[0.18em] font-semibold">Customer Portal</div>
          </div>
        </div>

        {sent ? (
          <div>
            <h1 className="text-[1.65rem] font-bold text-slate-100 tracking-tight leading-snug">Check your email</h1>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">
              If an account exists for <strong className="text-slate-300">{email}</strong>, we've sent password reset instructions.
            </p>
            <Link
              to="/portal/login"
              className="mt-6 inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              <ArrowLeft size={14} />
              Back to login
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <h1 className="text-[1.65rem] font-bold text-slate-100 tracking-tight leading-snug">Forgot password?</h1>
              <p className="mt-2 text-sm text-slate-400 leading-relaxed">Enter your email and we'll send you a reset link.</p>
            </div>

            {error && (
              <div className="mb-5 p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-xl">
                <p className="text-xs text-rose-300 leading-relaxed">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Email Address</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full h-11 pl-10 pr-4 bg-slate-800/60 border border-slate-700/60 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60 transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || !email.trim()}
                className="w-full h-11 bg-gradient-to-r from-emerald-600 to-green-500 hover:from-emerald-500 hover:to-green-400 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl shadow-lg shadow-emerald-600/25 transition-all flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : 'Send Reset Link'}
              </button>
            </form>

            <div className="mt-6 text-center">
              <Link to="/portal/login" className="text-xs text-slate-500 hover:text-slate-300 transition-colors inline-flex items-center gap-1">
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
