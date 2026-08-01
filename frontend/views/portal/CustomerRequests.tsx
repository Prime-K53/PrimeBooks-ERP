import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Plus, Loader2, ArrowUpRight } from 'lucide-react';
import { portalLifecycle, QuotationRequestRecord } from '../../services/portalApiClient';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import EmptyState from './components/EmptyState';
import StatusBadge from './components/StatusBadge';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

const requestStatusLabel: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  assigned: 'Assigned',
  under_review: 'Under Review',
  waiting_for_customer: 'Waiting for Customer',
  ready_for_conversion: 'Quotation Being Prepared',
  converted: 'Quotation Issued',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

const CustomerRequests: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useCustomerAuth();
  const [requests, setRequests] = useState<QuotationRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await portalLifecycle.requests.list();
      setRequests(data || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsubscribe = portalLifecycle.subscribe({
      onEvent: (type, payload) => {
        if (type === 'entity_changed' && payload.docType === 'request') load();
      },
    });
    return unsubscribe;
  }, [load]);

  const handleCancel = async (id: string) => {
    setCancellingId(id);
    setError(null);
    try {
      await portalLifecycle.requests.cancel(id);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel request');
    } finally {
      setCancellingId(null);
    }
  };

  const sorted = useMemo(
    () => [...requests].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()),
    [requests]
  );

  if (loading) return <div className="p-6 max-w-5xl mx-auto"><PortalLoadingSkeleton type="table" count={6} /></div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Requests</h1>
          <p className="text-sm text-slate-500 mt-1">Track your quotation and order requests</p>
        </div>
        <button
          onClick={() => navigate('/portal/new-request')}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-green-500 hover:from-emerald-500 hover:to-green-400 text-white text-sm font-semibold rounded-xl shadow-lg shadow-emerald-600/25 transition-all"
        >
          <Plus size={16} /> New Request
        </button>
      </div>

      {error && (
        <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-600">{error}</div>
      )}

      {sorted.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No requests yet"
          description="Submit a quotation or order request and track it here."
        />
      ) : (
      <div className="space-y-2">
          {sorted.map((r) => {
            const itemCount = (r.items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0);
            return (
              <div
                key={r.id}
                className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 px-5 py-4 flex flex-wrap items-center justify-between gap-4"
              >
                <button
                  onClick={() => navigate(`/portal/requests/${r.id}`)}
                  className="flex items-center gap-4 min-w-0 text-left flex-1"
                >
                  <div className="p-2 rounded-lg bg-slate-100 text-slate-500 shrink-0">
                    <ClipboardList size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-slate-900">{r.request_number}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(r.created_at).toLocaleDateString()} • {itemCount} item{itemCount === 1 ? '' : 's'}{' '}
                      • K {Number(r.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    {r.quotation_number && (
                      <span className="inline-flex items-center gap-1 mt-1 text-xs font-semibold text-emerald-600">
                        Quotation {r.quotation_number} issued <ArrowUpRight size={12} />
                      </span>
                    )}
                    {!r.quotation_number && r.quotation_id && (
                      <span className="inline-flex items-center gap-1 mt-1 text-xs font-semibold text-emerald-600">
                        Quotation ready <ArrowUpRight size={12} />
                      </span>
                    )}
                  </div>
                </button>
                <div className="flex items-center gap-3 shrink-0">
                  <StatusBadge status={requestStatusLabel[r.status] || r.status} />
                  {(r.status === 'submitted' || r.status === 'assigned' || r.status === 'under_review' || r.status === 'waiting_for_customer') && (
                    <button
                      onClick={() => handleCancel(r.id)}
                      disabled={cancellingId === r.id}
                      className="px-3 py-1.5 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {cancellingId === r.id ? <Loader2 size={12} className="animate-spin" /> : 'Cancel'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CustomerRequests;
