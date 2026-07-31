import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Fingerprint, User, Mail, Phone, Lock, Loader2, UserPlus } from 'lucide-react';
import { portalApi } from '../../services/portalApiClient';
import { savePortalSession } from '../../services/portalApiClient';
import { useCustomerAuth } from '../../context/CustomerAuthContext';

const CustomerRegister: React.FC = () => {
  const navigate = useNavigate();
  const { refreshSession } = useCustomerAuth();
  const [form, setForm] = useState({ customer_id: '', full_name: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setField = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customer_id.trim() || !form.full_name.trim() || !form.email.trim() || !form.password) return;
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await portalApi.post<{
        message: string;
        user: { id: string; customer_id: string; email: string; full_name?: string; phone?: string };
        access_token: string;
        refresh_token: string;
        expires_in: string;
      }>('/auth/register', {
        customer_id: form.customer_id.trim(),
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        password: form.password,
      });
      savePortalSession({
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        expires_in: result.expires_in,
        user: result.user,
      });
      await refreshSession().catch(() => {});
      navigate('/portal/dashboard', { replace: true });
    } catch (err: any) {
      setError(err.body?.error || err.message || 'Registration failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full h-11 pl-10 pr-4 bg-slate-800/60 border border-slate-700/60 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60 transition-all';

  return (
    <div className="min-h-screen bg-[#070B17] font-sans flex items-center justify-center p-6">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-gradient-to-br from-emerald-600/15 to-green-500/5 rounded-full blur-[120px]" />
        <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-gradient-to-tr from-teal-500/10 to-slate-800/20 rounded-full blur-[100px]" />
      </div>

      <div className="w-full max-w-[420px] relative z-10">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-400 flex items-center justify-center shadow-lg shadow-emerald-500/25">
            <UserPlus size={20} className="text-white" />
          </div>
          <div>
            <div className="text-slate-100 font-bold text-lg tracking-tight">Create Account</div>
            <div className="text-[10px] text-emerald-400 uppercase tracking-[0.18em] font-semibold">Customer Portal</div>
          </div>
        </div>

        <div className="mb-8">
          <h1 className="text-[1.65rem] font-bold text-slate-100 tracking-tight leading-snug">Register for portal access</h1>
          <p className="mt-2 text-sm text-slate-400 leading-relaxed">Use the customer ID on your invoices to create your account.</p>
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
              <input type="text" value={form.customer_id} onChange={(e) => setField('customer_id', e.target.value)} placeholder="Enter your customer ID" className={inputClass} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Full Name</label>
            <div className="relative">
              <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input type="text" value={form.full_name} onChange={(e) => setField('full_name', e.target.value)} placeholder="Your full name" className={inputClass} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Email Address</label>
            <div className="relative">
              <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="you@example.com" className={inputClass} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Phone (optional)</label>
            <div className="relative">
              <Phone size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input type="tel" value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="+260 000 000 000" className={inputClass} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Password</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input type="password" value={form.password} onChange={(e) => setField('password', e.target.value)} placeholder="At least 6 characters" className={inputClass} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Confirm Password</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input type="password" value={form.confirmPassword} onChange={(e) => setField('confirmPassword', e.target.value)} placeholder="Repeat your password" className={inputClass} />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || !form.customer_id.trim() || !form.full_name.trim() || !form.email.trim() || !form.password || !form.confirmPassword}
            className="w-full h-11 bg-gradient-to-r from-emerald-600 to-green-500 hover:from-emerald-500 hover:to-green-400 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl shadow-lg shadow-emerald-600/25 transition-all flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : 'Create Account'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link to="/portal/login" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
            Already have an account? Sign in
          </Link>
        </div>
      </div>
    </div>
  );
};

export default CustomerRegister;
