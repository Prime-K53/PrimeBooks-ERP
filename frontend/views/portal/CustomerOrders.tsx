import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, Eye, Plus, RotateCcw, Loader2, Search, Truck, Calendar, Package } from 'lucide-react';
import { portalLifecycle } from '../../services/portalApiClient';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { useToast } from './components/Toast';
import PortalPageHeader from './components/PortalPageHeader';
import PortalButton from './components/PortalButton';
import PortalInput from './components/PortalInput';
import ErrorBanner from './components/ErrorBanner';
import EmptyState from './components/EmptyState';
import StatusBadge from './components/StatusBadge';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { portalTheme, ORDER_STATUS_META, DEFAULT_PAGE_SIZE, FRIENDLY_STATUS_MAP, formatK } from './constants';

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
    let unsubscribe: (() => void) | undefined;
    (async () => {
      unsubscribe = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          if (type === 'entity_changed' && payload?.docType === 'order' && !cancelled) load();
        },
      });
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [load]);

  const handleReorderClick = (order: Order) => {
    setConfirmReorder({ open: true, order });
  };

  const handleReorderConfirm = async () => {
    if (!confirmReorder.order) return;
    const order = confirmReorder.order;
    setConfirmReorder({ open: false, order: null });
    const orderNumber = order.orderNumber || order.id.slice(0, 8);
    navigate(`/portal/new-request?type=order&ref=${encodeURIComponent(orderNumber)}&order_id=${encodeURIComponent(order.id)}`);
  };

  const filtered = useMemo(() => (filter === 'All' ? orders : orders.filter((o) => o.status === filter)), [orders, filter]);
  const availableStatuses = useMemo(() => {
    const set = new Set(orders.map((o) => o.status));
    return ['All', ...Array.from(set).sort()];
  }, [orders]);

  const totalValue = useMemo(() => filtered.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0), [filtered]);

  if (loading && page === 1) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={8} /></div>;

  return (
    <div>
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '0 2px' }}>
              <div style={{ fontSize: 12, color: portalTheme.inkSoft, fontWeight: 400, lineHeight: 1.4 }}>
                Showing {orders.length} of {total} order{total !== 1 ? 's' : ''}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {filter !== 'All' && (
                  <span style={{ fontSize: 11, fontWeight: 500, color: portalTheme.teal[700], background: portalTheme.teal[50], border: `1px solid ${portalTheme.teal[100]}`, padding: '3px 10px', borderRadius: 99, lineHeight: 1.4 }}>
                    {filter}
                  </span>
                )}
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 600, color: portalTheme.inkSoft, lineHeight: 1.4 }}>
                  {formatK(totalValue)} total
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtered.map((order) => {
                const statusMeta = ORDER_STATUS_META[order.status.toLowerCase()] || ORDER_STATUS_META.draft;
                const orderNumber = order.orderNumber || order.id.slice(0, 8);
                const date = order.orderDate ? new Date(order.orderDate) : null;
                const total = formatK(order.totalAmount);
                return (
                  <div
                    key={order.id}
                    onClick={() => navigate(`/portal/orders/${order.id}`)}
                    style={{
                      position: 'relative', background: portalTheme.paper, borderRadius: 14,
                      border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                      overflow: 'hidden', cursor: 'pointer', transition: 'all .15s ease',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = portalTheme.teal[200]; e.currentTarget.style.boxShadow = '0 8px 24px -8px rgba(15,84,76,.3)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = portalTheme.hairline; e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'; }}
                  >
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${portalTheme.teal[500]}, ${portalTheme.teal[300]} 50%, ${portalTheme.amber[300]} 100%)` }} />

                    <div style={{ display: 'flex', alignItems: 'stretch' }}>
                      <div style={{ width: 52, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `linear-gradient(180deg, ${portalTheme.teal[50]}, #f8fbfa)`, borderRight: `1px solid ${portalTheme.teal[100]}` }}>
                        <div style={{ width: 32, height: 32, borderRadius: 9, background: portalTheme.teal[50], border: `1px solid ${portalTheme.teal[200]}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Package size={15} color={portalTheme.teal[600]} />
                        </div>
                      </div>

                      <div style={{ flex: 1, minWidth: 0, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 13.5, color: portalTheme.ink, lineHeight: 1.4 }}>
                                #{orderNumber}
                              </span>
                              <StatusBadge status={FRIENDLY_STATUS_MAP[order.status.toLowerCase()] || order.status} />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, fontWeight: 400, color: portalTheme.inkSoft, lineHeight: 1.4 }}>
                              {date && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <Calendar size={11} />
                                  {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                </span>
                              )}
                            </div>
                          </div>

                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 500, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2, lineHeight: 1.4 }}>Total</div>
                            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 14.4, color: portalTheme.ink, lineHeight: 1.4 }}>
                              {total}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, padding: '8px 14px', borderTop: `1px solid ${portalTheme.hairline}`, background: '#fafbfa' }} onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => navigate(`/portal/orders/${order.id}`)}
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium rounded-md transition-all"
                        style={{ color: portalTheme.teal[700], background: portalTheme.teal[50], border: `1px solid ${portalTheme.teal[100]}`, padding: '6px 12px', lineHeight: 1.4, fontWeight: 500 }}
                        onMouseEnter={e => { e.currentTarget.style.background = portalTheme.teal[100]; }}
                        onMouseLeave={e => { e.currentTarget.style.background = portalTheme.teal[50]; }}
                        aria-label="View order detail"
                      >
                        <Eye size={12} /> View
                      </button>
                      {(order as any).tracking_number && (
                        <button
                          onClick={() => navigate(`/portal/shipments/${order.id}`)}
                          className="inline-flex items-center gap-1.5 text-[12px] font-medium rounded-md transition-all"
                          style={{ color: portalTheme.inkSoft, background: portalTheme.paper, border: `1px solid ${portalTheme.hairline}`, padding: '6px 12px', lineHeight: 1.4, fontWeight: 500 }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = portalTheme.teal[200]; e.currentTarget.style.color = portalTheme.teal[700]; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = portalTheme.hairline; e.currentTarget.style.color = portalTheme.inkSoft; }}
                          aria-label={`Track shipment for order ${order.orderNumber || order.id}`}
                        >
                          <Truck size={12} /> Track
                        </button>
                      )}
                       {order.status !== 'Draft' && order.status !== 'Cancelled' && (
                         <button
                           onClick={() => handleReorderClick(order)}
                           className="inline-flex items-center gap-1.5 text-[12px] font-medium rounded-md transition-all"
                           style={{ color: portalTheme.inkSoft, background: portalTheme.paper, border: `1px solid ${portalTheme.hairline}`, padding: '6px 12px', lineHeight: 1.4, fontWeight: 500 }}
                           onMouseEnter={e => { e.currentTarget.style.borderColor = portalTheme.amber[300]; e.currentTarget.style.color = portalTheme.amber[600]; }}
                           onMouseLeave={e => { e.currentTarget.style.borderColor = portalTheme.hairline; e.currentTarget.style.color = portalTheme.inkSoft; }}
                           aria-label={`Reorder ${order.orderNumber || order.id}`}
                         >
                           <RotateCcw size={12} />
                           Reorder
                         </button>
                       )}
                    </div>
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, fontSize: 12, color: portalTheme.inkSoft, fontWeight: 400, lineHeight: 1.4 }}>
                <span>Page {page} of {totalPages}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={{
                    padding: '6px 12px', borderRadius: 8, border: `1.4px solid ${portalTheme.hairline}`, background: portalTheme.paper, cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.5 : 1, fontSize: 12, color: portalTheme.ink, fontWeight: 500, lineHeight: 1.4
                  }}>Previous</button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{
                    padding: '6px 12px', borderRadius: 8, border: `1.4px solid ${portalTheme.hairline}`, background: portalTheme.paper, cursor: page >= totalPages ? 'not-allowed' : 'pointer', opacity: page >= totalPages ? 0.5 : 1, fontSize: 12, color: portalTheme.ink, fontWeight: 500, lineHeight: 1.4
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
              <button onClick={() => setConfirmReorder({ open: false, order: null })} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 8, color: portalTheme.inkSoft }} aria-label="Close dialog">
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 7, border: `1.4px solid ${portalTheme.hairline}` }}>+</span>
              </button>
            </div>
            <div style={{ padding: '18px 22px', fontSize: 14, color: portalTheme.inkSoft, lineHeight: 1.5 }}>
              Create a new order request based on order <strong style={{ color: portalTheme.ink, fontFamily: "'JetBrains Mono', monospace" }}>#{confirmReorder.order?.orderNumber || confirmReorder.order?.id.slice(0, 8)}</strong>? This will be reviewed by our team.
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
