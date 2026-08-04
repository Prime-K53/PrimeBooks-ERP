import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { FileText, File, Download, FileSpreadsheet, ArrowUpRight, Search, CheckSquare, Square } from 'lucide-react';
import { createElement } from 'react';
import { pdf } from '@react-pdf/renderer';
import { portalLifecycle } from '../../services/portalApiClient';
import { mapToInvoiceData } from '../../utils/pdfMapper';
import { attachDocumentSecurity } from '../../utils/documentSecurity';
import { initializePrimePdfFonts } from '../shared/components/PDF/templateSettings';
import { PrimeDocument } from '../shared/components/PDF/PrimeDocument';
import { useAuth } from '../../context/AuthContext';
import PortalPageHeader from './components/PortalPageHeader';
import PortalInput from './components/PortalInput';
import PortalButton from './components/PortalButton';
import PortalCard from './components/PortalCard';
import ErrorBanner from './components/ErrorBanner';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { useToast } from './components/Toast';
import { portalTheme, formatK } from './constants';

interface Document {
  id: string;
  type: string;
  title: string;
  date: string;
  url: string;
  amount?: number;
}

const typeIcons: Record<string, React.ReactNode> = {
  invoice: <FileText size={20} />,
  receipt: <FileText size={20} />,
  statement: <FileSpreadsheet size={20} />,
  report: <File size={20} />,
};

