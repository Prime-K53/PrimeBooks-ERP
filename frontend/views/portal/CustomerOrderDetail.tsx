import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../services/api';
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
  notes?: string;
}

const CustomerOrderDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.sales.getSalesOrderById(id)
      .then((o: any) => {
        if (!o) throw new Error('Order not found');
        setOrder({
          id: o.id,
          orderDate: o.orderDate || o.created_at || '',
          customerName: o.customerName || '',
          totalAmount: Number(o.total ?? o.subtotal ?? 0),
          status: o.status || 'Draft',
          items: (o.items || []).map((item: any) => {
            const quantity = Number(item.quantity ?? 1);
            const unitPrice = Number(item.unitPrice ?? item.price ?? 0);
            return {
              name: item.description || item.name || item.productName || 'Item',
              quantity,
              unitPrice,
              lineTotal: Number(item.lineTotal ?? (quantity * unitPrice)),
            };
          }),
          notes: o.notes || '',
        });
      })
      .catch((err) => setError(err.message || 'Failed to load order'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-6 max-w-4xl mx-auto"><PortalLoadingSkeleton type="detail" /></div>;
  if (error) return <div className="p-6 max-w-4xl mx-auto"><div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 text-sm">{error}</div></div>;
  if (!order) return null;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button onClick={() => navigate('/portal/orders')} className="inline-flex items-center gap-1 text-sm text-emerald-600 hover:text-emerald-600 mb-6 transition-colors">
        <ArrowLeft size={14} /> Back to Orders
      </button>

      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Order #{order.id.slice(0, 8)}</h1>
            <p className="text-sm text-slate-500 mt-1">{new Date(order.orderDate).toLocaleDateString()}</p>
          </div>
          <StatusBadge status={order.status} />
        </div>
        <div className="text-sm text-slate-700">
          <span className="text-slate-500">Customer:</span> {order.customerName}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-800">Order Items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 uppercase tracking-wider bg-white">
                <th className="px-5 py-3 font-medium">Item</th>
                <th className="px-5 py-3 font-medium text-right">Qty</th>
                <th className="px-5 py-3 font-medium text-right">Unit Price</th>
                <th className="px-5 py-3 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {(order.items || []).map((item, i) => (
                <tr key={i} className="text-slate-700">
                  <td className="px-5 py-3">{item.name}</td>
                  <td className="px-5 py-3 text-right">{item.quantity}</td>
                  <td className="px-5 py-3 text-right font-mono">K {Number(item.unitPrice).toFixed(2)}</td>
                  <td className="px-5 py-3 text-right font-mono">K {Number(item.lineTotal).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-4 border-t border-slate-200 flex justify-between items-center">
          <span className="text-sm font-semibold text-slate-700">Total</span>
          <span className="text-lg font-bold text-slate-900">K {Number(order.totalAmount).toFixed(2)}</span>
        </div>
      </div>
      {order.notes && (
        <div className="mt-4 bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Notes</p>
          <p className="text-sm text-slate-700">{order.notes}</p>
        </div>
      )}
    </div>
  );
};

export default CustomerOrderDetail;
