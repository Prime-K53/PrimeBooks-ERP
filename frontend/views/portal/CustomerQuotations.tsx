import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Plus, ArrowUpRight } from 'lucide-react';
import { portalLifecycle, QuotationRecord } from '../../services/portalApiClient';
import EmptyState from './components/EmptyState';
import StatusBadge from './components/StatusBadge';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

const quotationStatusLabel: Record<string, string> = {
  ready: 'Ready',
  accepted: 'Accepted',
  rejected: 'Rejected',
  revision_requested: 'Revision Requested',
  converted: 'Converted to Order',
};

const CustomerQuotations: React.FC = () => {
  const navigate = useNavigate();
  const [quotations, setQuotations] = useState<QuotationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await portalLifecycle.quotations.list();
      setQuotations(all || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load quotations');
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
        if (type === 'entity_changed' && payload.docType === 'quotation') load();
      },
    });
    return unsubscribe;
  }, [load]);

  const sorted = useMemo(
    () => [...quotations].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()),
    [quotations]
  );

  if (loading) return <div className="p-6 max-w-5xl mx-auto"><PortalLoadingSkeleton type="table" count={6} /></div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quotations</h1>
          <p className="text-sm text-slate-500 mt-1">Official quotations prepared for you</p>
        </div>
        <button
          onClick={() => navigate('/portal/new-request?type=quotation')}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-green-500 hover:from-emerald-500 hover:to-green-400 text-white text-sm font-semibold rounded-xl shadow-lg shadow-emerald-600/25 transition-all"
        >
          <Plus size={16} /> Request Quotation
        </button>
      </div>

      {error && (
        <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-600">{error}</div>
      )}

      {sorted.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No quotations"
          description="Official quotations created for you by our team will appear here."
        />
      ) : (
        <div className="space-y-2">
          {sorted.map((q) => (
            <button
              key={q.id}
              onClick={() => navigate(`/portal/quotations/${q.id}`)}
              className="w-full bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 px-5 py-4 flex items-center justify-between gap-4 hover:border-emerald-300 hover:shadow-md transition-all text-left"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="p-2 rounded-lg bg-slate-100 text-slate-500 shrink-0">
                  <FileText size={18} />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-slate-900">{q.quotation_number}</p>
                  <p className="text-xs text-slate-500">
                    {new Date(q.created_at).toLocaleDateString()}
                    {q.valid_until ? ` • Valid until ${new Date(q.valid_until).toLocaleDateString()}` : ''}
                    {q.payment_terms ? ` • ${q.payment_terms}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-semibold text-sm text-slate-900">K {Number(q.total).toFixed(2)}</span>
                <StatusBadge status={quotationStatusLabel[q.status] || q.status} />
                <ArrowUpRight size={16} className="text-slate-400" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default CustomerQuotations;
