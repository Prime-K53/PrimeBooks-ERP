import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, ChevronRight, Download, Edit2, DollarSign, MoreVertical } from 'lucide-react';
import { portalApi } from '../../services/portalApiClient';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

interface Invoice {
  id: string;
  invoice_number: string;
  customer_name: string;
  total_amount: number;
  paid_amount: number;
  status: string;
  due_date: string;
  created_at: string;
}

const statuses = ['All', 'Paid', 'Unpaid', 'Overdue', 'Partially Paid'];

const CustomerInvoices: React.FC = () => {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('All');

  useEffect(() => {
    portalApi.get<Invoice[]>('/invoices')
      .then(setInvoices)
      .catch((err) => setError(err.message || 'Failed to load invoices'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter === 'All' ? invoices : invoices.filter((inv) => {
    const key = inv.status?.toLowerCase().replace(/\s+/g, '_');
    const filterKey = filter.toLowerCase().replace(/\s+/g, '_');
    return key === filterKey || key === filterKey.replace('_', '');
  });

  if (loading) return <div className="p-6 max-w-7xl mx-auto"><PortalLoadingSkeleton type="table" count={8} /></div>;
  if (error) return <div className="p-6 max-w-7xl mx-auto"><div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 text-sm">{error}</div></div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Invoices</h1>
        <p className="text-sm text-slate-500 mt-1">View and manage your invoices</p>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {statuses.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filter === s
                ? 'bg-emerald-600 text-white'
                : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<Eye size={28} />} title="No invoices found" description={filter === 'All' ? 'You have no invoices yet.' : `No invoices with status "${filter}".`} />
      ) : (
        <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px] table-fixed">
              <thead className="bg-slate-50/80 backdrop-blur text-slate-500 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left">Invoice #</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left">Date</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right">Amount</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-center">Status</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left">Due Date</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/50">
                {filtered.map((inv) => {
                  const isPaid = inv.status === 'Paid';
                  const isCancelled = inv.status === 'Cancelled';
                  const balanceDue = isCancelled ? 0 : ((inv.total_amount || 0) - (inv.paid_amount || 0));
                  const totalAmount = isCancelled ? 0 : (inv.total_amount || 0);

                  return (
                    <tr
                      key={inv.id}
                      onClick={() => navigate(`/portal/invoices/${inv.id}`)}
                      className="transition-colors cursor-pointer group hover:bg-blue-50/50 border-l-4 border-l-transparent"
                    >
                      <td className="px-5 py-3 font-mono text-slate-500 font-bold truncate">{inv.invoice_number}</td>
                      <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{new Date(inv.created_at).toLocaleDateString()}</td>
                      <td className="px-5 py-3 text-right font-medium">K {totalAmount.toLocaleString()}</td>
                      <td className="px-5 py-3 text-center">
                        <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${inv.status === 'Paid' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                          inv.status === 'Partial' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                            inv.status === 'Overdue' ? 'bg-rose-100 text-rose-700 border-rose-200' :
                              inv.status === 'Cancelled' ? 'bg-slate-100 text-[#5c6567] border-slate-200 line-through' :
                                'bg-slate-100 text-[#5c6567] border-slate-200'
                          }`}>{inv.status}</span>
                      </td>
                      <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{new Date(inv.due_date).toLocaleDateString()}</td>
                      <td className="px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-center gap-1 items-center shrink-0">
                          <button className="p-1.5 text-[#5c6567] hover:text-blue-600 bg-slate-50 hover:bg-white border border-transparent hover:border-slate-200 rounded transition-all" title="View detail">
                            <ChevronRight size={14} />
                          </button>
                          <button className="p-1.5 text-[#5c6567] hover:text-blue-600 bg-slate-50 hover:bg-white border border-transparent hover:border-slate-200 rounded transition-all" title="Preview PDF">
                            <Eye size={14} />
                          </button>
                          <button className="p-1.5 text-[#5c6567] hover:text-blue-600 bg-slate-50 hover:bg-white border border-transparent hover:border-slate-200 rounded transition-all" title="Download PDF">
                            <Download size={14} />
                          </button>
                          {!isPaid && !isCancelled && (
                            <button className="p-1.5 text-[#5c6567] hover:text-amber-600 bg-slate-50 hover:bg-white border border-transparent hover:border-slate-200 rounded transition-all" title="Edit">
                              <Edit2 size={14} />
                            </button>
                          )}
                          {!isPaid && (
                            <button className="p-1.5 text-blue-600 hover:text-blue-700 transition-all" title="Receive Payment">
                              <DollarSign size={16} />
                            </button>
                          )}
                          <button className="p-1.5 text-[#5c6567] hover:text-slate-600 rounded"><MoreVertical size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerInvoices;
