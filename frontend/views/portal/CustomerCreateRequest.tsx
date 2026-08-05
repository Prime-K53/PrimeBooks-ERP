import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Search, Plus, Trash2, ShoppingCart, FileText,
  Loader2, CheckCircle2, Minus, Package
} from 'lucide-react';
import { api } from '../../services/api';
import { portalLifecycle } from '../../services/portalApiClient';
import ErrorBanner from './components/ErrorBanner';
import { portalTheme as t, formatK } from './constants';
import { useCustomerAuth } from '../../context/CustomerAuthContext';

type RequestType = 'order' | 'quotation';

interface LineItem {
  id: string;
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
}

const SERIF = "'DM Serif Display', 'Georgia', serif";
const MONO = "'JetBrains Mono', monospace";

const fieldBase: React.CSSProperties = {
  width: '100%',
  fontFamily: "'Inter', sans-serif",
  fontSize: 16,
  color: t.ink,
  background: '#fff',
  border: `1.4px solid ${t.hairline}`,
  borderRadius: 12,
  minHeight: 48,
  padding: '12px 14px',
  outline: 'none',
  transition: 'border-color .15s ease, box-shadow .15s ease, background .15s ease',
};

const cardStyle: React.CSSProperties = {
  background: t.paper,
  borderRadius: 14,
  border: `1.4px solid ${t.hairline}`,
  boxShadow: '0 1px 3px rgba(0,0,0,.04)',
  overflow: 'hidden',
};

const sectionTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  fontWeight: 600,
  color: t.inkSoft,
  textTransform: 'uppercase',
  letterSpacing: 0.06,
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  color: t.teal[800],
  marginBottom: 8,
  letterSpacing: 0.01,
};

const focusIn = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
  e.currentTarget.style.borderColor = t.teal[300];
  e.currentTarget.style.boxShadow = `0 0 0 3px ${t.teal[50]}`;
};

const focusOut = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
  e.currentTarget.style.borderColor = t.hairline;
  e.currentTarget.style.boxShadow = 'none';
};

