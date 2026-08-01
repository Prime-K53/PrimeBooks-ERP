import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Plus, Loader2, ArrowUpRight } from 'lucide-react';
import { portalLifecycle, QuotationRequestRecord } from '../../services/portalApiClient';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import EmptyState from './components/EmptyState';
import StatusBadge from './components/StatusBadge';
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

const requestStatusLabel: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  assigned: 'Assigned',
  under_review: 'Under Review',
  waiting_for_customer: 'Waiting for Customer',
  ready_for_conversion: 'Quotation Being Prepared',
  converted: 'Quotation Issued',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

const CustomerRequests: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useCustomerAuth();
  const [requests, setRequests] = useState<QuotationRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await portalLifecycle.requests.list();
      setRequests(data || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsubscribe = portalLifecycle.subscribe({
      onEvent: (type, payload) => {
        if (type === 'entity_changed' && payload.docType === 'request') load();
      },
    });
    return unsubscribe;
  }, [load]);

  const handleCancel = async (id: string) => {
    setCancellingId(id);
    setError(null);
    try {
      await portalLifecycle.requests.cancel(id);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel request');
    } finally {
      setCancellingId(null);
    }
  };

  const sorted = useMemo(
    () => [...requests].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()),
    [requests]
  );

  if (loading) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={6} /></div>;

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
            <ClipboardList size={19} color="#fff" />
          </div>
          <div>
            <h1 style={{
              fontFamily: "'DM Serif Display', 'Georgia', serif", fontWeight: 400,
              fontSize: 22, margin: 0, color: teal[800], letterSpacing: 0.2
            }}>
              Requests
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 11.5, color: inkSoft, letterSpacing: 0.02 }}>
              Track your quotation and order requests
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate('/portal/new-request')}
          style={{
            fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
            padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid transparent',
            background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
            color: '#fff', display: 'flex', alignItems: 'center', gap: 7,
            boxShadow: '0 6px 16px -6px rgba(15,84,76,.55)',
            transition: 'all .15s ease'
          }}
        >
          <Plus size={14} /> New Request
        </button>
      </div>

      <div style={{ padding: '24px 30px 8px' }}>
        {error && (
          <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-600">{error}</div>
        )}

        {sorted.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No requests yet"
            description="Submit a quotation or order request and track it here."
          />
        ) : (
          <div className="space-y-2">
            {sorted.map((r) => {
              const itemCount = (r.items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0);
              return (
                <button
                  key={r.id}
                  onClick={() => navigate(`/portal/requests/${r.id}`)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                    width: '100%', padding: '16px 20px', textAlign: 'left',
                    background: paper, borderRadius: 14,
                    border: `1.4px solid ${hairline}`,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(255,255,255,.04)',
                    cursor: 'pointer', transition: 'all .15s ease',
                    borderLeft: `4px solid ${teal[400]}`
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = teal[50]; e.currentTarget.style.borderColor = teal[200]; }}
                  onMouseLeave={e => { e.currentTarget.style.background = paper; e.currentTarget.style.borderColor = hairline; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: 1 }}>
                    <div style={{
                      padding: 8, borderRadius: 10,
                      background: teal[50], color: teal[600], flexShrink: 0
                    }}>
                      <ClipboardList size={18} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontWeight: 500, fontSize: 13, color: ink }}>{r.request_number}</p>
                      <p style={{ fontSize: 11, color: inkSoft, marginTop: 2 }}>
                        {new Date(r.created_at).toLocaleDateString()} • {itemCount} item{itemCount === 1 ? '' : 's'}{' '}
                        • K {Number(r.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      {r.quotation_number && (
                        <span className="inline-flex items-center gap-1 mt-1 text-xs font-semibold" style={{ color: teal[600] }}>
                          Quotation {r.quotation_number} issued <ArrowUpRight size={12} />
                        </span>
                      )}
                      {!r.quotation_number && r.quotation_id && (
                        <span className="inline-flex items-center gap-1 mt-1 text-xs font-semibold" style={{ color: teal[600] }}>
                          Quotation ready <ArrowUpRight size={12} />
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <StatusBadge status={requestStatusLabel[r.status] || r.status} />
                    {(r.status === 'submitted' || r.status === 'assigned' || r.status === 'under_review' || r.status === 'waiting_for_customer') && (
                      <button
                        onClick={() => handleCancel(r.id)}
                        disabled={cancellingId === r.id}
                        style={{
                          padding: '6px 12px', fontSize: 11, fontWeight: 600,
                          borderRadius: 8, cursor: 'pointer',
                          background: paper, border: `1.4px solid ${hairline}`,
                          color: '#b5493f',
                          transition: 'all .15s ease',
                          opacity: (cancellingId === r.id) ? 0.5 : 1
                        }}
                      >
                        {cancellingId === r.id ? <Loader2 size={12} className="animate-spin" /> : 'Cancel'}
                      </button>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomerRequests;
