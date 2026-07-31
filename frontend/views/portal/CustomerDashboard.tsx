import React, { useEffect, useState } from 'react';
import { DollarSign, Wallet, FileText, ShoppingCart, ArrowRight } from 'lucide-react';
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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">Welcome to your customer portal</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <PortalKPICard label="Balance" value={`K ${(data.balance || 0).toFixed(2)}`} icon={DollarSign} color="emerald" />
        <PortalKPICard label="Wallet Balance" value={`K ${(data.walletBalance || 0).toFixed(2)}`} icon={Wallet} color="blue" />
        <PortalKPICard label="Active Invoices" value={data.activeInvoiceCount ?? 0} icon={FileText} color="amber" />
        <PortalKPICard label="Total Orders" value={data.totalOrders ?? 0} icon={ShoppingCart} color="violet" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-800">Recent Activity</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                    <th className="px-5 py-3 font-medium">Date</th>
                    <th className="px-5 py-3 font-medium">Description</th>
                    <th className="px-5 py-3 font-medium text-right">Amount</th>
                    <th className="px-5 py-3 font-medium text-right">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {(data.recentTransactions || []).slice(0, 5).map((t, i) => (
                    <tr key={i} className="text-slate-700 hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{new Date(t.date).toLocaleDateString()}</td>
                      <td className="px-5 py-3">{t.description}</td>
                      <td className="px-5 py-3 text-right font-mono">{t.amount.toFixed(2)}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={`text-xs font-semibold ${t.type === 'credit' ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {t.type}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {(!data.recentTransactions || data.recentTransactions.length === 0) && (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-slate-400">No recent transactions</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div>
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Quick Actions</h2>
            <div className="space-y-2">
              {quickActions.map((action, i) => (
                <button
                  key={i}
                  onClick={action.onClick}
                  className="w-full flex items-center justify-between px-4 py-3 bg-slate-100 hover:bg-slate-100 rounded-lg text-sm text-slate-700 transition-colors group"
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
