import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CreditCard, CheckCircle2, Download, Loader2 } from 'lucide-react';
import { createElement } from 'react';
import { pdf } from '@react-pdf/renderer';
import { portalApi, portalLifecycle } from '../../services/portalApiClient';
import { attachDocumentSecurity } from '../../utils/documentSecurity';
import { initializePrimePdfFonts } from '../shared/components/PDF/templateSettings';
import { PrimeDocument } from '../shared/components/PDF/PrimeDocument';
import { useAuth } from '../../context/AuthContext';
import ErrorBanner from './components/ErrorBanner';
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
  const [downloading, setDownloading] = useState(false);
  const { companyConfig } = useAuth();

  useEffect(() => {
    if (!id) return;
    portalApi.get<PaymentDetail>(`/payments/${id}`)
      .then(setPayment)
      .catch((err) => setError(err.message || 'Failed to load payment'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const sub = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          if (type === 'entity_changed' && payload?.event === 'payment_allocated' && !cancelled) {
            portalApi.get<PaymentDetail>(`/payments/${id}`)
              .then(setPayment)
              .catch(() => {})
              .finally(() => setLoading(false));
          }
        },
      });
      if (!cancelled) return sub;
    })();
    return () => { cancelled = true; };
  }, [id]);

  const handleDownloadReceipt = useCallback(async () => {
    if (!payment) return;
    setDownloading(true);
    try {
      await initializePrimePdfFonts();

      const allocations = payment.allocations || [];
      const appliedInvoices = allocations.map((a) => a.invoice_number || a.invoice_id);
      const invoiceTotal = allocations.reduce((sum, a) => sum + Number(a.invoice_total || 0), 0);
      const totalAllocated = allocations.reduce((sum, a) => sum + Number(a.amount || 0), 0);
      const amountReceived = Number(payment.amount || 0);

      let paymentStatus: 'PAID' | 'PARTIALLY PAID' | 'OVERPAID' = 'PAID';
      if (totalAllocated < amountReceived) paymentStatus = 'OVERPAID';
      else if (totalAllocated < invoiceTotal) paymentStatus = 'PARTIALLY PAID';

      const receiptData = {
        receiptNumber: payment.reference || payment.id?.slice(0, 8) || 'N/A',
        date: payment.date ? new Date(payment.date).toLocaleDateString() : new Date().toLocaleDateString(),
        customerName: companyConfig?.companyName || 'Customer',
        amountReceived,
        amountApplied: totalAllocated,
        changeGiven: 0,
        walletDeposit: 0,
        paymentMethod: payment.payment_method || 'Unknown',
        appliedInvoices,
        appliedOrders: [],
        invoiceTotal,
        paymentStatus,
        balanceDue: Math.max(0, invoiceTotal - totalAllocated),
        overpaymentAmount: Math.max(0, amountReceived - totalAllocated),
        narrative: `Payment of K ${amountReceived.toFixed(2)} received via ${payment.payment_method || 'N/A'}. ${allocations.length} invoice(s) allocated.`,
        currentBalance: Math.max(0, invoiceTotal - totalAllocated),
        calculationVersion: 1,
      };

      const secured = await attachDocumentSecurity(receiptData, companyConfig?.companyName);
      const blob = await pdf(
        createElement(PrimeDocument, { type: 'RECEIPT', data: secured })
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `Receipt-${payment.reference || payment.id?.slice(0, 8) || 'payment'}.pdf`;
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to generate receipt PDF:', err);
    } finally {
      setDownloading(false);
    }
  }, [payment, companyConfig]);

  if (loading) return <div className="p-6 max-w-4xl mx-auto"><PortalLoadingSkeleton type="detail" /></div>;
  if (error) return <div className="p-6 max-w-4xl mx-auto"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>;
  if (!payment) return null;

  const allocations = payment.allocations || [];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button onClick={() => navigate('/portal/payments')} className="inline-flex items-center gap-1 text-sm text-emerald-600 hover:text-emerald-600 mb-6 transition-colors">
        <ArrowLeft size={14} /> Back to Payments
      </button>

      <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Payment #{payment.reference || payment.id.slice(0, 8)}</h1>
            <p className="text-sm text-slate-500 mt-1">
              {payment.date ? new Date(payment.date).toLocaleDateString() : ''} • {payment.payment_method}
              {payment.status ? ` • ${payment.status}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={18} className="text-emerald-600" />
              <span className="text-2xl font-bold text-emerald-600 font-mono">K {Number(payment.amount).toFixed(2)}</span>
            </div>
            <button
              onClick={handleDownloadReceipt}
              disabled={downloading}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors"
              style={{
                background: 'linear-gradient(155deg, #1f8577, #0f544c)',
                color: '#fff',
                opacity: downloading ? 0.6 : 1,
                cursor: downloading ? 'not-allowed' : 'pointer',
              }}
            >
              {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {downloading ? 'Generating…' : 'Download Receipt'}
            </button>
          </div>
        </div>
        {payment.notes && <div className="text-sm text-slate-500">{payment.notes}</div>}
      </div>

      <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200/60">
          <h2 className="text-sm font-semibold text-slate-800">Applied To Invoices</h2>
        </div>
        {allocations.length === 0 ? (
          <div className="px-5 py-8 text-center text-slate-400 text-sm">No invoice allocations for this payment.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px] table-fixed">
              <thead className="bg-slate-50/80 backdrop-blur text-slate-500 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left">Invoice</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right">Invoice Total</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right">Allocated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/50">
                {allocations.map((a) => (
                  <tr key={a.id} className="text-slate-700 hover:bg-blue-50/50 transition-colors border-l-4 border-l-transparent">
                    <td className="px-5 py-3 font-mono text-slate-500 font-bold truncate">{a.invoice_number || a.invoice_id}</td>
                    <td className="px-5 py-3 text-right font-mono">K {Number(a.invoice_total).toFixed(2)}</td>
                    <td className="px-5 py-3 text-right font-mono text-emerald-600">K {Number(a.amount).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-center text-slate-400 text-xs gap-2">
        <CreditCard size={14} />
        Need help with this payment? Visit Support.
      </div>
    </div>
  );
};

export default CustomerPaymentDetail;
