import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Search, Plus, Trash2, ShoppingCart, FileText, Loader2, CheckCircle2, User, ChevronRight } from 'lucide-react';
import { api } from '../../services/api';
import { portalLifecycle } from '../../services/portalApiClient';
import PortalPageHeader from './components/PortalPageHeader';
import PortalCard from './components/PortalCard';
import PortalButton from './components/PortalButton';
import PortalInput from './components/PortalInput';
import ErrorBanner from './components/ErrorBanner';
import { portalTheme, DEFAULT_PAGE_SIZE } from './constants';
import { validateRequired, validateEmail, validatePassword, validateConfirmPassword } from './utils/validation';
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
const danger = '#b5493f';
const currencySymbol = 'K ';

const labelStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  fontSize: 12, fontWeight: 600, color: teal[800],
  marginBottom: 6, letterSpacing: 0.01
};

const inputStyle: React.CSSProperties = {
  width: '100%', fontFamily: "'Inter', sans-serif", fontSize: 13.5,
  color: ink, background: paper,
  border: `1.4px solid ${hairline}`, borderRadius: 9,
  padding: '9px 12px', outline: 'none',
  transition: 'border-color .15s ease, box-shadow .15s ease, background .15s ease'
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%235c6567'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  paddingRight: 30,
  cursor: 'pointer'
};

const sectionLabelStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  margin: '26px 0 14px'
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
          api.inventory.getAllItems(),
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
  const customerPhone = customerRecord?.phone || '';

  const filteredCatalog = useMemo(() => {
    const term = search.trim().toLowerCase();
    const available = (catalog || []).filter(
      (item: any) =>
        item.status !== 'Deleted' &&
        Number(item.price) > 0 &&
        (Number(item.stock) || 0) > 0
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
      <div className="p-8 max-w-3xl mx-auto flex items-center justify-center min-h-[60vh]">
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 10px -3px rgba(15,84,76,.6)'
        }}>
          <Loader2 size={20} color="#fff" className="animate-spin" />
        </div>
      </div>
    );
  }

  if (successId) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div style={{
          borderRadius: 14, background: paper,
          border: `1.4px solid ${hairline}`,
          boxShadow: '0 30px 70px -20px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.04)',
          padding: 40, textAlign: 'center'
        }}>
          {/* Accent stripe */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 4,
            background: `linear-gradient(90deg, ${teal[600]}, ${teal[400]} 40%, ${amber[500]} 100%)`
          }} />
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: `${teal[500]}15`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px'
          }}>
            <CheckCircle2 size={28} color={teal[600]} />
          </div>
          <h2 style={{
            fontFamily: "'DM Serif Display', 'Georgia', serif",
            fontSize: 22, margin: 0, color: teal[800], letterSpacing: 0.2
          }}>
            {type === 'order' ? 'Order requested' : 'Quotation requested'}
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: 11.5, color: inkSoft, letterSpacing: 0.02 }}>
            Reference #{successId} — our team will review your request shortly.
          </p>
          <div style={{ marginTop: 28, display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              onClick={() => navigate('/portal/requests')}
              style={{
                fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 700,
                padding: '10px 22px', borderRadius: 9, cursor: 'pointer', border: 'none',
                background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
                color: '#fff', boxShadow: '0 6px 16px -6px rgba(15,84,76,.55)',
                transition: 'all .15s ease'
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 20px -6px rgba(15,84,76,.65)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 6px 16px -6px rgba(15,84,76,.55)'; }}
            >
              Track Request
            </button>
            <button
              onClick={() => navigate('/portal/new-request')}
              style={{
                fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
                padding: '10px 22px', borderRadius: 9, cursor: 'pointer',
                background: paper, border: `1.4px solid ${hairline}`, color: inkSoft,
                transition: 'all .15s ease'
              }}
              onMouseEnter={e => { e.currentTarget.style.background = teal[50]; e.currentTarget.style.color = teal[800]; e.currentTarget.style.borderColor = teal[200]; }}
              onMouseLeave={e => { e.currentTarget.style.background = paper; e.currentTarget.style.color = inkSoft; e.currentTarget.style.borderColor = hairline; }}
            >
              Create Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <button onClick={() => navigate('/portal/requests')} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 13, color: teal[600], fontWeight: 500,
        transition: 'color .15s'
      }}>
        <ArrowLeft size={14} /> Back to Requests
      </button>

      <div style={{
        marginTop: 24,
        background: paper, borderRadius: 14,
        boxShadow: '0 30px 70px -20px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.04)',
        overflow: 'hidden', position: 'relative'
      }}>
        {/* Accent stripe */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 4,
          background: `linear-gradient(90deg, ${teal[600]}, ${teal[400]} 40%, ${amber[500]} 100%)`
        }} />

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '22px 28px 18px',
          borderBottom: `1px solid ${hairline}`,
          background: paper
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: type === 'order'
                ? `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`
                : `linear-gradient(155deg, ${amber[500]}, ${amber[600]})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 10px -3px rgba(15,84,76,.6)', flexShrink: 0
            }}>
              {type === 'order' ? <ShoppingCart size={19} color="#fff" /> : <FileText size={19} color="#fff" />}
            </div>
            <div>
              <h1 style={{
                fontFamily: "'DM Serif Display', 'Georgia', serif", fontWeight: 400,
                fontSize: 22, margin: 0, color: type === 'order' ? teal[800] : amber[600], letterSpacing: 0.2
              }}>
                New {type === 'order' ? 'Order' : 'Quotation'} Request
              </h1>
              <p style={{ margin: '2px 0 0', fontSize: 11.5, color: inkSoft, letterSpacing: 0.02 }}>
                {type === 'order'
                  ? 'Place a new order with our team'
                  : 'Request a quotation for your needs'}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setType('order')}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', fontSize: 12, fontWeight: 600,
                borderRadius: 8, border: 'none', cursor: 'pointer',
                background: type === 'order' ? teal[50] : `rgba(217,154,63,.08)`,
                color: type === 'order' ? teal[700] : inkSoft,
                transition: 'all .15s ease'
              }}
            >
              <ShoppingCart size={14} /> Order
            </button>
            <button
              onClick={() => setType('quotation')}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', fontSize: 12, fontWeight: 600,
                borderRadius: 8, border: 'none', cursor: 'pointer',
                background: type === 'quotation' ? teal[50] : `rgba(217,154,63,.08)`,
                color: type === 'quotation' ? teal[700] : inkSoft,
                transition: 'all .15s ease'
              }}
            >
              <FileText size={14} /> Quotation
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '24px 30px 8px' }}>
          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>
              Search Products
            </label>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: inkSoft }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products..."
                style={{ ...inputStyle, paddingLeft: 40 }}
                onFocus={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.boxShadow = `0 0 0 3px ${teal[50]}`; }}
                onBlur={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>

            {search.trim() && (
              <div style={{
                marginTop: 8,
                maxHeight: 208, overflowY: 'auto',
                border: `1px solid ${hairline}`, borderRadius: 9,
                background: paper, overflow: 'hidden'
              }}>
                {filteredCatalog.length === 0 ? (
                  <p className="px-4 py-3 text-sm" style={{ color: inkSoft }}>No products match your search</p>
                ) : (
                  filteredCatalog.slice(0, 20).map((item: any) => (
                    <button
                      key={item.id}
                      onClick={() => addLine(item)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                        width: '100%', padding: '10px 16px', textAlign: 'left',
                        border: 'none', background: 'transparent', cursor: 'pointer',
                        borderBottom: `1px solid ${hairline}`, fontSize: 13,
                        transition: 'background .15s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = teal[50]}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <p style={{ fontWeight: 500, color: ink }}>{item.name}</p>
                        <p style={{ fontSize: 11, color: inkSoft, marginTop: 2 }}>
                          {item.sku || ''}{item.unit ? ` • ${item.unit}` : ''}
                        </p>
                      </div>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: ink }}>{currencySymbol}{Number(item.price).toFixed(2)}</span>
                        <Plus size={16} color={teal[500]} />
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div style={{
            background: paper, borderRadius: 14,
            border: `1.4px solid ${hairline}`,
            boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(255,255,255,.04)',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '14px 16px',
              borderBottom: `1px solid ${hairline}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6
            }}>
              <h2 style={{
                margin: 0, fontSize: 12, fontWeight: 600,
                color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06
              }}>
                Selected Items ({lines.length})
              </h2>
              <span style={{ fontSize: 10, color: inkSoft }}>{customerName}</span>
            </div>
            {lines.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm" style={{ color: inkSoft }}>
                No items selected yet — search and add products above.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[13px] table-fixed">
                  <thead style={{ background: teal[50] }}>
                    <tr>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: inkSoft }}>Item</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: inkSoft }}>Unit Price</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: inkSoft }}>Qty</th>
                      <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: inkSoft }}>Total</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100/50">
                    {lines.map((l) => (
                      <tr key={l.id} className="text-slate-700">
                        <td className="px-5 py-3">
                          <p className="font-medium text-slate-800">{l.name}</p>
                          {l.unit && <p className="text-xs text-slate-400">{l.unit}</p>}
                        </td>
                        <td className="px-5 py-3 text-right font-mono">K {l.unitPrice.toFixed(2)}</td>
                        <td className="px-5 py-3 text-right">
                          <input
                            type="number"
                            min={1}
                            value={l.quantity}
                            onChange={(e) => updateQuantity(l.id, parseInt(e.target.value, 10) || 1)}
                            style={{
                              width: 64, height: 32, padding: '0 8px',
                              ...inputStyle, textAlign: 'right',
                              fontFamily: "'JetBrains Mono', monospace"
                            }}
                          />
                        </td>
                        <td className="px-5 py-3 text-right font-mono">K {(l.quantity * l.unitPrice).toFixed(2)}</td>
                        <td className="px-5 py-3 text-right">
                          <button onClick={() => removeLine(l.id)} className="p-2 rounded-lg text-rose-600 hover:bg-rose-50 transition-colors" aria-label="Remove line item">
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={{
            background: paper, borderRadius: 14,
            border: `1.4px solid ${hairline}`,
            boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(255,255,255,.04)',
            padding: '20px 24px'
          }}>
            <div>
              <label style={labelStyle}>
                Delivery Date
              </label>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                style={inputStyle}
                onFocus={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.boxShadow = `0 0 0 3px ${teal[50]}`; }}
                onBlur={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>

            <div style={{ marginTop: 18 }}>
              <label style={labelStyle}>
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder={type === 'order' ? 'Order instructions, special requirements...' : 'Tell us what you need...'}
                style={{ ...inputStyle, minHeight: 66, lineHeight: 1.5 }}
              />
            </div>

            <div style={{
              marginTop: 18,
              borderTop: `1px solid ${hairline}`,
              paddingTop: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: inkSoft }}>Total</span>
              <span style={{
                fontSize: 20, fontWeight: 700, color: ink,
                fontFamily: "'JetBrains Mono', monospace"
              }}>
                K {subtotal.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Footer */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 14, padding: '16px 30px',
            borderTop: `1px solid ${hairline}`, background: paper
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: inkSoft }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: amber[500] }} />
              {type === 'order' ? 'Place a new order' : 'Request a quotation'}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => navigate('/portal/requests')}
                style={{
                  fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
                  padding: '9px 18px', borderRadius: 9, cursor: 'pointer',
                  background: paper, border: `1.4px solid ${hairline}`, color: inkSoft,
                  display: 'flex', alignItems: 'center', gap: 7, transition: 'all .15s ease'
                }}
                onMouseEnter={e => { e.currentTarget.style.background = teal[50]; e.currentTarget.style.color = teal[800]; e.currentTarget.style.borderColor = teal[200]; }}
                onMouseLeave={e => { e.currentTarget.style.background = paper; e.currentTarget.style.color = inkSoft; e.currentTarget.style.borderColor = hairline; }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving || lines.length === 0}
                style={{
                  fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
                  padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid transparent',
                  background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
                  color: '#fff', display: 'flex', alignItems: 'center', gap: 7,
                  boxShadow: '0 6px 16px -6px rgba(15,84,76,.55)',
                  transition: 'all .15s ease',
                  opacity: (saving || lines.length === 0) ? 0.5 : 1
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 20px -6px rgba(15,84,76,.65)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 6px 16px -6px rgba(15,84,76,.55)'; }}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                {type === 'order' ? 'Submit Order' : 'Request Quotation'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomerCreateRequest;
