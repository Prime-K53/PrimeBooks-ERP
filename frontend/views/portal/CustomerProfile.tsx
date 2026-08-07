import React, { useEffect, useState, useCallback } from 'react';
import { User, Save, Lock, Loader2, Monitor, Smartphone, Bell, Shield, Settings2, ChevronRight, Building2, Key, CheckCircle2 } from 'lucide-react';
import QRCode from 'qrcode';
import { portalLifecycle, portalApi } from '../../services/portalApiClient';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import ErrorBanner from './components/ErrorBanner';
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
const hairline = '#E7E3DA';
const danger = '#c0495f';
const canvas = '#F5F4EF';
const surface = '#FFFFFF';
const success = '#1f9d6b';
const warn = '#d99a3f';

// QBO Theme Styles (exact copy from Settings)
const qboStyles = `
    /* premium elevation token */
    .white-card {
        background: #FFFFFF;
        border: 1px solid rgba(16,24,40,0.07);
        border-radius: 14px;
        box-shadow: 0 1px 2px rgba(16,24,40,0.04), 0 12px 30px -16px rgba(16,24,40,0.18);
        transition: box-shadow .2s ease, transform .2s ease, border-color .2s ease;
    }
    .white-card:hover {
        box-shadow: 0 2px 4px rgba(16,24,40,0.05), 0 18px 40px -18px rgba(16,24,40,0.22);
    }
    .settings-label {
        display: block;
        font-size: 12.5px;
        font-weight: 600;
        color: #3b454c;
        margin-bottom: 7px;
        letter-spacing: 0.01em;
    }
    .settings-input {
        width: 100%;
        padding: 10px 13px;
        background: #FFFFFF;
        border: 1px solid #e2ded3;
        border-radius: 10px;
        font-size: 14px;
        color: #23282A;
        transition: all 0.2s;
        box-shadow: inset 0 1px 2px rgba(16,24,40,0.03);
    }
    .settings-input:focus {
        outline: none;
        border-color: #1f8577 !important;
        box-shadow: 0 0 0 3px rgba(31,133,119,0.18);
    }
    .settings-section-header {
        padding: 20px 28px;
        border-bottom: 1px solid rgba(16,24,40,0.06);
        background: linear-gradient(180deg, #fbfaf7 0%, #ffffff 100%);
        border-top-left-radius: 14px;
        border-top-right-radius: 14px;
    }

    /* Focus rings for inline-styled controls that don't use the .settings-input class */
    .premium-settings input:not([type=checkbox]):not([type=radio]):not([type=range]),
    .premium-settings textarea,
    .premium-settings select {
        transition: border-color .15s ease, box-shadow .15s ease !important;
    }
    .premium-settings input:not([type=checkbox]):not([type=radio]):not([type=range]):focus,
    .premium-settings textarea:focus,
    .premium-settings select:focus {
        outline: none;
        border-color: #1f8577 !important;
        box-shadow: 0 0 0 3px rgba(31,133,119,0.18) !important;
    }

    .toggle-input {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border-width: 0;
    }
    .toggle-track {
        width: 44px;
        height: 24px;
        background: #d3ece9;
        border-radius: 9999px;
        position: relative;
        transition: background 0.2s ease;
        cursor: pointer;
        flex-shrink: 0;
    }
    .toggle-track::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 20px;
        height: 20px;
        background: #ffffff;
        border-radius: 50%;
        border: 1px solid #D4D7DC;
        transition: transform 0.2s ease;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    .toggle-input:checked + .toggle-track {
        background: #1f8577;
    }
    .toggle-input:checked + .toggle-track::after {
        transform: translateX(20px);
    }
    .toggle-track-sm {
        width: 40px;
        height: 20px;
        background: #d3ece9;
        border-radius: 9999px;
        position: relative;
        transition: background 0.2s ease;
        cursor: pointer;
        flex-shrink: 0;
    }
    .toggle-track-sm::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        background: #ffffff;
        border-radius: 50%;
        border: 1px solid #D4D7DC;
        transition: transform 0.2s ease;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    .toggle-input:checked + .toggle-track-sm {
        background: #1f8577;
    }
    .toggle-input:checked + .toggle-track-sm::after {
        transform: translateX(16px);
    }
    .toggle-track-lg {
        width: 48px;
        height: 24px;
        background: #d3ece9;
        border-radius: 9999px;
        position: relative;
        transition: background 0.2s ease;
        cursor: pointer;
        flex-shrink: 0;
    }
    .toggle-track-lg::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 20px;
        height: 20px;
        background: #ffffff;
        border-radius: 50%;
        border: 1px solid #D4D7DC;
        transition: transform 0.2s ease;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    .toggle-input:checked + .toggle-track-lg {
        background: #1f8577;
    }
    .toggle-input:checked + .toggle-track-lg::after {
        transform: translateX(24px);
    }
    .toggle-track-xl {
        width: 56px;
        height: 28px;
        background: #d3ece9;
        border-radius: 9999px;
        position: relative;
        transition: background 0.2s ease;
        cursor: pointer;
        flex-shrink: 0;
    }
    .toggle-track-xl::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 24px;
        height: 24px;
        background: #ffffff;
        border-radius: 50%;
        border: 1px solid #D4D7DC;
        transition: transform 0.2s ease;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    .toggle-input:checked + .toggle-track-xl {
        background: #1f8577;
    }
    .toggle-input:checked + .toggle-track-xl::after {
        transform: translateX(24px);
    }
`;

