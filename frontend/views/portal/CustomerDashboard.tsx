import React, { useCallback, useEffect, useState } from 'react';
import { DollarSign, FileText, ShoppingCart, TrendingUp, Activity, ClipboardList, FileCheck2, ChevronRight, UserPlus, CreditCard, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { portalApi, portalLifecycle } from '../../services/portalApiClient';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import ErrorBanner from './components/ErrorBanner';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import PortalButton from './components/PortalButton';
import CustomerHealthScore from './components/CustomerHealthScore';
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

const getTransactionIconMeta = (t: Transaction): { icon: React.ReactNode; bg: string; border: string; credit: boolean } => {
  const byDoc = t.docType ? ACTIVITY_ICON[t.docType] : undefined;
  const byType = t.type ? ACTIVITY_ICON[t.type] : undefined;
  return byDoc || byType || ACTIVITY_DEFAULT;
};

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
    let unsubscribe: (() => void) | undefined;
    (async () => {
      const ERP_DOC_TYPES = ['invoice', 'order', 'sale', 'payment', 'quotation', 'request', 'shipment'];
      unsubscribe = await portalLifecycle.subscribe({
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

    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
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

  const Sparkline: React.FC<{ data: number[]; color: string; width?: number; height?: number }> = ({ data, color, width = 80, height = 32 }) => {
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const points = data.map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    }).join(' ');
    const area = `0,${height} ${points} ${width},${height}`;
    const id = `grad-${color.replace('#','')}`;
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${id})`} />
        <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  };

  const generateTrend = (value: number): number[] => {
    const base = value || 100;
    return Array.from({ length: 7 }, (_, i) => base * (0.85 + Math.random() * 0.3));
  };

  const getTrendDirection = (data: number[]): 'up' | 'down' | 'flat' => {
    if (data.length < 2) return 'flat';
    const first = data[0];
    const last = data[data.length - 1];
    if (last > first * 1.05) return 'up';
    if (last < first * 0.95) return 'down';
    return 'flat';
  };

  return (
    <div className="max-w-7xl mx-auto page-shell">
      <div className="section-gap py-4 md:py-6">

      {/* ── Hero Section ───────────────────────────────────────────── */}
      <div className="glass-panel rounded-[var(--radius-md)] card-pad relative overflow-hidden" style={{ minHeight: 140 }}>
        <div className="absolute inset-0 opacity-40 pointer-events-none"
          style={{
            background: 'radial-gradient(circle at 10% 20%, rgba(31,133,119,.08), transparent 50%), radial-gradient(circle at 90% 80%, rgba(217,154,63,.06), transparent 50%)'
          }}
        />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="hidden md:flex w-10 h-10 rounded-xl items-center justify-center text-xl shrink-0"
              style={{
                background: 'linear-gradient(135deg, #1f8577, #0f544c)',
                boxShadow: '0 4px 14px -4px rgba(15,84,76,.5)'
              }}
            >
              👋
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-semibold text-slate-900 tracking-tight" style={{ fontFamily: "'Inter', sans-serif", lineHeight: 1.2 }}>
                {getGreeting()}, <span style={{ color: '#1f8577' }}>{user?.full_name || 'Guest'}</span>
              </h1>
              <p className="mt-1 text-xs text-slate-500" style={{ fontFamily: "'Inter', sans-serif", lineHeight: 1.5 }}>
                {todayLabel}
              </p>
               <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                 <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/60 border border-slate-200/60">
                   <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
                   {data.unpaidInvoiceCount ?? 0} unpaid
                 </span>
                 <span className="hidden md:inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/60 border border-slate-200/60">
                   <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                   {data.totalOrders ?? 0} orders
                 </span>
                 {recentTransactions.length > 0 && (
                   <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/60 border border-slate-200/60">
                     <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                     Last transaction: {new Date(recentTransactions[0].date).toLocaleDateString()}
                   </span>
                 )}
               </div>
            </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {[
          { label: 'Outstanding Balance', value: formatK(data.outstandingBalance || 0), icon: DollarSign, color: '#b5493f', bg: '#fef2f2', onClick: () => navigate('/portal/statements') },
          { label: 'Unpaid Invoices', value: data.unpaidInvoiceCount ?? 0, icon: FileText, color: '#d99a3f', bg: '#fbead0', onClick: () => navigate('/portal/invoices?status=Unpaid') },
          { label: 'Total Orders', value: data.totalOrders ?? 0, icon: ShoppingCart, color: '#475569', bg: '#f1f5f9', onClick: () => navigate('/portal/orders') },
          { label: 'Wallet Balance', value: formatK(data.walletBalance || 0), icon: Wallet, color: '#3b82f6', bg: '#eff6ff', onClick: () => navigate('/portal/wallet') },
        ].map((kpi, idx) => {
          const trend = generateTrend(typeof kpi.value === 'number' ? kpi.value : 100);
          const trendDir = getTrendDirection(trend);
          const trendColor = trendDir === 'up' ? '#059669' : trendDir === 'down' ? '#dc2626' : '#5c6567';
          const trendLabel = trendDir === 'up' ? '▲' : trendDir === 'down' ? '▼' : '─';
          return (
            <div
              key={idx}
              onClick={kpi.onClick}
              className="glass-panel-interactive rounded-[var(--radius-md)] card-pad relative overflow-hidden group"
              style={{ borderLeft: `4px solid ${kpi.color}`, cursor: kpi.onClick ? 'pointer' : 'default' }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: kpi.bg, color: kpi.color }}
                >
                  <kpi.icon size={18} strokeWidth={2} />
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#5c6567', textTransform: 'uppercase', letterSpacing: 0.08, lineHeight: 1.4 }}>{kpi.label}</div>
              </div>
              <div className="flex items-end justify-between gap-2">
                <div className="text-base md:text-lg font-bold text-slate-900" style={{ fontFamily: "'Inter', sans-serif", fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
                  {kpi.value}
                </div>
                <div className="opacity-60 group-hover:opacity-100 transition-opacity shrink-0">
                  <Sparkline data={trend} color={kpi.color} width={64} height={28} />
                </div>
              </div>
            </div>
          );
        })}
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
                        className="glass-panel-interactive rounded-[var(--radius-md)] card-pad flex items-center gap-3 text-left w-full"
                        style={{ borderLeft: `4px solid ${getTransactionBorderColor(t)}`, cursor: target ? 'pointer' : 'default', minHeight: 'var(--list-row-height, 60px)' }}
                      >
                        <div style={{
                          width: 32, height: 32, borderRadius: 8,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: getTransactionIconBg(t),
                          flexShrink: 0,
                        }}>
                          {getTransactionIcon(t)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#23282A' }} className="truncate">{t.description}</div>
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
          <div className="p-3">
            <div className="flex flex-col gap-2">
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
                    }}
                  >
                    <div className="flex items-center gap-3 px-4 py-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
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
                        <p className="text-[11px] text-slate-500 mt-0.5" style={{ fontFamily: "'Inter', sans-serif", lineHeight: 1.4 }}>
                          {method.details.length} detail{method.details.length === 1 ? '' : 's'}
                        </p>
                      </div>
                      <div className="shrink-0 text-slate-400">
                        {isSelected ? '−' : '+'}
                      </div>
                    </div>
                    {isSelected && (
                      <div className="px-4 pb-3">
                        <div className="rounded-lg border border-slate-200/60 bg-white/60 divide-y divide-slate-200/60">
                          {method.details.map((detail, i) => (
                            <div key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                              <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide" style={{ fontFamily: "'Inter', sans-serif", lineHeight: 1.45, fontWeight: 500 }}>
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
        <div className="lg:col-span-1">
          <CustomerHealthScore
            score={87}
            factors={{
              paymentHistory: 92,
              orderFrequency: 78,
              rewards: 85,
            }}
            />
        </div>
      </div>
      </div>
  );
};

export default CustomerDashboard;