const CustomerCreateRequest: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useCustomerAuth();

  const [type, setType] = useState<RequestType>(searchParams.get('type') === 'order' ? 'order' : 'quotation');
  const [catalog, setCatalog] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<LineItem[]>([]);
  const [deliveryDate, setDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [items, custs] = await Promise.all([
          portalLifecycle.catalog.list(),
          api.customers.getAll(),
        ]);
        setCatalog(items || []);
        setCustomers(custs || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load catalog');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const customerRecord = useMemo(
    () => (customers || []).find((c: any) => String(c.id) === String(user?.customer_id)),
    [customers, user]
  );
  const customerName = customerRecord?.name || user?.full_name || 'Customer';

  const filteredCatalog = useMemo(() => {
    const term = search.trim().toLowerCase();
    const available = (catalog || []).filter(
      (item: any) =>
        String(item.status || '').toLowerCase() !== 'deleted'
    );
    if (!term) return available;
    return available.filter((item: any) =>
      `${item.name} ${item.sku || ''} ${item.category || ''}`.toLowerCase().includes(term)
    );
  }, [catalog, search]);

  const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

  const addLine = (item: any) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === item.id);
      if (existing) {
        return prev.map((l) =>
          l.productId === item.id ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          productId: item.id,
          name: item.name,
          unit: item.unit || '',
          quantity: 1,
          unitPrice: Number(item.price) || 0,
        },
      ];
    });
    setSearch('');
  };

  const updateQuantity = (id: string, quantity: number) => {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, quantity: Math.max(1, quantity) } : l))
    );
  };

  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const handleSubmit = async () => {
    if (lines.length === 0) {
      setError('Please add at least one line item.');
      return;
    }
    for (const l of lines) {
      if (!l.name || !l.quantity || l.quantity <= 0) {
        setError(`Invalid quantity for "${l.name || 'unknown item'}". Quantity must be a positive number.`);
        return;
      }
      if (!l.unitPrice || l.unitPrice <= 0) {
        setError(`Invalid unit price for "${l.name || 'unknown item'}". Unit price must be a positive number.`);
        return;
      }
    }
    if (deliveryDate) {
      const selected = new Date(deliveryDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (selected < today) {
        setError('Requested delivery date cannot be in the past.');
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const created = await portalLifecycle.requests.create({
        requestType: type === 'order' ? 'order' : 'quotation',
        items: lines.map((l) => ({
          productId: l.productId,
          name: l.name,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
        notes: notes || undefined,
        requestedDeliveryDate: deliveryDate || null,
      });
      setSuccessId(created.request_number || created.id);
    } catch (err: any) {
      setError(err.message || 'Failed to submit request');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto min-h-[50vh] flex items-center justify-center">
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: `linear-gradient(155deg, ${t.teal[500]}, ${t.teal[700]})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 10px -3px rgba(15,84,76,.6)'
        }}>
          <Loader2 size={22} color="#fff" className="animate-spin" />
        </div>
      </div>
    );
  }

  if (successId) {
    return (
      <div className="max-w-2xl mx-auto md:px-2" style={{ paddingTop: 8 }}>
        <div style={{
          ...cardStyle, padding: '40px 24px 32px', textAlign: 'center', position: 'relative'
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 4,
            background: `linear-gradient(90deg, ${t.teal[600]}, ${t.teal[400]} 40%, ${t.amber[500]} 100%)`
          }} />
          <div style={{
            width: 68, height: 68, borderRadius: 18,
            background: `${t.teal[500]}15`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 18px'
          }}>
            <CheckCircle2 size={34} color={t.teal[600]} />
          </div>
          <h2 style={{
            fontFamily: SERIF, fontSize: 24, margin: 0, color: t.teal[800], letterSpacing: 0.2
          }}>
            {type === 'order' ? 'Order requested' : 'Quotation requested'}
          </h2>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: t.inkSoft, lineHeight: 1.5 }}>
            Reference <span style={{ fontFamily: MONO, fontWeight: 700, color: t.ink }}>#{successId}</span><br />
            Our team will review your request shortly.
          </p>
          <div className="flex flex-col md:flex-row gap-3 mt-8">
            <button
              onClick={() => navigate('/portal/requests')}
              className="md:flex-1"
              style={{
                fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 700,
                height: 50, borderRadius: 12, cursor: 'pointer', border: 'none',
                background: `linear-gradient(155deg, ${t.teal[500]}, ${t.teal[700]})`,
                color: '#fff', boxShadow: '0 6px 16px -6px rgba(15,84,76,.55)'
              }}
            >
              Track Request
            </button>
            <button
              onClick={() => navigate('/portal/new-request')}
              className="md:flex-1"
              style={{
                fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 600,
                height: 50, borderRadius: 12, cursor: 'pointer',
                background: t.paper, border: `1.4px solid ${t.hairline}`, color: t.inkSoft
              }}
            >
              Create Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto" style={{ paddingBottom: 110 }}>
      {/* Sticky top bar */}
      <div
        className="sticky top-0 z-20 -mx-4 md:-mx-6 -mt-4 md:-mt-6 px-4 md:px-6"
        style={{
          background: 'rgba(254,253,251,.94)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: `1px solid ${t.hairline}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0 12px' }}>
          <button
            onClick={() => navigate('/portal/requests')}
            aria-label="Back to requests"
            style={{
              width: 44, height: 44, borderRadius: 12, border: 'none', cursor: 'pointer',
              background: t.teal[50], color: t.teal[700], flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <ArrowLeft size={20} />
          </button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1 style={{
              fontFamily: SERIF, fontWeight: 400, fontSize: 20, margin: 0,
              color: type === 'order' ? t.teal[800] : t.amber[600], letterSpacing: 0.2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            }}>
              New {type === 'order' ? 'Order' : 'Quotation'} Request
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: t.inkSoft }}>
              {type === 'order' ? 'Place a new order with our team' : 'Request a quotation for your needs'}
            </p>
          </div>
          <div style={{
            width: 40, height: 40, borderRadius: 12, flexShrink: 0,
            background: type === 'order'
              ? `linear-gradient(155deg, ${t.teal[500]}, ${t.teal[700]})`
              : `linear-gradient(155deg, ${t.amber[500]}, ${t.amber[600]})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 10px -3px rgba(15,84,76,.6)'
          }}>
            {type === 'order' ? <ShoppingCart size={18} color="#fff" /> : <FileText size={18} color="#fff" />}
          </div>
        </div>
      </div>

      <div style={{ paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {/* Type toggle */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, padding: 5,
          background: '#f0f6f5', border: `1px solid ${t.teal[100]}`, borderRadius: 14,
        }}>
          <button
            aria-pressed={type === 'order'}
            onClick={() => setType('order')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              height: 46, borderRadius: 10, border: 'none', cursor: 'pointer',
              fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 700,
              background: type === 'order' ? `linear-gradient(155deg, ${t.teal[500]}, ${t.teal[700]})` : 'transparent',
              color: type === 'order' ? '#fff' : t.inkSoft,
              boxShadow: type === 'order' ? '0 4px 12px -4px rgba(15,84,76,.5)' : 'none',
              transition: 'all .15s ease',
            }}
          >
            <ShoppingCart size={16} /> Order
          </button>
          <button
            aria-pressed={type === 'quotation'}
            onClick={() => setType('quotation')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              height: 46, borderRadius: 10, border: 'none', cursor: 'pointer',
              fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 700,
              background: type === 'quotation' ? `linear-gradient(155deg, ${t.teal[500]}, ${t.teal[700]})` : 'transparent',
              color: type === 'quotation' ? '#fff' : t.inkSoft,
              boxShadow: type === 'quotation' ? '0 4px 12px -4px rgba(15,84,76,.5)' : 'none',
              transition: 'all .15s ease',
            }}
          >
            <FileText size={16} /> Quotation
          </button>
        </div>

        {/* Search products */}
        <div style={cardStyle}>
          <div style={{ padding: '16px 16px 18px' }}>
            <label style={labelStyle}>
              Search Products
            </label>
            <div style={{ position: 'relative' }}>
              <Search size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: t.inkSoft }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products..."
                style={{ ...fieldBase, paddingLeft: 44 }}
                onFocus={focusIn}
                onBlur={focusOut}
              />
            </div>

            {search.trim() && (
              <div style={{
                marginTop: 10,
                maxHeight: 264, overflowY: 'auto',
                border: `1px solid ${t.hairline}`, borderRadius: 12,
                background: '#fff'
              }}>
                {filteredCatalog.length === 0 ? (
                  <p style={{ margin: 0, padding: '18px 16px', fontSize: 13, color: t.inkSoft }}>
                    No products match your search
                  </p>
                ) : (
                  filteredCatalog.slice(0, 20).map((item: any) => (
                    <button
                      key={item.id}
                      onClick={() => addLine(item)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        width: '100%', minHeight: 56, padding: '10px 14px', textAlign: 'left',
                        border: 'none', borderBottom: `1px solid ${t.hairline}`,
                        background: 'transparent', cursor: 'pointer', fontSize: 13,
                        transition: 'background .15s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = t.teal[50]}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <p style={{ fontWeight: 500, color: t.ink, margin: 0, wordBreak: 'break-word' }}>{item.name}</p>
                        <p style={{ fontSize: 11, color: t.inkSoft, marginTop: 2 }}>
                          {item.sku || ''}{item.unit ? ` • ${item.unit}` : ''} • {formatK(item.price)}
                        </p>
                      </div>
                      <span style={{
                        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                        background: t.teal[50], color: t.teal[600],
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        <Plus size={18} />
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Selected items */}
        <div style={cardStyle}>
          <div style={{
            padding: '14px 16px',
            borderBottom: `1px solid ${t.hairline}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8
          }}>
            <h2 style={sectionTitle}>Selected Items ({lines.length})</h2>
            <span style={{ fontSize: 11, color: t.inkSoft }}>{customerName}</span>
          </div>
          {lines.length === 0 ? (
            <div style={{ padding: '34px 16px', textAlign: 'center' }}>
              <Package size={30} color={t.teal[300]} style={{ margin: '0 auto 10px' }} />
              <p style={{ margin: 0, fontSize: 13, color: t.inkSoft }}>
                No items selected yet — search and add products above.
              </p>
            </div>
          ) : (
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {lines.map((l) => (
                <div key={l.id} style={{
                  background: '#fff', borderRadius: 12,
                  border: `1.4px solid ${t.hairline}`, padding: 12
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: t.ink, margin: 0, wordBreak: 'break-word' }}>{l.name}</p>
                      <p style={{ fontSize: 12, color: t.inkSoft, marginTop: 2 }}>
                        {l.unit ? `${l.unit} • ` : ''}{formatK(l.unitPrice)} each
                      </p>
                    </div>
                    <button
                      onClick={() => removeLine(l.id)}
                      aria-label={`Remove ${l.name}`}
                      style={{
                        width: 40, height: 40, borderRadius: 10, border: 'none', cursor: 'pointer',
                        background: '#fef2f2', color: t.danger, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        onClick={() => updateQuantity(l.id, l.quantity - 1)}
                        aria-label="Decrease quantity"
                        style={{
                          width: 40, height: 40, borderRadius: 10, border: `1.4px solid ${t.hairline}`,
                          background: t.paper, color: t.teal[600], cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}
                      >
                        <Minus size={16} />
                      </button>
                      <input
                        type="number"
                        min={1}
                        value={l.quantity}
                        onChange={(e) => updateQuantity(l.id, parseInt(e.target.value, 10) || 1)}
                        aria-label={`Quantity for ${l.name}`}
                        style={{ ...fieldBase, width: 56, minHeight: 40, padding: '0 6px', textAlign: 'center', fontSize: 15, fontFamily: MONO }}
                      />
                      <button
                        onClick={() => updateQuantity(l.id, l.quantity + 1)}
                        aria-label="Increase quantity"
                        style={{
                          width: 40, height: 40, borderRadius: 10, border: `1.4px solid ${t.hairline}`,
                          background: t.paper, color: t.teal[600], cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ margin: 0, fontSize: 10, color: t.inkSoft, textTransform: 'uppercase', letterSpacing: 0.05 }}>Total</p>
                      <p style={{ margin: '2px 0 0', fontSize: 15, fontWeight: 700, color: t.ink, fontFamily: MONO }}>
                        {formatK(l.quantity * l.unitPrice)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Delivery & notes */}
        <div style={{ ...cardStyle, padding: '18px 16px' }}>
          <h2 style={sectionTitle}>Delivery & Notes</h2>
          <div style={{ marginTop: 14 }}>
            <label style={labelStyle}>Delivery Date</label>
            <input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              style={fieldBase}
              onFocus={focusIn}
              onBlur={focusOut}
            />
          </div>
          <div style={{ marginTop: 16 }}>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder={type === 'order' ? 'Order instructions, special requirements...' : 'Tell us what you need...'}
              style={{ ...fieldBase, minHeight: 96, lineHeight: 1.5, resize: 'vertical' }}
              onFocus={focusIn}
              onBlur={focusOut}
            />
          </div>
        </div>

        {/* Summary */}
        <div style={{ ...cardStyle, padding: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: t.inkSoft }}>Estimated Total</p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: t.inkSoft }}>
                {lines.length} item{lines.length === 1 ? '' : 's'}
              </p>
            </div>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: t.ink, fontFamily: MONO }}>
              {formatK(subtotal)}
            </p>
          </div>
        </div>
      </div>

      {/* Sticky bottom action bar */}
      <div
        className="fixed bottom-0 left-0 right-0 md:left-64 z-30"
        style={{
          background: 'rgba(254,253,251,.96)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderTop: `1px solid ${t.hairline}`,
          boxShadow: '0 -6px 24px -16px rgba(0,0,0,.18)',
        }}
      >
        <div
          className="max-w-4xl mx-auto flex items-stretch gap-3 px-4 md:px-6 pt-3"
          style={{ paddingBottom: 'calc(14px + env(safe-area-inset-bottom))' }}
        >
          <button
            onClick={() => navigate('/portal/requests')}
            style={{
              height: 50, padding: '0 20px', borderRadius: 12, cursor: 'pointer',
              border: `1.4px solid ${t.hairline}`, background: '#fff', color: t.ink,
              fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 600,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || lines.length === 0}
            className="flex-1"
            style={{
              height: 50, borderRadius: 12, border: 'none', cursor: saving || lines.length === 0 ? 'not-allowed' : 'pointer',
              background: `linear-gradient(155deg, ${t.teal[500]}, ${t.teal[700]})`,
              color: '#fff', fontSize: 15, fontWeight: 700,
              fontFamily: "'Inter', sans-serif",
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: '0 8px 20px -8px rgba(15,84,76,.6)',
              opacity: saving || lines.length === 0 ? 0.55 : 1,
              transition: 'all .15s ease',
            }}
          >
            {saving ? <Loader2 size={17} className="animate-spin" /> : null}
            {type === 'order' ? 'Submit Order' : 'Request Quotation'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CustomerCreateRequest;