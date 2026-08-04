import React, { useCallback, useEffect, useState } from 'react';
import { DollarSign, FileText, ShoppingCart, TrendingUp, Activity, ClipboardList, FileCheck2, ChevronRight, UserPlus, CreditCard, Wallet, Share2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { portalApi, portalLifecycle } from '../../services/portalApiClient';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import ErrorBanner from './components/ErrorBanner';
import PortalKPICard from './components/PortalKPICard';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import PortalButton from './components/PortalButton';
import { portalTheme, formatK } from './constants';

interface Transaction {
  date: string;
  description: string;
  amount: number | null;
  type: string;
  status?: string;
  docType?: string;
  docId?: string;
}

interface DashboardData {
  balance: number;
  outstandingBalance: number;
  walletBalance: number;
  unpaidInvoiceCount: number;
  totalOrders: number;
  unreadMessageCount: number;
  recentTransactions: Transaction[];
}

const ACTIVITY_ICON: Record<string, { icon: React.ReactNode; bg: string; border: string; credit: boolean }> = {
  invoice: { icon: <FileText size={16} color="#1f8577" />, bg: '#eef7f6', border: '#1f8577', credit: false },
  sale: { icon: <DollarSign size={16} color="#059669" />, bg: '#ecfdf5', border: '#059669', credit: true },
  payment: { icon: <TrendingUp size={16} color="#059669" />, bg: '#ecfdf5', border: '#059669', credit: true },
  order: { icon: <ShoppingCart size={16} color="#2563eb" />, bg: '#eff6ff', border: '#2563eb', credit: false },
  quotation: { icon: <FileCheck2 size={16} color="#7c3aed" />, bg: '#f5f3ff', border: '#7c3aed', credit: false },
  request: { icon: <ClipboardList size={16} color="#b45309" />, bg: '#fffbeb', border: '#b45309', credit: false },
};
const ACTIVITY_DEFAULT: { icon: React.ReactNode; bg: string; border: string; credit: boolean } = {
  icon: <Activity size={16} color="#5c6567" />,
  bg: '#f8fafc',
  border: '#94a3b8',
  credit: false,
};

const getTransactionIconMeta = (t: Transaction) =>
  (t.docType && ACTIVITY_ICON[t.docType]) || (t.type && ACTIVITY_ICON[t.type]) || ACTIVITY_DEFAULT;

const getTransactionIcon = (t: Transaction) => {
  const meta = getTransactionIconMeta(t);
  if (t.type === 'credit' || t.docType === 'payment' || t.type === 'sale') {
    return <TrendingUp size={16} color="#059669" />;
  }
  return meta.icon;
};

const getTransactionIconBg = (t: Transaction) => {
  if (t.type === 'credit') return '#ecfdf5';
  return getTransactionIconMeta(t).bg;
};

const getTransactionBorderColor = (t: Transaction) => {
  if (t.type === 'credit') return '#059669';
  return getTransactionIconMeta(t).border;
};

const isCreditActivity = (t: Transaction) =>
  t.type === 'credit' || t.docType === 'payment' || t.type === 'sale';

const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

const CustomerDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useCustomerAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [referralSettings, setReferralSettings] = useState<any>(null);
  const [referralFunnel, setReferralFunnel] = useState<any>(null);
  const [referralLoading, setReferralLoading] = useState(true);
  const [selectedMethod, setSelectedMethod] = useState<number | null>(null);

  const paymentMethods = [
    {
      title: 'National Bank',
      details: [
        { label: 'Account Name', value: 'Rhonald Chiwatu' },
        { label: 'Account Number', value: '1010182286' },
      ],
    },
    {
      title: 'First Capital Bank',
      details: [
        { label: 'Account Name', value: 'Rhonald Chiwatu' },
        { label: 'Account Number', value: '1036047166312' },
      ],
    },
    {
      title: 'Airtel Agent Transfer',
      details: [
        { label: 'Dealer Number', value: '0982482425' },
        { label: 'Agent Name', value: 'Rhonald Chiwatu' },
      ],
    },
  ];

  useEffect(() => {
    portalApi.get<DashboardData>('/dashboard')
      .then(setData)
      .catch((err) => setError(err.message || 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [settings, funnel] = await Promise.all([
          portalLifecycle.referrals.settings().catch(() => null),
          portalLifecycle.referrals.stats().catch(() => null),
        ]);
        if (!cancelled) {
          setReferralSettings(settings);
          setReferralFunnel(funnel);
        }
      } finally {
        if (!cancelled) setReferralLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ERP_DOC_TYPES = ['invoice', 'order', 'sale', 'payment', 'quotation', 'request', 'shipment'];
      const sub = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          const docType = payload?.docType;
          const activity = (payload?.event === 'payment_allocated')
            || (docType && ERP_DOC_TYPES.includes(docType))
            || type === 'activity';
          if (activity && !cancelled) {
            portalApi.get<DashboardData>('/dashboard')
              .then(setData)
              .catch(() => {});
          }
        },
      });
      if (!cancelled) return sub;
    })();
    return () => { cancelled = true; };
  }, []);

  const handleShareWhatsApp = useCallback(() => {
    const message = `I highly recommend *Prime Printing* for quality, affordable, and reliable printing services.\n\nSimply *mention that you were referred by an existing customer*, and you'll receive a *discount on your first order*.\n\nGive them a try—you won't be disappointed!`;
    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  }, []);

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <PortalLoadingSkeleton type="card" />
        <PortalLoadingSkeleton type="table" count={5} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      </div>
    );
  }

  if (!data) return null;

  const recentTransactions = (data.recentTransactions || [])
    .slice()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 3);

  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mt-6" />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#5c6567', letterSpacing: '0.02em' }}>{getGreeting()}, </span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#0b3e39' }}>{user?.full_name || 'Guest'}</span>
          </div>
          <div style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 28, color: '#0b3e39', letterSpacing: '0.2px', lineHeight: 1.2, fontWeight: 400 }}>
            {todayLabel}
          </div>
          <div style={{ fontSize: 13, color: '#5c6567', fontWeight: 500 }}>Here's what's happening with your Orders today.</div>
        </div>
        <PortalButton variant="primary" size="sm" onClick={() => navigate('/portal/new-request?type=order')} icon={ShoppingCart}>Create</PortalButton>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 18 }}>
        <PortalKPICard label="Outstanding Balance" value={formatK(data.outstandingBalance || 0)} icon={DollarSign} color="rose" onClick={() => navigate('/portal/statements')} />
        <PortalKPICard label="Unpaid Invoices" value={data.unpaidInvoiceCount ?? 0} icon={FileText} color="amber" onClick={() => navigate('/portal/invoices?status=Unpaid')} />
        <PortalKPICard label="Total Orders" value={data.totalOrders ?? 0} icon={ShoppingCart} color="slate" onClick={() => navigate('/portal/orders')} />
        <PortalKPICard label="Wallet Balance" value={formatK(data.walletBalance || 0)} icon={Wallet} color="blue" onClick={() => navigate('/portal/wallet')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200/60">
              <h2 className="text-sm font-semibold text-slate-800">Recent Activity</h2>
            </div>
            <div className="p-2">
              {recentTransactions.length === 0 ? (
                <div className="p-6 text-center text-slate-400">
                  <Activity size={28} className="mx-auto mb-2" />
                  <p>No recent transactions</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentTransactions.map((t, i) => {
                    const isCredit = isCreditActivity(t);
                    const target = t.docId && t.docType
                      ? t.docType === 'invoice'
                        ? `/portal/invoices/${t.docId}`
                        : t.docType === 'order'
                          ? `/portal/orders/${t.docId}`
                          : t.docType === 'quotation'
                            ? `/portal/quotations/${t.docId}`
                            : t.docType === 'request'
                              ? `/portal/requests/${t.docId}`
                              : null
                      : null;
                    const hasAmount = typeof t.amount === 'number' && Number.isFinite(t.amount);
                    return (
                      <div
                        key={`${t.description}-${t.date}-${t.amount}-${i}`}
                        onClick={() => target && navigate(target)}
                        className="rounded-[10px] p-[12px_14px] bg-[#FEFDFB] border-[1.4px] border-[#e4ddd1] border-l-[4px] flex items-center gap-3 text-left w-full shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
                        style={{ borderLeftColor: getTransactionBorderColor(t), cursor: target ? 'pointer' : 'default' }}
                      >
                        <div style={{
                          width: 34, height: 34, borderRadius: 8,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: getTransactionIconBg(t),
                          flexShrink: 0,
                        }}>
                          {getTransactionIcon(t)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#23282A' }}>{t.description}</div>
                          <div style={{ fontSize: 10, color: '#5c6567', marginTop: 1, lineHeight: 1.3 }}>
                            {new Date(t.date).toLocaleDateString()}
                            {t.status ? ` • ${t.status}` : ''}
                          </div>
                        </div>
                        {hasAmount ? (
                          <div style={{ textAlign: 'right', minWidth: 80 }}>
                            <div style={{
                              fontSize: 14, fontWeight: 600,
                              color: isCredit ? '#059669' : '#dc2626',
                              fontFamily: "'Inter', sans-serif",
                              fontVariantNumeric: 'tabular-nums',
                            }}>
                              {formatK(t.amount)}
                            </div>
                            <div style={{ fontSize: 10, color: '#5c6567', textTransform: 'uppercase', marginTop: 1 }}>
                              {(t.docType || t.type) && String(t.docType || t.type).replace(/_/g, ' ')}
                            </div>
                          </div>
                        ) : (
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 10, color: '#5c6567', textTransform: 'uppercase' }}>
                              {(t.docType || t.type) && String(t.docType || t.type).replace(/_/g, ' ')}
                            </div>
                          </div>
                        )}
                        {target && (
                          <div style={{
                            marginLeft: 'auto',
                            padding: '4px 10px',
                            borderRadius: 6,
                            background: '#eef7f6',
                            fontSize: 10,
                            fontWeight: 600,
                            color: '#1f8577',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 3,
                            flexShrink: 0,
                          }}>
                            View
                            <ChevronRight size={10} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200/60">
            <h2 className="text-lg font-semibold text-slate-900" style={{ fontFamily: "'Inter', sans-serif", lineHeight: 1.4 }}>Payment Methods</h2>
            <p className="text-xs text-slate-500 mt-0.5" style={{ fontFamily: "'Inter', sans-serif", lineHeight: 1.45 }}>Select a method to view details</p>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {paymentMethods.map((method, index) => {
                const isSelected = selectedMethod === index;
                return (
                  <div
                    key={index}
                    onClick={() => setSelectedMethod(isSelected ? null : index)}
                    className="rounded-xl border cursor-pointer transition-all duration-200"
                    style={{
                      background: isSelected ? '#f8fafc' : '#fff',
                      border: isSelected ? '1.4px solid #3fa294' : '1.4px solid #e4ddd1',
                      boxShadow: isSelected ? '0 2px 8px rgba(15, 84, 76, 0.08)' : '0 1px 2px rgba(0,0,0,0.04)',
                      padding: '12px 14px',
                    }}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{
                          background: 'linear-gradient(135deg, #3fa294 0%, #0f544c 100%)',
                          boxShadow: '0 1px 3px rgba(15, 84, 76, 0.15)',
                        }}
                      >
                        <CreditCard size={16} className="text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-slate-900 truncate" style={{ fontFamily: "'Inter', sans-serif", lineHeight: 1.4 }}>
                          {method.title}
                        </h3>
                      </div>
                      <div className="shrink-0" style={{ color: '#5c6567' }}>
                        {isSelected ? '−' : '+'}
                      </div>
                    </div>
                    {isSelected && (
                      <div className="mt-3 pt-3 border-t" style={{ borderColor: '#e4ddd1' }}>
                        <div className="space-y-2">
                          {method.details.map((detail, i) => (
                            <div key={i} className="flex items-center justify-between gap-3">
                              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide" style={{ fontFamily: "'Inter', sans-serif", lineHeight: 1.45, fontWeight: 500 }}>
                                {detail.label}
                              </span>
                              <span className="text-xs font-semibold text-slate-800 text-right" style={{ fontFamily: "'Inter', sans-serif", lineHeight: 1.45, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                                {detail.value}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={handleShareWhatsApp}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: '#25D366',
          color: '#fff',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 6px 16px rgba(37, 211, 102, 0.4)',
          zIndex: 50,
          transition: 'all .15s ease',
        }}
        title="Share via WhatsApp"
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
      >
        <Share2 size={24} />
      </button>
    </div>
  );
};

export default CustomerDashboard;
