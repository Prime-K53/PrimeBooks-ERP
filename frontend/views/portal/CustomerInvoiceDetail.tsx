import React, { useEffect, useState } from 'react';
import { createElement } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import { portalApi } from '../../services/portalApiClient';
import { mapToInvoiceData } from '../../utils/pdfMapper';
import { attachDocumentSecurity } from '../../utils/documentSecurity';
import { initializePrimePdfFonts } from '../shared/components/PDF/templateSettings';
import { PrimeDocument } from '../shared/components/PDF/PrimeDocument';
import { useAuth } from '../../context/AuthContext';
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
  const { companyConfig } = useAuth();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    portalApi.get<InvoiceDetail>(`/invoices/${id}`)
      .then(setInvoice)
      .catch((err) => setError(err.message || 'Failed to load invoice'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleDownloadPdf = async () => {
    if (!invoice) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const items = (invoice.line_items || []).map((i) => ({
        desc: i.item_name,
        qty: Number(i.quantity || 1),
        price: Number(i.unit_price || 0),
        total: Number(i.line_total ?? i.unit_price * i.quantity),
      }));
      const mapped = mapToInvoiceData(
        {
          ...invoice,
          items,
          customerName: invoice.customer_name,
          subtotal: invoice.total_amount,
        },
        companyConfig,
        'INVOICE'
      ) as any;
      const secured = await attachDocumentSecurity(mapped, companyConfig?.companyName);
      await initializePrimePdfFonts();
      const blob = await pdf(createElement(PrimeDocument as any, { type: 'INVOICE', data: secured }) as any).toBlob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${invoice.invoice_number || invoice.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch (err: any) {
      setDownloadError(err.message || 'Failed to generate PDF');
    } finally {
      setDownloading(false);
    }
  };

  if (loading) return <div className="p-6 max-w-4xl mx-auto"><PortalLoadingSkeleton type="detail" /></div>;
  if (error) return <div className="p-6 max-w-4xl mx-auto"><div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 text-sm">{error}</div></div>;
  if (!invoice) return null;

  const subtotal = (invoice.line_items || []).reduce((sum, item) => sum + Number(item.line_total), 0);
  const remaining = Number(invoice.total_amount) - Number(invoice.paid_amount || 0);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button onClick={() => navigate('/portal/invoices')} className="inline-flex items-center gap-1 text-sm text-emerald-600 hover:text-emerald-600 mb-6 transition-colors">
        <ArrowLeft size={14} /> Back to Invoices
      </button>

      {downloadError && (
        <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-600">{downloadError}</div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Invoice {invoice.invoice_number}</h1>
            <p className="text-sm text-slate-500 mt-1">
              Issued: {new Date(invoice.created_at).toLocaleDateString()} | Due: {new Date(invoice.due_date).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={invoice.status} />
            <button
              onClick={handleDownloadPdf}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-xs font-semibold rounded-lg transition-colors"
            >
              {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} {downloading ? 'Generating...' : 'PDF'}
            </button>
          </div>
        </div>
        <div className="text-sm text-slate-700">
          <span className="text-slate-500">Customer:</span> {invoice.customer_name}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-800">Line Items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 uppercase tracking-wider bg-white">
                <th className="px-5 py-3 font-medium">Item</th>
                <th className="px-5 py-3 font-medium text-right">Qty</th>
                <th className="px-5 py-3 font-medium text-right">Unit Price</th>
                <th className="px-5 py-3 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {(invoice.line_items || []).map((item, i) => (
                <tr key={i} className="text-slate-700">
                  <td className="px-5 py-3">{item.item_name}</td>
                  <td className="px-5 py-3 text-right">{item.quantity}</td>
                  <td className="px-5 py-3 text-right font-mono">K {Number(item.unit_price).toFixed(2)}</td>
                  <td className="px-5 py-3 text-right font-mono">K {Number(item.line_total).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-4 border-t border-slate-200 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Subtotal</span>
            <span className="text-slate-700 font-mono">K {subtotal.toFixed(2)}</span>
          </div>
          {Number(invoice.paid_amount) > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-emerald-600">Paid</span>
              <span className="text-emerald-600 font-mono">K {Number(invoice.paid_amount).toFixed(2)}</span>
            </div>
          )}
          {remaining > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-amber-400">Remaining</span>
              <span className="text-amber-400 font-mono">K {remaining.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-bold pt-2 border-t border-slate-200">
            <span className="text-slate-900">Total</span>
            <span className="text-slate-900 font-mono">K {Number(invoice.total_amount).toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomerInvoiceDetail;
