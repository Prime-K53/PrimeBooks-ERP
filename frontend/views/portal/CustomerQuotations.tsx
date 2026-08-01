import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Plus, ArrowUpRight } from 'lucide-react';
import { portalLifecycle, QuotationRecord } from '../../services/portalApiClient';
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

const quotationStatusLabel: Record<string, string> = {
  ready: 'Ready',
  accepted: 'Accepted',
  rejected: 'Rejected',
  revision_requested: 'Revision Requested',
  converted: 'Converted to Order',
};

const CustomerQuotations: React.FC = () => {
  const navigate = useNavigate();
  const [quotations, setQuotations] = useState<QuotationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await portalLifecycle.quotations.list();
      setQuotations(all || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load quotations');
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
        if (type === 'entity_changed' && payload.docType === 'quotation') load();
      },
    });
    return unsubscribe;
  }, [load]);

  const sorted = useMemo(
    () => [...quotations].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()),
    [quotations]
  );

  if (loading) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={6} /></div>;

  return (
    <div>
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
              <FileText size={19} color="#fff" />
            </div>
            <div>
              <h1 style={{
                fontFamily: "'DM Serif Display', 'Georgia', serif", fontWeight: 400,
                fontSize: 22, margin: 0, color: teal[800], letterSpacing: 0.2
              }}>
                Quotations
              </h1>
              <p style={{ margin: '2px 0 0', fontSize: 11.5, color: inkSoft, letterSpacing: 0.02 }}>
                Official quotations prepared for you
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate('/portal/new-request?type=quotation')}
            style={{
              fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
              padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid transparent',
              background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
              color: '#fff', display: 'flex', alignItems: 'center', gap: 7,
              boxShadow: '0 6px 16px -6px rgba(15,84,76,.55)',
              transition: 'all .15s ease'
            }}
          >
            <Plus size={14} /> Request Quotation
          </button>
        </div>

        <div style={{ padding: '24px 30px 8px' }}>
          {error && (
            <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-600">{error}</div>
          )}

          {sorted.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No quotations"
              description="Official quotations created for you by our team will appear here."
            />
          ) : (
            <div className="space-y-2">
              {sorted.map((q) => (
                <button
                  key={q.id}
                  onClick={() => navigate(`/portal/quotations/${q.id}`)}
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
                      <FileText size={18} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontWeight: 500, fontSize: 13, color: ink }}>{q.quotation_number}</p>
                      <p style={{ fontSize: 11, color: inkSoft, marginTop: 2 }}>
                        {new Date(q.created_at).toLocaleDateString()}
                        {q.valid_until ? ` • Valid until ${new Date(q.valid_until).toLocaleDateString()}` : ''}
                        {q.payment_terms ? ` • ${q.payment_terms}` : ''}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: ink, fontFamily: "'JetBrains Mono', monospace" }}>K {Number(q.total).toFixed(2)}</span>
                    <StatusBadge status={quotationStatusLabel[q.status] || q.status} />
                    <ArrowUpRight size={16} style={{ color: inkSoft }} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CustomerQuotations;
