import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, ChevronDown, Plus } from 'lucide-react';
import { api } from '../../services/api';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import EmptyState from './components/EmptyState';
import StatusBadge from './components/StatusBadge';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

interface QuotationItem {
  name: string;
  quantity: number;
  price: number;
}

interface Quotation {
  id: string;
  customerId?: string;
  customerName: string;
  items: QuotationItem[];
  total?: number;
  totalAmount?: number;
  date: string;
  validUntil?: string;
  status: string;
  notes?: string;
  quotationType?: string;
}

const CustomerQuotations: React.FC = () => {
  const { user } = useCustomerAuth();
  const navigate = useNavigate();
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await api.sales.getQuotations();
        if (cancelled) return;
        const customerId = user?.customer_id;
        const mine = customerId
          ? all.filter((q: any) => String(q.customerId || '') === String(customerId))
          : all;
        setQuotations(mine as Quotation[]);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to load quotations');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const sorted = useMemo(
    () => [...quotations].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()),
    [quotations]
  );

  if (loading) return <div className="p-6 max-w-7xl mx-auto"><PortalLoadingSkeleton type="table" count={6} /></div>;
  if (error) return <div className="p-6 max-w-7xl mx-auto"><div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 text-rose-300 text-sm">{error}</div></div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Quotations</h1>
          <p className="text-sm text-slate-400 mt-1">Review and track your quotation requests</p>
        </div>
        <button
          onClick={() => navigate('/portal/new-request?type=quotation')}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-green-500 hover:from-emerald-500 hover:to-green-400 text-white text-sm font-semibold rounded-xl shadow-lg shadow-emerald-600/25 transition-all"
        >
          <Plus size={16} /> Request Quotation
        </button>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No quotations"
          description="Quotations created for you by our team will appear here."
        />
      ) : (
        <div className="space-y-3">
          {sorted.map((q) => {
            const total = Number(q.total ?? q.totalAmount ?? 0);
            const isOpen = expanded === q.id;
            return (
              <div key={q.id} className="bg-slate-800/60 border border-slate-700/60 rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpanded(isOpen ? null : q.id)}
                  className="w-full flex items-center justify-between gap-4 px-5 py-4 hover:bg-slate-700/30 transition-colors text-left"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="p-2 rounded-lg bg-slate-700/60 text-slate-400 shrink-0">
                      <FileText size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-slate-100 truncate">#{q.id}</p>
                      <p className="text-xs text-slate-400">
                        {q.date ? new Date(q.date).toLocaleDateString() : ''}
                        {q.validUntil ? ` • Valid until ${new Date(q.validUntil).toLocaleDateString()}` : ''}
                        {q.quotationType ? ` • ${q.quotationType}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <span className="font-semibold text-sm text-slate-100">K {total.toFixed(2)}</span>
                    <StatusBadge status={q.status} />
                    <ChevronDown size={16} className={`text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-slate-700/60 px-5 py-4">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-slate-500 uppercase tracking-wider">
                            <th className="py-2 font-medium">Item</th>
                            <th className="py-2 font-medium text-right">Qty</th>
                            <th className="py-2 font-medium text-right">Unit Price</th>
                            <th className="py-2 font-medium text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/60">
                          {(q.items || []).map((item, i) => (
                            <tr key={i} className="text-slate-300">
                              <td className="py-2.5">{item.name}</td>
                              <td className="py-2.5 text-right">{item.quantity}</td>
                              <td className="py-2.5 text-right font-mono">K {Number(item.price || 0).toFixed(2)}</td>
                              <td className="py-2.5 text-right font-mono">K {Number((item.price || 0) * (item.quantity || 1)).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {q.notes && <p className="mt-3 text-xs text-slate-400">{q.notes}</p>}
                    <div className="mt-3 pt-3 border-t border-slate-700/60 flex justify-between text-base font-bold">
                      <span className="text-slate-200">Total</span>
                      <span className="text-slate-100 font-mono">K {total.toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CustomerQuotations;
