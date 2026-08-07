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
                        if (!isActive) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(16,24,40,0.04)'; }
                      }}
                    >
                      <div style={{
                        width: 34, height: 34, borderRadius: 9,
                        background: isActive ? 'rgba(255,255,255,0.18)' : '#eef7f6',
                        color: isActive ? '#fff' : teal[600],
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                      }}>
                        <item.icon size={16} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: isActive ? '#fff' : '#23282A' }}>{item.label}</div>
                        <div style={{ fontSize: 10, color: isActive ? 'rgba(255,255,255,0.82)' : '#5c6567', marginTop: 1, lineHeight: 1.3 }}>{item.desc}</div>
                      </div>
                      <div style={{
                        marginLeft: 'auto', padding: '4px 9px', borderRadius: 6,
                        background: isActive ? 'rgba(255,255,255,0.2)' : '#eef7f6',
                        color: isActive ? '#fff' : teal[600],
                        fontSize: 10, fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0
                      }}>
                        Open
                        <ChevronRight size={10} />
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Content Area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '28px 36px', background: 'linear-gradient(180deg, #F7F6F2 0%, #F2F1EB 100%)' }}>
          <div style={{ maxWidth: '920px' }}>
            {saveMsg && (
              <div style={{
                marginBottom: 18, padding: '12px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                border: `1px solid ${saveMsg.includes('successfully') ? '#a6d9d3' : '#f0c4cd'}`,
                background: saveMsg.includes('successfully') ? '#e9f7f4' : '#fdeef0',
                color: saveMsg.includes('successfully') ? teal[700] : danger,
              }}>
                {saveMsg}
              </div>
            )}

            {activeTab === 'Personal' && (
              <form onSubmit={handleSave}>
                <div style={sectionLabelStyle}><span style={{ fontSize: 13, fontWeight: 700, color: teal[800] }}>Personal Information</span></div>
                <div className="white-card" style={{ padding: '24px 28px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', columnGap: 16, rowGap: 16 }}>
                    <div>
                      <label style={labelStyle}>Full Name</label>
                      <input style={inputStyle} name="full_name" value={form.full_name || ''} onChange={handleChange} placeholder="Your full name" />
                    </div>
                    <div>
                      <label style={labelStyle}>Email</label>
                      <input style={{ ...inputStyle, background: '#f5f4f0', color: inkSoft }} name="email" value={form.email || ''} onChange={handleChange} disabled />
                    </div>
                    <div>
                      <label style={labelStyle}>Phone</label>
                      <input style={inputStyle} name="phone" value={form.phone || ''} onChange={handleChange} placeholder="Phone number" />
                    </div>
                    <div>
                      <label style={labelStyle}>Address</label>
                      <input style={inputStyle} name="address" value={form.address || ''} onChange={handleChange} placeholder="Street address" />
                    </div>
                    <div>
                      <label style={labelStyle}>City</label>
                      <input style={inputStyle} name="city" value={form.city || ''} onChange={handleChange} placeholder="City" />
                    </div>
                    <div>
                      <label style={labelStyle}>State / Province</label>
                      <input style={inputStyle} name="state" value={form.state || ''} onChange={handleChange} placeholder="State" />
                    </div>
                    <div>
                      <label style={labelStyle}>ZIP / Postal Code</label>
                      <input style={inputStyle} name="zip" value={form.zip || ''} onChange={handleChange} placeholder="ZIP code" />
                    </div>
                    <div>
                      <label style={labelStyle}>Country</label>
                      <input style={inputStyle} name="country" value={form.country || ''} onChange={handleChange} placeholder="Country" />
                    </div>
                  </div>
                  <div style={{ marginTop: 22, display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="submit" style={{ ...btnPrimaryStyle, justifyContent: 'center', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                      {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {activeTab === 'Notifications' && (
              <div>
                <div style={sectionLabelStyle}><span style={{ fontSize: 13, fontWeight: 700, color: teal[800] }}>Notification Preferences</span></div>
                <div className="white-card" style={{ padding: '24px 28px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: ink }}>Browser notifications</div>
                      <p style={{ margin: '4px 0 0', fontSize: 11.5, color: inkSoft, lineHeight: 1.5 }}>
                        Receive native browser notifications for important portal events (quotation ready, order shipped, etc.).
                      </p>
                    </div>
                    <label style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        className="toggle-input"
                        checked={browserNotifs}
                        onChange={(e) => {
                          const val = e.target.checked;
                          setBrowserNotifs(val);
                          localStorage.setItem('portal_browser_notifications', String(val));
                        }}
                      />
                      <span className="toggle-track" />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'Password' && (
              <form onSubmit={handlePasswordChange}>
                <div style={sectionLabelStyle}><span style={{ fontSize: 13, fontWeight: 700, color: teal[800] }}>Change Password</span></div>
                <div className="white-card" style={{ padding: '24px 28px' }}>
                  {passwordMsg && (
                    <div style={{
                      marginBottom: 16, padding: '12px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                      border: '1px solid #A6D9D3', background: '#e9f7f4', color: teal[700],
                    }}>{passwordMsg}</div>
                  )}
                  {passwordError && <ErrorBanner message={passwordError} onDismiss={() => setPasswordError(null)} />}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                    <div>
                      <label style={labelStyle}>Current Password</label>
                      <input style={inputStyle} type="password" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm((p) => ({ ...p, currentPassword: e.target.value }))} />
                    </div>
                    <div>
                      <label style={labelStyle}>New Password</label>
                      <input style={inputStyle} type="password" value={passwordForm.newPassword} onChange={(e) => setPasswordForm((p) => ({ ...p, newPassword: e.target.value }))} />
                    </div>
                    <div>
                      <label style={labelStyle}>Confirm Password</label>
                      <input style={inputStyle} type="password" value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm((p) => ({ ...p, confirmPassword: e.target.value }))} />
                    </div>
                  </div>
                  <p style={{ fontSize: 11, color: inkSoft, marginTop: 12 }}>Password must be at least 6 characters long.</p>
                  <div style={{ marginTop: 22, display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="submit"
                      style={{ ...btnPrimaryStyle, justifyContent: 'center', cursor: changingPassword ? 'default' : 'pointer', opacity: changingPassword ? 0.7 : 1 }}
                      disabled={changingPassword || !passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword}
                    >
                      {changingPassword ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />}
                      {changingPassword ? 'Changing...' : 'Change Password'}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {activeTab === 'TwoFactor' && (
              <div>
                <div style={sectionLabelStyle}><span style={{ fontSize: 13, fontWeight: 700, color: teal[800] }}>Two-Factor Authentication</span></div>
                <div className="white-card" style={{ padding: '24px 28px' }}>
                  {twoFactorError && <ErrorBanner message={twoFactorError} onDismiss={() => setTwoFactorError(null)} />}

                  {twoFactorStatus?.enabled ? (
                    <>
                      <p style={{ fontSize: 13, color: inkSoft, marginBottom: 16 }}>
                        Two-factor authentication is <span style={{ color: ink, fontWeight: 600 }}>enabled</span>.
                      </p>
                      <form onSubmit={handle2FADisable} style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                        <div>
                          <label style={labelStyle}>Current 2FA Code</label>
                          <input style={{ ...inputStyle, maxWidth: 200 }} value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value)} disabled={twoFactorLoading} placeholder="000000" maxLength={6} />
                        </div>
                        <button type="submit" disabled={twoFactorLoading || !twoFactorCode} style={{ ...btnGhostStyle, justifyContent: 'center', color: danger, borderColor: '#f0c4cd', background: '#fdf1f3', cursor: twoFactorLoading ? 'default' : 'pointer' }}>
                          {twoFactorLoading ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />}
                          {twoFactorLoading ? 'Disabling...' : 'Disable 2FA'}
                        </button>
                      </form>
                    </>
                  ) : twoFactorSetup ? (
                    <>
                      <p style={{ fontSize: 13, color: inkSoft, marginBottom: 12 }}>
                        Scan this QR code with your authenticator app, then enter the verification code below.
                      </p>
                      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <div style={{ flex: '0 0 auto', textAlign: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#fff', border: `1px solid ${hairline}`, borderRadius: 10, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                            {qrCodeDataUrl ? (
                              <img src={qrCodeDataUrl} alt="Scan with your authenticator app" style={{ width: 160, height: 160, objectFit: 'contain' }} />
                            ) : (
                              <div style={{ width: 160, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: inkSoft }}>Generating QR code...</div>
                            )}
                          </div>
                        </div>
                        <form onSubmit={handle2FAEnable} style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 14 }}>
                          <div>
                            <label style={labelStyle}>Verification Code</label>
                            <input style={inputStyle} value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" maxLength={6} disabled={twoFactorLoading} />
                          </div>
                          <button type="submit" disabled={twoFactorLoading || twoFactorCode.length < 6} style={{ ...btnPrimaryStyle, justifyContent: 'center', cursor: twoFactorLoading ? 'default' : 'pointer', opacity: twoFactorLoading || twoFactorCode.length < 6 ? 0.7 : 1 }}>
                            {twoFactorLoading ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                            {twoFactorLoading ? 'Enabling...' : 'Enable 2FA'}
                          </button>
                        </form>
                      </div>
                      <p style={{ fontSize: 11, color: inkSoft, marginTop: 12, wordBreak: 'break-all' }}>
                        Secret: <code style={{ fontSize: 10 }}>{twoFactorSetup.secret}</code>
                      </p>
                    </>
                  ) : (
                    <div>
                      <p style={{ fontSize: 13, color: inkSoft, marginBottom: 16 }}>
                        Add an extra layer of security to your account with time-based one-time passwords (TOTP).
                      </p>
                      <button onClick={handle2FASetup} disabled={twoFactorLoading} style={{ ...btnPrimaryStyle, justifyContent: 'center', cursor: twoFactorLoading ? 'default' : 'pointer', opacity: twoFactorLoading ? 0.7 : 1 }}>
                        {twoFactorLoading ? <Loader2 size={15} className="animate-spin" /> : <Shield size={15} />}
                        {twoFactorLoading ? 'Setting up...' : 'Set Up 2FA'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'Sessions' && (
              <div>
                <div style={sectionLabelStyle}><span style={{ fontSize: 13, fontWeight: 700, color: teal[800] }}>Active Sessions</span></div>
                <div className="white-card" style={{ padding: '24px 28px' }}>
                  {sessionsLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 0' }}>
                      <div className="w-6 h-6 border-2 border-teal-500/30 border-t-teal-600 rounded-full animate-spin" />
                    </div>
                  ) : sessions.length === 0 ? (
                    <p style={{ fontSize: 13, color: inkSoft, textAlign: 'center', padding: '20px 0' }}>No active sessions found.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {sessions.map((s) => {
                        const created = s.created_at ? new Date(s.created_at).toLocaleDateString() : '—';
                        const expires = s.expires_at ? new Date(s.expires_at).toLocaleDateString() : '—';
                        return (
                          <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', background: '#FFFFFF', borderRadius: 12, border: `1px solid ${hairline}`, boxShadow: '0 1px 2px rgba(16,24,40,0.04)', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                              <div style={{ width: 36, height: 36, borderRadius: 10, background: '#eef7f6', color: teal[600], display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <Smartphone size={16} />
                              </div>
                              <div>
                                <p style={{ fontSize: 13, fontWeight: 600, color: ink, margin: 0 }}>{s.user_agent || 'Unknown device'}</p>
                                <p style={{ fontSize: 11, color: inkSoft, marginTop: 2 }}>Created: {created} &bull; Expires: {expires}</p>
                              </div>
                            </div>
                            <button
                              onClick={() => setRevokeConfirmSessionId(s.id)}
                              disabled={revokingSessionId === s.id}
                              style={{ ...btnGhostStyle, color: danger, borderColor: '#f0c4c4', background: '#fdf1f3', cursor: revokingSessionId === s.id ? 'default' : 'pointer' }}
                            >
                              {revokingSessionId === s.id ? 'Revoking...' : 'Revoke'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
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