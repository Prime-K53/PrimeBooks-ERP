import React, { useEffect, useState } from 'react';
import { User, Save, Lock, Loader2 } from 'lucide-react';
import { portalApi } from '../../services/portalApiClient';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

interface ProfileData {
  full_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

const CustomerProfile: React.FC = () => {
  const { user } = useCustomerAuth();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [form, setForm] = useState<ProfileData>({});

  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    portalApi.get<ProfileData>('/profile')
      .then((data) => {
        setProfile(data);
        setForm({
          full_name: data.full_name || '',
          phone: data.phone || '',
          address: data.address || '',
          city: data.city || '',
          state: data.state || '',
          zip: data.zip || '',
          country: data.country || '',
          email: data.email || user?.email || '',
        });
      })
      .catch((err) => setError(err.message || 'Failed to load profile'))
      .finally(() => setLoading(false));
  }, [user]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    try {
      await portalApi.put('/profile', form);
      setSaveMsg('Profile updated successfully.');
    } catch (err: any) {
      setSaveMsg(err.message || 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMsg(null);
    setPasswordError(null);

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters.');
      return;
    }

    setChangingPassword(true);
    try {
      await portalApi.put('/profile/password', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordMsg('Password changed successfully.');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err: any) {
      setPasswordError(err.message || 'Failed to change password.');
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) return <div className="p-6 max-w-3xl mx-auto"><PortalLoadingSkeleton type="detail" /></div>;
  if (error) return <div className="p-6 max-w-3xl mx-auto"><div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 text-sm">{error}</div></div>;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center">
          <User size={24} className="text-emerald-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Profile</h1>
          <p className="text-sm text-slate-500">Manage your account information</p>
        </div>
      </div>

      {saveMsg && (
        <div className={`mb-5 p-3.5 border rounded-xl text-sm ${saveMsg.includes('successfully') ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-rose-50 border-rose-200 text-rose-600'}`}>
          {saveMsg}
        </div>
      )}

      <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-xl p-6 mb-8">
        <h2 className="text-sm font-semibold text-slate-800 mb-5">Personal Information</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Full Name</label>
            <input
              name="full_name"
              value={form.full_name || ''}
              onChange={handleChange}
              className="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Email</label>
            <input
              name="email"
              value={form.email || ''}
              readOnly
              className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-400 cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Phone</label>
            <input
              name="phone"
              value={form.phone || ''}
              onChange={handleChange}
              className="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Address</label>
            <input
              name="address"
              value={form.address || ''}
              onChange={handleChange}
              className="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">City</label>
            <input
              name="city"
              value={form.city || ''}
              onChange={handleChange}
              className="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">State</label>
            <input
              name="state"
              value={form.state || ''}
              onChange={handleChange}
              className="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">ZIP Code</label>
            <input
              name="zip"
              value={form.zip || ''}
              onChange={handleChange}
              className="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Country</label>
            <input
              name="country"
              value={form.country || ''}
              onChange={handleChange}
              className="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60"
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>

      <form onSubmit={handlePasswordChange} className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-5">
          <Lock size={18} className="text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-800">Change Password</h2>
        </div>

        {passwordMsg && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-600">{passwordMsg}</div>
        )}
        {passwordError && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-600">{passwordError}</div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Current Password</label>
            <input
              type="password"
              value={passwordForm.currentPassword}
              onChange={(e) => setPasswordForm((p) => ({ ...p, currentPassword: e.target.value }))}
              className="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">New Password</label>
            <input
              type="password"
              value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm((p) => ({ ...p, newPassword: e.target.value }))}
              className="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Confirm Password</label>
            <input
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(e) => setPasswordForm((p) => ({ ...p, confirmPassword: e.target.value }))}
              className="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60"
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <button
            type="submit"
            disabled={changingPassword || !passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {changingPassword ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
            {changingPassword ? 'Changing...' : 'Change Password'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CustomerProfile;
