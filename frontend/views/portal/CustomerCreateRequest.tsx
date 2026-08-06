import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Search, Plus, Trash2, ShoppingCart, FileText,
  Loader2, CheckCircle2, Minus, Package, Link2
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
  fontSize: 13.5,
  color: t.ink,
  background: '#fff',
  border: `1.4px solid ${t.hairline}`,
  borderRadius: 14,
  minHeight: 46,
  padding: '10px 14px',
  outline: 'none',
  transition: 'border-color .15s ease, box-shadow .15s ease, background .15s ease',
  lineHeight: 1.45,
};

const focusIn = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
  e.currentTarget.style.borderColor = t.teal[400];
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
  const [reorderRef, setReorderRef] = useState<string | null>(searchParams.get('ref'));
  const [reorderOf, setReorderOf] = useState<string | null>(searchParams.get('order_id'));

  // Fetch source order details for pre-fill when reordering
  useEffect(() => {
    if (!reorderOf) return;

    let cancelled = false;
    const loadSourceOrder = async () => {
      try {
        const orderDetail = await portalLifecycle.orders.get(reorderOf);
        if (orderDetail && orderDetail.items && Array.isArray(orderDetail.items)) {
          // Map order items to line items format
          const lineItems: LineItem[] = orderDetail.items.map((item: any) => ({
            id: item.id || Math.random().toString(36).substr(2, 9),
            productId: item.productId || null,
            name: item.name || item.description || 'Item',
            quantity: Number(item.quantity || 0),
            unitPrice: Number(item.unitPrice || item.price || 0),
          }));
          setLines(lineItems);
        }
      } catch (err) {
        console.warn('Failed to load source order for reorder:', err);
        // Continue with empty lines - user can still manually add items
      }
    };

    loadSourceOrder();
    return () => {
      cancelled = true;
    };
  }, [reorderOf]);

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
        reorderOf: reorderOf || null,
        reorderOfNumber: reorderRef || null,
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
      <div style={{ maxWidth: 720, margin: '0 auto', minHeight: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: 48, height: 48, borderRadius: 16,
          background: `linear-gradient(135deg, ${t.teal[500]}, ${t.teal[700]})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 14px -4px rgba(15,84,76,.6)', animation: 'pulse 1.5s ease-in-out infinite'
        }}>
          <Loader2 size={24} color="#fff" className="animate-spin" />
        </div>
      </div>
    );
  }

  if (successId) {
    return (
      <div style={{ maxWidth: 460, margin: '0 auto', padding: '16px 16px 40px', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          background: t.paper, borderRadius: 24, padding: '32px 24px 28px', textAlign: 'center', position: 'relative',
          border: `1.4px solid ${t.hairline}`, boxShadow: '0 20px 40px -16px rgba(0,0,0,.2)', width: '100%',
          animation: 'scaleIn .3s cubic-bezier(.4,0,.2,1)'
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 4,
            background: `linear-gradient(90deg, ${t.teal[600]}, ${t.teal[400]} 40%, ${t.amber[500]} 100%)`, borderRadius: '24px 24px 0 0'
          }} />
          <div style={{
            width: 72, height: 72, borderRadius: 20,
            background: `linear-gradient(135deg, ${t.teal[500]}18, ${t.teal[400]}10)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px', animation: 'scaleIn .4s cubic-bezier(.4,0,.2,1) .1s both'
          }}>
            <CheckCircle2 size={36} color={t.teal[600]} strokeWidth={2.5} />
          </div>
          <h2 style={{
            fontFamily: SERIF, fontSize: 22, margin: 0, color: t.teal[800], letterSpacing: 0.2, lineHeight: 1.35
          }}>
            {type === 'order' ? 'Order Requested' : 'Quotation Requested'}
          </h2>
          <p style={{ margin: '8px 0 0', fontSize: 13.5, color: t.inkSoft, lineHeight: 1.5 }}>
            Reference <span style={{ fontFamily: MONO, fontWeight: 600, color: t.ink, letterSpacing: 0.15, fontVariantNumeric: 'tabular-nums' }}>#{successId}</span><br />
            Our team will review your request shortly.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 24 }}>
            <button
              onClick={() => navigate('/portal/requests')}
              style={{
                width: '100%', padding: '10px 0', borderRadius: 14, border: 'none', cursor: 'pointer',
                background: `linear-gradient(135deg, ${t.teal[500]}, ${t.teal[700]})`, color: '#fff',
                fontSize: 13.5, fontWeight: 600, lineHeight: 1.4, boxShadow: '0 6px 16px -6px rgba(15,84,76,.5)',
                transition: 'all .15s ease'
              }}
            >
              Track Request
            </button>
            <button
              onClick={() => navigate('/portal/new-request')}
              style={{
                width: '100%', padding: '10px 0', borderRadius: 14, cursor: 'pointer',
                background: t.paper, border: `1.4px solid ${t.hairline}`, color: t.inkSoft,
                fontSize: 13.5, fontWeight: 600, lineHeight: 1.4, transition: 'all .15s ease'
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
    <div style={{ maxWidth: 720, margin: '0 auto', paddingBottom: 120 }}>
      {/* Sticky Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20, background: 'rgba(254,253,251,.92)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        borderBottom: `1px solid ${t.hairline}`
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px' }}>
          <button
            onClick={() => navigate('/portal/requests')}
            aria-label="Back to requests"
            style={{
              width: 40, height: 40, borderRadius: 12, border: 'none', cursor: 'pointer',
              background: t.teal[50], color: t.teal[700], flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s ease'
            }}
          >
            <ArrowLeft size={20} strokeWidth={2.2} />
          </button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1 style={{
              fontFamily: SERIF, fontWeight: 400, fontSize: 22, margin: 0,
              color: type === 'order' ? t.teal[800] : t.amber[700], letterSpacing: 0.2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              lineHeight: 1.35
            }}>
              New {type === 'order' ? 'Order' : 'Quotation'} Request
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: t.inkSoft, fontWeight: 500, lineHeight: 1.4 }}>
              {type === 'order' ? 'Place a new order with our team' : 'Request a quotation for your needs'}
            </p>
          </div>
          <div style={{
            width: 44, height: 44, borderRadius: 14, flexShrink: 0,
            background: type === 'order'
              ? `linear-gradient(135deg, ${t.teal[500]}, ${t.teal[700]})`
              : `linear-gradient(135deg, ${t.amber[500]}, ${t.amber[600]})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 12px -4px rgba(15,84,76,.5)'
          }}>
            {type === 'order' ? <ShoppingCart size={20} color="#fff" strokeWidth={2.2} /> : <FileText size={20} color="#fff" strokeWidth={2.2} />}
          </div>
        </div>
      </div>

      <div style={{ padding: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {/* Type Toggle - Pill Style */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: 6,
          background: t.paper, border: `1.4px solid ${t.hairline}`, borderRadius: 18
        }}>
          <button
            aria-pressed={type === 'order'}
            onClick={() => setType('order')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              height: 46, borderRadius: 14, border: 'none', cursor: 'pointer',
              fontFamily: "'Inter', sans-serif", fontSize: 13.5, fontWeight: 600,
              background: type === 'order' ? `linear-gradient(135deg, ${t.teal[500]}, ${t.teal[700]})` : 'transparent',
              color: type === 'order' ? '#fff' : t.inkSoft,
              boxShadow: type === 'order' ? '0 4px 14px -4px rgba(15,84,76,.5)' : 'none',
              transition: 'all .2s cubic-bezier(.4,0,.2,1)', position: 'relative', overflow: 'hidden'
            }}
          >
            {type === 'order' && (
              <div style={{
                position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(255,255,255,.15), transparent)',
                borderRadius: 14
              }} />
            )}
            <ShoppingCart size={16} strokeWidth={2.2} />
            <span style={{ position: 'relative', zIndex: 1 }}>Order</span>
          </button>
          <button
            aria-pressed={type === 'quotation'}
            onClick={() => setType('quotation')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              height: 46, borderRadius: 14, border: 'none', cursor: 'pointer',
              fontFamily: "'Inter', sans-serif", fontSize: 13.5, fontWeight: 600,
              background: type === 'quotation' ? `linear-gradient(135deg, ${t.teal[500]}, ${t.teal[700]})` : 'transparent',
              color: type === 'quotation' ? '#fff' : t.inkSoft,
              boxShadow: type === 'quotation' ? '0 4px 14px -4px rgba(15,84,76,.5)' : 'none',
              transition: 'all .2s cubic-bezier(.4,0,.2,1)', position: 'relative', overflow: 'hidden'
            }}
          >
            {type === 'quotation' && (
              <div style={{
                position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(255,255,255,.15), transparent)',
                borderRadius: 14
              }} />
            )}
            <FileText size={16} strokeWidth={2.2} />
            <span style={{ position: 'relative', zIndex: 1 }}>Quotation</span>
          </button>
        </div>

        {/* Reference (reorder) */}
        {reorderRef && (
          <div style={{
            background: t.paper, borderRadius: 18, border: `1.4px solid ${t.hairline}`,
            overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)'
          }}>
            <div style={{ padding: '10px 14px' }}>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: t.teal[800],
                marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.06
              }}>
                <Link2 size={14} /> Reference
              </label>
              <input
                readOnly
                value={`From ${reorderRef}`}
                style={{
                  ...fieldBase, fontSize: 13.5, minHeight: 44, padding: '10px 14px',
                  background: t.teal[50], borderColor: t.teal[200], color: t.teal[800], fontWeight: 600,
                }}
                onFocus={(e) => { e.target.select(); }}
              />
            </div>
          </div>
        )}

        {/* Search Products */}
        <div style={{
          background: t.paper, borderRadius: 18, border: `1.4px solid ${t.hairline}`,
          overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)'
        }}>
          <div style={{ padding: '10px 14px 12px' }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: t.teal[800],
              marginBottom: 8, letterSpacing: 0.02
            }}>
              <Search size={13} /> Search Products
            </label>
            <div style={{ position: 'relative' }}>
              <Search size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: t.inkSoft, pointerEvents: 'none' }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products by name, SKU..."
                style={{ ...fieldBase, paddingLeft: 42, fontSize: 13.5, height: 44 }}
                onFocus={focusIn}
                onBlur={focusOut}
              />
            </div>

            {search.trim() && (
              <div style={{
                marginTop: 10, maxHeight: 260, overflowY: 'auto', borderRadius: 14,
                border: `1.4px solid ${t.hairline}`, background: '#fff',
                boxShadow: '0 4px 12px -4px rgba(0,0,0,.08)'
              }}>
                {filteredCatalog.length === 0 ? (
                  <div style={{ padding: '20px 14px', textAlign: 'center' }}>
                    <Package size={28} color={t.teal[300]} style={{ margin: '0 auto 8px' }} />
                    <p style={{ margin: 0, fontSize: 13, color: t.inkSoft, lineHeight: 1.45 }}>No products match your search</p>
                  </div>
                ) : (
                  filteredCatalog.slice(0, 20).map((item: any) => (
                    <button
                      key={item.id}
                      onClick={() => addLine(item)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 54, padding: '10px 14px',
                        textAlign: 'left', border: 'none', borderBottom: `1px solid ${t.hairline}`,
                        background: 'transparent', cursor: 'pointer', fontSize: 13.5, transition: 'all .15s ease'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = t.teal[50]; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                        <p style={{ fontWeight: 600, color: t.ink, margin: 0, lineHeight: 1.4, fontSize: 13.5 }}>{item.name}</p>
                        <p style={{ fontSize: 12, color: t.inkSoft, marginTop: 2, lineHeight: 1.4 }}>
                          {item.sku || ''}{item.unit ? ` • ${item.unit}` : ''} • {formatK(item.price)}
                        </p>
                      </div>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                        background: `linear-gradient(135deg, ${t.teal[500]}, ${t.teal[600]})`, color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 2px 6px -2px rgba(15,84,76,.4)'
                      }}>
                        <Plus size={18} strokeWidth={3} />
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Selected Items */}
        <div style={{
          background: t.paper, borderRadius: 18, border: `1.4px solid ${t.hairline}`,
          overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)'
        }}>
          <div style={{
            padding: '8px 14px', borderBottom: `1px solid ${t.hairline}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8
          }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, color: t.inkSoft, textTransform: 'uppercase', letterSpacing: 0.06, margin: 0 }}>
              Selected Items ({lines.length})
            </h2>
            <span style={{ fontSize: 12, color: t.inkSoft, fontWeight: 500 }}>{customerName}</span>
          </div>
          {lines.length === 0 ? (
            <div style={{ padding: '36px 14px', textAlign: 'center' }}>
              <div style={{
                width: 52, height: 52, borderRadius: 16, background: `${t.teal[500]}12`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px'
              }}>
                <Package size={26} color={t.teal[400]} />
              </div>
              <p style={{ margin: 0, fontSize: 13.5, color: t.inkSoft, lineHeight: 1.5 }}>
                No items selected yet.<br />Search and add products above.
              </p>
            </div>
          ) : (
            <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {lines.map((l) => (
                <div key={l.id} style={{
                  background: '#fff', borderRadius: 14,
                  border: `1.4px solid ${t.hairline}`, padding: '10px 12px',
                  boxShadow: '0 1px 2px rgba(0,0,0,.03)', animation: 'slideUp .2s ease'
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: 13.5, fontWeight: 600, color: t.ink, margin: 0, lineHeight: 1.4 }}>{l.name}</p>
                      <p style={{ fontSize: 12, color: t.inkSoft, marginTop: 2, lineHeight: 1.4 }}>
                        {l.unit ? `${l.unit} • ` : ''}{formatK(l.unitPrice)} each
                      </p>
                    </div>
                    <button
                      onClick={() => removeLine(l.id)}
                      aria-label={`Remove ${l.name}`}
                      style={{
                        width: 40, height: 40, borderRadius: 10, border: 'none', cursor: 'pointer',
                        background: `${t.danger}12`, color: t.danger, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s ease'
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        onClick={() => updateQuantity(l.id, l.quantity - 1)}
                        aria-label="Decrease quantity"
                        style={{
                          width: 40, height: 40, borderRadius: 10, border: `1.4px solid ${t.hairline}`,
                          background: t.paper, color: t.teal[600], cursor: 'pointer', fontSize: 16, fontWeight: 600,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s ease'
                        }}
                      >
                        <Minus size={16} strokeWidth={2.5} />
                      </button>
                      <div style={{
                        width: 56, height: 40, borderRadius: 10, border: `1.4px solid ${t.hairline}`,
                        background: t.paper, display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 600, color: t.ink, fontVariantNumeric: 'tabular-nums' }}>{l.quantity}</span>
                      </div>
                      <button
                        onClick={() => updateQuantity(l.id, l.quantity + 1)}
                        aria-label="Increase quantity"
                        style={{
                          width: 40, height: 40, borderRadius: 10, border: `1.4px solid ${t.hairline}`,
                          background: t.paper, color: t.teal[600], cursor: 'pointer', fontSize: 16, fontWeight: 600,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s ease'
                        }}
                      >
                        <Plus size={16} strokeWidth={2.5} />
                      </button>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ margin: 0, fontSize: 10.5, color: t.inkSoft, textTransform: 'uppercase', letterSpacing: 0.06, fontWeight: 600, lineHeight: 1.4 }}>Total</p>
                      <p style={{ margin: '1px 0 0', fontSize: 14, fontWeight: 600, color: t.ink, fontFamily: MONO, letterSpacing: 0.1, fontVariantNumeric: 'tabular-nums' }}>
                        {formatK(l.quantity * l.unitPrice)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Delivery & Notes */}
        <div style={{
          background: t.paper, borderRadius: 18, border: `1.4px solid ${t.hairline}`,
          padding: '14px 14px', boxShadow: '0 1px 3px rgba(0,0,0,.04)'
        }}>
          <h2 style={{ fontSize: 12, fontWeight: 600, color: t.inkSoft, textTransform: 'uppercase', letterSpacing: 0.08, margin: '0 0 10px', lineHeight: 1.4 }}>
            Delivery & Notes
          </h2>
          <div style={{ marginBottom: 12 }}>
            <label style={{
              display: 'block', fontSize: 12, fontWeight: 600, color: t.teal[800], marginBottom: 6, letterSpacing: 0.01, lineHeight: 1.4
            }}>
              Delivery Date
            </label>
            <input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              style={{ ...fieldBase, fontSize: 13.5, height: 42 }}
              onFocus={focusIn}
              onBlur={focusOut}
            />
          </div>
          <div>
            <label style={{
              display: 'block', fontSize: 12, fontWeight: 600, color: t.teal[800], marginBottom: 6, letterSpacing: 0.01, lineHeight: 1.4
            }}>
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={type === 'order' ? 'Order instructions, special requirements...' : 'Tell us what you need...'}
              style={{ ...fieldBase, minHeight: 88, lineHeight: 1.5, resize: 'vertical', fontSize: 13.5 }}
              onFocus={focusIn}
              onBlur={focusOut}
            />
          </div>
        </div>

        {/* Summary */}
        <div style={{
          background: `linear-gradient(135deg, ${t.teal[500]}08, ${t.teal[400]}05)`,
          borderRadius: 18, border: `1.4px solid ${t.teal[200]}`,
          padding: '14px 16px', boxShadow: '0 2px 8px -4px rgba(15,84,76,.12)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: t.teal[700], textTransform: 'uppercase', letterSpacing: 0.06, lineHeight: 1.4 }}>Estimated Total</p>
              <p style={{ margin: '3px 0 0', fontSize: 12, color: t.inkSoft, lineHeight: 1.4 }}>
                {lines.length} item{lines.length === 1 ? '' : 's'}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 600, color: t.ink, fontFamily: MONO, letterSpacing: 0.15, fontVariantNumeric: 'tabular-nums', lineHeight: 1.35 }}>
                {formatK(subtotal)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky Bottom Action Bar */}
      <div
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 30,
          background: 'rgba(254,253,251,.96)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          borderTop: `1px solid ${t.hairline}`, boxShadow: '0 -8px 24px -12px rgba(0,0,0,.15)'
        }}
      >
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', alignItems: 'stretch', gap: 10, padding: '10px 16px', paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}>
          <button
            onClick={() => navigate('/portal/requests')}
            style={{
              height: 46, padding: '0 14px', borderRadius: 14, cursor: 'pointer',
              border: `1.4px solid ${t.hairline}`, background: t.paper, color: t.ink,
              fontFamily: "'Inter', sans-serif", fontSize: 13.5, fontWeight: 600,
              display: 'inline-flex', alignItems: 'center', gap: 6, transition: 'all .15s ease', lineHeight: 1.4
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || lines.length === 0}
            style={{
              flex: 1, height: 46, borderRadius: 14, border: 'none', cursor: saving || lines.length === 0 ? 'not-allowed' : 'pointer',
              background: saving || lines.length === 0
                ? t.hairline
                : `linear-gradient(135deg, ${t.teal[500]}, ${t.teal[700]})`,
              color: saving || lines.length === 0 ? t.inkSoft : '#fff', fontSize: 13.5, fontWeight: 600,
              fontFamily: "'Inter', sans-serif", lineHeight: 1.4,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: saving || lines.length === 0 ? 'none' : '0 8px 20px -8px rgba(15,84,76,.6)',
              transition: 'all .2s cubic-bezier(.4,0,.2,1)'
            }}
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : (
              type === 'order' ? 'Submit Order' : 'Request Quotation'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CustomerCreateRequest;
