import React, { useEffect, useState } from 'react';
import { User, Save, Lock, Loader2 } from 'lucide-react';
import { portalLifecycle } from '../../services/portalApiClient';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import PortalPageHeader from './components/PortalPageHeader';
import PortalButton from './components/PortalButton';
import PortalInput from './components/PortalInput';
import ErrorBanner from './components/ErrorBanner';
import PortalCard from './components/PortalCard';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { useToast } from './hooks/useConfirmDialog';
import { portalTheme } from '../constants';

const teal = {
  50: '#eef7f6', 100: '#d3ece9', 200: '#a6d9d3', 300: '#72c0b7',
  400: '#3fa294', 500: '#1f8577', 600: '#146b60', 700: '#0f544c',
  800: '#0b3e39', 900: '#082e2a'
};
const amber = { 100: '#fbead0', 300: '#eec27a', 500: '#d99a3f', 600: '#b97e2b' };
const paper = '#FEFDFB';
const ink = '#23282A';
const inkSoft = '#5c6567';
const hairline = '#e4ddd1';

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
  const { addToast } = useToast();
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
    portalLifecycle.profile.get()
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
      await portalLifecycle.profile.update(form);
      setSaveMsg('Profile updated successfully.');
      addToast('success', 'Profile updated successfully');
    } catch (err: any) {
      setSaveMsg(err.message || 'Failed to update profile.');
      addToast('error', err.message || 'Failed to update profile');
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
      await portalLifecycle.profile.changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordMsg('Password changed successfully.');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      addToast('success', 'Password changed successfully');
    } catch (err: any) {
      setPasswordError(err.message || 'Failed to change password.');
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="detail" /></div>;
  if (error) return <div className="p-8 max-w-4xl mx-auto"><ErrorBanner message={error} /></div>;

  return (
    <div style={{ background: portalTheme.paper, borderRadius: 14, overflow: 'hidden' }}>
      <PortalPageHeader title="My Profile" subtitle="Manage your account information" icon={User} />

      <div style={{ padding: '20px 28px 8px' }}>
        {saveMsg && (
          <div className={`mb-5 p-3.5 border rounded-xl text-sm ${saveMsg.includes('successfully') ? 'bg-teal-50 border-teal-200 text-teal-700' : 'bg-rose-50 border-rose-200 text-rose-600'}`}>
            {saveMsg}
          </div>
        )}

        <form onSubmit={handleSave} style={{ background: portalTheme.paper, borderRadius: 14, border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', padding: '24px 30px', marginBottom: 18 }}>
          <h2 style={{ margin: '0 0 18px', fontSize: 12, fontWeight: 600, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>
            Personal Information
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <PortalInput label="Full Name" value={form.full_name || ''} onChange={(v) => setForm((prev) => ({ ...prev, full_name: v }))} />
            <PortalInput label="Email" value={form.email || ''} onChange={(v) => setForm((prev) => ({ ...prev, email: v }))} disabled />
            <PortalInput label="Phone" value={form.phone || ''} onChange={(v) => setForm((prev) => ({ ...prev, phone: v }))} />
            <PortalInput label="Address" value={form.address || ''} onChange={(v) => setForm((prev) => ({ ...prev, address: v }))} />
            <PortalInput label="City" value={form.city || ''} onChange={(v) => setForm((prev) => ({ ...prev, city: v }))} />
            <PortalInput label="State" value={form.state || ''} onChange={(v) => setForm((prev) => ({ ...prev, state: v }))} />
            <PortalInput label="ZIP Code" value={form.zip || ''} onChange={(v) => setForm((prev) => ({ ...prev, zip: v }))} />
            <PortalInput label="Country" value={form.country || ''} onChange={(v) => setForm((prev) => ({ ...prev, country: v }))} />
          </div>
          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
            <PortalButton type="submit" disabled={saving} icon={saving ? Loader2 : Save}>
              {saving ? 'Saving...' : 'Save Changes'}
            </PortalButton>
          </div>
        </form>

        <PortalCard style={{ padding: '24px 30px', marginBottom: 18 }}>
          <form onSubmit={handlePasswordChange}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <Lock size={18} style={{ color: portalTheme.inkSoft }} />
              <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>
                Change Password
              </h2>
            </div>

            {passwordMsg && (
              <div className="mb-4 p-3 bg-teal-50 border border-teal-200 rounded-lg text-sm text-teal-700">{passwordMsg}</div>
            )}
            {passwordError && (
              <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-600">{passwordError}</div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
              <PortalInput label="Current Password" type="password" value={passwordForm.currentPassword} onChange={(v) => setPasswordForm((p) => ({ ...p, currentPassword: v }))} />
              <PortalInput label="New Password" type="password" value={passwordForm.newPassword} onChange={(v) => setPasswordForm((p) => ({ ...p, newPassword: v }))} />
              <PortalInput label="Confirm Password" type="password" value={passwordForm.confirmPassword} onChange={(v) => setPasswordForm((p) => ({ ...p, confirmPassword: v }))} />
            </div>
            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
              <PortalButton type="submit" disabled={changingPassword || !passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword} icon={changingPassword ? Loader2 : Lock}>
                {changingPassword ? 'Changing...' : 'Change Password'}
              </PortalButton>
            </div>
          </form>
        </PortalCard>
      </div>
    </div>
  );
};

export default CustomerProfile;
