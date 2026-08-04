import React, { useEffect, useState } from 'react';
import { createElement } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Eye } from 'lucide-react';
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
import { portalTheme, DEFAULT_PAGE_SIZE, formatK } from './constants';

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
          <div style={{ padding: '4px 18px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '10px 0', borderBottom: '1px solid #e4ddd1' }}>
              <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>Item</span>
              <span style={{ width: 48, textAlign: 'right', fontSize: 11, fontWeight: 600, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>Qty</span>
              <span style={{ width: 96, textAlign: 'right', fontSize: 11, fontWeight: 600, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>Price</span>
              <span style={{ width: 110, textAlign: 'right', fontSize: 11, fontWeight: 600, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>Total</span>
            </div>
            {(invoice.line_items || []).map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '14px 0', borderBottom: i < (invoice.line_items || []).length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#23282A' }}>{item.item_name}</span>
                </div>
                <span style={{ width: 48, textAlign: 'right', fontSize: 13, color: '#5c6567' }}>{item.quantity}</span>
                <span style={{ width: 96, textAlign: 'right', fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: '#5c6567' }}>{formatK(item.unit_price)}</span>
                <span style={{ width: 110, textAlign: 'right', fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: '#23282A' }}>{formatK(item.line_total)}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: '14px 16px', borderTop: '1px solid #e4ddd1', display: 'flex', flexDirection: 'column', gap: 6 }}>
<div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
  <span style={{ color: portalTheme.inkSoft }}>Subtotal</span>
  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: portalTheme.ink }}>{formatK(subtotal)}</span>
</div>
{Number(invoice.paid_amount) > 0 && (
  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
    <span style={{ color: portalTheme.teal[600] }}>Paid</span>
    <span style={{ fontFamily: "'JetBrains Mono', monospace", color: portalTheme.teal[600] }}>{formatK(invoice.paid_amount)}</span>
  </div>
)}
{remaining > 0 && (
  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
    <span style={{ color: portalTheme.amber[600] }}>Remaining</span>
    <span style={{ fontFamily: "'JetBrains Mono', monospace", color: portalTheme.amber[600] }}>{formatK(remaining)}</span>
  </div>
)}
<div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700, borderTop: '1px solid #e4ddd1', paddingTop: 8, marginTop: 4 }}>
  <span style={{ color: portalTheme.ink }}>Total</span>
  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: portalTheme.ink }}>{formatK(invoice.total_amount)}</span>
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
            <span style={{ color: portalTheme.ink, fontFamily: "'JetBrains Mono', monospace" }}>{formatK(invoice.total_amount)}</span>
          </div>
          {(invoice.line_items || []).map((item, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ color: portalTheme.ink }}>{item.item_name} × {item.quantity}</span>
              <span style={{ color: portalTheme.ink, fontFamily: "'JetBrains Mono', monospace" }}>{formatK(item.line_total)}</span>
            </div>
          ))}
        </div>
      </DocumentPreviewModal>
    </div>
  );
};

export default CustomerInvoiceDetail;
