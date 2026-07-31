import React, { useEffect, useState } from 'react';
import { DollarSign, Wallet, FileText, ShoppingCart, ArrowRight, ChevronRight, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { portalApi } from '../../services/portalApiClient';
import PortalKPICard from './components/PortalKPICard';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

interface Transaction {
  date: string;
  description: string;
  amount: number;
  type: string;
}

interface DashboardData {
  balance: number;
  walletBalance: number;
  outstandingBalance: number;
  activeInvoiceCount: number;
  totalOrders: number;
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

  useEffect(() => {
    portalApi.get<DashboardData>('/dashboard')
      .then(setData)
      .catch((err) => setError(err.message || 'Failed to load dashboard'))
      .finally(() => setLoading(false));
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
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 text-sm">{error}</div>
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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">Welcome to your customer portal</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 18 }}>
        <PortalKPICard label="Balance" value={`K ${(data.balance || 0).toFixed(2)}`} icon={DollarSign} color="emerald" />
        <PortalKPICard label="Wallet Balance" value={`K ${(data.walletBalance || 0).toFixed(2)}`} icon={Wallet} color="blue" />
        <PortalKPICard label="Active Invoices" value={data.activeInvoiceCount ?? 0} icon={FileText} color="amber" />
        <PortalKPICard label="Total Orders" value={data.totalOrders ?? 0} icon={ShoppingCart} color="violet" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
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
                      key={i}
                      style={{
                        borderRadius: 10,
                        padding: '12px 14px',
                        background: '#FEFDFB',
                        border: '1.4px solid #e4ddd1',
                        borderLeft: `4px solid ${getTransactionBorderColor(t)}`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        cursor: 'pointer',
                        textAlign: 'left',
                        width: '100%',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                        transition: 'transform .15s ease, box-shadow .15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-1px)';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)';
                      }}
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
