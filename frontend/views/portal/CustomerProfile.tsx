import React, { useEffect, useState, useCallback } from 'react';
import { User, Save, Lock, Loader2, Monitor, Smartphone, Bell, Shield } from 'lucide-react';
import QRCode from 'qrcode';
import { portalLifecycle, portalApi } from '../../services/portalApiClient';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import PortalPageHeader from './components/PortalPageHeader';
import PortalButton from './components/PortalButton';
import PortalInput from './components/PortalInput';
import ErrorBanner from './components/ErrorBanner';
import PortalCard from './components/PortalCard';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { useToast } from './components/Toast';
import { portalTheme } from './constants';
import ConfirmDialog from './components/ConfirmDialog';

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

  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [revokeConfirmSessionId, setRevokeConfirmSessionId] = useState<string | null>(null);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [browserNotifs, setBrowserNotifs] = useState(() => localStorage.getItem('portal_browser_notifications') !== 'false');

  // 2FA state
  const [twoFactorStatus, setTwoFactorStatus] = useState<{ enabled: boolean; confirmed: boolean } | null>(null);
  const [twoFactorSetup, setTwoFactorSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorLoading, setTwoFactorLoading] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);

  const loadSessions = () => {
    portalLifecycle.profile.listSessions()
      .then(setSessions)
      .catch(() => {})
      .finally(() => setSessionsLoading(false));
  };

  useEffect(() => { loadSessions(); }, []);

  // 2FA setup
  useEffect(() => {
    portalLifecycle.twoFactor.status()
      .then(setTwoFactorStatus)
      .catch(() => setTwoFactorStatus({ enabled: false, confirmed: false }));
  }, []);

  const handleRevokeSession = async (sessionId: string) => {
    setRevokingSessionId(sessionId);
    try {
      await portalApi.delete(`/auth/sessions/${sessionId}`);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      addToast('success', 'Session revoked successfully');
    } catch {
      addToast('error', 'Failed to revoke session');
    } finally {
      setRevokingSessionId(null);
      setRevokeConfirmSessionId(null);
    }
  };

  const handle2FASetup = async () => {
    setTwoFactorLoading(true);
    setTwoFactorError(null);
    setQrCodeDataUrl(null);
    try {
      const data = await portalLifecycle.twoFactor.setup();
      setTwoFactorSetup(data);
      const dataUrl = await QRCode.toDataURL(data.otpauth_uri, { width: 160, margin: 1 });
      setQrCodeDataUrl(dataUrl);
    } catch (err: any) {
      setTwoFactorError(err.message || 'Failed to set up 2FA');
    } finally {
      setTwoFactorLoading(false);
    }
  };

  const handle2FAEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    setTwoFactorLoading(true);
    setTwoFactorError(null);
    try {
      await portalLifecycle.twoFactor.enable(twoFactorCode.trim());
      setTwoFactorStatus({ enabled: true, confirmed: true });
      setTwoFactorSetup(null);
      setTwoFactorCode('');
      addToast('success', 'Two-factor authentication enabled');
    } catch (err: any) {
      setTwoFactorError(err.message || 'Failed to enable 2FA');
    } finally {
      setTwoFactorLoading(false);
    }
  };

  const handle2FADisable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorCode) return;
    setTwoFactorLoading(true);
    setTwoFactorError(null);
    try {
      await portalLifecycle.twoFactor.disable(twoFactorCode.trim());
      setTwoFactorStatus({ enabled: false, confirmed: false });
      setTwoFactorSetup(null);
      setTwoFactorCode('');
      addToast('success', 'Two-factor authentication disabled');
    } catch (err: any) {
      setTwoFactorError(err.message || 'Failed to disable 2FA');
    } finally {
      setTwoFactorLoading(false);
    }
  };

  const loadProfile = useCallback(async () => {
    try {
      const data = await portalLifecycle.profile.get();
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
    } catch (err: any) {
      setError(err.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [user?.email]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sub = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          if (type === 'entity_changed' && (payload?.docType === 'customer_updated' || payload?.docType === 'customer') && !cancelled) {
            loadProfile();
          }
        },
      });
      if (!cancelled) return sub;
    })();
    return () => { cancelled = true; };
  }, [loadProfile]);

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
    <div>
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
            {passwordError && <ErrorBanner message={passwordError} onDismiss={() => setPasswordError(null)} />}

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

        <PortalCard style={{ padding: '24px 30px', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <Bell size={18} style={{ color: portalTheme.inkSoft }} />
            <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>
              Notification Preferences
            </h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label className="flex items-center gap-3 cursor-pointer">
              <div className="relative inline-block w-12 h-6">
                <input
                  type="checkbox"
                  checked={browserNotifs}
                  onChange={(e) => {
                    const val = e.target.checked;
                    setBrowserNotifs(val);
                    localStorage.setItem('portal_browser_notifications', String(val));
                    if (val && !('Notification' in window)) {
                      // Permission will be requested automatically on next SSE event
                    }
                  }}
                  className="sr-only"
                />
                <div className={`w-12 h-6 rounded-full transition-colors ${
                  browserNotifs ? 'bg-teal-500' : 'bg-slate-300'
                }`} />
                <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                  browserNotifs ? 'translate-x-6' : ''
                }`} />
              </div>
              <span style={{ color: ink, fontSize: 14, fontWeight: 500 }}>Browser notifications</span>
            </label>
          </div>
          <p style={{ fontSize: 11, color: portalTheme.inkSoft, marginTop: 12 }}>
            Receive native browser notifications for important portal events (quotation ready, order shipped, etc.).
          </p>
        </PortalCard>

        <PortalCard style={{ padding: '24px 30px', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>            <Shield size={18} style={{ color: portalTheme.inkSoft }} />
            <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>
              Two-Factor Authentication
            </h2>
          </div>

          {twoFactorError && <ErrorBanner message={twoFactorError} onDismiss={() => setTwoFactorError(null)} />}

          {twoFactorStatus?.enabled ? (
            <>
              <p style={{ fontSize: 13, color: portalTheme.inkSoft, marginBottom: 16 }}>
                Two-factor authentication is <span style={{ color: ink, fontWeight: 600 }}>enabled</span>.
              </p>
              <form onSubmit={handle2FADisable} style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                <PortalInput
                  label="Current 2FA Code"
                  value={twoFactorCode}
                  onChange={(v) => setTwoFactorCode(v)}
                  disabled={twoFactorLoading}
                  style={{ maxWidth: 200 }}
                />
                <PortalButton
                  type="submit"
                  variant="danger"
                  disabled={twoFactorLoading || !twoFactorCode}
                  icon={twoFactorLoading ? Loader2 : Lock}
                >
                  {twoFactorLoading ? 'Disabling...' : 'Disable 2FA'}
                </PortalButton>
              </form>
              {twoFactorError && <p style={{ fontSize: 11, color: '#dc2626', marginTop: 8 }}>{twoFactorError}</p>}
            </>
          ) : twoFactorSetup ? (
            <>
              <p style={{ fontSize: 13, color: portalTheme.inkSoft, marginBottom: 12 }}>
                Scan this QR code with your authenticator app, then enter the verification code below.
              </p>
              <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
                <div style={{ flex: '0 0 auto', textAlign: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#fff', border: `1px solid ${hairline}`, borderRadius: 10, width: 200, height: 200 }}>
                    {qrCodeDataUrl ? (
                      <img src={qrCodeDataUrl} alt="Scan with your authenticator app" style={{ width: 160, height: 160, objectFit: 'contain' }} />
                    ) : (
                      <div style={{ fontSize: 10, color: inkSoft }}>Generating QR code...</div>
                    )}
                  </div>
                </div>
                <form onSubmit={handle2FAEnable} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <PortalInput
                    label="Verification Code"
                    value={twoFactorCode}
                    onChange={(v) => setTwoFactorCode(v.replace(/\D/g, '').slice(0, 6))}
                    maxLength={6}
                    placeholder="000000"
                    disabled={twoFactorLoading}
                  />
                  <PortalButton
                    type="submit"
                    disabled={twoFactorLoading || twoFactorCode.length < 6}
                    icon={twoFactorLoading ? Loader2 : Save}
                  >
                    {twoFactorLoading ? 'Enabling...' : 'Enable 2FA'}
                  </PortalButton>
                </form>
              </div>
              <p style={{ fontSize: 11, color: portalTheme.inkSoft, marginTop: 12, wordBreak: 'break-all' }}>
                Secret: <code style={{ fontSize: 10 }}>{twoFactorSetup.secret}</code>
              </p>
            </>
          ) : (
            <div>
              <p style={{ fontSize: 13, color: portalTheme.inkSoft, marginBottom: 16 }}>
                Add an extra layer of security to your account with time-based one-time passwords (TOTP).
              </p>
              <PortalButton
                onClick={handle2FASetup}
                disabled={twoFactorLoading}
                icon={twoFactorLoading ? Loader2 : Shield}
              >
                {twoFactorLoading ? 'Setting up...' : 'Set Up 2FA'}
              </PortalButton>
            </div>
          )}
        </PortalCard>

        <PortalCard style={{ padding: '24px 30px', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>            <Monitor size={18} style={{ color: portalTheme.inkSoft }} />
            <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>
              Active Sessions
            </h2>
          </div>

          {sessionsLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 0' }}>
              <div className="w-6 h-6 border-2 border-teal-500/30 border-t-teal-600 rounded-full animate-spin" />
            </div>
          ) : sessions.length === 0 ? (
            <p style={{ fontSize: 13, color: portalTheme.inkSoft, textAlign: 'center', padding: '20px 0' }}>
              No active sessions found.
            </p>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => {
                const created = s.created_at ? new Date(s.created_at).toLocaleDateString() : '—';
                const expires = s.expires_at ? new Date(s.expires_at).toLocaleDateString() : '—';
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', background: '#FEFDFB', borderRadius: 12, border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 8, background: '#eef7f6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5c6567', flexShrink: 0 }}>
                        <Smartphone size={16} />
                      </div>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: '#23282A', margin: 0 }}>{s.user_agent || 'Unknown device'}</p>
                        <p style={{ fontSize: 11, color: '#5c6567', marginTop: 2 }}>Created: {created} • Expires: {expires}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setRevokeConfirmSessionId(s.id)}
                      disabled={revokingSessionId === s.id}
                      className="text-xs font-semibold text-rose-600 hover:text-rose-700 transition-colors inline-flex items-center gap-1"
                    >
                      {revokingSessionId === s.id ? 'Revoking...' : 'Revoke'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </PortalCard>
      </div>

      <ConfirmDialog
        open={revokeConfirmSessionId !== null}
        title="Revoke Session"
        message="Are you sure you want to revoke this session? The device will be signed out."
        confirmLabel="Revoke Session"
        variant="danger"
        onCancel={() => setRevokeConfirmSessionId(null)}
        onConfirm={() => {
          if (revokeConfirmSessionId) handleRevokeSession(revokeConfirmSessionId);
        }}
      />
    </div>
  );
};

export default CustomerProfile;