const CustomerDocuments: React.FC = () => {
  const { companyConfig } = useAuth();
  const { addToast } = useToast();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    portalLifecycle.documents.list()
      .then(setDocuments)
      .catch((err) => setError(err.message || 'Failed to load documents'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sub = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          if (type === 'entity_changed' && !cancelled) {
            portalLifecycle.documents.list()
              .then(setDocuments)
              .catch(() => {});
          }
        },
      });
      if (!cancelled) return sub;
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = documents.filter((doc) =>
    doc.title?.toLowerCase().includes(search.toLowerCase()) ||
    doc.type?.toLowerCase().includes(search.toLowerCase())
  );

  // Extract invoice ID from document URL (format: #/portal/invoices/{id})
  const extractInvoiceId = (url?: string): string | null => {
    if (!url) return null;
    const match = url.match(/#\/portal\/invoices\/(.+)/);
    return match ? match[1] : null;
  };

  // Toggle a single document selection
  const toggleSelect = useCallback((docId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  }, []);

  // Toggle select all
  const toggleSelectAll = useCallback(() => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((d) => d.id)));
    }
  }, [selected.size, filtered]);

  // Bulk download selected documents as individual PDFs
  const handleBulkDownload = useCallback(async () => {
    if (selected.size === 0) return;
    setDownloading(true);
    try {
      await initializePrimePdfFonts();
      let successCount = 0;

      for (const docId of selected) {
        const doc = documents.find((d) => d.id === docId);
        if (!doc) continue;

        const invoiceId = extractInvoiceId(doc.url);
        if (!invoiceId) continue;

        try {
          const invoice = await portalLifecycle.invoices.get(invoiceId);
          if (!invoice) continue;

          const items = Array.isArray(invoice.line_items_json)
            ? invoice.line_items_json
            : typeof invoice.line_items_json === 'string'
              ? JSON.parse(invoice.line_items_json)
              : [];

          const customerName = invoice.customer_name || invoice.customerName || 'Customer';

          const mapped = mapToInvoiceData(
            { ...invoice, items, customerName, subtotal: invoice.subtotal || invoice.total_amount },
            companyConfig,
            'INVOICE'
          );
          const secured = await attachDocumentSecurity(mapped, companyConfig?.companyName);
          const blob = await pdf(
            createElement(PrimeDocument, { type: 'INVOICE', data: secured })
          ).toBlob();

          // Trigger download
          const url = URL.createObjectURL(blob);
          const a = window.document.createElement('a');
          a.href = url;
          a.download = `${doc.title || `Invoice-${invoiceId}`}.pdf`;
          window.document.body.appendChild(a);
          a.click();
          window.document.body.removeChild(a);
          URL.revokeObjectURL(url);
          successCount++;
        } catch (err) {
          console.warn(`Failed to generate PDF for ${docId}:`, err);
        }
      }

      if (successCount > 0) {
        addToast({ title: 'Download complete', description: `${successCount} document(s) downloaded.`, type: 'success' });
      } else {
        addToast({ title: 'Download failed', description: 'Could not generate PDFs for selected documents.', type: 'error' });
      }
    } catch (err) {
      addToast({ title: 'Download failed', description: String(err), type: 'error' });
    } finally {
      setDownloading(false);
    }
  }, [selected, documents, companyConfig, addToast]);

  const grouped: Record<string, Document[]> = {};
  filtered.forEach((doc) => {
    const type = doc.type || 'Other';
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(doc);
  });
  const typeKeys = Object.keys(grouped);

  if (loading) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={6} /></div>;

  return (
    <div>
      <PortalPageHeader title="Documents" subtitle="Access your invoices, receipts, statements and more" icon={FileText} />

      <div style={{ padding: '20px 28px 8px' }}>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div style={{ position: 'relative', maxWidth: 360, flex: 1 }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: portalTheme.inkSoft }} />
            <PortalInput label="" placeholder="Search documents..." value={search} onChange={(v) => setSearch(v)} onFocus={() => {}} onBlur={() => {}} style={{ paddingLeft: 32 }} />
          </div>
          {filtered.length > 0 && (
            <div className="flex items-center gap-2">
              {/* Select All */}
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
                style={{
                  color: selected.size > 0 ? portalTheme.teal[700] : portalTheme.inkSoft,
                  background: selected.size > 0 ? portalTheme.teal[50] : 'transparent',
                  border: `1px solid ${selected.size > 0 ? portalTheme.teal[200] : '#e2e8f0'}`,
                }}
              >
                {selected.size === filtered.length && filtered.length > 0 ? (
                  <CheckSquare size={14} />
                ) : (
                  <Square size={14} />
                )}
                {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
              </button>

              {/* Download Selected */}
              {selected.size > 0 && (
                <PortalButton
                  variant="primary"
                  onClick={handleBulkDownload}
                  disabled={downloading}
                  loading={downloading}
                  icon={Download}
                >
                  {downloading ? 'Downloading…' : `Download (${selected.size})`}
                </PortalButton>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: '16px 28px 28px' }}>
        {filtered.length === 0 ? (
          <EmptyState icon={<FileText size={28} />} title="No documents available" description={search ? 'No documents match your search.' : 'Your documents will appear here once generated.'} />
        ) : (
          <div className="space-y-8">
            {typeKeys.map((type) => (
              <div key={type}>
                <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 capitalize" style={{ color: portalTheme.inkSoft }}>{type}s</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {grouped[type].map((doc) => {
                    const isSelected = selected.has(doc.id);
                    return (
                      <PortalCard
                        key={doc.id}
                        hoverable
                        className={`flex items-center gap-3 p-4 transition-all ${isSelected ? 'ring-2' : ''}`}
                        style={isSelected ? { borderColor: portalTheme.teal[400], background: portalTheme.teal[50] } : undefined}
                      >
                        {/* Selection checkbox */}
                        <button
                          onClick={() => toggleSelect(doc.id)}
                          className="shrink-0 p-0.5 rounded transition-colors"
                          title={isSelected ? 'Deselect' : 'Select for download'}
                          style={{ color: isSelected ? portalTheme.teal[600] : portalTheme.inkSoft }}
                        >
                          {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                        </button>
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: portalTheme.teal[50], color: portalTheme.teal[600] }}>
                          {typeIcons[doc.type?.toLowerCase()] || <File size={20} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: portalTheme.ink }}>{doc.title}</p>
                          <p className="text-xs mt-1" style={{ color: portalTheme.inkSoft }}>
                            {doc.date ? new Date(doc.date).toLocaleDateString() : ''}
                            {doc.amount !== undefined ? ` • ${formatK(doc.amount)}` : ''}
                          </p>
                        </div>
                        {doc.url?.startsWith('#/') ? (
                          <Link
                            to={doc.url.slice(2)}
                            className="p-2 rounded-lg shrink-0 transition-colors hover:text-[#146b60] hover:bg-[#eef7f6]"
                            style={{ color: portalTheme.inkSoft }}
                            title="Open document"
                          >
                            <ArrowUpRight size={16} />
                          </Link>
                        ) : (
                          <a
                            href={doc.url}
                            download
                            className="p-2 rounded-lg shrink-0 transition-colors hover:text-[#146b60] hover:bg-[#eef7f6]"
                            style={{ color: portalTheme.inkSoft }}
                            title="Download"
                          >
                            <Download size={16} />
                          </a>
                        )}
                      </PortalCard>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomerDocuments;
