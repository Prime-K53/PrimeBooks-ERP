import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, Eye, Plus } from 'lucide-react';
import { api } from '../../services/api';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import StatusBadge from './components/StatusBadge';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

interface Order {
  id: string;
  orderDate: string;
  customerName: string;
  totalAmount: number;
  status: string;
}

const statuses = ['All', 'Pending', 'Fulfilled', 'Shipped', 'Cancelled', 'Draft'];

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
        const all = await api.sales.getSalesOrders();
        if (cancelled) return;
        const customerId = user?.customer_id;
        const mine = customerId
          ? (all || []).filter((o: any) => String(o.customerId || '') === String(customerId))
          : (all || []);
        setOrders(mine as Order[]);
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

  const filtered = filter === 'All' ? orders : orders.filter((o) => o.status === filter);

  if (loading) return <div className="p-6 max-w-7xl mx-auto"><PortalLoadingSkeleton type="table" count={8} /></div>;
  if (error) return <div className="p-6 max-w-7xl mx-auto"><div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 text-rose-300 text-sm">{error}</div></div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Orders</h1>
          <p className="text-sm text-slate-400 mt-1">View your order history</p>
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
                : 'bg-slate-800/60 text-slate-400 border border-slate-700/60 hover:bg-slate-700/60'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<ShoppingCart size={28} />} title="No orders found" description={filter === 'All' ? 'You have no orders yet.' : `No orders with status "${filter}".`} />
      ) : (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wider bg-slate-800/80">
                  <th className="px-5 py-3 font-medium">Order #</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium text-right">Total</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {filtered.map((order) => (
                  <tr
                    key={order.id}
                    onClick={() => navigate(`/portal/orders/${order.id}`)}
                    className="text-slate-300 hover:bg-slate-700/30 transition-colors cursor-pointer"
                  >
                    <td className="px-5 py-3 font-medium text-slate-100">#{order.id.slice(0, 8)}</td>
                    <td className="px-5 py-3 text-slate-400 whitespace-nowrap">{new Date(order.orderDate).toLocaleDateString()}</td>
                    <td className="px-5 py-3 text-right font-mono">K {Number(order.totalAmount).toFixed(2)}</td>
                    <td className="px-5 py-3"><StatusBadge status={order.status} /></td>
                    <td className="px-5 py-3 text-right">
                      <button className="p-1.5 rounded-lg hover:bg-slate-700/60 text-slate-400 hover:text-slate-200 transition-colors">
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerOrders;
