import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { portalApi } from '../../services/portalApiClient';
import StatusBadge from './components/StatusBadge';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

interface OrderItem {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface OrderDetail {
  id: string;
  orderDate: string;
  customerName: string;
  totalAmount: number;
  status: string;
  items: OrderItem[];
}

const CustomerOrderDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    portalApi.get<OrderDetail>(`/orders/${id}`)
      .then(setOrder)
      .catch((err) => setError(err.message || 'Failed to load order'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-6 max-w-4xl mx-auto"><PortalLoadingSkeleton type="detail" /></div>;
  if (error) return <div className="p-6 max-w-4xl mx-auto"><div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 text-rose-300 text-sm">{error}</div></div>;
  if (!order) return null;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button onClick={() => navigate('/portal/orders')} className="inline-flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300 mb-6 transition-colors">
        <ArrowLeft size={14} /> Back to Orders
      </button>

      <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-100">Order #{order.id.slice(0, 8)}</h1>
            <p className="text-sm text-slate-400 mt-1">{new Date(order.orderDate).toLocaleDateString()}</p>
          </div>
          <StatusBadge status={order.status} />
        </div>
        <div className="text-sm text-slate-300">
          <span className="text-slate-400">Customer:</span> {order.customerName}
        </div>
      </div>

      <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-700/60">
          <h2 className="text-sm font-semibold text-slate-200">Order Items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 uppercase tracking-wider bg-slate-800/80">
                <th className="px-5 py-3 font-medium">Item</th>
                <th className="px-5 py-3 font-medium text-right">Qty</th>
                <th className="px-5 py-3 font-medium text-right">Unit Price</th>
                <th className="px-5 py-3 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/60">
              {(order.items || []).map((item, i) => (
                <tr key={i} className="text-slate-300">
                  <td className="px-5 py-3">{item.name}</td>
                  <td className="px-5 py-3 text-right">{item.quantity}</td>
                  <td className="px-5 py-3 text-right font-mono">K {Number(item.unitPrice).toFixed(2)}</td>
                  <td className="px-5 py-3 text-right font-mono">K {Number(item.lineTotal).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-4 border-t border-slate-700/60 flex justify-between items-center">
          <span className="text-sm font-semibold text-slate-200">Total</span>
          <span className="text-lg font-bold text-slate-100">K {Number(order.totalAmount).toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
};

export default CustomerOrderDetail;
