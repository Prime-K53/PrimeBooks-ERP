import React, { useEffect, useState, useCallback, Suspense } from 'react';
import { createElement } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Loader2, Eye, CreditCard, CheckCircle } from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import { portalLifecycle } from '../../services/portalApiClient';
import { mapToInvoiceData } from '../../utils/pdfMapper';
import { attachDocumentSecurity } from '../../utils/documentSecurity';
import { initializePrimePdfFonts } from '../shared/components/PDF/templateSettings';
import { PrimeDocument } from '../shared/components/PDF/PrimeDocument';
import { useAuth } from '../../context/AuthContext';
import PortalPageHeader from './components/PortalPageHeader';
import PortalButton from './components/PortalButton';
import PortalCard from './components/PortalCard';
import PortalInput from './components/PortalInput';
import ErrorBanner from './components/ErrorBanner';
import DocumentPreviewModal from './components/DocumentPreviewModal';
import StatusBadge from './components/StatusBadge';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { useToast } from './components/Toast';
import { portalTheme, DEFAULT_PAGE_SIZE } from './constants';

const StripePaymentForm = React.lazy(() => import('./StripePaymentForm'));

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
  currency: string;
  line_items: LineItem[];
  created_at: string;
  document_title?: string;
}

const CustomerInvoiceDetail: React.FC = () => {
  const { id } = useParams() as { id?: string };
  const navigate = useNavigate();
  const { companyConfig } = useAuth();
  const { addToast } = useToast();

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Payment state
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [showStripeForm, setShowStripeForm] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [paySuccess, setPaySuccess] = useState(false);

  useEffect(() => {
    if (!id) return;
    portalLifecycle.invoices.get(id)
      .then(setInvoice)
      .catch((err) => setError(err.message || 'Failed to load invoice'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const sub = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          if (type === 'entity_changed' && payload?.docType === 'invoice' && payload?.docId === id && !cancelled) {
            portalLifecycle.invoices.get(id)
              .then(setInvoice)
              .catch(() => {})
              .finally(() => setLoading(false));
          }
        },
      });
      if (!cancelled) return sub;
    })();
    return () => { cancelled = true; };
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

  const handlePay = useCallback(async () => {
    if (!invoice) return;
    const remaining = Number(invoice.total_amount) - Number(invoice.paid_amount || 0);
    const amount = paymentAmount ? Number(paymentAmount) : remaining;
    if (amount <= 0 || amount > remaining) {
      setPayError('Please enter a valid amount (max ' + remaining.toFixed(2) + ')');
      return;
    }
    setPaying(true);
    setPayError(null);
    setPaySuccess(false);
    try {
      const data = await portalLifecycle.payments.createIntent(invoice.id, amount, 'usd');
      setClientSecret(data.clientSecret);
      if (data.mode === 'stripe') {
        setShowStripeForm(true);
      } else {
        // Mock mode — simulate successful payment
        setShowStripeForm(false);
        await portalLifecycle.payments.recordPayment(invoice.id, amount, { paymentMethod: 'Card', currency: 'USD' });
        setPaySuccess(true);
        setClientSecret(null);
        setPaymentAmount('');
        addToast('success', 'Payment successful!');
        portalLifecycle.invoices.get(invoice.id).then(setInvoice).catch(() => {});
      }
    } catch (err: any) {
      setPayError(err.message || 'Failed to initialize payment');
    } finally {
      setPaying(false);
    }
  }, [invoice, paymentAmount, addToast]);

  const handlePaymentSuccess = useCallback(() => {
    setPaySuccess(true);
    setClientSecret(null);
    setShowStripeForm(false);
    setPaymentAmount('');
    if (invoice) {
      portalLifecycle.invoices.get(invoice.id).then(setInvoice).catch(() => {});
    }
  }, [invoice]);

  const handlePaymentCancel = useCallback(() => {
    setClientSecret(null);
    setShowStripeForm(false);
    setPaymentAmount('');
    setPayError(null);
  }, []);

  if (loading) return <div className="p-6 max-w-4xl mx-auto"><PortalLoadingSkeleton type="detail" /></div>;
  if (error) return <div className="p-6 max-w-4xl mx-auto"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>;
  if (!invoice) return null;

  const remaining = Number(invoice.total_amount) - Number(invoice.paid_amount || 0);
  const subtotal = (invoice.line_items || []).reduce((sum, item) => sum + Number(item.line_total), 0);

  return (
    <div>
      <PortalPageHeader
        title={`Invoice ${invoice.invoice_number}`}
        subtitle={`Issued: ${new Date(invoice.created_at).toLocaleDateString()} | Due: ${new Date(invoice.due_date).toLocaleDateString()}`}
        icon={Eye}
        action={{
          label: downloading ? 'Generating...' : 'Download PDF',
          onClick: handleDownloadPdf,
          disabled: downloading,
        }}
      />

      {downloadError && <div style={{ padding: '0 28px 0' }}><ErrorBanner message={downloadError} onDismiss={() => setDownloadError(null)} /></div>}

      <div style={{ padding: '0 28px 28px' }}>
        <PortalCard style={{ padding: '20px 24px', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <p style={{ fontSize: 14, color: portalTheme.inkSoft }}>Customer: <strong style={{ color: portalTheme.ink }}>{invoice.customer_name}</strong></p>
              <p style={{ fontSize: 13, color: portalTheme.inkSoft, marginTop: 4 }}>
                Status: <StatusBadge status={invoice.status} />
              </p>
            </div>
            <PortalButton variant="secondary" onClick={() => setPreviewOpen(true)} icon={Eye}>Preview</PortalButton>
          </div>
        </PortalCard>

        <div style={{ background: portalTheme.paper, borderRadius: 14, border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #e4ddd1' }}>
            <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>Line Items</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px] table-fixed">
              <thead>
                <tr style={{ background: portalTheme.teal[50] }}>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Item</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: portalTheme.inkSoft }}>Qty</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: portalTheme.inkSoft }}>Unit Price</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: portalTheme.inkSoft }}>Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/50">
                {(invoice.line_items || []).map((item, i) => (
                  <tr key={i} className="text-slate-700 hover:bg-[#eef7f6] transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-900" data-label="Item">{item.item_name}</td>
                    <td className="px-5 py-3 text-right" data-label="Qty">{item.quantity}</td>
                    <td className="px-5 py-3 text-right font-mono" data-label="Unit Price">K {Number(item.unit_price).toFixed(2)}</td>
                    <td className="px-5 py-3 text-right font-mono" data-label="Total">K {Number(item.line_total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '14px 16px', borderTop: '1px solid #e4ddd1', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: portalTheme.inkSoft }}>Subtotal</span>
              <span className="font-mono" style={{ color: portalTheme.ink }}>K {subtotal.toFixed(2)}</span>
            </div>
            {Number(invoice.paid_amount) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: portalTheme.teal[600] }}>Paid</span>
                <span className="font-mono" style={{ color: portalTheme.teal[600] }}>K {Number(invoice.paid_amount).toFixed(2)}</span>
              </div>
            )}
            {remaining > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: portalTheme.amber[600] }}>Remaining</span>
                <span className="font-mono" style={{ color: portalTheme.amber[600] }}>K {remaining.toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700, borderTop: '1px solid #e4ddd1', paddingTop: 8, marginTop: 4 }}>
              <span style={{ color: portalTheme.ink }}>Total</span>
              <span className="font-mono" style={{ color: portalTheme.ink }}>K {Number(invoice.total_amount).toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Payment Section */}
        {remaining > 0 && invoice.status !== 'paid' && (
          <PortalCard style={{ padding: '24px 30px', marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <CreditCard size={18} style={{ color: portalTheme.inkSoft }} />
              <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>
                Pay Online
              </h2>
            </div>

            {paySuccess && (
              <div className="mb-4 p-3.5 bg-teal-50 border border-teal-200 rounded-xl text-sm text-teal-700 flex items-center gap-2">
                <CheckCircle size={16} />
                Payment successful! Thank you for your payment.
              </div>
            )}

            {payError && <ErrorBanner message={payError} onDismiss={() => setPayError(null)} />}

            {!clientSecret && !paySuccess ? (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <PortalInput
                  label="Amount (K)"
                  value={paymentAmount}
                  onChange={(v) => setPaymentAmount(v)}
                  placeholder={remaining.toFixed(2)}
                  type="number"
                  style={{ maxWidth: 160 }}
                />
                <PortalButton
                  onClick={handlePay}
                  disabled={paying || !invoice}
                  icon={paying ? Loader2 : CreditCard}
                >
                  {paying ? 'Processing...' : `Pay K ${remaining.toFixed(2)}`}
                </PortalButton>
              </div>
            ) : clientSecret && showStripeForm ? (
              <Suspense fallback={<div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading payment form...</div>}>
                <StripePaymentForm
                  clientSecret={clientSecret}
                  invoice={invoice}
                  onSuccess={handlePaymentSuccess}
                  onCancel={handlePaymentCancel}
                />
              </Suspense>
            ) : null}

            <p style={{ fontSize: 11, color: portalTheme.inkSoft, marginTop: 12 }}>
              Your payment is processed securely via Stripe. Your card information is never stored on our servers.
            </p>
          </PortalCard>
        )}

      </div>

      <DocumentPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={`Invoice ${invoice.invoice_number}`}
        onDownload={handleDownloadPdf}
        downloading={downloading}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: portalTheme.inkSoft }}>Invoice Number:</span>
            <span style={{ color: portalTheme.ink, fontWeight: 600 }}>{invoice.invoice_number}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: portalTheme.inkSoft }}>Customer:</span>
            <span style={{ color: portalTheme.ink }}>{invoice.customer_name}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: portalTheme.inkSoft }}>Status:</span>
            <StatusBadge status={invoice.status} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: portalTheme.inkSoft }}>Total:</span>
            <span style={{ color: portalTheme.ink, fontFamily: "'JetBrains Mono', monospace" }}>K {Number(invoice.total_amount).toFixed(2)}</span>
          </div>
          {(invoice.line_items || []).map((item, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ color: portalTheme.ink }}>{item.item_name} × {item.quantity}</span>
              <span style={{ color: portalTheme.ink, fontFamily: "'JetBrains Mono', monospace" }}>K {Number(item.line_total).toFixed(2)}</span>
            </div>
          ))}
        </div>
      </DocumentPreviewModal>
    </div>
  );
};

export default CustomerInvoiceDetail;
