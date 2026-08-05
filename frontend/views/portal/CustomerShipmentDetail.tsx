import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, Clock, User, Car, Package, FileText } from 'lucide-react';
import { portalLifecycle, PortalShipmentRecord } from '../../services/portalApiClient';
import { useAuth } from '../../context/AuthContext';
import PortalPageHeader from './components/PortalPageHeader';
import PortalButton from './components/PortalButton';
import ErrorBanner from './components/ErrorBanner';
import StatusBadge from './components/StatusBadge';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { portalTheme, SHIPMENT_STATUS_META } from './constants';

const CustomerShipmentDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { companyConfig } = useAuth();
  const [shipment, setShipment] = useState<PortalShipmentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await portalLifecycle.shipments.get(id);
      setShipment(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load shipment');
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
          if (type === 'entity_changed' && payload?.docType === 'order' && payload?.docId === id && !cancelled) load();
        },
      });
      if (!cancelled) return sub;
    })();
    return () => { cancelled = true; };
  }, [id, load]);

  const formatDate = (value: string | null | undefined) => {
    if (!value) return '—';
    const d = new Date(value);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString();
  };

  const parseLocation = (raw: string | null | undefined) => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.lat === 'number' && typeof parsed.lng === 'number') return parsed;
    } catch { /* ignore */ }
    return null;
  };

  const parseProof = (raw: string | null | undefined) => {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch { /* ignore */ }
    return null;
  };

  if (loading) return <div className="p-6 max-w-4xl mx-auto"><PortalLoadingSkeleton type="detail" /></div>;
  if (error) return <div className="p-6 max-w-4xl mx-auto"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>;
  if (!shipment) return null;

  const statusKey = shipment.status.toLowerCase();
  const statusMeta = SHIPMENT_STATUS_META[statusKey] || SHIPMENT_STATUS_META.draft;
  const location = parseLocation(shipment.current_location);
  const proof = parseProof(shipment.proof_of_delivery);

  const stageDefinitions = [
    { key: 'processing', label: 'Processing', description: 'Order is being prepared' },
    { key: 'shipped', label: 'Shipped', description: 'In transit' },
    { key: 'out_for_delivery', label: 'Out for Delivery', description: 'With the courier' },
    { key: 'delivered', label: 'Delivered', description: 'Order delivered' },
  ];

  const currentStage = (() => {
    const s = shipment.status.toLowerCase();
    if (s === 'delivered' || s === 'fulfilled') return 4;
    if (s === 'out_for_delivery') return 3;
    if (s === 'shipped' || s === 'in_transit') return 2;
    return 1;
  })();

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PortalButton variant="ghost" onClick={() => navigate('/portal/shipments')} icon={ArrowLeft}>Back to Shipments</PortalButton>

      <div className="mt-6 mb-6">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-bold" style={{ fontFamily: "'DM Serif Display', Georgia, serif", color: portalTheme.ink }}>
            Order #{shipment.order_number || shipment.id.slice(0, 8)}
          </h1>
          <StatusBadge status={shipment.status} type="order" />
        </div>
        <p className="text-sm" style={{ color: portalTheme.inkSoft }}>
          {shipment.customerName} • {shipment.orderDate ? new Date(shipment.orderDate).toLocaleDateString() : ''}
        </p>
      </div>

      {shipment.proof_of_delivery && (
        <div className="mb-6 p-5 rounded-xl" style={{ background: '#f0fdfa', border: '1px solid #99f6e4' }}>
          <div className="flex items-center gap-2 mb-3">
            <Package size={16} style={{ color: '#0f766e' }} />
            <h2 className="font-bold text-sm" style={{ color: '#0f766e' }}>Proof of Delivery</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm" style={{ color: portalTheme.ink }}>
            {proof.receivedBy && (
              <div><span style={{ color: portalTheme.inkSoft }}>Received by:</span> <b>{proof.receivedBy}</b></div>
            )}
            {proof.timestamp && (
              <div><span style={{ color: portalTheme.inkSoft }}>Delivered at:</span> <b>{formatDate(proof.timestamp)}</b></div>
            )}
            {proof.recipientPhone && (
              <div><span style={{ color: portalTheme.inkSoft }}>Phone:</span> <b>{proof.recipientPhone}</b></div>
            )}
            {proof.remarks && (
              <div className="sm:col-span-2"><span style={{ color: portalTheme.inkSoft }}>Remarks:</span> {proof.remarks}</div>
            )}
            {proof.signatureDataUrl && (
              <div className="sm:col-span-2">
                <span style={{ color: portalTheme.inkSoft }}>Signature:</span>
                <div className="mt-2 p-2 bg-white rounded-lg border border-slate-200 inline-block">
                  <img src={proof.signatureDataUrl} alt="Delivery signature" style={{ maxHeight: 80, maxWidth: 280 }} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="p-5 rounded-xl" style={{ background: 'rgba(255,255,255,0.7)', border: '1.4px solid #e4ddd1', backdropFilter: 'blur(12px)' }}>
          <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: portalTheme.inkSoft }}>Shipment Details</h3>
          <div className="space-y-2 text-sm">
            <DetailRow icon={<Car size={14} />} label="Carrier" value={shipment.carrier || '—'} />
            <DetailRow icon={<User size={14} />} label="Driver" value={shipment.driver_name || '—'} />
            <DetailRow icon={<FileText size={14} />} label="Vehicle" value={shipment.vehicle_no || '—'} />
            <DetailRow icon={<FileText size={14} />} label="Tracking #" value={shipment.tracking_number || '—'} mono />
          </div>
        </div>

        <div className="p-5 rounded-xl" style={{ background: 'rgba(255,255,255,0.7)', border: '1.4px solid #e4ddd1', backdropFilter: 'blur(12px)' }}>
          <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: portalTheme.inkSoft }}>Schedule</h3>
          <div className="space-y-2 text-sm">
            <DetailRow icon={<Clock size={14} />} label="Estimated Delivery" value={formatDate(shipment.estimated_delivery)} />
            <DetailRow icon={<Clock size={14} />} label="Actual Arrival" value={formatDate(shipment.actual_arrival)} />
            <DetailRow icon={<MapPin size={14} />} label="Last Location" value={location ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}` : '—'} />
          </div>
        </div>
      </div>

      <div className="p-5 rounded-xl mb-6" style={{ background: 'rgba(255,255,255,0.7)', border: '1.4px solid #e4ddd1', backdropFilter: 'blur(12px)' }}>
        <h3 className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: portalTheme.inkSoft }}>Tracking Timeline</h3>
        <div className="flex items-center justify-between">
          {stageDefinitions.map((stage, idx) => {
            const isCompleted = idx < currentStage;
            const isCurrent = idx === currentStage - 1 && currentStage > 0;
            return (
              <div key={stage.key} className="flex-1 flex flex-col items-center relative">
                {idx > 0 && (
                  <div className="absolute top-3 left-0 w-full h-0.5" style={{
                    background: isCompleted ? portalTheme.teal[500] : '#e4ddd1',
                    left: '-50%',
                    width: '100%',
                    zIndex: 0,
                  }} />
                )}
                <div className="w-6 h-6 rounded-full flex items-center justify-center z-10" style={{
                  background: isCurrent ? portalTheme.teal[500] : isCompleted ? portalTheme.teal[500] : '#fff',
                  border: `2px solid ${isCompleted || isCurrent ? portalTheme.teal[500] : '#e4ddd1'}`,
                  color: isCompleted || isCurrent ? '#fff' : portalTheme.inkSoft,
                }}>
                  {isCompleted ? <Package size={12} /> : <span className="text-[10px] font-bold">{idx + 1}</span>}
                </div>
                <span className="text-[11px] font-semibold mt-1 text-center" style={{ color: isCurrent ? portalTheme.teal[700] : portalTheme.inkSoft }}>{stage.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {shipment.items && shipment.items.length > 0 && (
        <div className="p-5 rounded-xl" style={{ background: 'rgba(255,255,255,0.7)', border: '1.4px solid #e4ddd1', backdropFilter: 'blur(12px)' }}>
          <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: portalTheme.inkSoft }}>Items in this shipment</h3>
          <div className="space-y-2">
            {shipment.items.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <span className="text-sm font-medium" style={{ color: portalTheme.ink }}>{item.name}</span>
                <span className="text-sm" style={{ color: portalTheme.inkSoft }}>Qty: {item.quantity}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const DetailRow: React.FC<{ icon: React.ReactNode; label: string; value: string; mono?: boolean }> = ({ icon, label, value, mono }) => (
  <div className="flex items-start gap-2">
    <span className="mt-0.5 shrink-0" style={{ color: portalTheme.inkSoft }}>{icon}</span>
    <div>
      <div className="text-[11px]" style={{ color: portalTheme.inkSoft }}>{label}</div>
      <div className={`text-sm font-medium ${mono ? 'font-mono text-xs' : ''}`} style={{ color: portalTheme.ink }}>{value}</div>
    </div>
  </div>
);

export default CustomerShipmentDetail;
