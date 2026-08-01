import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, Eye, Plus, MoreVertical, RotateCcw, Loader2, Search } from 'lucide-react';
import { portalLifecycle } from '../../services/portalApiClient';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { useToast } from './components/Toast';
import PortalPageHeader from './components/PortalPageHeader';
import PortalCard from './components/PortalCard';
import PortalButton from './components/PortalButton';
import PortalInput from './components/PortalInput';
import ErrorBanner from './components/ErrorBanner';
import EmptyState from './components/EmptyState';
import StatusBadge from './components/StatusBadge';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { portalTheme, ORDER_STATUS_META, DEFAULT_PAGE_SIZE, FRIENDLY_STATUS_MAP } from './constants';

interface Order {
  id: string;
  orderNumber?: string;
  orderDate: string;
  customerName: string;
  totalAmount: number;
  status: string;
}

const CustomerOrders: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useCustomerAuth();
  const { addToast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('All');
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [confirmReorder, setConfirmReorder] = useState<{ open: boolean; order: Order | null }>({ open: false, order: null });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await portalLifecycle.orders.list({ page, pageSize: DEFAULT_PAGE_SIZE, search: search || undefined, status: filter === 'All' ? undefined : filter });
      if ('orders' in data) {
        const mapped: Order[] = (data as any).orders.map((o: any) => ({
          id: o.id,
          orderNumber: o.orderNumber || o.order_number,
          orderDate: o.orderDate || o.order_date || o.created_at || '',
          customerName: o.customerName || o.customer_name || '',
          totalAmount: Number(o.totalAmount ?? o.total ?? o.subtotal ?? 0),
          status: o.status || 'Draft',
        }));
        setOrders(mapped);
        setTotalPages((data as any).totalPages);
        setTotal((data as any).total);
      } else {
        const mapped: Order[] = (data as Order[]).map((o) => ({ ...o }));
        setOrders(mapped);
        setTotalPages(1);
        setTotal(mapped.length);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, [page, search, filter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sub = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          if (type === 'entity_changed' && payload?.docType === 'order' && !cancelled) load();
        },
      });
      if (!cancelled) return sub;
    })();
    return () => { cancelled = true; };
  }, [load]);

  const handleReorderClick = (order: Order) => {
    setConfirmReorder({ open: true, order });
  };

  const handleReorderConfirm = async () => {
    if (!confirmReorder.order) return;
    const order = confirmReorder.order;
    setConfirmReorder({ open: false, order: null });
    setReorderingId(order.id);
    try {
      const result = await portalLifecycle.orders.reorder(order.id);
      addToast('success', `Reorder request ${result.id} created`);
      navigate(`/portal/requests/${result.id}`);
    } catch (err: any) {
      addToast('error', err.message || 'Failed to create reorder request');
    } finally {
      setReorderingId(null);
    }
  };

  const filtered = useMemo(() => (filter === 'All' ? orders : orders.filter((o) => o.status === filter)), [orders, filter]);
  const availableStatuses = useMemo(() => {
    const set = new Set(orders.map((o) => o.status));
    return ['All', ...Array.from(set).sort()];
  }, [orders]);

  if (loading && page === 1) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={8} /></div>;

  return (
    <div style={{ background: portalTheme.paper, borderRadius: 14, overflow: 'hidden' }}>
      <PortalPageHeader
        title="Orders"
        subtitle="View your order history"
        icon={ShoppingCart}
        action={{ label: 'New Order', onClick: () => navigate('/portal/new-request?type=order'), icon: Plus }}
      />

      <div style={{ padding: '20px 28px 8px' }}>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 240px' }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: portalTheme.inkSoft }} />
            <PortalInput label="" placeholder="Search orders..." value={search} onChange={(v) => { setPage(1); setSearch(v); }} onFocus={() => {}} onBlur={() => {}} style={{ paddingLeft: 32 }} />
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
            {availableStatuses.map((s) => <option key={s} value={s}>{s === 'All' ? 'All Statuses' : s}</option>)}
          </select>
        </div>
      </div>

      <div style={{ padding: '16px 28px 28px' }}>
        {filtered.length === 0 ? (
          <EmptyState icon={<ShoppingCart size={28} />} title="No orders found" description={filter === 'All' ? 'You have no orders yet.' : `No orders with status "${filter}".`} />
        ) : (
          <>
            <div style={{ fontSize: 11, color: portalTheme.inkSoft, marginBottom: 8 }}>
              Showing {orders.length} of {total} order{total !== 1 ? 's' : ''}
            </div>
            <div style={{ background: portalTheme.paper, borderRadius: 14, border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[13px] table-fixed">
                  <thead>
                    <tr style={{ background: portalTheme.teal[50] }}>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Order #</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Date</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: portalTheme.inkSoft }}>Total</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-center" style={{ color: portalTheme.inkSoft }}>Status</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: portalTheme.inkSoft }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100/50">
                    {filtered.map((order) => {
                      const statusMeta = ORDER_STATUS_META[order.status.toLowerCase()] || ORDER_STATUS_META.draft;
                      return (
                        <tr
                          key={order.id}
                          onClick={() => navigate(`/portal/orders/${order.id}`)}
                          className="transition-colors cursor-pointer group hover:bg-[#eef7f6]"
                        >
<td className="px-5 py-3 font-mono text-slate-500 font-bold truncate" data-label="Order #">#{order.orderNumber || order.id.slice(0, 8)}</td>
                           <td className="px-5 py-3 text-slate-500 whitespace-nowrap" data-label="Date">{order.orderDate ? new Date(order.orderDate).toLocaleDateString() : ''}</td>
                           <td className="px-5 py-3 text-right font-medium" data-label="Total">K {Number(order.totalAmount).toFixed(2)}</td>
                           <td className="px-5 py-3 text-center" data-label="Status">
                            <StatusBadge status={FRIENDLY_STATUS_MAP[order.status.toLowerCase()] || order.status} />
                          </td>
                          <td className="px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-center gap-1 items-center shrink-0">
                              <button className="p-2 text-[#5c6567] hover:text-blue-600 bg-slate-50 hover:bg-white border border-transparent hover:border-slate-200 rounded transition-all" title="View detail" aria-label="View order detail">
                                <Eye size={14} />
                              </button>
                              {order.status !== 'Draft' && order.status !== 'Cancelled' && (
                                <button
                                  onClick={() => handleReorderClick(order)}
                                  disabled={reorderingId === order.id}
                                  className="p-2 text-[#5c6567] hover:text-teal-600 bg-slate-50 hover:bg-white border border-transparent hover:border-teal-200 rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="Reorder"
                                  aria-label={`Reorder ${order.orderNumber || order.id}`}
                                >
                                  {reorderingId === order.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                                </button>
                              )}
                              <button className="p-2 text-[#5c6567] hover:text-slate-600 rounded" aria-label="More actions"><MoreVertical size={14} /></button>
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
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={{
                    padding: '6px 12px', borderRadius: 8, border: `1.4px solid ${portalTheme.hairline}`, background: portalTheme.paper, cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.5 : 1, fontSize: 12, color: portalTheme.ink
                  }}>Previous</button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{
                    padding: '6px 12px', borderRadius: 8, border: `1.4px solid ${portalTheme.hairline}`, background: portalTheme.paper, cursor: page >= totalPages ? 'not-allowed' : 'pointer', opacity: page >= totalPages ? 0.5 : 1, fontSize: 12, color: portalTheme.ink
                  }}>Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {confirmReorder.open && (
        <div className="confirm-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmReorder({ open: false, order: null }); }}>
          <div className="confirm-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="reorder-title">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid #e4ddd1' }}>
              <h2 id="reorder-title" style={{ fontSize: 16, fontWeight: 700, color: portalTheme.ink, margin: 0 }}>Confirm Reorder</h2>
              <button onClick={() => setConfirmReorder({ open: false, order: null })} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 8, color: portalTheme.inkSoft }} aria-label="Close dialog"><ArrowUpRight size={18} style={{ transform: 'rotate(45deg)' }} /></button>
            </div>
            <div style={{ padding: '18px 22px', fontSize: 14, color: portalTheme.inkSoft, lineHeight: 1.5 }}>
              Create a new order request based on order <strong>#{confirmReorder.order?.orderNumber || confirmReorder.order?.id.slice(0, 8)}</strong>? This will be reviewed by our team.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '14px 22px', borderTop: '1px solid #e4ddd1' }}>
              <button onClick={() => setConfirmReorder({ open: false, order: null })} style={{ padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid #e4ddd1', background: portalTheme.paper, color: portalTheme.inkSoft, fontSize: 13, fontWeight: 600 }}>Cancel</button>
              <button onClick={handleReorderConfirm} style={{ padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid transparent', background: 'linear-gradient(155deg, #1f8577, #0f544c)', color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: '0 6px 16px -6px rgba(15,84,76,.55)' }}>Create Reorder</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerOrders;

