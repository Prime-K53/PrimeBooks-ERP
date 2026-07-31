import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, Eye, Plus, MoreVertical } from 'lucide-react';
import { api } from '../../services/api';
import { portalApi } from '../../services/portalApiClient';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

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

  if (loading) return <div className="p-6 max-w-7xl mx-auto"><PortalLoadingSkeleton type="table" count={8} /></div>;
  if (error) return <div className="p-6 max-w-7xl mx-auto"><div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 text-sm">{error}</div></div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Orders</h1>
          <p className="text-sm text-slate-500 mt-1">View your order history</p>
        </div>
        <button
          onClick={() => navigate('/portal/new-request?type=order')}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-green-500 hover:from-emerald-500 hover:to-green-400 text-white text-sm font-semibold rounded-xl shadow-lg shadow-emerald-600/25 transition-all"
        >
          <Plus size={16} /> New Order
        </button>
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
        <EmptyState icon={<ShoppingCart size={28} />} title="No orders found" description={filter === 'All' ? 'You have no orders yet.' : `No orders with status "${filter}".`} />
      ) : (
        <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px] table-fixed">
              <thead className="bg-slate-50/80 backdrop-blur text-slate-500 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left">Order #</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left">Date</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right">Total</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-center">Status</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/50">
                {filtered.map((order) => {
                  const isCancelled = order.status === 'Cancelled' || order.status === 'Draft';
                  const statusColorMap: Record<string, string> = {
                    'Confirmed': 'bg-emerald-100 text-emerald-700 border-emerald-200',
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
                      className="transition-colors cursor-pointer group hover:bg-blue-50/50 border-l-4 border-l-transparent"
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

export default CustomerOrders;

