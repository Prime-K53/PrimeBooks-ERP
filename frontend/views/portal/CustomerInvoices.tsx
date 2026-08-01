import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, ChevronRight, Download, DollarSign, Search } from 'lucide-react';
import { portalLifecycle } from '../../services/portalApiClient';
import PortalPageHeader from './components/PortalPageHeader';
import PortalInput from './components/PortalInput';
import ErrorBanner from './components/ErrorBanner';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import StatusBadge from './components/StatusBadge';
import { portalTheme, DEFAULT_PAGE_SIZE } from '../constants';

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
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await portalLifecycle.invoices.list({ page, pageSize: DEFAULT_PAGE_SIZE, search: search || undefined, status: filter === 'All' ? undefined : filter });
      if ('invoices' in data) {
        setInvoices((data as any).invoices);
        setTotalPages((data as any).totalPages);
        setTotal((data as any).total);
      } else {
        setInvoices(data as Invoice[]);
        setTotalPages(1);
        setTotal((data as Invoice[]).length);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [page, search, filter]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = filter === 'All' ? invoices : invoices.filter((inv) => {
    const key = inv.status?.toLowerCase().replace(/\s+/g, '_');
    const filterKey = filter.toLowerCase().replace(/\s+/g, '_');
    return key === filterKey || key === filterKey.replace('_', '');
  });

  if (loading && page === 1) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={8} /></div>;

  return (
    <div style={{ background: portalTheme.paper, borderRadius: 14, overflow: 'hidden' }}>
      <PortalPageHeader title="Invoices" subtitle="View and manage your invoices" icon={Eye} />

      <div style={{ padding: '20px 28px 8px' }}>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 240px' }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: portalTheme.inkSoft }} />
            <PortalInput label="" placeholder="Search invoices..." value={search} onChange={(v) => { setPage(1); setSearch(v); }} onFocus={() => {}} onBlur={() => {}} style={{ paddingLeft: 32 }} />
          </div>
          <select
            value={filter}
            onChange={(e) => { setPage(1); setFilter(e.target.value); }}
            aria-label="Filter by status"
            style={{
              fontFamily: "'Inter', sans-serif", fontSize: 13, padding: '10px 32px 10px 12px',
              border: '1.4px solid #e4ddd1', borderRadius: 9, background: portalTheme.paper, color: portalTheme.ink,
              appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%235c6567'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', cursor: 'pointer',
            }}
          >
            <option value="All">All Statuses</option>
            <option value="Paid">Paid</option>
            <option value="Unpaid">Unpaid</option>
            <option value="Overdue">Overdue</option>
            <option value="Partially Paid">Partially Paid</option>
          </select>
        </div>
      </div>

      <div style={{ padding: '16px 28px 28px' }}>
        {filtered.length === 0 ? (
          <EmptyState icon={<Eye size={28} />} title="No invoices found" description={filter === 'All' ? 'You have no invoices yet.' : `No invoices with status "${filter}".`} />
        ) : (
          <>
            <div style={{ fontSize: 11, color: portalTheme.inkSoft, marginBottom: 8 }}>
              Showing {invoices.length} of {total} invoice{total !== 1 ? 's' : ''}
            </div>
            <div style={{ background: portalTheme.paper, borderRadius: 14, border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[13px] table-fixed">
                  <thead>
                    <tr style={{ background: portalTheme.teal[50] }}>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Invoice #</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Date</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: portalTheme.inkSoft }}>Total</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: portalTheme.inkSoft }}>Paid</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-center" style={{ color: portalTheme.inkSoft }}>Status</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: portalTheme.inkSoft }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100/50">
                    {filtered.map((inv) => {
                      const isPaid = inv.status === 'Paid';
                      const isCancelled = inv.status === 'Cancelled';
                      const balanceDue = isCancelled ? 0 : ((inv.total_amount || 0) - (inv.paid_amount || 0));
                      const totalAmount = isCancelled ? 0 : (inv.total_amount || 0);
                      return (
                        <tr key={inv.id} onClick={() => navigate(`/portal/invoices/${inv.id}`)} className="transition-colors cursor-pointer group hover:bg-[#eef7f6]">
                          <td className="px-5 py-3 font-mono text-slate-500 font-bold truncate">{inv.invoice_number}</td>
                          <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{new Date(inv.created_at).toLocaleDateString()}</td>
                          <td className="px-5 py-3 text-right font-medium">K {totalAmount.toLocaleString()}</td>
                          <td className="px-5 py-3 text-right font-medium">K {Number(inv.paid_amount).toFixed(2)}</td>
                          <td className="px-5 py-3 text-center"><StatusBadge status={inv.status} /></td>
                          <td className="px-5 py-3 text-right">
                            <div className="flex justify-center gap-1 items-center shrink-0" onClick={(e) => e.stopPropagation()}>
                              <button className="p-2 text-[#5c6567] hover:text-blue-600 bg-slate-50 hover:bg-white border border-transparent hover:border-slate-200 rounded transition-all" title="View detail" aria-label={`View invoice ${inv.invoice_number}`}><Eye size={14} /></button>
                              <button className="p-2 text-[#5c6567] hover:text-teal-600 bg-slate-50 hover:bg-white border border-transparent hover:border-teal-200 rounded transition-all" title="Download PDF" aria-label={`Download invoice ${inv.invoice_number}`}><Download size={14} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, fontSize: 12, color: portalTheme.inkSoft }}>
                <span>Page {page} of {totalPages}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={{ padding: '6px 12px', borderRadius: 8, border: `1.4px solid ${portalTheme.hairline}`, background: portalTheme.paper, cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.5 : 1, fontSize: 12, color: portalTheme.ink }}>Previous</button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{ padding: '6px 12px', borderRadius: 8, border: `1.4px solid ${portalTheme.hairline}`, background: portalTheme.paper, cursor: page >= totalPages ? 'not-allowed' : 'pointer', opacity: page >= totalPages ? 0.5 : 1, fontSize: 12, color: portalTheme.ink }}>Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default CustomerInvoices;
