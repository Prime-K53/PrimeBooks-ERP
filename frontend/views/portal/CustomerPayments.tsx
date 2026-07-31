import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard } from 'lucide-react';
import { portalApi } from '../../services/portalApiClient';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

interface Payment {
  id: string;
  amount: number;
  payment_method: string;
  date: string;
  reference: string;
}

const CustomerPayments: React.FC = () => {
  const navigate = useNavigate();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    portalApi.get<Payment[]>('/payments')
      .then(setPayments)
      .catch((err) => setError(err.message || 'Failed to load payments'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 max-w-7xl mx-auto"><PortalLoadingSkeleton type="table" count={6} /></div>;
  if (error) return <div className="p-6 max-w-7xl mx-auto"><div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 text-sm">{error}</div></div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Payments</h1>
        <p className="text-sm text-slate-500 mt-1">Your payment history</p>
      </div>

      {payments.length === 0 ? (
        <EmptyState icon={CreditCard} title="No payments yet" description="Your payment transactions will appear here." />
      ) : (
        <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px] table-fixed">
              <thead className="bg-slate-50/80 backdrop-blur text-slate-500 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left">Date</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left">Reference</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left">Method</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/50">
                {payments.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => navigate(`/portal/payments/${p.id}`)}
                    className="transition-colors cursor-pointer group hover:bg-blue-50/50 border-l-4 border-l-transparent"
                  >
                    <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{new Date(p.date).toLocaleDateString()}</td>
                    <td className="px-5 py-3 font-medium text-slate-900">{p.reference}</td>
                    <td className="px-5 py-3">{p.payment_method}</td>
                    <td className="px-5 py-3 text-right font-medium text-emerald-600">K {Number(p.amount).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerPayments;
