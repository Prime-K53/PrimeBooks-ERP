import React, { useCallback, useEffect, useState } from 'react';
import { createElement } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Loader2, CheckCircle2, XCircle, RefreshCcw, FileText, MessageSquare, History, Clock, BadgeCheck } from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import { portalLifecycle, QuotationRecord, TimelineEvent, DocumentVersionRecord, DocumentSignatureRecord } from '../../services/portalApiClient';
import ErrorBanner from './components/ErrorBanner';
import { mapToInvoiceData } from '../../utils/pdfMapper';
import { attachDocumentSecurity } from '../../utils/documentSecurity';
import { initializePrimePdfFonts } from '../shared/components/PDF/templateSettings';
import { PrimeDocument } from '../shared/components/PDF/PrimeDocument';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from './components/StatusBadge';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import DocumentChain from './components/DocumentChain';
import DocumentDiscussion from './components/DocumentDiscussion';
import VersionHistoryModal from './components/VersionHistoryModal';
import { portalTheme, formatK } from './constants';

const stageDefinitions = [
  { key: 'submitted', label: 'Requested', description: 'Your request was received' },
  { key: 'under_review', label: 'Under Review', description: 'Our team is reviewing it' },
  { key: 'quotation_ready', label: 'Quotation Ready', description: 'Your official quotation is ready' },
  { key: 'accepted', label: 'Accepted', description: 'Converted into an order' },
];

function stageIndex(status: string): number {
  if (status === 'converted') return 4;
  switch (status) {
    case 'ready': return 3;
    case 'accepted': return 4;
    case 'revision_requested': return 3;
    case 'rejected': return 3;
    case 'expired': return 3;
    default: return 0;
  }
}

const CustomerQuotationDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { companyConfig } = useAuth();
  const [quotation, setQuotation] = useState<QuotationRecord | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [versions, setVersions] = useState<DocumentVersionRecord[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [signatures, setSignatures] = useState<DocumentSignatureRecord[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [q, events, sigs] = await Promise.all([
        portalLifecycle.quotations.get(id),
        portalLifecycle.timeline.get('quotation', id),
        portalLifecycle.quotations.signatures(id).catch(() => [] as DocumentSignatureRecord[]),
      ]);
      setQuotation(q);
      setTimeline(events || []);
      setSignatures(sigs);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load quotation');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const openVersions = async () => {
    if (!quotation) return;
    setVersionsOpen(true);
    setVersionsLoading(true);
    try {
      const data = await portalLifecycle.quotations.versions.list(quotation.id);
      setVersions(data || []);
    } catch {
      setVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      unsubscribe = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          if (type === 'entity_changed' && payload.docType === 'quotation' && payload.docId === id && !cancelled) load();
        },
      });

    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [id, load]);

  const runAction = async (actionName: string, payload?: any) => {
    if (!quotation) return;
    setAction(actionName);
    setActionError(null);
    try {
      if (actionName === 'accept') {
        await portalLifecycle.quotations.accept(quotation.id, { acceptedBy: quotation.customer_name });
      } else if (actionName === 'reject') {
        if (!rejectionReason.trim()) throw new Error('Please provide a reason for rejecting');
        await portalLifecycle.quotations.reject(quotation.id, { reason: rejectionReason });
      } else if (actionName === 'revision') {
        if (!revisionNote.trim()) throw new Error('Please describe the changes you need');
        await portalLifecycle.quotations.requestRevision(quotation.id, { comments: revisionNote });
      }
      await load();
    } catch (err: any) {
      setActionError(err.message || `Failed to ${actionName} quotation`);
    } finally {
      setAction(null);
    }
  };

  const handleDownloadPdf = async () => {
    if (!quotation) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await portalLifecycle.downloads.record('quotation', quotation.id);
      const items = (quotation.items || []).map((i) => ({
        desc: i.name,
        qty: Number(i.quantity || 1),
        price: Number(i.unitPrice || 0),
        total: Number(i.lineTotal ?? i.quantity * i.unitPrice),
      }));
      const mapped = mapToInvoiceData(
        {
          ...quotation,
          items,
          quotation_number: quotation.quotation_number,
          customerName: quotation.customer_name,
          customer_name: quotation.customer_name,
          subtotal: quotation.subtotal,
          date: quotation.created_at,
        },
        companyConfig,
        'QUOTATION'
      ) as any;
      const secured = await attachDocumentSecurity(mapped, companyConfig?.companyName);
      await initializePrimePdfFonts();
      const blob = await pdf(createElement(PrimeDocument as any, { type: 'QUOTATION', data: secured }) as any).toBlob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${quotation.quotation_number}.pdf`;
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
  if (!quotation) return null;

  const status = quotation.status;
  const currentStage = stageIndex(status);
  const canDecide = status === 'ready' || status === 'revision_requested';
  const canDownload = status === 'ready' || status === 'accepted' || status === 'revision_requested' || status === 'converted';

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button onClick={() => navigate('/portal/orders?tab=quotations')} className="inline-flex items-center gap-1 text-sm text-emerald-600 hover:text-emerald-600 mb-6 transition-colors">
        <ArrowLeft size={14} /> Back to Quotations
      </button>

{downloadError && <ErrorBanner message={downloadError} onDismiss={() => setDownloadError(null)} />}
       {actionError && <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />}

      <DocumentChain docType="quotation" docId={quotation.id} />

      <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Quotation {quotation.quotation_number}</h1>
            <p className="text-sm text-slate-500 mt-1">
              Issued: {new Date(quotation.created_at).toLocaleDateString()}
              {quotation.valid_until ? ` • Valid until ${new Date(quotation.valid_until).toLocaleDateString()}` : ''}
              {quotation.payment_terms ? ` • ${quotation.payment_terms}` : ''}
              {quotation.source_request_number ? ` • From request ${quotation.source_request_number}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {Number(quotation.version || 1) > 1 && (
              <button
                onClick={openVersions}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                <History size={14} /> V{quotation.version} <span className="text-slate-300 font-normal">• history</span>
              </button>
            )}
            {Number(quotation.version || 1) > 1 && <span className="hidden sm:inline text-[10px] text-slate-400">Revision {quotation.version}</span>}
            <StatusBadge status={status} />
            {canDownload && (
              <button
                onClick={handleDownloadPdf}
                disabled={downloading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-xs font-semibold rounded-lg transition-colors"
              >
                {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} {downloading ? 'Generating...' : 'PDF'}
              </button>
            )}
          </div>
        </div>

        {status === 'expired' && (
          <div className="mb-5 bg-slate-100 border border-slate-200 rounded-xl p-4 flex items-start gap-3">
            <Clock size={16} className="text-slate-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-slate-700">This quotation has expired</p>
              <p className="text-xs text-slate-500 mt-0.5">
                It was valid until {quotation.valid_until ? new Date(quotation.valid_until).toLocaleDateString() : 'its expiry date'} and can no longer be
                accepted. Please submit a new request or contact our team to prepare a fresh quotation.
              </p>
            </div>
          </div>
        )}

        {status === 'accepted' && quotation.accepted_by && (
          <div className="mb-5 bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
            <BadgeCheck size={16} className="text-emerald-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-emerald-700">Accepted and digitally recorded</p>
              <p className="text-xs text-emerald-600 mt-0.5">
                Accepted by <span className="font-semibold">{quotation.accepted_by}</span>
                {quotation.accepted_by_email ? ` (${quotation.accepted_by_email})` : ''} on{' '}
                {quotation.accepted_at ? new Date(quotation.accepted_at).toLocaleString() : 'an unknown date'}.
                {signatures.length > 1 && ` ${signatures.length - 1} earlier decision${signatures.length > 2 ? 's' : ''} recorded on this document.`}
              </p>
            </div>
          </div>
        )}

        {/* Progress tracker */}
        <div className="flex items-center gap-2 mb-6">
          {stageDefinitions.map((stage, i) => {
            const done = currentStage > i + 1 || (currentStage === i + 1);
            const active = currentStage === i + 1;
            const isLast = i === stageDefinitions.length - 1;
            return (
              <React.Fragment key={stage.key}>
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      done ? 'bg-emerald-500 text-white' : active ? 'bg-amber-400 text-white' : 'bg-slate-200 text-slate-400'
                    }`}
                  >
                    {done && currentStage > i + 1 ? <CheckCircle2 size={15} /> : <span className="text-xs font-bold">{i + 1}</span>}
                  </div>
                  <span className={`mt-1.5 text-[10px] font-semibold text-center ${done || active ? 'text-slate-800' : 'text-slate-400'}`}>
                    {stage.label}
                  </span>
                  <span className="text-[9px] text-slate-400 text-center hidden sm:block">{stage.description}</span>
                </div>
                {!isLast && <div className={`h-0.5 flex-1 -mt-5 ${done ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
              </React.Fragment>
            );
          })}
        </div>

        <div className="text-sm text-slate-700">
          <span className="text-slate-500">Customer:</span> {quotation.customer_name}
        </div>
      </div>

      {/* Decision panel */}
      {canDecide && (
        <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 p-5 mb-6">
          <h2 className="text-sm font-semibold text-slate-800 mb-4">Review Quotation</h2>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => runAction('accept')}
              disabled={action !== null}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-all"
            >
              {action === 'accept' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={15} />} Accept &amp; Convert to Order
            </button>
            <button
              onClick={() => runAction('reject')}
              disabled={action !== null}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-rose-50 hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed text-rose-600 text-sm font-semibold rounded-xl transition-all"
            >
              {action === 'reject' ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={15} />} Reject
            </button>
            <button
              onClick={() => runAction('revision')}
              disabled={action !== null}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-semibold rounded-xl transition-all"
            >
              {action === 'revision' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={15} />} Request Changes
            </button>
          </div>
          {status === 'revision_requested' && (
            <p className="mt-3 text-xs text-violet-600 font-medium">Revision requested — our team will regenerate the quotation.</p>
          )}
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Change Request</label>
              <textarea
                value={revisionNote}
                onChange={(e) => setRevisionNote(e.target.value)}
                rows={2}
                placeholder="Describe the changes you need (prices, quantities, terms)..."
                className="w-full px-3 py-2.5 bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl text-sm text-slate-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Rejection Reason</label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={2}
                placeholder="Why are you rejecting this quotation?"
                className="w-full px-3 py-2.5 bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl text-sm text-slate-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/40 resize-none"
              />
            </div>
          </div>
        </div>
      )}

      {status === 'rejected' && quotation.rejection_reason && (
        <div className="mb-6 bg-rose-50 border border-rose-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-rose-600 uppercase tracking-wider mb-1">Rejected</p>
          <p className="text-sm text-rose-700">{quotation.rejection_reason}</p>
        </div>
      )}
      {status === 'converted' && (
        <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between gap-3">
          <p className="text-sm text-emerald-700 font-medium">This quotation was accepted and converted into an order.</p>
          <button
            onClick={() => quotation.order_id && navigate(`/portal/orders/${quotation.order_id}`)}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors shrink-0"
          >
            View Order
          </button>
        </div>
      )}

      <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-slate-200/60">
          <h2 className="text-sm font-semibold text-slate-800">Items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200/60 text-slate-500">
                <th className="px-5 py-2.5 font-semibold text-xs uppercase tracking-wider">Item</th>
                <th className="px-5 py-2.5 font-semibold text-xs uppercase tracking-wider text-right">Qty</th>
                <th className="px-5 py-2.5 font-semibold text-xs uppercase tracking-wider text-right">Price</th>
                <th className="px-5 py-2.5 font-semibold text-xs uppercase tracking-wider text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {(quotation.items || []).map((item, i) => (
                <tr key={i} className={i < (quotation.items || []).length - 1 ? 'border-b border-slate-200/60' : ''}>
                  <td className="px-5 py-3 font-medium text-slate-800">{item.name}</td>
                  <td className="px-5 py-3 text-right text-slate-600 tabular-nums">{item.quantity}</td>
                  <td className="px-5 py-3 text-right text-slate-600 tabular-nums" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatK(item.unitPrice || 0)}</td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-900 tabular-nums" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatK(item.lineTotal ?? item.quantity * item.unitPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-4 border-t border-slate-200/60 space-y-1.5 text-sm">
          <div className="flex justify-between text-slate-600"><span>Subtotal</span><span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatK(quotation.subtotal)}</span></div>
          {Number(quotation.discount) > 0 && (
            <div className="flex justify-between text-slate-600"><span>Discount</span><span style={{ fontFamily: "'JetBrains Mono', monospace" }}>- {formatK(quotation.discount)}</span></div>
          )}
          {Number(quotation.delivery_fee) > 0 && (
            <div className="flex justify-between text-slate-600"><span>Delivery Fee</span><span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatK(quotation.delivery_fee)}</span></div>
          )}
          {Number(quotation.tax_amount) > 0 && (
            <div className="flex justify-between text-slate-600"><span>Tax ({Number(quotation.tax_rate)}%)</span><span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatK(quotation.tax_amount)}</span></div>
          )}
          <div className="flex justify-between pt-2 border-t border-slate-200/60 text-base font-bold">
            <span className="text-slate-800">Total</span>
            <span className="text-slate-900" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatK(quotation.total)}</span>
          </div>
        </div>
      </div>

      {quotation.revision_note && (
        <div className="mb-6 bg-violet-50 border border-violet-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-violet-600 uppercase tracking-wider mb-1">Your change request</p>
          <p className="text-sm text-violet-700">{quotation.revision_note}</p>
        </div>
      )}

      {/* Timeline */}
      <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 p-5 mb-6">
        <h2 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <MessageSquare size={15} className="text-slate-400" /> Activity Timeline
        </h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-slate-400">No activity yet.</p>
        ) : (
          <div className="space-y-4">
            {timeline.map((event) => (
              <div key={event.id} className="flex gap-3">
                <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{event.title}</p>
                  {event.description && <p className="text-xs text-slate-500">{event.description}</p>}
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {new Date(event.created_at).toLocaleString()} • {event.actor_name || 'System'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Decision Records / Signatures */}
      {signatures.length > 0 && (
        <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-slate-200/60">
            <h2 className="text-sm font-semibold text-slate-800">Decision Records</h2>
          </div>
          <div className="space-y-2">
            {signatures.map((sig) => (
              <div key={sig.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', background: '#FEFDFB', borderRadius: 12, border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full text-[11px] font-bold border whitespace-nowrap ${
                    sig.decision === 'accepted' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                    sig.decision === 'rejected' ? 'bg-rose-100 text-rose-700 border-rose-200' :
                    'bg-violet-100 text-violet-700 border-violet-200'
                  }`}>{sig.decision}</span>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#23282A', marginTop: 4 }}>{sig.signer_name || '—'}</p>
                  <p style={{ fontSize: 11, color: '#5c6567', marginTop: 2 }}>{sig.signer_email || '—'} • {sig.signed_at ? new Date(sig.signed_at).toLocaleString() : '—'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <DocumentDiscussion docType="quotation" docId={quotation.id} />

      <VersionHistoryModal
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        versions={versions}
        loading={versionsLoading}
      />
    </div>
  );
};

export default CustomerQuotationDetail;
