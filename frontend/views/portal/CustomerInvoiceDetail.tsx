import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download } from 'lucide-react';
import { portalApi } from '../../services/portalApiClient';
import StatusBadge from './components/StatusBadge';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

interface LineItem {
  item_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

interface InvoiceDetail {
  id: string;
  invoice_number: string;
  customer_name: string;
  total_amount: number;
  paid_amount: number;
  status: string;
  due_date: string;
  line_items: LineItem[];
  created_at: string;
}

const CustomerInvoiceDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    portalApi.get<InvoiceDetail>(`/invoices/${id}`)
      .then(setInvoice)
      .catch((err) => setError(err.message || 'Failed to load invoice'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-6 max-w-4xl mx-auto"><PortalLoadingSkeleton type="detail" /></div>;
  if (error) return <div className="p-6 max-w-4xl mx-auto"><div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 text-rose-300 text-sm">{error}</div></div>;
  if (!invoice) return null;

  const subtotal = (invoice.line_items || []).reduce((sum, item) => sum + Number(item.line_total), 0);
  const remaining = Number(invoice.total_amount) - Number(invoice.paid_amount || 0);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button onClick={() => navigate('/portal/invoices')} className="inline-flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300 mb-6 transition-colors">
        <ArrowLeft size={14} /> Back to Invoices
      </button>

      <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-100">Invoice {invoice.invoice_number}</h1>
            <p className="text-sm text-slate-400 mt-1">
              Issued: {new Date(invoice.created_at).toLocaleDateString()} | Due: {new Date(invoice.due_date).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={invoice.status} />
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition-colors">
              <Download size={14} /> PDF
            </button>
          </div>
        </div>
        <div className="text-sm text-slate-300">
          <span className="text-slate-400">Customer:</span> {invoice.customer_name}
        </div>
      </div>

      <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-700/60">
          <h2 className="text-sm font-semibold text-slate-200">Line Items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 uppercase tracking-wider bg-slate-800/80">
                <th className="px-5 py-3 font-medium">Item</th>
                <th className="px-5 py-3 font-medium text-right">Qty</th>
                <th className="px-5 py-3 font-medium text-right">Unit Price</th>
                <th className="px-5 py-3 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/60">
              {(invoice.line_items || []).map((item, i) => (
                <tr key={i} className="text-slate-300">
                  <td className="px-5 py-3">{item.item_name}</td>
                  <td className="px-5 py-3 text-right">{item.quantity}</td>
                  <td className="px-5 py-3 text-right font-mono">K {Number(item.unit_price).toFixed(2)}</td>
                  <td className="px-5 py-3 text-right font-mono">K {Number(item.line_total).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-4 border-t border-slate-700/60 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Subtotal</span>
            <span className="text-slate-300 font-mono">K {subtotal.toFixed(2)}</span>
          </div>
          {Number(invoice.paid_amount) > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-emerald-400">Paid</span>
              <span className="text-emerald-400 font-mono">K {Number(invoice.paid_amount).toFixed(2)}</span>
            </div>
          )}
          {remaining > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-amber-400">Remaining</span>
              <span className="text-amber-400 font-mono">K {remaining.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-bold pt-2 border-t border-slate-700/60">
            <span className="text-slate-100">Total</span>
            <span className="text-slate-100 font-mono">K {Number(invoice.total_amount).toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomerInvoiceDetail;
