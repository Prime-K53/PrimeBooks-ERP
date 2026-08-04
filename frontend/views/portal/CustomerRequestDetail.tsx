import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, MessageSquare, CheckCircle2, ArrowUpRight, FileText, XCircle } from 'lucide-react';
import { portalLifecycle, QuotationRequestRecord, TimelineEvent } from '../../services/portalApiClient';
import ErrorBanner from './components/ErrorBanner';
import StatusBadge from './components/StatusBadge';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import PortalButton from './components/PortalButton';
import DocumentChain from './components/DocumentChain';
import DocumentDiscussion from './components/DocumentDiscussion';
import { useToast } from './components/Toast';
import { REQUEST_STATUS_META, FRIENDLY_STATUS_MAP, formatK } from './constants';

const stageDefinitions = [
  { key: 'submitted', label: 'Submitted', description: 'Request received' },
  { key: 'assigned', label: 'Assigned', description: 'Sales assigned' },
  { key: 'under_review', label: 'Under Review', description: 'Team is reviewing' },
  { key: 'ready_for_conversion', label: 'Quotation Being Prepared', description: 'Official quotation being drafted' },
  { key: 'converted', label: 'Quotation Issued', description: 'Official quotation available' },
];

function stageIndex(status: string): number {
  switch (status) {
    case 'draft': return 1;
    case 'submitted': return 1;
    case 'assigned': return 2;
    case 'under_review': return 3;
    case 'waiting_for_customer': return 3;
    case 'ready_for_conversion': return 4;
    case 'converted': return 5;
    case 'rejected': return -1;
    case 'cancelled': return -1;
    default: return 1;
  }
}

const CustomerRequestDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [request, setRequest] = useState<QuotationRequestRecord | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [r, events] = await Promise.all([
        portalLifecycle.requests.get(id),
        portalLifecycle.timeline.get('request', id),
      ]);
      setRequest(r);
      setTimeline(events || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load request');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const sub = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          if (type === 'entity_changed' && payload.docType === 'request' && payload.docId === id && !cancelled) load();
        },
      });
      if (!cancelled) return sub;
    })();
    return () => { cancelled = true; };
  }, [id, load]);

  const handleCancelClick = () => {
    setConfirmCancel(true);
  };

  const handleCancelConfirm = async () => {
    setConfirmCancel(false);
    if (!request) return;
    setCancelling(true);
    setError(null);
    try {
      await portalLifecycle.requests.cancel(request.id);
      addToast('success', 'Request cancelled successfully');
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel request');
      addToast('error', err.message || 'Failed to cancel request');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) return <div className="p-6 max-w-4xl mx-auto"><PortalLoadingSkeleton type="detail" /></div>;
  if (error) return <div className="p-6 max-w-4xl mx-auto"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>;
  if (!request) return null;

  const currentStage = stageIndex(request.status);
  const failed = currentStage === -1;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button onClick={() => navigate('/portal/requests')} className="inline-flex items-center gap-1 text-sm text-emerald-600 hover:text-emerald-600 mb-6 transition-colors">
        <ArrowLeft size={14} /> Back to Requests
      </button>

      <DocumentChain docType="request" docId={request.id} />

      <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Request {request.request_number}</h1>
            <p className="text-sm text-slate-500 mt-1">
              {new Date(request.created_at).toLocaleString()}
              {request.request_type ? ` • ${request.request_type}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={FRIENDLY_STATUS_MAP[request.status] || request.status} />
            {(request.status === 'submitted' || request.status === 'assigned' || request.status === 'under_review' || request.status === 'waiting_for_customer') && (
              <PortalButton
                variant="ghost"
                size="sm"
                onClick={handleCancelClick}
                disabled={cancelling}
                style={{ color: '#dc2626', border: '1.4px solid #fecaca' }}
              >
                {cancelling ? <Loader2 size={12} className="animate-spin" /> : 'Cancel Request'}
              </PortalButton>
            )}
          </div>
        </div>

        {!failed ? (
          <div className="flex items-center gap-2 mb-6">
            {stageDefinitions.map((stage, i) => {
              const done = currentStage > i + 1 || (currentStage === i + 1 && i < stageDefinitions.length - 1);
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
                      {done ? <CheckCircle2 size={15} /> : <span className="text-xs font-bold">{i + 1}</span>}
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
        ) : (
          <div className="mb-6 flex items-center gap-3 bg-rose-50 border border-rose-200 rounded-xl p-4">
            <XCircle size={18} className="text-rose-500 shrink-0" />
            <p className="text-sm text-rose-700 font-medium">
              This request was {request.status === 'cancelled' ? 'cancelled' : 'rejected'}.
              {request.review_note ? ` Reason: ${request.review_note}` : ''}
            </p>
          </div>
        )}

        {request.status === 'converted' && request.quotation_id && (
          <button
            onClick={() => navigate(`/portal/quotations/${request.quotation_id}`)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-xl transition-all"
          >
            <FileText size={15} /> View Quotation {request.quotation_number ? `(${request.quotation_number})` : ''} <ArrowUpRight size={14} />
          </button>
        )}
      </div>

      <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-slate-200/60">
          <h2 className="text-sm font-semibold text-slate-800">Requested Items</h2>
        </div>
        <div className="space-y-2">
          {(request.items || []).map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', background: '#FEFDFB', borderRadius: 12, border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#23282A', margin: 0 }}>{item.name}</p>
              </div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 13, color: '#5c6567' }}>Qty: {item.quantity}</span>
                <span style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: '#5c6567' }}>{formatK(item.unitPrice || 0)}</span>
                <span style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: '#23282A' }}>{formatK(item.lineTotal ?? item.quantity * item.unitPrice)}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 py-4 border-t border-slate-200/60 flex justify-between items-center">
          <span className="text-sm font-semibold text-slate-700">Subtotal</span>
          <span className="text-lg font-bold text-slate-900" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatK(request.subtotal)}</span>
        </div>
      </div>

      {request.status === 'waiting_for_customer' && (
        <div className="mb-6 bg-violet-50 border border-violet-200 rounded-xl p-4">
          <p className="text-sm text-violet-700 font-medium">
            Our team is waiting on additional information from you. Please contact us or submit a new request with more detail.
          </p>
        </div>
      )}

      {request.notes && (
        <div className="mb-6 bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Your Notes</p>
          <p className="text-sm text-slate-700">{request.notes}</p>
        </div>
      )}

      {request.requested_delivery_date && (
        <div className="mb-6 bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Requested Delivery Date</p>
          <p className="text-sm text-slate-700">{new Date(request.requested_delivery_date).toLocaleDateString()}</p>
        </div>
      )}

      {request.attachments && request.attachments.length > 0 && (
        <div className="mb-6 bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Attachments</p>
          <div className="flex flex-wrap gap-2">
            {request.attachments.map((a, i) => (
              <a
                key={i}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
              >
                <FileText size={12} /> {a.name}
              </a>
            ))}
          </div>
        </div>
      )}

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

      <div className="mt-4">
        <DocumentDiscussion docType="request" docId={request.id} />
      </div>

      {confirmCancel && (
        <div className="confirm-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmCancel(false); }}>
          <div className="confirm-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="cancel-request-detail-title">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid #e4ddd1' }}>
              <h2 id="cancel-request-detail-title" style={{ fontSize: 16, fontWeight: 700, color: '#23282A', margin: 0 }}>Cancel Request</h2>
              <button onClick={() => setConfirmCancel(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 8, color: '#5c6567' }} aria-label="Close dialog"><XCircle size={18} /></button>
            </div>
            <div style={{ padding: '18px 22px', fontSize: 14, color: '#5c6567', lineHeight: 1.5 }}>
              Are you sure you want to cancel request <strong>{request?.request_number}</strong>? This action cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '14px 22px', borderTop: '1px solid #e4ddd1' }}>
              <button onClick={() => setConfirmCancel(false)} style={{ padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid #e4ddd1', background: '#FEFDFB', color: '#5c6567', fontSize: 13, fontWeight: 600 }}>Keep Request</button>
              <button onClick={handleCancelConfirm} style={{ padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid transparent', background: 'linear-gradient(155deg, #dc2626, #b91c1c)', color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: '0 6px 16px -6px rgba(185,28,28,.55)' }}>Cancel Request</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerRequestDetail;