// ClientModal-aligned style constants (exact copy from Settings)
const labelStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  fontSize: 12.5, fontWeight: 600, color: '#3b454c',
  marginBottom: 7, letterSpacing: 0.01
};

const inputStyle: React.CSSProperties = {
  width: '100%', fontFamily: "'Inter', sans-serif", fontSize: 13.5,
  color: ink, background: '#fff',
  border: '1px solid #e2ded3', borderRadius: 10,
  padding: '10px 13px', outline: 'none',
  boxShadow: 'inset 0 1px 2px rgba(16,24,40,0.03)',
  transition: 'border-color .15s ease, box-shadow .15s ease, background .15s ease'
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle, resize: 'none', minHeight: 72, lineHeight: 1.5
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%235c6567'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  paddingRight: 30,
  cursor: 'pointer'
};

const sectionLabelStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  margin: '30px 0 16px', paddingLeft: 12,
  borderLeft: `3px solid ${teal[500]}`
};

const btnGhostStyle: React.CSSProperties = {
  fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
  padding: '9px 18px', borderRadius: 10, cursor: 'pointer',
  background: '#fff', border: `1px solid ${hairline}`, color: inkSoft,
  display: 'flex', alignItems: 'center', gap: 7, transition: 'all .15s ease'
};

const btnPrimaryStyle: React.CSSProperties = {
  fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
  padding: '9px 18px', borderRadius: 10, cursor: 'pointer', border: '1px solid transparent',
  background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
  color: '#fff', display: 'flex', alignItems: 'center', gap: 7,
  boxShadow: `0 8px 20px -8px rgba(15,84,76,.6)`,
  transition: 'all .15s ease'
};

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

  const [activeTab, setActiveTab] = useState('Personal');

  // Inject qboStyles (exact copy from Settings)
  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = qboStyles;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

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
    let unsubscribe: (() => void) | undefined;
    (async () => {
      unsubscribe = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          if (type === 'entity_changed' && (payload?.docType === 'customer_updated' || payload?.docType === 'customer') && !cancelled) {
            loadProfile();
          }
        },
      });

    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
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

  if (loading) return <div className="p-8 max-w-4xl mx-auto"><div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-2 border-teal-500/30 border-t-teal-600 rounded-full animate-spin" /></div></div>;
  if (error) return <div className="p-8 max-w-4xl mx-auto"><ErrorBanner message={error} /></div>;

  // Menu groups (exact Settings structure)
  const menuGroups = [
    {
      title: 'Account & Organization',
      items: [
        { id: 'Personal', icon: Building2, label: 'Personal Information', desc: 'Your contact details and address' },
        { id: 'Notifications', icon: Bell, label: 'Notification Preferences', desc: 'Email and browser alerts' }
      ]
    },
    {
      title: 'Security',
      items: [
        { id: 'Password', icon: Key, label: 'Change Password', desc: 'Update your account password' },
        { id: 'TwoFactor', icon: Shield, label: 'Two-Factor Authentication', desc: 'Add an extra layer of security' },
        { id: 'Sessions', icon: Monitor, label: 'Active Sessions', desc: 'Manage devices signed in to your account' }
      ]
    }
  ];

  const activeGroupTitle = menuGroups.find(g => g.items.some(i => i.id === activeTab))?.title || 'Profile';
  const activeItemLabel = menuGroups.flatMap(g => g.items).find(i => i.id === activeTab)?.label || activeTab;

  return (
    <div className="premium-settings" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Inter','DM Sans',sans-serif" }}>
      {/* Header (exact Settings style) */}
      <div style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '15px 28px',
        borderBottom: '1px solid rgba(11,62,57,0.4)',
        background: 'linear-gradient(120deg, #0b3e39 0%, #146b60 52%, #1f8577 100%)',
        boxShadow: '0 6px 20px -10px rgba(11,62,57,0.6)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12,
            background: 'linear-gradient(155deg, rgba(255,255,255,0.22), rgba(255,255,255,0.06))',
            border: '1px solid rgba(255,255,255,0.28)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25)', flexShrink: 0
          }}>
            <Settings2 size={20} color="#fff" />
          </div>
          <div>
            <h1 style={{
              fontFamily: "'DM Serif Display', 'Georgia', serif", fontWeight: 400,
              fontSize: 19, margin: 0, color: '#ffffff', letterSpacing: 0.3
            }}>
              {activeItemLabel}
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'rgba(255,255,255,0.78)', letterSpacing: 0.02 }}>
              {activeGroupTitle} &mdash; Manage your account
            </p>
          </div>
        </div>
        <button onClick={handleSave} style={{
          display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
          fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
          padding: '9px 18px', borderRadius: 10, border: 'none',
          background: '#ffffff', color: teal[700],
          boxShadow: '0 8px 18px -8px rgba(0,0,0,0.45)',
          transition: 'all .15s ease'
        }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 12px 24px -10px rgba(0,0,0,0.5)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 8px 18px -8px rgba(0,0,0,0.45)'; }}
        >
          <CheckCircle2 size={16} /> Save Profile
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Premium Sidebar (exact Settings style) */}
        <div style={{
          width: 286, flexShrink: 0,
          background: '#FFFFFF',
          borderRight: '1px solid rgba(16,24,40,0.07)',
          display: 'flex', flexDirection: 'column', position: 'relative', overflowY: 'auto'
        }}>
          <div style={{
            color: '#8b938f', fontSize: 11, letterSpacing: '1px',
            textTransform: 'uppercase', fontWeight: 700, padding: '20px 18px 10px'
          }}>
            Profile
          </div>
          <div style={{ padding: '0 12px 16px', flex: 1 }}>
            {menuGroups.map(group => (
              <div key={group.title} style={{ marginBottom: 18 }}>
                <div style={{
                  color: '#9aa19c', fontSize: 10, letterSpacing: '0.9px',
                  textTransform: 'uppercase', fontWeight: 700, padding: '4px 6px 9px'
                }}>{group.title}</div>
                {group.items.map(item => {
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '11px 13px', borderRadius: 11, width: '100%',
                        background: isActive ? `linear-gradient(135deg, ${teal[500]}, ${teal[700]})` : '#FFFFFF',
                        border: isActive ? '1px solid transparent' : '1px solid rgba(16,24,40,0.06)',
                        boxShadow: isActive ? `0 10px 22px -10px rgba(15,84,76,0.55)` : '0 1px 2px rgba(16,24,40,0.04)',
                        cursor: 'pointer', marginBottom: 8,
                        transition: 'all .15s ease', position: 'relative',
                        textAlign: 'left',
                      }}
                      onMouseEnter={e => {
                        if (!isActive) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 16px -8px rgba(16,24,40,0.18)'; }
                      }}
                      onMouseLeave={e => {
                        if (!isActive) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(1