import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Search, Plus, Trash2, ShoppingCart, FileText, Loader2, CheckCircle2 } from 'lucide-react';
import { api } from '../../services/api';
import { portalLifecycle } from '../../services/portalApiClient';
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
    if (lines.length === 0) return;
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
      <div className="p-6 max-w-4xl mx-auto flex items-center justify-center min-h-[60vh]">
        <Loader2 size={28} className="animate-spin text-emerald-600" />
      </div>
    );
  }

  if (successId) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={28} className="text-emerald-600" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-1">
            {type === 'order' ? 'Order requested' : 'Quotation requested'}
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            Reference #{successId} — our team will review your request shortly.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => navigate('/portal/requests')}
              className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-green-500 hover:from-emerald-500 hover:to-green-400 text-white text-sm font-semibold rounded-xl transition-all"
            >
              Track Request
            </button>
            <button
              onClick={() => navigate('/portal/new-request')}
              className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-semibold rounded-xl transition-all"
            >
              Create Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button onClick={() => navigate('/portal/requests')} className="inline-flex items-center gap-1 text-sm text-emerald-600 hover:text-emerald-600 mb-6 transition-colors">
        <ArrowLeft size={14} /> Back to Requests
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">New Request</h1>
        <p className="text-sm text-slate-500 mt-1">Create an order or request a quotation</p>
      </div>

      <div className="grid grid-cols-2 gap-3 max-w-sm mb-8">
        <button
          onClick={() => setType('order')}
          className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold transition-all border ${
            type === 'order'
              ? 'bg-emerald-600 border-emerald-500 text-white'
              : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-100'
          }`}
        >
          <ShoppingCart size={16} /> Order
        </button>
        <button
          onClick={() => setType('quotation')}
          className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold transition-all border ${
            type === 'quotation'
              ? 'bg-emerald-600 border-emerald-500 text-white'
              : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-100'
          }`}
        >
          <FileText size={16} /> Quotation
        </button>
      </div>

      {error && (
        <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-600">{error}</div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-slate-800 mb-4">Add Items</h2>
        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products..."
            className="w-full h-10 pl-9 pr-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60"
          />
        </div>
        {search.trim() && (
          <div className="mb-4 max-h-52 overflow-y-auto custom-scrollbar border border-slate-200 rounded-lg divide-y divide-slate-700/50">
            {filteredCatalog.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-400">No products match your search</p>
            ) : (
              filteredCatalog.slice(0, 20).map((item: any) => (
                <button
                  key={item.id}
                  onClick={() => addLine(item)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{item.name}</p>
                    <p className="text-xs text-slate-400">{item.sku || ''}{item.unit ? ` • ${item.unit}` : ''}</p>
                  </div>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-mono text-slate-700">K {Number(item.price).toFixed(2)}</span>
                    <Plus size={16} className="text-emerald-600" />
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-slate-200/60 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">Selected Items ({lines.length})</h2>
          <span className="text-xs text-slate-500">{customerName}</span>
        </div>
        {lines.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">No items selected yet — search and add products above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px] table-fixed">
              <thead className="bg-slate-50/80 backdrop-blur text-slate-500 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left">Item</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right">Unit Price</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right">Qty</th>
                  <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right">Total</th>
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
                        className="w-16 h-8 px-2 bg-white/70 backdrop-blur-xl border border-slate-200 rounded-lg text-sm text-slate-800 text-right focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                      />
                    </td>
                    <td className="px-5 py-3 text-right font-mono">K {(l.quantity * l.unitPrice).toFixed(2)}</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => removeLine(l.id)} className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 transition-colors">
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

      <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 p-5 mb-6 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder={type === 'order' ? 'Order instructions, special requirements...' : 'Tell us what you need...'}
            className="w-full px-3 py-2.5 bg-white/70 backdrop-blur-xl border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none"
          />
        </div>
        <div className="flex items-center justify-between border-t border-slate-200/60 pt-4">
          <span className="text-sm font-semibold text-slate-700">Total</span>
          <span className="text-2xl font-bold text-slate-900 font-mono">K {subtotal.toFixed(2)}</span>
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={saving || lines.length === 0}
        className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-emerald-600 to-green-500 hover:from-emerald-500 hover:to-green-400 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl shadow-lg shadow-emerald-600/25 transition-all flex items-center justify-center gap-2"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : null}
        {type === 'order' ? 'Submit Order' : 'Request Quotation'}
      </button>
    </div>
  );
};

export default CustomerCreateRequest;
