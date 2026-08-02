import React, { useCallback, useEffect, useState } from 'react';
import { DollarSign, FileText, ShoppingCart, ArrowRight, ChevronRight, TrendingUp, TrendingDown, Activity, ClipboardList, FileCheck2, Users, Gift, UserPlus, Sparkles, MessageSquare, CalendarDays, Truck, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { portalApi, portalLifecycle, PortalShipmentRecord } from '../../services/portalApiClient';
import ErrorBanner from './components/ErrorBanner';
import PortalKPICard from './components/PortalKPICard';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import PortalPageHeader from './components/PortalPageHeader';
import PortalButton from './components/PortalButton';

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
  outstandingBalance: number;
  walletBalance: number;
  unpaidInvoiceCount: number;
  totalOrders: number;
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
  const [shipments, setShipments] = useState<PortalShipmentRecord[]>([]);
  const [shipmentsLoading, setShipmentsLoading] = useState(true);
  const [shipmentsError, setShipmentsError] = useState<string | null>(null);

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
      const sub = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          if (type === 'entity_changed' && (payload?.docType === 'invoice' || payload?.event === 'payment_allocated') && !cancelled) {
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

  const loadShipments = useCallback(async () => {
    setShipmentsLoading(true);
    setShipmentsError(null);
    try {
      const rows = await portalLifecycle.shipments.list();
      setShipments(rows.slice(0, 3));
    } catch (err: any) {
      setShipmentsError(err?.message || 'Failed to load delivery updates');
    } finally {
      setShipmentsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadShipments();
  }, [loadShipments]);
 
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
    { label: 'Create New Request', onClick: () => navigate('/portal/new-request'), icon: <ShoppingCart size={16} /> },
    { label: 'Download Statement', onClick: () => navigate('/portal/statements'), icon: <CalendarDays size={16} /> },
    { label: 'Track Shipments', onClick: () => navigate('/portal/shipments'), icon: <Truck size={16} /> },
    { label: 'Contact Support', onClick: () => navigate('/portal/support'), icon: <MessageSquare size={16} /> },
    { label: 'Rewards & Referrals', onClick: () => navigate('/portal/referrals'), icon: <Gift size={16} /> },
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
      <PortalPageHeader
        title="Customer Dashboard"
        subtitle="Track your invoices, requests, and outstanding balance in one place"
        icon={Sparkles}
        action={{ label: 'Create request', onClick: () => navigate('/portal/new-request'), icon: ShoppingCart }}
      />

      <div className="mt-6" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 18 }}>
        <PortalKPICard label="Outstanding Balance" value={`K ${(data.outstandingBalance || 0).toFixed(2)}`} icon={DollarSign} color="emerald" onClick={() => navigate('/portal/statements')} />
        <PortalKPICard label="Unpaid Invoices" value={data.unpaidInvoiceCount ?? 0} icon={FileText} color="amber" onClick={() => navigate('/portal/invoices?status=Unpaid')} />
        <PortalKPICard label="Total Orders" value={data.totalOrders ?? 0} icon={ShoppingCart} color="slate" onClick={() => navigate('/portal/orders')} />
        <PortalKPICard label="Wallet Balance" value={`K ${(data.walletBalance || 0).toFixed(2)}`} icon={Wallet} color="blue" onClick={() => navigate('/portal/wallet')} />
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

      <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-slate-200/60 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Delivery updates</h2>
            <p className="text-xs text-slate-500 mt-1">Your latest shipped orders, tracking details, and estimated deliveries.</p>
          </div>
          <PortalButton variant="secondary" size="sm" onClick={() => navigate('/portal/shipments')} icon={Truck}>View all shipments</PortalButton>
        </div>
        <div className="p-5">
          {shipmentsLoading ? (
            <div className="text-sm text-slate-500">Loading delivery updates...</div>
          ) : shipmentsError ? (
            <div className="text-sm text-rose-600">{shipmentsError}</div>
          ) : shipments.length === 0 ? (
            <div className="text-sm text-slate-500">No tracked shipments yet. Once your orders ship, tracking details will appear here.</div>
          ) : (
            <div className="space-y-4">
              {shipments.map((shipment) => (
                <div key={shipment.id} className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{shipment.order_number || `Order ${shipment.id.slice(0, 8)}`}</div>
                      <div className="text-xs text-slate-500 mt-1">{shipment.carrier || 'Carrier unavailable'} • Tracking {shipment.tracking_number || 'pending'}</div>
                    </div>
                    <span className="inline-flex items-center rounded-full bg-teal-100 text-teal-700 text-[11px] font-semibold px-3 py-1 uppercase tracking-[0.14em]">{shipment.status || 'Pending'}</span>
                  </div>
                  <div className="mt-3 text-sm text-slate-600">Estimated delivery: {shipment.estimated_delivery ? new Date(shipment.estimated_delivery).toLocaleDateString() : 'TBD'}</div>
                  <div className="mt-3 flex flex-wrap gap-2 items-center">
                    <button onClick={() => navigate(`/portal/shipments/${shipment.id}`)} className="text-xs font-semibold text-teal-600 hover:text-teal-700">Open tracking details</button>
                    {shipment.actual_arrival && <span className="text-xs text-slate-500">Arrived: {new Date(shipment.actual_arrival).toLocaleDateString()}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
