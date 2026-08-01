import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Loader2, MessageSquare, CheckCircle2, ShoppingCart, RotateCcw } from 'lucide-react';
import { createElement } from 'react';
import { pdf } from '@react-pdf/renderer';
import { api } from '../../services/api';
import { portalApi, portalLifecycle, TimelineEvent } from '../../services/portalApiClient';
import { mapToInvoiceData } from '../../utils/pdfMapper';
import { attachDocumentSecurity } from '../../utils/documentSecurity';
import { initializePrimePdfFonts } from '../shared/components/PDF/templateSettings';
import { PrimeDocument } from '../shared/components/PDF/PrimeDocument';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from './components/StatusBadge';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import DocumentChain from './components/DocumentChain';
import DocumentDiscussion from './components/DocumentDiscussion';

interface OrderItem {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface OrderDetail {
  id: string;
  orderNumber?: string;
  order_date?: string;
  orderDate: string;
  customerName: string;
  totalAmount: number;
  status: string;
  items: OrderItem[];
  notes?: string;
  quotation_id?: string | null;
}

const stageDefinitions = [
  { key: 'quotation_accepted', label: 'Accepted', description: 'Quotation accepted' },
  { key: 'confirmed', label: 'Confirmed', description: 'Order confirmed by our team' },
  { key: 'processing', label: 'Processing', description: 'Order being prepared' },
  { key: 'delivered', label: 'Delivered', description: 'Order delivered' },
];

function stageIndex(status: string): number {
  const normalized = status.toLowerCase().replace(/\s+/g, '');
  if (normalized === 'delivered' || normalized === 'fulfilled' || normalized === 'complete') return 4;
  if (normalized === 'processing' || normalized === 'inprogress' || normalized === 'in_progress') return 3;
  if (normalized === 'confirmed') return 2;
  return 1;
}

const CustomerOrderDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { companyConfig } = useAuth();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      let o: any = null;
      try {
        o = await portalApi.get<any>(`/orders/${id}`);
      } catch {
        o = null;
      }
      if (o) {
        setOrder({
          id: o.id,
          orderNumber: o.order_number || o.orderNumber,
          orderDate: o.orderDate || o.order_date || o.created_at || '',
          customerName: o.customerName || o.customer_name || '',
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
          quotation_id: o.quotation_id || null,
        });
        const events = await portalLifecycle.timeline.get('order', id);
        setTimeline(events || []);
      } else {
        const legacy = (await api.sales.getSalesOrderById(id)) as any;
        if (!legacy) throw new Error('Order not found');
        setOrder({
          id: legacy.id,
          orderNumber: legacy.order_number || legacy.id,
          orderDate: legacy.orderDate || legacy.created_at || '',
          customerName: legacy.customerName || '',
          totalAmount: Number(legacy.total ?? legacy.subtotal ?? 0),
          status: legacy.status || 'Draft',
          items: (legacy.items || []).map((item: any) => {
            const quantity = Number(item.quantity ?? 1);
            const unitPrice = Number(item.unitPrice ?? item.price ?? 0);
            return {
              name: item.description || item.name || item.productName || 'Item',
              quantity,
              unitPrice,
              lineTotal: Number(item.lineTotal ?? (quantity * unitPrice)),
            };
          }),
          notes: legacy.notes || '',
        });
      }
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load order');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!id) return;
    const unsubscribe = portalLifecycle.subscribe({
      onEvent: (type, payload) => {
        if (type === 'entity_changed' && payload.docType === 'order' && payload.docId === id) load();
      },
    });
    return unsubscribe;
  }, [id, load]);

  const handleDownloadPdf = async () => {
    if (!order) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await portalLifecycle.downloads.record('order', order.id);
      const mapped = mapToInvoiceData(
        {
          ...order,
          items: order.items.map((i) => ({ desc: i.name, qty: i.quantity, price: i.unitPrice, total: i.lineTotal })),
          customerName: order.customerName,
          subtotal: order.totalAmount,
          orderDate: order.orderDate,
          status: order.status,
        },
        companyConfig,
        'ORDER'
      ) as any;
      const secured = await attachDocumentSecurity(mapped, companyConfig?.companyName);
      await initializePrimePdfFonts();
      const blob = await pdf(createElement(PrimeDocument as any, { type: 'ORDER', data: secured }) as any).toBlob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${order.orderNumber || order.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch (err: any) {
      setDownloadError(err.message || 'Failed to generate PDF');
    } finally {
      setDownloading(false);
    }
  };

  const handleReorder = async () => {
    if (!order) return;
    if (!window.confirm(`Create a new order request based on order ${order.orderNumber || order.id.slice(0, 8)}? This will be reviewed by our team.`)) return;
    setReordering(true);
    setReorderError(null);
    try {
      const result = await portalLifecycle.orders.reorder(order.id);
      navigate(`/portal/requests/${result.id}`);
    } catch (err: any) {
      setReorderError(err.message || 'Failed to create reorder request');
    } finally {
      setReordering(false);
    }
  };

  if (loading) return <div className="p-6 max-w-4xl mx-auto"><PortalLoadingSkeleton type="detail" /></div>;
  if (error) return <div className="p-6 max-w-4xl mx-auto"><div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 text-sm">{error}</div></div>;
  if (!order) return null;

  const currentStage = stageIndex(order.status);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button onClick={() => navigate('/portal/orders')} className="inline-flex items-center gap-1 text-sm text-emerald-600 hover:text-emerald-600 mb-6 transition-colors">
        <ArrowLeft size={14} /> Back to Orders
      </button>

      <DocumentChain docType="order" docId={order.id} />

      {downloadError && (
        <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-600">{downloadError}</div>
      )}
      {reorderError && (
        <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-600">{reorderError}</div>
      )}

      <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Order #{order.orderNumber || order.id.slice(0, 8)}</h1>
            <p className="text-sm text-slate-500 mt-1">
              {order.orderDate ? new Date(order.orderDate).toLocaleDateString() : ''}
              {order.notes ? ` • ${order.notes}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={order.status} />
            {order.status !== 'Draft' && order.status !== 'Cancelled' && (
              <button
                onClick={handleReorder}
                disabled={reordering}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-50 hover:bg-teal-100 disabled:opacity-50 disabled:cursor-not-allowed text-teal-700 text-xs font-semibold rounded-lg transition-colors"
              >
                {reordering ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} {reordering ? 'Creating...' : 'Reorder'}
              </button>
            )}
            <button
              onClick={handleDownloadPdf}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-xs font-semibold rounded-lg transition-colors"
            >
              {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} {downloading ? 'Generating...' : 'PDF'}
            </button>
          </div>
        </div>

        {/* Order lifecycle tracker */}
        <div className="flex items-center gap-2 mb-6">
          {stageDefinitions.map((stage, i) => {
            const done = currentStage > i + 1;
            const active = currentStage === i + 1;
            const isLast = i === stageDefinitions.length - 1;
            return (
              <React.Fragment key={stage.key}>
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      done ? 'bg-emerald-500 text-white' : active ? 'bg-amber-400 text-white' : 'bg-slate-200 text-slate-400'
                    }`}
                  >
                    {done ? <CheckCircle2 size={15} /> : active ? <ShoppingCart size={14} /> : <span className="text-xs font-bold">{i + 1}</span>}
                  </div>
                  <span className={`mt-1.5 text-[10px] font-semibold text-center ${done || active ? 'text-slate-800' : 'text-slate-400'}`}>
                    {stage.label}
                  </span>
                  <span className="text-[9px] text-slate-400 text-center hidden sm:block">{stage.description}</span>
                </div>
                {!isLast && <div className={`h-0.5 flex-1 -mt-5 ${done ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
              </React.Fragment>
            );
          })}
        </div>

        <div className="text-sm text-slate-700">
          <span className="text-slate-500">Customer:</span> {order.customerName}
        </div>
      </div>

      <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200/60">
          <h2 className="text-sm font-semibold text-slate-800">Order Items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px] table-fixed">
            <thead className="bg-slate-50/80 backdrop-blur text-slate-500 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left">Item</th>
                <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right">Qty</th>
                <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right">Unit Price</th>
                <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/50">
              {(order.items || []).map((item, i) => (
                <tr key={i} className="text-slate-700">
                  <td className="px-5 py-3 font-medium text-slate-900">{item.name}</td>
                  <td className="px-5 py-3 text-right">{item.quantity}</td>
                  <td className="px-5 py-3 text-right font-mono">K {Number(item.unitPrice).toFixed(2)}</td>
                  <td className="px-5 py-3 text-right font-mono">K {Number(item.lineTotal).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-4 border-t border-slate-200/60 flex justify-between items-center">
          <span className="text-sm font-semibold text-slate-700">Total</span>
          <span className="text-lg font-bold text-slate-900">K {Number(order.totalAmount).toFixed(2)}</span>
        </div>
      </div>
      {order.notes && (
        <div className="mt-4 bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Notes</p>
          <p className="text-sm text-slate-700">{order.notes}</p>
        </div>
      )}

      {/* Timeline */}
      <div className="mt-4 bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 p-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <MessageSquare size={15} className="text-slate-400" /> Activity Timeline
        </h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-slate-400">No activity yet.</p>
        ) : (
          <div className="space-y-4">
            {timeline.map((event) => (
              <div key={event.id} className="flex gap-3">
                <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{event.title}</p>
                  {event.description && <p className="text-xs text-slate-500">{event.description}</p>}
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {new Date(event.created_at).toLocaleString()} • {event.actor_name || 'System'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <DocumentDiscussion docType="order" docId={order.id} />
      </div>
    </div>
  );
};

export default CustomerOrderDetail;
