import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, MessageSquare, CheckCircle2, ArrowUpRight, FileText, XCircle } from 'lucide-react';
import { portalLifecycle, QuotationRequestRecord, TimelineEvent } from '../../services/portalApiClient';
import StatusBadge from './components/StatusBadge';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

const stageDefinitions = [
  { key: 'submitted', label: 'Submitted', description: 'Request received' },
  { key: 'under_review', label: 'Under Review', description: 'Team is reviewing' },
  { key: 'quotation_ready', label: 'Quotation Ready', description: 'Official quotation issued' },
  { key: 'done', label: 'Completed', description: 'Order confirmed' },
];

function stageIndex(status: string): number {
  switch (status) {
    case 'submitted': return 1;
    case 'under_review': return 2;
    case 'quotation_ready': return 3;
    case 'rejected': return -1;
    case 'cancelled': return -1;
    default: return 1;
  }
}

const requestStatusLabel: Record<string, string> = {
  submitted: 'Submitted',
  under_review: 'Under Review',
  quotation_ready: 'Quotation Ready',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

const CustomerRequestDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [request, setRequest] = useState<QuotationRequestRecord | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

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
    const unsubscribe = portalLifecycle.subscribe({
      onEvent: (type, payload) => {
        if (type === 'entity_changed' && payload.docType === 'request' && payload.docId === id) load();
      },
    });
    return unsubscribe;
  }, [id, load]);

  const handleCancel = async () => {
    if (!request) return;
    setCancelling(true);
    setError(null);
    try {
      await portalLifecycle.requests.cancel(request.id);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel request');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) return <div className="p-6 max-w-4xl mx-auto"><PortalLoadingSkeleton type="detail" /></div>;
  if (error) return <div className="p-6 max-w-4xl mx-auto"><div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 text-sm">{error}</div></div>;
  if (!request) return null;

  const currentStage = stageIndex(request.status);
  const failed = currentStage === -1;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button onClick={() => navigate('/portal/requests')} className="inline-flex items-center gap-1 text-sm text-emerald-600 hover:text-emerald-600 mb-6 transition-colors">
        <ArrowLeft size={14} /> Back to Requests
      </button>

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
            <StatusBadge status={requestStatusLabel[request.status] || request.status} />
            {(request.status === 'submitted' || request.status === 'under_review') && (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="px-3 py-1.5 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors disabled:opacity-50"
              >
                {cancelling ? <Loader2 size={12} className="animate-spin" /> : 'Cancel Request'}
              </button>
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

        {request.status === 'quotation_ready' && request.quotation_id && (
          <button
            onClick={() => navigate(`/portal/quotations/${request.quotation_id}`)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-xl transition-all"
          >
            <FileText size={15} /> View Quotation <ArrowUpRight size={14} />
          </button>
        )}
      </div>

      <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-slate-200/60">
          <h2 className="text-sm font-semibold text-slate-800">Requested Items</h2>
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
              {(request.items || []).map((item, i) => (
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
        <div className="px-5 py-4 border-t border-slate-200/60 flex justify-between items-center">
          <span className="text-sm font-semibold text-slate-700">Subtotal</span>
          <span className="text-lg font-bold text-slate-900 font-mono">K {Number(request.subtotal).toFixed(2)}</span>
        </div>
      </div>

      {request.notes && (
        <div className="mb-6 bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Your Notes</p>
          <p className="text-sm text-slate-700">{request.notes}</p>
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
    </div>
  );
};

export default CustomerRequestDetail;
