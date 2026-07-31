import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CreditCard, CheckCircle2 } from 'lucide-react';
import { portalApi } from '../../services/portalApiClient';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

interface Allocation {
  id: string;
  invoice_id: string;
  invoice_number: string;
  invoice_total: number;
  paid_amount: number;
  amount: number;
}

interface PaymentDetail {
  id: string;
  amount: number;
  payment_method: string;
  date: string;
  reference: string;
  notes?: string;
  status?: string;
  allocations: Allocation[];
}

const CustomerPaymentDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [payment, setPayment] = useState<PaymentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    portalApi.get<PaymentDetail>(`/payments/${id}`)
      .then(setPayment)
      .catch((err) => setError(err.message || 'Failed to load payment'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-6 max-w-4xl mx-auto"><PortalLoadingSkeleton type="detail" /></div>;
  if (error) return <div className="p-6 max-w-4xl mx-auto"><div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 text-rose-300 text-sm">{error}</div></div>;
  if (!payment) return null;

  const allocations = payment.allocations || [];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button onClick={() => navigate('/portal/payments')} className="inline-flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300 mb-6 transition-colors">
        <ArrowLeft size={14} /> Back to Payments
      </button>

      <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-100">Payment #{payment.reference || payment.id.slice(0, 8)}</h1>
            <p className="text-sm text-slate-400 mt-1">
              {payment.date ? new Date(payment.date).toLocaleDateString() : ''} • {payment.payment_method}
              {payment.status ? ` • ${payment.status}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-emerald-400" />
            <span className="text-2xl font-bold text-emerald-400 font-mono">K {Number(payment.amount).toFixed(2)}</span>
          </div>
        </div>
        {payment.notes && <div className="text-sm text-slate-400">{payment.notes}</div>}
      </div>

      <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-700/60">
          <h2 className="text-sm font-semibold text-slate-200">Applied To Invoices</h2>
        </div>
        {allocations.length === 0 ? (
          <div className="px-5 py-8 text-center text-slate-500 text-sm">No invoice allocations for this payment.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wider bg-slate-800/80">
                  <th className="px-5 py-3 font-medium">Invoice</th>
                  <th className="px-5 py-3 font-medium text-right">Invoice Total</th>
                  <th className="px-5 py-3 font-medium text-right">Allocated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {allocations.map((a) => (
                  <tr key={a.id} className="text-slate-300 hover:bg-slate-700/30 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-100">{a.invoice_number || a.invoice_id}</td>
                    <td className="px-5 py-3 text-right font-mono">K {Number(a.invoice_total).toFixed(2)}</td>
                    <td className="px-5 py-3 text-right font-mono text-emerald-400">K {Number(a.amount).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-center text-slate-500 text-xs gap-2">
        <CreditCard size={14} />
        Need help with this payment? Visit Support.
      </div>
    </div>
  );
};

export default CustomerPaymentDetail;
