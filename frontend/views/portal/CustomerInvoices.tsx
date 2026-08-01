import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, ChevronRight, Download, Edit2, DollarSign, Plus, MoreVertical } from 'lucide-react';
import { portalApi } from '../../services/portalApiClient';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

const teal = {
  50: '#eef7f6', 100: '#d3ece9', 200: '#a6d9d3', 300: '#72c0b7',
  400: '#3fa294', 500: '#1f8577', 600: '#146b60', 700: '#0f544c',
  800: '#0b3e39', 900: '#082e2a'
};
const amber = { 100: '#fbead0', 300: '#eec27a', 500: '#d99a3f', 600: '#b97e2b' };
const paper = '#FEFDFB';
const ink = '#23282A';
const inkSoft = '#5c6567';
const hairline = '#e4ddd1';

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

  if (loading) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={8} /></div>;
  if (error) return <div className="p-8 max-w-4xl mx-auto"><div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 text-sm">{error}</div></div>;

  return (
    <div>
      <div style={{
        background: paper,
        borderRadius: 14,
        overflow: 'hidden'
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '22px 28px 18px',
          borderBottom: `1px solid ${hairline}`,
          background: paper
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 10px -3px rgba(15,84,76,.6)', flexShrink: 0
            }}>
              <Eye size={19} color="#fff" />
            </div>
            <div>
              <h1 style={{
                fontFamily: "'DM Serif Display', 'Georgia', serif", fontWeight: 400,
                fontSize: 22, margin: 0, color: teal[800], letterSpacing: 0.2
              }}>
                Invoices
              </h1>
              <p style={{ margin: '2px 0 0', fontSize: 11.5, color: inkSoft, letterSpacing: 0.02 }}>
                View and manage your invoices
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate('/portal/new-request')}
            style={{
              fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
              padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid transparent',
              background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
              color: '#fff', display: 'flex', alignItems: 'center', gap: 7,
              boxShadow: '0 6px 16px -6px rgba(15,84,76,.55)',
              transition: 'all .15s ease'
            }}
          >
            <Plus size={14} /> New Invoice
          </button>
        </div>

        <div style={{ padding: '24px 30px 8px' }}>
          {error && (
            <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-600">{error}</div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
            {statuses.map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                style={{
                  padding: '8px 14px', fontSize: 12, fontWeight: 600,
                  borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: filter === s ? teal[50] : `rgba(217,154,63,.08)`,
                  color: filter === s ? teal[700] : inkSoft,
                  transition: 'all .15s ease'
                }}
              >
                {s}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon={<Eye size={28} />} title="No invoices found" description={filter === 'All' ? 'You have no invoices yet.' : `No invoices with status "${filter}".`} />
          ) : (
            <div style={{
              background: paper, borderRadius: 14,
              border: `1.4px solid ${hairline}`,
              boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(255,255,255,.04)',
              overflow: 'hidden'
            }}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[13px] table-fixed">
                  <thead style={{ background: teal[50] }}>
                    <tr>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: inkSoft }}>Invoice #</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: inkSoft }}>Date</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: inkSoft }}>Amount</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-center" style={{ color: inkSoft }}>Status</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: inkSoft }}>Due Date</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: inkSoft }}>Actions</th>
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
                          className="transition-colors cursor-pointer group hover:bg-[#eef7f6]"
                        >
                          <td className="px-5 py-3 font-mono text-slate-500 font-bold truncate">{inv.invoice_number}</td>
                          <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{new Date(inv.created_at).toLocaleDateString()}</td>
                          <td className="px-5 py-3 text-right font-medium">K {totalAmount.toLocaleString()}</td>
                          <td className="px-5 py-3 text-center">
                            <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${inv.status === 'Paid' ? 'bg-teal-100 text-teal-700 border-teal-200' :
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
      </div>
    </div>
  );
};

export default CustomerInvoices;
