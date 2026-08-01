import React, { useEffect, useState } from 'react';
import { DollarSign, Wallet, FileText, ShoppingCart, ArrowRight, ChevronRight, TrendingUp, TrendingDown, Activity, ClipboardList, FileCheck2, Package, Factory, Users, Gift, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { portalApi, portalLifecycle } from '../../services/portalApiClient';
import ErrorBanner from './components/ErrorBanner';
import PortalKPICard from './components/PortalKPICard';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

interface Transaction {
  date: string;
  description: string;
  amount: number;
  type: string;
}

interface RecentDocument {
  docType: 'request' | 'quotation' | 'order';
  id: string;
  docNumber: string;
  status: string;
  request_type?: string;
  created_at?: string;
}

interface DashboardData {
  balance: number;
  walletBalance: number;
  outstandingBalance: number;
  activeInvoiceCount: number;
  totalOrders: number;
  activeRequestCount: number;
  openQuotationCount: number;
  productionOrderCount: number;
  unreadMessageCount: number;
  recentDocuments: RecentDocument[];
  recentTransactions: Transaction[];
}

const getTransactionIcon = (t: Transaction) => {
  if (t.type === 'credit') return <TrendingUp size={16} color="#059669" />;
  return <TrendingDown size={16} color="#dc2626" />;
};

const getTransactionIconBg = (t: Transaction) => {
  if (t.type === 'credit') return '#ecfdf5';
  return '#fef2f2';
};

const getTransactionBorderColor = (t: Transaction) => {
  if (t.type === 'credit') return '#059669';
  return '#dc2626';
};

const CustomerDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [referralSettings, setReferralSettings] = useState<any>(null);
  const [referralFunnel, setReferralFunnel] = useState<any>(null);
  const [referralLoading, setReferralLoading] = useState(true);

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

  const quickActions = [
    { label: 'View Invoices', onClick: () => navigate('/portal/invoices'), icon: <FileText size={16} /> },
    { label: 'View Orders', onClick: () => navigate('/portal/orders'), icon: <ShoppingCart size={16} /> },
    { label: 'Download Statement', onClick: () => navigate('/portal/statements'), icon: <FileText size={16} /> },
    { label: 'Contact Support', onClick: () => navigate('/portal/support'), icon: <FileText size={16} /> },
  ];

  const recentTransactions = (data.recentTransactions || []).slice(0, 5);
  const recentDocuments = (data.recentDocuments || []).slice(0, 6);

  const docRoute = (doc: RecentDocument) => {
    switch (doc.docType) {
      case 'request': return `/portal/requests/${doc.id}`;
      case 'quotation': return `/portal/quotations/${doc.id}`;
      case 'order': return `/portal/orders/${doc.id}`;
    }
  };

  const docIcon = (doc: RecentDocument) => {
    switch (doc.docType) {
      case 'request': return <ClipboardList size={15} />;
      case 'quotation': return <FileCheck2 size={15} />;
      case 'order': return <ShoppingCart size={15} />;
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">Welcome to your customer portal</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 18 }}>
        <PortalKPICard label="Outstanding Balance" value={`K ${(data.outstandingBalance || 0).toFixed(2)}`} icon={DollarSign} color="emerald" />
        <PortalKPICard label="Wallet Balance" value={`K ${(data.walletBalance || 0).toFixed(2)}`} icon={Wallet} color="blue" />
        <PortalKPICard label="Active Invoices" value={data.activeInvoiceCount ?? 0} icon={FileText} color="amber" />
        <PortalKPICard label="Pending Requests" value={data.activeRequestCount ?? 0} icon={ClipboardList} color="teal" onClick={() => navigate('/portal/requests')} />
        <PortalKPICard label="Open Quotations" value={data.openQuotationCount ?? 0} icon={FileCheck2} color="violet" onClick={() => navigate('/portal/quotations')} />
        <PortalKPICard label="Total Orders" value={data.totalOrders ?? 0} icon={ShoppingCart} color="slate" onClick={() => navigate('/portal/orders')} />
        <PortalKPICard label="In Production" value={data.productionOrderCount ?? 0} icon={Factory} color="blue" onClick={() => navigate('/portal/orders')} />
      </div>

      {referralSettings?.enabled && !referralLoading && referralFunnel && (
        <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-slate-200/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users size={16} className="text-teal-600" />
              <h2 className="text-sm font-semibold text-slate-800">My Referrals</h2>
            </div>
            <button onClick={() => navigate('/portal/referrals')} className="text-xs font-semibold text-teal-600 hover:text-teal-700 flex items-center gap-1">
              View all <ChevronRight size={12} />
            </button>
          </div>
          <div className="p-5">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
              {[
                { label: 'Invited', value: referralFunnel.total, icon: Users, color: 'teal' },
                { label: 'Signed Up', value: referralFunnel.signedUp, icon: UserPlus, color: 'teal' },
                { label: 'Qualified', value: referralFunnel.qualified, icon: FileCheck2, color: 'amber' },
                { label: 'Reward Approved', value: referralFunnel.rewardApproved, icon: Gift, color: 'emerald' },
                { label: 'Paid', value: referralFunnel.paid, icon: Wallet, color: 'teal' },
              ].map((stage) => (
                <div key={stage.label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#5c6567', textTransform: 'uppercase', letterSpacing: 0.06, margin: '0 0 6px' }}>{stage.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#23282A', fontFamily: "'JetBrains Mono', monospace" }}>{stage.value}</div>
                </div>
              ))}
            </div>
            {referralFunnel.pendingRewardAmount > 0 && (
              <p style={{ fontSize: 11, color: '#5c6567', marginTop: 12 }}>
                <span style={{ fontWeight: 600 }}>{referralFunnel.pendingRewardAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span> pending • <span style={{ fontWeight: 600 }}>{referralFunnel.totalEarned.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span> total earned
              </p>
            )}
          </div>
        </div>
      )}

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
                  {recentTransactions.map((t, i) => (
                    <div
                      key={`${t.description}-${t.date}-${t.amount}-${i}`}
                      className="rounded-[10px] p-[12px_14px] bg-[#FEFDFB] border-[1.4px] border-[#e4ddd1] border-l-[4px] flex items-center gap-3 cursor-pointer text-left w-full shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
                      style={{ borderLeftColor: getTransactionBorderColor(t) }}
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
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', minWidth: 80 }}>
                        <div style={{
                          fontSize: 14, fontWeight: 700,
                          color: t.type === 'credit' ? '#059669' : '#dc2626',
                          fontFamily: "'JetBrains Mono', monospace",
                        }}>
                          {t.type === 'credit' ? '+' : '-'}{t.amount.toFixed(2)}
                        </div>
                        <div style={{ fontSize: 10, color: '#5c6567', textTransform: 'uppercase', marginTop: 1 }}>
                          {t.type}
                        </div>
                      </div>
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
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div>
          <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200/60">
              <h2 className="text-sm font-semibold text-slate-800">Recent Documents</h2>
            </div>
            <div className="p-2">
              {recentDocuments.length === 0 ? (
                <div className="p-6 text-center text-slate-400">
                  <FileText size={28} className="mx-auto mb-2" />
                  <p>No documents yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentDocuments.map((doc, i) => (
                    <button
                      key={`${doc.docType}-${doc.id}-${i}`}
                      onClick={() => navigate(docRoute(doc))}
                      className="rounded-[10px] p-[10px_12px] bg-[#FEFDFB] border-[1.4px] border-[#e4ddd1] border-l-[4px] border-l-[#1f8577] flex items-center gap-3 cursor-pointer text-left w-full shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
                    >
                      <div style={{
                        width: 30, height: 30, borderRadius: 8,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: '#eef7f6', color: '#1f8577',
                        flexShrink: 0,
                      }}>
                        {docIcon(doc)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#23282A', fontFamily: "'JetBrains Mono', monospace" }}>
                          {doc.docNumber || doc.id.slice(0, 8)}
                        </div>
                        <div style={{ fontSize: 10, color: '#5c6567', marginTop: 1, textTransform: 'capitalize' }}>
                          {doc.docType}{doc.request_type ? ` (${doc.request_type} request)` : ''} • {doc.status}
                          {doc.created_at ? ` • ${new Date(doc.created_at).toLocaleDateString()}` : ''}
                        </div>
                      </div>
                      <ChevronRight size={14} style={{ color: '#5c6567', flexShrink: 0 }} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div>
          <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Quick Actions</h2>
            <div className="space-y-2">
              {quickActions.map((action, i) => (
                <button
                  key={i}
                  onClick={action.onClick}
                  className="w-full flex items-center justify-between px-4 py-3 bg-slate-100 hover:bg-slate-100 rounded-xl text-sm text-slate-700 transition-colors group"
                >
                  <span className="flex items-center gap-2">{action.icon}{action.label}</span>
                  <ArrowRight size={14} className="text-slate-400 group-hover:text-slate-700 transition-colors" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomerDashboard;
