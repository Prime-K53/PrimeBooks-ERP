import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, MessageSquare, CheckCircle2, ShoppingCart, RotateCcw } from 'lucide-react';
import { createElement } from 'react';
import { pdf } from '@react-pdf/renderer';
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
import ConfirmDialog from './components/ConfirmDialog';
import ErrorBanner from './components/ErrorBanner';
import PortalButton from './components/PortalButton';

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
  const [confirmReorder, setConfirmReorder] = useState<{ open: boolean; order: OrderDetail | null }>({ open: false, order: null });

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const o = await portalApi.get<any>(`/orders/${id}`);
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
    let cancelled = false;
    (async () => {
      const sub = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          if (type === 'entity_changed' && payload.docType === 'order' && payload.docId === id && !cancelled) load();
        },
      });
      if (!cancelled) return sub;
    })();
    return () => { cancelled = true; };
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

  const handleReorderRequest = () => {
    if (!order) return;
    setConfirmReorder({ open: true, order });
  };

  const handleReorderConfirm = async () => {
    if (!order) return;
    setConfirmReorder({ open: false, order: null });
    setLoading(true);
    try {
      const result = await portalLifecycle.orders.reorder(order.id);
      navigate(`/portal/requests/${result.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create reorder request');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="p-6 max-w-4xl mx-auto"><PortalLoadingSkeleton type="detail" /></div>;
  if (error) return <div className="p-6 max-w-4xl mx-auto"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>;
  if (!order) return null;

  const currentStage = stageIndex(order.status);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PortalButton variant="ghost" onClick={() => navigate('/portal/orders')} icon={ArrowLeft}>Back to Orders</PortalButton>

      <DocumentChain docType="order" docId={order.id} />

      {downloadError && <ErrorBanner message={downloadError} onDismiss={() => setDownloadError(null)} />}

      <ConfirmDialog
        open={confirmReorder.open}
        title="Reorder"
        message={`Create a new order request based on order ${order.orderNumber || order.id.slice(0, 8)}? This will be reviewed by our team.`}
        confirmLabel="Create Reorder"
        cancelLabel="Cancel"
        onConfirm={handleReorderConfirm}
        onCancel={() => setConfirmReorder({ open: false, order: null })}
      />

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
              <PortalButton variant="secondary" onClick={handleReorderRequest} icon={RotateCcw}>Reorder</PortalButton>
            )}
            <PortalButton variant="secondary" onClick={handleDownloadPdf} icon={Download} loading={downloading}>{downloading ? 'Generating...' : 'PDF'}</PortalButton>
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
<td className="px-5 py-3 font-medium text-slate-900" data-label="Item">{item.name}</td>
                   <td className="px-5 py-3 text-right" data-label="Qty">{item.quantity}</td>
                   <td className="px-5 py-3 text-right font-mono" data-label="Unit Price">K {Number(item.unitPrice).toFixed(2)}</td>
                   <td className="px-5 py-3 text-right font-mono" data-label="Total">K {Number(item.lineTotal).toFixed(2)}</td>
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
