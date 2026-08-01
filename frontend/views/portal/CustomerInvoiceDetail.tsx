import React, { useEffect, useState } from 'react';
import { createElement } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Loader2, Eye } from 'lucide-react';
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
import ErrorBanner from './components/ErrorBanner';
import DocumentPreviewModal from './components/DocumentPreviewModal';
import StatusBadge from './components/StatusBadge';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { portalTheme, DEFAULT_PAGE_SIZE } from './constants';

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
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    portalLifecycle.invoices.get(id)
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
  if (error) return <div className="p-6 max-w-4xl mx-auto"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>;
  if (!invoice) return null;

  const subtotal = (invoice.line_items || []).reduce((sum, item) => sum + Number(item.line_total), 0);
  const remaining = Number(invoice.total_amount) - Number(invoice.paid_amount || 0);

  return (
    <div style={{ background: portalTheme.paper, borderRadius: 14, overflow: 'hidden' }}>
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
