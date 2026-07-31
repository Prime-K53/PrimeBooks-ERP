import React, { useMemo, useState } from 'react';
import { Lock, ShieldCheck, Mail, ArrowRight, Loader2, Key, Eye, EyeOff } from 'lucide-react';
import AuthLayout from './AuthLayout';
import { useAuth } from '../../context/AuthContext';

const Login: React.FC = () => {
  const { login, notification, clearNotification } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [requiresMfa, setRequiresMfa] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const isDev = import.meta.env.DEV;

  const canSubmit = useMemo(() => {
    if (!email.trim()) return false;
    if (requiresMfa) return mfaCode.trim().length === 6;
    return password.length > 0;
  }, [mfaCode, password, requiresMfa, email]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    if (notification) clearNotification();

    try {
      const result = await login(email.trim(), password, requiresMfa ? mfaCode.trim() : undefined);
      if (result === 'MFA_REQUIRED') {
        setRequiresMfa(true);
        setSubmitting(false);
        return;
      }
      if (result === 'INVALID') {
        setError('Invalid credentials. Please try again.');
        setSubmitting(false);
        return;
      }
      if (result === 'EXPIRED') {
        setError('Session expired. Please sign in again.');
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
    } catch (err) {
      const authError = err as Error & { userMessage?: string };
      setError(authError.userMessage || authError.message || 'Login failed.');
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout title="Sign in to your account" subtitle="Enter your credentials to access the Prime ERP dashboard." showBrand>
      <div>
        <div className="mb-8">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[11px] font-bold text-indigo-300 uppercase tracking-wider">
            <ShieldCheck size={12} />
            {requiresMfa ? 'Two-Factor Auth' : 'Secure Sign In'}
          </span>
          <h1 className="mt-4 text-[1.65rem] font-bold text-slate-100 tracking-tight leading-snug">
            {requiresMfa ? 'Two-Factor Authentication' : 'Welcome back'}
          </h1>
          <p className="mt-2 text-sm text-slate-400 leading-relaxed">
            {requiresMfa
              ? 'Enter the 6-digit code from your authenticator app to continue.'
              : 'Sign in to your workspace to continue where you left off.'}
          </p>
        </div>

        {(error || notification?.type === 'error') && (
          <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3">
            <div className="w-5 h-5 rounded-full bg-rose-100 flex items-center justify-center shrink-0 mt-0.5">
              <div className="w-2 h-2 rounded-full bg-rose-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-rose-700 leading-relaxed">{error || notification?.message}</p>
              {error && error.includes('company was deleted') && (
                <a
                  href="#/setup"
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-lg text-[11px] font-semibold transition-colors"
                >
                  Create New Workspace
                  <ArrowRight size={12} />
                </a>
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-4">
            <div>
              <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                Email <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <Mail size={16} />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-sky-400 focus:ring-3 focus:ring-sky-100/60"
                  placeholder="admin@company.com"
                  autoComplete="email"
                  disabled={submitting}
                  required
                />
              </div>
            </div>

            {!requiresMfa && (
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-[13px] font-semibold text-slate-700">
                    Password <span className="text-rose-500">*</span>
                  </label>
<a href="#/forgot-password" className="text-[11px] font-semibold text-sky-600 hover:text-sky-700 transition-colors">
              Forgot Password?
            </a>
                </div>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                    <Lock size={16} />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-11 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-sky-400 focus:ring-3 focus:ring-sky-100/60"
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    disabled={submitting}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            )}

            {requiresMfa && (
              <div>
                <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                  Verification Code <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                    <Key size={16} />
                  </div>
                  <input
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-sky-400 focus:ring-3 focus:ring-sky-100/60 tracking-[0.2em] font-mono text-center text-base"
                    inputMode="numeric"
                    placeholder="000000"
                    disabled={submitting}
                    required
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">6-digit code from your authenticator app</p>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={!canSubmit || submitting}
            className="w-full py-2.5 bg-indigo-500 hover:bg-indigo-400 disabled:bg-indigo-500/30 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-[13px] flex items-center justify-center gap-2 shadow-sm hover:shadow-md transition-all duration-200 active:scale-[0.99]"
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>{requiresMfa ? 'Verifying...' : 'Signing in...'}</span>
                </>
              ) : (
                <>
                  <span>{requiresMfa ? 'Verify Code' : 'Sign In'}</span>
                  <ArrowRight size={16} />
                </>
              )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-200 text-center space-y-2">
          <p className="text-xs text-slate-500">
            Don't have an account?{' '}
            <a href="#/setup" className="text-xs font-semibold text-sky-600 hover:text-sky-700 transition-colors">
              Create new
            </a>
          </p>
          <p className="text-xs text-slate-400">
            <a href="#/portal/login" className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 transition-colors">
              Customer Portal Login
            </a>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
};

export default Login;
