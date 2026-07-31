import React, { useCallback, useEffect, useState } from 'react';
import { createElement } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Loader2, CheckCircle2, XCircle, RefreshCcw, FileText, MessageSquare } from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import { portalLifecycle, QuotationRecord, TimelineEvent } from '../../services/portalApiClient';
import { mapToInvoiceData } from '../../utils/pdfMapper';
import { attachDocumentSecurity } from '../../utils/documentSecurity';
import { initializePrimePdfFonts } from '../shared/components/PDF/templateSettings';
import { PrimeDocument } from '../shared/components/PDF/PrimeDocument';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from './components/StatusBadge';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

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

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [q, events] = await Promise.all([
        portalLifecycle.quotations.get(id),
        portalLifecycle.timeline.get('quotation', id),
      ]);
      setQuotation(q);
      setTimeline(events || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load quotation');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!id) return;
    const unsubscribe = portalLifecycle.subscribe({
      onEvent: (type, payload) => {
        if (type === 'entity_changed' && payload.docType === 'quotation' && payload.docId === id) load();
      },
    });
    return unsubscribe;
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
  if (error) return <div className="p-6 max-w-4xl mx-auto"><div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 text-sm">{error}</div></div>;
  if (!quotation) return null;

  const status = quotation.status;
  const currentStage = stageIndex(status);
  const canDecide = status === 'ready' || status === 'revision_requested';
  const canDownload = status === 'ready' || status === 'accepted' || status === 'revision_requested' || status === 'converted';

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button onClick={() => navigate('/portal/quotations')} className="inline-flex items-center gap-1 text-sm text-emerald-600 hover:text-emerald-600 mb-6 transition-colors">
        <ArrowLeft size={14} /> Back to Quotations
      </button>

      {downloadError && (
        <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-600">{downloadError}</div>
      )}
      {actionError && (
        <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-600">{actionError}</div>
      )}

      <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Quotation {quotation.quotation_number}</h1>
            <p className="text-sm text-slate-500 mt-1">
              Issued: {new Date(quotation.created_at).toLocaleDateString()}
              {quotation.valid_until ? ` • Valid until ${new Date(quotation.valid_until).toLocaleDateString()}` : ''}
              {quotation.payment_terms ? ` • ${quotation.payment_terms}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
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
          <table className="w-full min-w-[640px] text-left text-[13px] table-fixed">
            <thead className="bg-slate-50/80 backdrop-blur text-slate-500 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left">Item</th>
                <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right">Qty</th>
                <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right">Unit Price</th>
                <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/50">
              {(quotation.items || []).map((item, i) => (
                <tr key={i} className="text-slate-700">
                  <td className="px-5 py-3 font-medium text-slate-900">{item.name}</td>
                  <td className="px-5 py-3 text-right">{item.quantity}</td>
                  <td className="px-5 py-3 text-right font-mono">K {Number(item.unitPrice || 0).toFixed(2)}</td>
                  <td className="px-5 py-3 text-right font-mono">K {Number(item.lineTotal ?? item.quantity * item.unitPrice).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-4 border-t border-slate-200/60 space-y-1.5 text-sm">
          <div className="flex justify-between text-slate-600"><span>Subtotal</span><span className="font-mono">K {Number(quotation.subtotal).toFixed(2)}</span></div>
          {Number(quotation.discount) > 0 && (
            <div className="flex justify-between text-slate-600"><span>Discount</span><span className="font-mono">- K {Number(quotation.discount).toFixed(2)}</span></div>
          )}
          {Number(quotation.delivery_fee) > 0 && (
            <div className="flex justify-between text-slate-600"><span>Delivery Fee</span><span className="font-mono">K {Number(quotation.delivery_fee).toFixed(2)}</span></div>
          )}
          {Number(quotation.tax_amount) > 0 && (
            <div className="flex justify-between text-slate-600"><span>Tax ({Number(quotation.tax_rate)}%)</span><span className="font-mono">K {Number(quotation.tax_amount).toFixed(2)}</span></div>
          )}
          <div className="flex justify-between pt-2 border-t border-slate-200/60 text-base font-bold">
            <span className="text-slate-800">Total</span>
            <span className="text-slate-900 font-mono">K {Number(quotation.total).toFixed(2)}</span>
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
      <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 p-5">
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
    </div>
  );
};

export default CustomerQuotationDetail;
