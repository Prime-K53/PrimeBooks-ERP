import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, MessageSquare, CheckCircle2, ArrowUpRight, FileText, XCircle, Share2 } from 'lucide-react';
import { portalLifecycle, QuotationRequestRecord, TimelineEvent } from '../../services/portalApiClient';
import ErrorBanner from './components/ErrorBanner';
import StatusBadge from './components/StatusBadge';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import PortalButton from './components/PortalButton';
import DocumentChain from './components/DocumentChain';
import DocumentDiscussion from './components/DocumentDiscussion';
import { useToast } from './components/Toast';
import { portalTheme, REQUEST_STATUS_META, FRIENDLY_STATUS_MAP, formatK } from './constants';

const stageDefinitions = [
  { key: 'submitted', label: 'Submitted', description: 'Request received', icon: '📬' },
  { key: 'assigned', label: 'Assigned', description: 'Sales assigned', icon: '👤' },
  { key: 'under_review', label: 'Under Review', description: 'Team is reviewing', icon: '🔍' },
  { key: 'ready_for_conversion', label: 'Quotation', description: 'Official quotation being drafted', icon: '📝' },
  { key: 'converted', label: 'Quotation Issued', description: 'Official quotation available', icon: '✅' },
];

function stageIndex(status: string): number {
  switch (status) {
    case 'draft': return 1;
    case 'submitted': return 1;
    case 'assigned': return 2;
    case 'under_review': return 3;
    case 'waiting_for_customer': return 3;
    case 'ready_for_conversion': return 4;
    case 'converted': return 5;
    case 'rejected': return -1;
    case 'cancelled': return -1;
    default: return 1;
  }
}

const CustomerRequestDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [request, setRequest] = useState<QuotationRequestRecord | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [r, events] = await Promise.all([
        portalLifecycle.requests.get(id),
        portalLifecycle.timeline.get('request', id),
      ]);
      setRequest(r);
      setTimeline(events || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load request');
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
    let unsubscribe: (() => void) | undefined;
    (async () => {
      unsubscribe = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          if (type === 'entity_changed' && payload.docType === 'request' && payload.docId === id && !cancelled) load();
        },
      });
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [id, load]);

  const handleCancelClick = () => {
    setConfirmCancel(true);
  };

  const handleCancelConfirm = async () => {
    setConfirmCancel(false);
    if (!request) return;
    setCancelling(true);
    setError(null);
    try {
      await portalLifecycle.requests.cancel(request.id);
      addToast('success', 'Request cancelled successfully');
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel request');
      addToast('error', err.message || 'Failed to cancel request');
    } finally {
      setCancelling(false);
    }
  };

  const copyRequestId = () => {
    if (request?.request_number) {
      navigator.clipboard.writeText(request.request_number);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shareRequest = () => {
    if (request?.request_number && navigator.share) {
      navigator.share({ title: `Request ${request.request_number}`, text: `Track my request ${request.request_number}` }).catch(() => {});
    } else {
      copyRequestId();
    }
  };

  if (loading) return <div className="p-4"><PortalLoadingSkeleton type="detail" /></div>;
  if (error) return <div className="p-4"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>;
  if (!request) return null;

  const currentStage = stageIndex(request.status);
  const failed = currentStage === -1;
  const isConverted = request.status === 'converted';

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', paddingBottom: 100 }}>
      {/* Sticky Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20, background: 'rgba(254,253,251,.92)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        borderBottom: `1px solid ${portalTheme.hairline}`
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px' }}>
          <button
            onClick={() => navigate('/portal/orders?tab=requests')}
            aria-label="Back to requests"
            style={{
              width: 40, height: 40, borderRadius: 12, border: 'none', cursor: 'pointer',
              background: portalTheme.teal[50], color: portalTheme.teal[700], flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s ease'
            }}
          >
            <ArrowLeft size={20} strokeWidth={2.2} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 17, fontWeight: 700, color: portalTheme.ink, margin: 0, letterSpacing: 0.1 }}>
              {request.request_number}
            </h1>
            <p style={{ fontSize: 12, color: portalTheme.inkSoft, margin: '2px 0 0' }}>
              {new Date(request.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              {request.request_type ? ` • ${request.request_type === 'order' ? 'Order' : 'Quotation'}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={shareRequest}
              style={{
                width: 40, height: 40, borderRadius: 12, border: 'none', cursor: 'pointer',
                background: portalTheme.paper, color: portalTheme.inkSoft, display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 1px 3px rgba(0,0,0,.06)', border: `1.4px solid ${portalTheme.hairline}`
              }}
            >
              <Share2 size={18} />
            </button>
            {(request.status === 'submitted' || request.status === 'assigned' || request.status === 'under_review' || request.status === 'waiting_for_customer') && (
              <PortalButton
                variant="ghost"
                size="sm"
                onClick={handleCancelClick}
                disabled={cancelling}
                style={{ color: portalTheme.danger, border: `1.4px solid ${portalTheme.hairline}`, borderRadius: 12, height: 40 }}
              >
                {cancelling ? <Loader2 size={12} className="animate-spin" /> : 'Cancel'}
              </PortalButton>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: '20px 20px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <DocumentChain docType="request" docId={request.id} />

        {/* Status Banner */}
        {!failed ? (
          <div style={{
            background: `linear-gradient(135deg, ${portalTheme.teal[500]}12, ${portalTheme.teal[400]}08)`,
            border: `1px solid ${portalTheme.teal[200]}`, borderRadius: 20, padding: '18px 20px',
            boxShadow: '0 2px 8px -4px rgba(15,84,76,.15)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: portalTheme.teal[700], textTransform: 'uppercase', letterSpacing: 0.08, margin: 0 }}>Status</p>
                <p style={{ fontSize: 18, fontWeight: 700, color: portalTheme.ink, margin: '4px 0 0' }}>
                  {FRIENDLY_STATUS_MAP[request.status] || request.status}
                </p>
              </div>
              <StatusBadge status={FRIENDLY_STATUS_MAP[request.status] || request.status} />
            </div>

            {/* Stage Progress */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, position: 'relative' }}>
              {stageDefinitions.map((stage, i) => {
                const done = currentStage > i + 1;
                const active = currentStage === i + 1;
                return (
                  <React.Fragment key={stage.key}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: done ? `linear-gradient(135deg, ${portalTheme.teal[500]}, ${portalTheme.teal[600]})` : active ? `${portalTheme.amber[500]}25` : portalTheme.paper,
                        color: done ? '#fff' : active ? portalTheme.amber[600] : portalTheme.inkSoft,
                        border: done ? 'none' : active ? `2px solid ${portalTheme.amber[400]}` : `2px solid ${portalTheme.hairline}`,
                        boxShadow: done ? '0 4px 12px -4px rgba(15,84,76,.5)' : active ? '0 2px 8px -4px rgba(245,158,11,.3)' : 'none',
                        transition: 'all .3s ease', position: 'relative', zIndex: 2
                      }}>
                        {done ? <CheckCircle2 size={16} /> : <span style={{ fontSize: 12, fontWeight: 800 }}>{i + 1}</span>}
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: done || active ? portalTheme.ink : portalTheme.inkSoft, textAlign: 'center', lineHeight: 1.3 }}>
                        {stage.label}
                      </span>
                    </div>
                    {i < stageDefinitions.length - 1 && (
                      <div style={{
                        position: 'absolute', top: 18, left: `calc(${(i + 0.5) * (100 / stageDefinitions.length)}% + 8px)`,
                        right: `calc(${(stageDefinitions.length - i - 0.5) * (100 / stageDefinitions.length)}% - 8px)`,
                        height: 2, background: done ? `linear-gradient(90deg, ${portalTheme.teal[500]}, ${portalTheme.teal[400]})` : portalTheme.hairline,
                        borderRadius: 1, zIndex: 1, transition: 'all .3s ease'
                      }} />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{
            background: `linear-gradient(135deg, ${portalTheme.danger}12, ${portalTheme.danger}08)`,
            border: `1px solid ${portalTheme.danger}30`, borderRadius: 20, padding: '18px 20px',
            display: 'flex', alignItems: 'flex-start', gap: 14
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 14, background: `${portalTheme.danger}18`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
            }}>
              <XCircle size={20} color={portalTheme.danger} />
            </div>
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: portalTheme.danger, margin: 0 }}>Request {request.status === 'cancelled' ? 'Cancelled' : 'Rejected'}</p>
              {request.review_note && <p style={{ fontSize: 13, color: portalTheme.inkSoft, marginTop: 4, lineHeight: 1.5 }}>{request.review_note}</p>}
            </div>
          </div>
        )}

        {/* Converted Quotation Link */}
        {isConverted && request.quotation_id && (
          <button
            onClick={() => navigate(`/portal/quotations/${request.quotation_id}`)}
            style={{
              width: '100%', padding: '16px 20px', borderRadius: 20, border: 'none', cursor: 'pointer',
              background: `linear-gradient(135deg, ${portalTheme.teal[500]}, ${portalTheme.teal[700]})`,
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              boxShadow: '0 6px 16px -6px rgba(15,84,76,.5)', transition: 'all .15s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 14, background: 'rgba(255,255,255,.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <FileText size={22} color="#fff" />
              </div>
              <div style={{ textAlign: 'left' }}>
                <p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>View Quotation</p>
                <p style={{ fontSize: 12, opacity: 0.85, margin: '2px 0 0' }}>
                  {request.quotation_number ? `#${request.quotation_number}` : 'Click to view'}
                </p>
              </div>
            </div>
            <ArrowUpRight size={20} />
          </button>
        )}

        {/* Waiting for Customer Banner */}
        {request.status === 'waiting_for_customer' && (
          <div style={{
            background: `linear-gradient(135deg, #7c3aed12, #7c3aed08)`, border: `1px solid #7c3aed30`,
            borderRadius: 20, padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: 12
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 14, background: `#7c3aed18`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
            }}>
              <MessageSquare size={20} color="#7c3aed" />
            </div>
            <p style={{ fontSize: 14, color: '#5b21b6', lineHeight: 1.5, margin: 0 }}>
              Our team is waiting on additional information from you. Please contact us or submit a new request with more detail.
            </p>
          </div>
        )}

        {/* Requested Items */}
        <div style={{
          background: portalTheme.paper, borderRadius: 20, border: `1.4px solid ${portalTheme.hairline}`,
          overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)'
        }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${portalTheme.hairline}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: portalTheme.ink, margin: 0 }}>Requested Items</h2>
            <span style={{ fontSize: 12, color: portalTheme.inkSoft, fontWeight: 600 }}>{(request.items || []).length} items</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${portalTheme.hairline}` }}>
                  <th style={{ textAlign: 'left', padding: '10px 20px', fontSize: 10.5, fontWeight: 700, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.08 }}>Item</th>
                  <th style={{ textAlign: 'right', padding: '10px 20px', fontSize: 10.5, fontWeight: 700, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.08, width: 80 }}>Qty</th>
                  <th style={{ textAlign: 'right', padding: '10px 20px', fontSize: 10.5, fontWeight: 700, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.08, width: 110 }}>Price</th>
                  <th style={{ textAlign: 'right', padding: '10px 20px', fontSize: 10.5, fontWeight: 700, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.08, width: 110 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {(request.items || []).map((item, i) => (
                  <tr key={i} style={{ borderBottom: i < (request.items || []).length - 1 ? `1px solid ${portalTheme.hairline}` : 'none' }}>
                    <td style={{ padding: '12px 20px', fontSize: 13.5, fontWeight: 600, color: portalTheme.ink, lineHeight: 1.4 }}>{item.name}</td>
                    <td style={{ padding: '12px 20px', textAlign: 'right', fontSize: 13, color: portalTheme.inkSoft }}>x{item.quantity}</td>
                    <td style={{ padding: '12px 20px', textAlign: 'right', fontSize: 13, color: portalTheme.inkSoft, fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>{formatK(item.unitPrice || 0)}</td>
                    <td style={{ padding: '12px 20px', textAlign: 'right', fontSize: 14, fontWeight: 700, color: portalTheme.ink, fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>{formatK(item.lineTotal ?? item.quantity * item.unitPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${portalTheme.hairline}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.04 }}>Subtotal</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: portalTheme.ink, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 0.2 }}>
              {formatK(request.subtotal)}
            </span>
          </div>
        </div>

        {/* Delivery & Notes */}
        <div style={{
          background: portalTheme.paper, borderRadius: 20, border: `1.4px solid ${portalTheme.hairline}`,
          padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,.04)'
        }}>
          <h2 style={{ fontSize: 12, fontWeight: 700, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.08, margin: '0 0 12px' }}>Details</h2>
          {request.requested_delivery_date && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: portalTheme.teal[500], flexShrink: 0 }} />
              <span style={{ fontSize: 14, color: portalTheme.ink }}>
                <span style={{ fontWeight: 600, color: portalTheme.inkSoft }}>Delivery: </span>
                {new Date(request.requested_delivery_date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
          )}
          {request.notes && (
            <div style={{ background: portalTheme.teal[50], borderRadius: 14, padding: '12px 14px', border: `1px solid ${portalTheme.teal[100]}` }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: portalTheme.teal[700], textTransform: 'uppercase', letterSpacing: 0.06, margin: '0 0 6px' }}>Notes</p>
              <p style={{ fontSize: 13, color: portalTheme.ink, margin: 0, lineHeight: 1.6 }}>{request.notes}</p>
            </div>
          )}
        </div>

        {/* Attachments */}
        {request.attachments && request.attachments.length > 0 && (
          <div style={{
            background: portalTheme.paper, borderRadius: 20, border: `1.4px solid ${portalTheme.hairline}`,
            padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,.04)'
          }}>
            <h2 style={{ fontSize: 12, fontWeight: 700, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.08, margin: '0 0 12px' }}>Attachments</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {request.attachments.map((a, i) => (
                <a
                  key={i}
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 14,
                    background: portalTheme.teal[50], border: `1px solid ${portalTheme.teal[100]}`,
                    color: portalTheme.teal[700], textDecoration: 'none', fontSize: 13, fontWeight: 600,
                    transition: 'all .15s ease'
                  }}
                >
                  <FileText size={16} />
                  <span style={{ flex: 1 }}>{a.name}</span>
                  <ArrowUpRight size={14} />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Activity Timeline */}
        <div style={{
          background: portalTheme.paper, borderRadius: 20, border: `1.4px solid ${portalTheme.hairline}`,
          padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,.04)'
        }}>
          <h2 style={{ fontSize: 12, fontWeight: 700, color: portalTheme.inkSoft, textTransform: 'uppercase', letterSpacing: 0.08, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageSquare size={14} /> Activity
          </h2>
          {timeline.length === 0 ? (
            <p style={{ fontSize: 13, color: portalTheme.inkSoft, textAlign: 'center', padding: '20px 0' }}>No activity yet.</p>
          ) : (
            <div style={{ position: 'relative', paddingLeft: 20 }}>
              <div style={{ position: 'absolute', left: 5, top: 8, bottom: 8, width: 2, background: `linear-gradient(180deg, ${portalTheme.teal[300]}, ${portalTheme.teal[100]})`, borderRadius: 1 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {timeline.map((event) => (
                  <div key={event.id} style={{ position: 'relative', paddingLeft: 16 }}>
                    <div style={{
                      position: 'absolute', left: -15, top: 4, width: 10, height: 10, borderRadius: '50%',
                      background: `linear-gradient(135deg, ${portalTheme.teal[500]}, ${portalTheme.teal[600]})`,
                      border: `2px solid ${portalTheme.paper}`, boxShadow: '0 0 0 2px ' + portalTheme.teal[300]
                    }} />
                    <p style={{ fontSize: 14, fontWeight: 600, color: portalTheme.ink, margin: 0, lineHeight: 1.4 }}>{event.title}</p>
                    {event.description && <p style={{ fontSize: 13, color: portalTheme.inkSoft, marginTop: 3, lineHeight: 1.5 }}>{event.description}</p>}
                    <p style={{ fontSize: 11, color: portalTheme.inkSoft, marginTop: 4, fontWeight: 500 }}>
                      {new Date(event.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {event.actor_name ? ` • ${event.actor_name}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Discussion */}
        <div style={{ marginBottom: 20 }}>
          <DocumentDiscussion docType="request" docId={request.id} />
        </div>
      </div>

      {/* Confirm Dialog */}
      {confirmCancel && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(6px)', animation: 'fadeIn .2s ease' }} onClick={() => setConfirmCancel(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: portalTheme.paper, borderRadius: 24, width: '100%', maxWidth: 360, overflow: 'hidden',
            boxShadow: '0 20px 40px -12px rgba(0,0,0,.4)', animation: 'scaleIn .2s cubic-bezier(.4,0,.2,1)'
          }}>
            <div style={{ padding: '22px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: portalTheme.ink, margin: 0 }}>Cancel Request</h3>
              <button onClick={() => setConfirmCancel(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 10, color: portalTheme.inkSoft }} aria-label="Close">
                <XCircle size={18} />
              </button>
            </div>
            <div style={{ padding: '16px 24px 24px', fontSize: 14, color: portalTheme.inkSoft, lineHeight: 1.6 }}>
              Are you sure you want to cancel request <strong style={{ color: portalTheme.ink }}>{request?.request_number}</strong>? This action cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 10, padding: '0 24px 24px' }}>
              <button onClick={() => setConfirmCancel(false)} style={{
                flex: 1, padding: '14px 0', borderRadius: 14, border: `1.4px solid ${portalTheme.hairline}`, background: portalTheme.paper,
                color: portalTheme.ink, fontSize: 14, fontWeight: 700, cursor: 'pointer', transition: 'all .15s ease'
              }}>
                Keep Request
              </button>
              <button onClick={handleCancelConfirm} style={{
                flex: 1, padding: '14px 0', borderRadius: 14, border: 'none', cursor: 'pointer',
                background: `linear-gradient(135deg, ${portalTheme.danger}, ${portalTheme.danger}dd)`, color: '#fff',
                fontSize: 14, fontWeight: 700, boxShadow: '0 6px 16px -6px rgba(185,28,28,.5)', transition: 'all .15s ease'
              }}>
                Cancel Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerRequestDetail;
