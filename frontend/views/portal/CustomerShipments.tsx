import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Search, Loader2, Truck } from 'lucide-react';
import { portalLifecycle, PortalShipmentRecord } from '../../services/portalApiClient';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { useToast } from './components/Toast';
import PortalPageHeader from './components/PortalPageHeader';
import PortalInput from './components/PortalInput';
import ErrorBanner from './components/ErrorBanner';
import EmptyState from './components/EmptyState';
import StatusBadge from './components/StatusBadge';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { portalTheme, SHIPMENT_STATUS_META, DEFAULT_PAGE_SIZE } from './constants';

const CustomerShipments: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useCustomerAuth();
  const { addToast } = useToast();
  const [shipments, setShipments] = useState<PortalShipmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = { search: search || undefined };
      if (statusFilter !== 'All') params.status = statusFilter;
      const data = await portalLifecycle.shipments.list();
      let filtered = data;
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter((s) =>
          (s.order_number || '').toLowerCase().includes(q) ||
          (s.tracking_number || '').toLowerCase().includes(q) ||
          (s.customerName || '').toLowerCase().includes(q)
        );
      }
      if (statusFilter !== 'All') {
        filtered = filtered.filter((s) => s.status === statusFilter);
      }
      setShipments(filtered);
    } catch (err: any) {
      setError(err.message || 'Failed to load shipments');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

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

  const availableStatuses = useMemo(() => {
    const set = new Set(shipments.map((s) => s.status));
    return ['All', ...Array.from(set).sort()];
  }, [shipments]);

  if (loading) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={6} /></div>;

  return (
    <div>
      <PortalPageHeader
        title="Shipments & Tracking"
        subtitle="Track your orders in transit"
        icon={Truck}
      />

      <div style={{ padding: '20px 28px 8px' }}>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 240px' }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: portalTheme.inkSoft }} />
            <PortalInput label="" placeholder="Search by order #, tracking #..." value={search} onChange={(v) => setSearch(v)} onFocus={() => {}} onBlur={() => {}} style={{ paddingLeft: 32 }} />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
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
        {shipments.length === 0 ? (
          <EmptyState icon={<Truck size={28} />} title="No shipments yet" description={search || statusFilter !== 'All' ? 'No shipments match your filters.' : 'When your orders are shipped, tracking information will appear here.'} />
        ) : (
          <div style={{ background: portalTheme.paper, borderRadius: 14, border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[13px] table-fixed">
                <thead>
                  <tr style={{ background: portalTheme.teal[50] }}>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Order #</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Date</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-center" style={{ color: portalTheme.inkSoft }}>Status</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Carrier</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Tracking #</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Est. Delivery</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-center" style={{ color: portalTheme.inkSoft }}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100/50">
                  {shipments.map((shipment) => {
                    const statusKey = shipment.status.toLowerCase();
                    const statusMeta = SHIPMENT_STATUS_META[statusKey] || SHIPMENT_STATUS_META.draft;
                    return (
                      <tr key={shipment.id} className="transition-colors cursor-pointer group hover:bg-[#eef7f6]">
                        <td className="px-5 py-3 font-mono text-slate-500 font-bold" data-label="Order #">#{shipment.order_number || shipment.id.slice(0, 8)}</td>
                        <td className="px-5 py-3 text-slate-500 whitespace-nowrap" data-label="Date">{shipment.orderDate ? new Date(shipment.orderDate).toLocaleDateString() : ''}</td>
                        <td className="px-5 py-3 text-center" data-label="Status">
                          <StatusBadge status={shipment.status} type="order" />
                        </td>
                        <td className="px-5 py-3 text-slate-600" data-label="Carrier">{shipment.carrier || '—'}</td>
                        <td className="px-5 py-3 font-mono text-slate-500 text-xs" data-label="Tracking #">{shipment.tracking_number || '—'}</td>
                        <td className="px-5 py-3 text-slate-500 whitespace-nowrap" data-label="Est. Delivery">
                          {shipment.estimated_delivery ? new Date(shipment.estimated_delivery).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-5 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-center gap-1 items-center shrink-0">
                            <button
                              onClick={() => navigate(`/portal/shipments/${shipment.id}`)}
                              className="p-2 text-[#5c6567] hover:text-blue-600 bg-slate-50 hover:bg-white border border-transparent hover:border-slate-200 rounded transition-all"
                              title="Track shipment"
                              aria-label={`Track shipment for order ${shipment.order_number || shipment.id}`}
                            >
                              <Eye size={14} />
                            </button>
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

export default CustomerShipments;
