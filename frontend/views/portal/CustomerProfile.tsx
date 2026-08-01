import React, { useEffect, useState } from 'react';
import { User, Save, Lock, Loader2 } from 'lucide-react';
import { portalApi } from '../../services/portalApiClient';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

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

  if (loading) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="detail" /></div>;
  if (error) return <div className="p-8 max-w-4xl mx-auto"><div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 text-sm">{error}</div></div>;

  return (
    <div style={{
      background: paper,
      borderRadius: 14,
      overflow: 'hidden'
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '22px 28px 18px',
        borderBottom: `1px solid ${hairline}`,
        background: paper
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 10px -3px rgba(15,84,76,.6)', flexShrink: 0
          }}>
            <User size={19} color="#fff" />
          </div>
          <div>
            <h1 style={{
              fontFamily: "'DM Serif Display', 'Georgia', serif", fontWeight: 400,
              fontSize: 22, margin: 0, color: teal[800], letterSpacing: 0.2
            }}>
              My Profile
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 11.5, color: inkSoft, letterSpacing: 0.02 }}>
              Manage your account information
            </p>
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 30px 8px' }}>
        {saveMsg && (
          <div className={`mb-5 p-3.5 border rounded-xl text-sm ${saveMsg.includes('successfully') ? 'bg-teal-50 border-teal-200 text-teal-700' : 'bg-rose-50 border-rose-200 text-rose-600'}`}>
            {saveMsg}
          </div>
        )}

        <form onSubmit={handleSave} style={{
          background: paper, borderRadius: 14,
          border: `1.4px solid ${hairline}`,
          boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(255,255,255,.04)',
          padding: '24px 30px', marginBottom: 18
        }}>
          <h2 style={{
            margin: '0 0 18px', fontSize: 12, fontWeight: 600,
            color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06
          }}>
            Personal Information
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <div>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 600, color: teal[800],
                marginBottom: 6, letterSpacing: 0.01
              }}>
                Full Name
              </label>
              <input
                name="full_name"
                value={form.full_name || ''}
                onChange={handleChange}
                style={{
                  width: '100%', fontFamily: "'Inter', sans-serif", fontSize: 13.5,
                  color: ink, background: paper,
                  border: `1.4px solid ${hairline}`, borderRadius: 9,
                  padding: '9px 12px', outline: 'none',
                  transition: 'border-color .15s ease, box-shadow .15s ease, background .15s ease'
                }}
                onFocus={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.boxShadow = `0 0 0 3px ${teal[50]}`; }}
                onBlur={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>
            <div>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 600, color: teal[800],
                marginBottom: 6, letterSpacing: 0.01
              }}>
                Email
              </label>
              <input
                name="email"
                value={form.email || ''}
                readOnly
                style={{
                  width: '100%', fontFamily: "'Inter', sans-serif", fontSize: 13.5,
                  color: inkSoft, background: paper,
                  border: `1.4px solid ${hairline}`, borderRadius: 9,
                  padding: '9px 12px', outline: 'none', cursor: 'not-allowed'
                }}
              />
            </div>
            <div>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 600, color: teal[800],
                marginBottom: 6, letterSpacing: 0.01
              }}>
                Phone
              </label>
              <input
                name="phone"
                value={form.phone || ''}
                onChange={handleChange}
                style={{
                  width: '100%', fontFamily: "'Inter', sans-serif", fontSize: 13.5,
                  color: ink, background: paper,
                  border: `1.4px solid ${hairline}`, borderRadius: 9,
                  padding: '9px 12px', outline: 'none',
                  transition: 'border-color .15s ease, box-shadow .15s ease, background .15s ease'
                }}
                onFocus={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.boxShadow = `0 0 0 3px ${teal[50]}`; }}
                onBlur={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>
            <div>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 600, color: teal[800],
                marginBottom: 6, letterSpacing: 0.01
              }}>
                Address
              </label>
              <input
                name="address"
                value={form.address || ''}
                onChange={handleChange}
                style={{
                  width: '100%', fontFamily: "'Inter', sans-serif", fontSize: 13.5,
                  color: ink, background: paper,
                  border: `1.4px solid ${hairline}`, borderRadius: 9,
                  padding: '9px 12px', outline: 'none',
                  transition: 'border-color .15s ease, box-shadow .15s ease, background .15s ease'
                }}
                onFocus={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.boxShadow = `0 0 0 3px ${teal[50]}`; }}
                onBlur={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>
            <div>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 600, color: teal[800],
                marginBottom: 6, letterSpacing: 0.01
              }}>
                City
              </label>
              <input
                name="city"
                value={form.city || ''}
                onChange={handleChange}
                style={{
                  width: '100%', fontFamily: "'Inter', sans-serif", fontSize: 13.5,
                  color: ink, background: paper,
                  border: `1.4px solid ${hairline}`, borderRadius: 9,
                  padding: '9px 12px', outline: 'none',
                  transition: 'border-color .15s ease, box-shadow .15s ease, background .15s ease'
                }}
                onFocus={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.boxShadow = `0 0 0 3px ${teal[50]}`; }}
                onBlur={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>
            <div>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 600, color: teal[800],
                marginBottom: 6, letterSpacing: 0.01
              }}>
                State
              </label>
              <input
                name="state"
                value={form.state || ''}
                onChange={handleChange}
                style={{
                  width: '100%', fontFamily: "'Inter', sans-serif", fontSize: 13.5,
                  color: ink, background: paper,
                  border: `1.4px solid ${hairline}`, borderRadius: 9,
                  padding: '9px 12px', outline: 'none',
                  transition: 'border-color .15s ease, box-shadow .15s ease, background .15s ease'
                }}
                onFocus={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.boxShadow = `0 0 0 3px ${teal[50]}`; }}
                onBlur={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>
            <div>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 600, color: teal[800],
                marginBottom: 6, letterSpacing: 0.01
              }}>
                ZIP Code
              </label>
              <input
                name="zip"
                value={form.zip || ''}
                onChange={handleChange}
                style={{
                  width: '100%', fontFamily: "'Inter', sans-serif", fontSize: 13.5,
                  color: ink, background: paper,
                  border: `1.4px solid ${hairline}`, borderRadius: 9,
                  padding: '9px 12px', outline: 'none',
                  transition: 'border-color .15s ease, box-shadow .15s ease, background .15s ease'
                }}
                onFocus={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.boxShadow = `0 0 0 3px ${teal[50]}`; }}
                onBlur={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>
            <div>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 600, color: teal[800],
                marginBottom: 6, letterSpacing: 0.01
              }}>
                Country
              </label>
              <input
                name="country"
                value={form.country || ''}
                onChange={handleChange}
                style={{
                  width: '100%', fontFamily: "'Inter', sans-serif", fontSize: 13.5,
                  color: ink, background: paper,
                  border: `1.4px solid ${hairline}`, borderRadius: 9,
                  padding: '9px 12px', outline: 'none',
                  transition: 'border-color .15s ease, box-shadow .15s ease, background .15s ease'
                }}
                onFocus={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.boxShadow = `0 0 0 3px ${teal[50]}`; }}
                onBlur={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>
          </div>
          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="submit"
              disabled={saving}
              style={{
                fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
                padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid transparent',
                background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
                color: '#fff', display: 'flex', alignItems: 'center', gap: 7,
                boxShadow: '0 6px 16px -6px rgba(15,84,76,.55)',
                opacity: saving ? 0.5 : 1
              }}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>

        <form onSubmit={handlePasswordChange} style={{
          background: paper, borderRadius: 14,
          border: `1.4px solid ${hairline}`,
          boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(255,255,255,.04)',
          padding: '24px 30px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <Lock size={18} style={{ color: inkSoft }} />
            <h2 style={{
              margin: 0, fontSize: 12, fontWeight: 600,
              color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06
            }}>
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
            <div>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 600, color: teal[800],
                marginBottom: 6, letterSpacing: 0.01
              }}>
                Current Password
              </label>
              <input
                type="password"
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm((p) => ({ ...p, currentPassword: e.target.value }))}
                style={{
                  width: '100%', fontFamily: "'Inter', sans-serif", fontSize: 13.5,
                  color: ink, background: paper,
                  border: `1.4px solid ${hairline}`, borderRadius: 9,
                  padding: '9px 12px', outline: 'none',
                  transition: 'border-color .15s ease, box-shadow .15s ease, background .15s ease'
                }}
                onFocus={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.boxShadow = `0 0 0 3px ${teal[50]}`; }}
                onBlur={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>
            <div>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 600, color: teal[800],
                marginBottom: 6, letterSpacing: 0.01
              }}>
                New Password
              </label>
              <input
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm((p) => ({ ...p, newPassword: e.target.value }))}
                style={{
                  width: '100%', fontFamily: "'Inter', sans-serif", fontSize: 13.5,
                  color: ink, background: paper,
                  border: `1.4px solid ${hairline}`, borderRadius: 9,
                  padding: '9px 12px', outline: 'none',
                  transition: 'border-color .15s ease, box-shadow .15s ease, background .15s ease'
                }}
                onFocus={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.boxShadow = `0 0 0 3px ${teal[50]}`; }}
                onBlur={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>
            <div>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 600, color: teal[800],
                marginBottom: 6, letterSpacing: 0.01
              }}>
                Confirm Password
              </label>
              <input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                style={{
                  width: '100%', fontFamily: "'Inter', sans-serif", fontSize: 13.5,
                  color: ink, background: paper,
                  border: `1.4px solid ${hairline}`, borderRadius: 9,
                  padding: '9px 12px', outline: 'none',
                  transition: 'border-color .15s ease, box-shadow .15s ease, background .15s ease'
                }}
                onFocus={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.boxShadow = `0 0 0 3px ${teal[50]}`; }}
                onBlur={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>
          </div>
          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="submit"
              disabled={changingPassword || !passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword}
              style={{
                fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
                padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid transparent',
                background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
                color: '#fff', display: 'flex', alignItems: 'center', gap: 7,
                boxShadow: '0 6px 16px -6px rgba(15,84,76,.55)',
                opacity: (changingPassword || !passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) ? 0.5 : 1
              }}
            >
              {changingPassword ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
              {changingPassword ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CustomerProfile;
