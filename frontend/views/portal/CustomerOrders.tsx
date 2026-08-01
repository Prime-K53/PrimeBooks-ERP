import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, Eye, Plus, MoreVertical, RotateCcw, Loader2 } from 'lucide-react';
import { api } from '../../services/api';
import { portalApi, portalLifecycle } from '../../services/portalApiClient';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
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

interface Order {
  id: string;
  orderNumber?: string;
  orderDate: string;
  customerName: string;
  totalAmount: number;
  status: string;
}

const statuses = ['All', 'Confirmed', 'Processing', 'Pending', 'Delivered', 'Fulfilled', 'Shipped', 'Cancelled', 'Draft'];

const CustomerOrders: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useCustomerAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('All');
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleReorder = async (order: Order) => {
    setActionError(null);
    if (!window.confirm(`Create a new order request based on order ${order.orderNumber || order.id.slice(0, 8)}? This will be reviewed by our team.`)) return;
    setReorderingId(order.id);
    try {
      const result = await portalLifecycle.orders.reorder(order.id);
      navigate(`/portal/requests/${result.id}`);
    } catch (err: any) {
      setActionError(err.message || 'Failed to create reorder request');
    } finally {
      setReorderingId(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const customerId = user?.customer_id;
        const lifecycle = await portalApi.get<any[]>('/orders').catch(() => []);
        const lifecycleMapped: Order[] = (lifecycle || []).map((o) => ({
          id: o.id,
          orderNumber: o.order_number || o.orderNumber,
          orderDate: o.orderDate || o.order_date || o.created_at || '',
          customerName: o.customerName || o.customer_name || '',
          totalAmount: Number(o.totalAmount ?? o.total ?? o.subtotal ?? 0),
          status: o.status || 'Draft',
        }));

        const all = await api.sales.getSalesOrders().catch(() => []);
        const mine = customerId
          ? (all || []).filter((o: any) => String(o.customerId || '') === String(customerId))
          : (all || []);
        const legacyMapped: Order[] = (mine || []).map((o: any) => ({
          id: o.id,
          orderDate: o.orderDate || o.created_at || '',
          customerName: o.customerName || '',
          totalAmount: Number(o.total ?? o.subtotal ?? 0),
          status: o.status || 'Draft',
        }));

        const seen = new Set<string>();
        const merged: Order[] = [];
        for (const o of [...lifecycleMapped, ...legacyMapped]) {
          if (seen.has(o.id)) continue;
          seen.add(o.id);
          merged.push(o);
        }
        if (!cancelled) setOrders(merged);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to load orders');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const filtered = useMemo(() => (filter === 'All' ? orders : orders.filter((o) => o.status === filter)), [orders, filter]);

  if (loading) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={8} /></div>;
  if (error) return <div className="p-8 max-w-4xl mx-auto"><div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 text-sm">{error}</div></div>;

  return (
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
            <ShoppingCart size={19} color="#fff" />
          </div>
          <div>
            <h1 style={{
              fontFamily: "'DM Serif Display', 'Georgia', serif", fontWeight: 400,
              fontSize: 22, margin: 0, color: teal[800], letterSpacing: 0.2
            }}>
              Orders
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 11.5, color: inkSoft, letterSpacing: 0.02 }}>
              View your order history
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate('/portal/new-request?type=order')}
          style={{
            fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
            padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid transparent',
            background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
            color: '#fff', display: 'flex', alignItems: 'center', gap: 7,
            boxShadow: '0 6px 16px -6px rgba(15,84,76,.55)',
            transition: 'all .15s ease'
          }}
        >
          <Plus size={14} /> New Order
        </button>
      </div>

      <div style={{ padding: '24px 30px 8px' }}>
        {error && (
          <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-600">{error}</div>
        )}
        {actionError && (
          <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-600">{actionError}</div>
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
          <EmptyState icon={<ShoppingCart size={28} />} title="No orders found" description={filter === 'All' ? 'You have no orders yet.' : `No orders with status "${filter}".`} />
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
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: inkSoft }}>Order #</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: inkSoft }}>Date</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: inkSoft }}>Total</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-center" style={{ color: inkSoft }}>Status</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: inkSoft }}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100/50">
                  {filtered.map((order) => {
                    const statusColorMap: Record<string, string> = {
                      'Confirmed': 'bg-teal-100 text-teal-700 border-teal-200',
                      'Processing': 'bg-amber-100 text-amber-700 border-amber-200',
                      'Pending': 'bg-slate-100 text-[#5c6567] border-slate-200',
                      'Delivered': 'bg-blue-100 text-blue-700 border-blue-200',
                      'Fulfilled': 'bg-teal-100 text-teal-700 border-teal-200',
                      'Shipped': 'bg-violet-100 text-violet-700 border-violet-200',
                      'Cancelled': 'bg-rose-100 text-rose-700 border-rose-200',
                      'Draft': 'bg-slate-100 text-[#5c6567] border-slate-200',
                    };
                    const statusClass = statusColorMap[order.status] || 'bg-slate-100 text-[#5c6567] border-slate-200';
                    return (
                      <tr
                        key={order.id}
                        onClick={() => navigate(`/portal/orders/${order.id}`)}
                        className="transition-colors cursor-pointer group hover:bg-[#eef7f6]"
                      >
                        <td className="px-5 py-3 font-mono text-slate-500 font-bold truncate">#{order.orderNumber || order.id.slice(0, 8)}</td>
                        <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{order.orderDate ? new Date(order.orderDate).toLocaleDateString() : ''}</td>
                        <td className="px-5 py-3 text-right font-medium">K {Number(order.totalAmount).toFixed(2)}</td>
                        <td className="px-5 py-3 text-center">
                          <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${statusClass}`}>{order.status}</span>
                        </td>
                        <td className="px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-center gap-1 items-center shrink-0">
                            <button className="p-1.5 text-[#5c6567] hover:text-blue-600 bg-slate-50 hover:bg-white border border-transparent hover:border-slate-200 rounded transition-all" title="View detail">
                              <Eye size={14} />
                            </button>
                            {order.status !== 'Draft' && order.status !== 'Cancelled' && (
                              <button
                                onClick={() => handleReorder(order)}
                                disabled={reorderingId === order.id}
                                className="p-1.5 text-[#5c6567] hover:text-teal-600 bg-slate-50 hover:bg-white border border-transparent hover:border-teal-200 rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Reorder (create a new order request)"
                              >
                                {reorderingId === order.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
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
  );
};

export default CustomerOrders;

