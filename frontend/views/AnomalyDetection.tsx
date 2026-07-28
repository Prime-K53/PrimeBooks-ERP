import React, { useState, useMemo } from 'react';
import { AlertTriangle, AlertCircle, TrendingUp, TrendingDown, DollarSign, Package, Percent, ShieldAlert, Calendar, Filter, Search, X, RefreshCw, Clock, ArrowUpDown } from 'lucide-react';
import { detectDuplicatePayments, detectSalesSpikes, detectSalesDrops, detectUnusualInventoryMovements, detectSuspiciousDiscounts, detectAbnormalExpensePatterns, detectFraudIndicators } from '../services/anomalyDetectionService';
import { formatCurrency } from '../services/reportSummaryService';
import { useAuth } from '../context/AuthContext';
import { useSales } from '../context/SalesContext';
import { useFinance } from '../context/FinanceContext';
import { useInventory } from '../context/InventoryContext';

type Severity = 'low' | 'medium' | 'high';

interface AnomalyBase {
  id: string;
  category: string;
  description: string;
  amount?: number;
  severity: Severity;
  date: string;
  transactionRef?: string;
  source: string;
}

interface FraudIndicator extends AnomalyBase {
  recommendation: string;
  fraudType: string;
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

const severityBadge = (severity: Severity) => {
  const colors: Record<Severity, string> = {
    low: 'bg-blue-100 text-blue-700',
    medium: 'bg-amber-100 text-amber-700',
    high: 'bg-red-100 text-red-700'
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${colors[severity]}`}>
      {severity === 'high' && <AlertCircle size={10} />}
      {severity === 'medium' && <AlertTriangle size={10} />}
      {severity === 'low' && <Clock size={10} />}
      {severity.toUpperCase()}
    </span>
  );
};

const categoryIcon = (category: string) => {
  const icons: Record<string, React.ReactNode> = {
    duplicate_payment: <DollarSign size={14} className="text-rose-500" />,
    sales_spike: <TrendingUp size={14} className="text-emerald-500" />,
    sales_drop: <TrendingDown size={14} className="text-orange-500" />,
    unusual_inventory: <Package size={14} className="text-purple-500" />,
    suspicious_discount: <Percent size={14} className="text-yellow-500" />,
    abnormal_expense: <DollarSign size={14} className="text-red-500" />,
    fraud_indicator: <ShieldAlert size={14} className="text-rose-600" />
  };
  return icons[category] || <AlertCircle size={14} className="text-slate-500" />;
};

const categoryLabel = (category: string) => {
  const labels: Record<string, string> = {
    duplicate_payment: 'Duplicate Payment',
    sales_spike: 'Sales Spike',
    sales_drop: 'Sales Drop',
    unusual_inventory: 'Unusual Inventory',
    suspicious_discount: 'Suspicious Discount',
    abnormal_expense: 'Abnormal Expense',
    fraud_indicator: 'Fraud Indicator'
  };
  return labels[category] || category;
};

const AnomalyDetection: React.FC = () => {
  const { notify } = useAuth();

  const { sales } = useSales();
  const { invoices, expenses } = useFinance();
  const { inventory } = useInventory();
  const payments: any[] = [];
  const [isLoading] = useState(false);
  const [error] = useState<string | null>(null);

  const [filterSeverity, setFilterSeverity] = useState<Severity | 'all'>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  const anomalies = useMemo(() => {
    const results: AnomalyBase[] = [];

    try {
      const duplicatePayments = detectDuplicatePayments(payments);
      duplicatePayments.forEach(dp => {
        results.push({
          id: `dup-${dp.paymentId}`,
          category: 'duplicate_payment',
          description: dp.reason,
          amount: undefined,
          severity: dp.confidence > 80 ? 'high' : dp.confidence > 60 ? 'medium' : 'low',
          date: '',
          transactionRef: dp.paymentId,
          source: 'payment'
        });
      });
    } catch { }

    try {
      const salesSpikes = detectSalesSpikes(sales, invoices);
      salesSpikes.forEach(sp => {
        results.push({
          id: `spike-${sp.date}`,
          category: 'sales_spike',
          description: `Sales spike on ${sp.date}: ${formatCurrency(sp.amount)} (${sp.deviation.toFixed(1)}σ above avg ${formatCurrency(sp.averageAmount)})`,
          amount: sp.amount,
          severity: sp.deviation >= 4 ? 'high' : sp.deviation >= 3 ? 'medium' : 'low',
          date: sp.date,
          transactionRef: sp.transactions[0],
          source: 'sales'
        });
      });
    } catch { }

    try {
      const salesDrops = detectSalesDrops(sales, invoices);
      salesDrops.forEach(sd => {
        results.push({
          id: `drop-${sd.date}`,
          category: 'sales_drop',
          description: `Sales drop on ${sd.date}: ${formatCurrency(sd.amount)} (${Math.abs(sd.deviation).toFixed(1)}σ below avg ${formatCurrency(sd.averageAmount)})`,
          amount: sd.amount,
          severity: Math.abs(sd.deviation) >= 4 ? 'high' : Math.abs(sd.deviation) >= 3 ? 'medium' : 'low',
          date: sd.date,
          transactionRef: sd.transactions[0],
          source: 'sales'
        });
      });
    } catch { }

    try {
      const inventoryMovements = detectUnusualInventoryMovements(inventory, []);
      inventoryMovements.forEach(im => {
        results.push({
          id: `inv-${im.itemId}-${im.movementType}-${Date.now()}`,
          category: 'unusual_inventory',
          description: im.reason,
          amount: im.quantity,
          severity: im.severity,
          date: '',
          transactionRef: im.itemId,
          source: 'inventory'
        });
      });
    } catch { }

    try {
      const suspiciousDiscounts = detectSuspiciousDiscounts(sales, invoices);
      suspiciousDiscounts.forEach(sd => {
        results.push({
          id: `disc-${sd.transactionId}`,
          category: 'suspicious_discount',
          description: sd.reason,
          amount: sd.amount,
          severity: sd.severity,
          date: '',
          transactionRef: sd.transactionId,
          source: 'sales'
        });
      });
    } catch { }

    try {
      const abnormalExpenses = detectAbnormalExpensePatterns(expenses);
      abnormalExpenses.forEach(ae => {
        results.push({
          id: `exp-${ae.expenseId}`,
          category: 'abnormal_expense',
          description: ae.reason,
          amount: ae.amount,
          severity: ae.severity,
          date: '',
          transactionRef: ae.expenseId,
          source: 'expense'
        });
      });
    } catch { }

    return results;
  }, [sales, invoices, expenses, payments, inventory]);

  const fraudIndicators = useMemo(() => {
    const results: FraudIndicator[] = [];
    try {
      const indicators = detectFraudIndicators(sales, invoices, expenses, inventory);
      indicators.forEach(fi => {
        results.push({
          id: `fraud-${fi.type}-${fi.transactionId || Math.random()}`,
          category: 'fraud_indicator',
          description: fi.detail,
          amount: fi.amount,
          severity: fi.severity,
          date: '',
          transactionRef: fi.transactionId,
          source: 'fraud',
          recommendation: fi.recommendation,
          fraudType: fi.type
        });
      });
    } catch { }
    return results;
  }, [sales, invoices, expenses, inventory]);

  const allAnomalies = useMemo(() => [...anomalies, ...fraudIndicators], [anomalies, fraudIndicators]);

  const filteredAnomalies = useMemo(() => {
    return allAnomalies.filter(a => {
      if (filterSeverity !== 'all' && a.severity !== filterSeverity) return false;
      if (filterCategory !== 'all' && a.category !== filterCategory) return false;
      if (filterDateFrom && a.date && a.date < filterDateFrom) return false;
      if (filterDateTo && a.date && a.date > filterDateTo) return false;
      return true;
    }).sort((a, b) => {
      const sevOrder = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (sevOrder !== 0) return sevOrder;
      return (b.date || '').localeCompare(a.date || '');
    });
  }, [allAnomalies, filterSeverity, filterCategory, filterDateFrom, filterDateTo]);

  const summaryStats = useMemo(() => ({
    total: allAnomalies.length,
    critical: allAnomalies.filter(a => a.severity === 'high').length,
    byCategory: allAnomalies.reduce((acc, a) => {
      acc[a.category] = (acc[a.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  }), [allAnomalies]);

  const uniqueCategories = useMemo(() => [...new Set(allAnomalies.map(a => a.category))], [allAnomalies]);

  if (isLoading) {
    return (
      <div className="p-6 max-w-[1600px] mx-auto h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="animate-spin text-blue-600" size={24} />
          <p className="text-sm text-slate-500">Running anomaly detection...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-[1600px] mx-auto h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="prime-card p-8 max-w-md text-center">
          <AlertCircle className="mx-auto mb-3" size={32} style={{ color: '#b5493f' }} />
          <h3 className="font-bold text-sm mb-2" style={{ color: '#23282A' }}>Detection Failed</h3>
          <p className="text-xs mb-4" style={{ color: '#5c6567' }}>{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto flex flex-col overflow-hidden" style={{ minHeight: '100vh', background: '#f0f4f8' }}>
      <div className="mb-6 shrink-0">
        <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <ShieldAlert className="text-rose-600" size={20} />
          Anomaly Detection
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">Automated detection of unusual patterns, fraud indicators, and data anomalies</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6 shrink-0">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center gap-4 border-l-4 border-l-slate-500">
          <div className="p-2.5 bg-slate-50 text-slate-600 rounded-lg">
            <AlertTriangle size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight leading-none mb-1.5">Total Anomalies</p>
            <p className="text-xl font-semibold text-slate-900">{summaryStats.total}</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center gap-4 border-l-4 border-l-red-500">
          <div className="p-2.5 bg-red-50 text-red-600 rounded-lg">
            <AlertCircle size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight leading-none mb-1.5">Critical (High)</p>
            <p className="text-xl font-semibold text-slate-900">{summaryStats.critical}</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center gap-4 border-l-4 border-l-amber-500">
          <div className="p-2.5 bg-amber-50 text-amber-600 rounded-lg">
            <ShieldAlert size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight leading-none mb-1.5">Fraud Indicators</p>
            <p className="text-xl font-semibold text-slate-900">{fraudIndicators.length}</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center gap-4 border-l-4 border-l-purple-500">
          <div className="p-2.5 bg-purple-50 text-purple-600 rounded-lg">
            <Package size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight leading-none mb-1.5">Categories Affected</p>
            <p className="text-xl font-semibold text-slate-900">{uniqueCategories.length}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4 shrink-0 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2">
          <Filter size={14} className="text-slate-400" />
          <select
            value={filterSeverity}
            onChange={e => setFilterSeverity(e.target.value as Severity | 'all')}
            className="text-xs font-semibold text-slate-600 bg-transparent border-none outline-none appearance-none cursor-pointer"
          >
            <option value="all">All Severities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2">
          <Search size={14} className="text-slate-400" />
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="text-xs font-semibold text-slate-600 bg-transparent border-none outline-none appearance-none cursor-pointer"
          >
            <option value="all">All Categories</option>
            {uniqueCategories.map(cat => (
              <option key={cat} value={cat}>{categoryLabel(cat)}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2">
          <Calendar size={14} className="text-slate-400" />
          <input
            type="date"
            value={filterDateFrom}
            onChange={e => setFilterDateFrom(e.target.value)}
            className="text-xs font-semibold text-slate-600 bg-transparent border-none outline-none"
            placeholder="From"
          />
          <span className="text-slate-300">-</span>
          <input
            type="date"
            value={filterDateTo}
            onChange={e => setFilterDateTo(e.target.value)}
            className="text-xs font-semibold text-slate-600 bg-transparent border-none outline-none"
            placeholder="To"
          />
        </div>
        {(filterSeverity !== 'all' || filterCategory !== 'all' || filterDateFrom || filterDateTo) && (
          <button
            onClick={() => { setFilterSeverity('all'); setFilterCategory('all'); setFilterDateFrom(''); setFilterDateTo(''); }}
            className="flex items-center gap-1 px-3 py-2 text-xs font-bold text-slate-500 hover:text-red-600 transition-colors"
          >
            <X size={14} /> Clear
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6">
        <div className="prime-card overflow-hidden">
          <div className="p-4 flex items-center justify-between" style={{ borderBottom: '1.4px solid #e4ddd1', background: '#eef7f6' }}>
            <h3 className="font-bold text-sm flex items-center gap-2" style={{ color: '#23282A' }}>
              <ArrowUpDown size={14} style={{ color: '#5c6567' }} />
              All Detected Anomalies
            </h3>
            <span className="text-[10px] font-bold" style={{ color: '#5c6567' }}>{filteredAnomalies.length} of {allAnomalies.length}</span>
          </div>
          {filteredAnomalies.length === 0 ? (
            <div className="p-12 text-center">
              <AlertCircle className="mx-auto mb-3" size={32} style={{ color: '#e4ddd1' }} />
              <p className="text-sm font-semibold" style={{ color: '#5c6567' }}>No Anomalies Found</p>
              <p className="text-xs mt-1" style={{ color: '#5c6567' }}>All business data appears normal for the selected filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-4">Type</th>
                    <th className="px-6 py-4">Description</th>
                    <th className="px-6 py-4 text-right">Amount</th>
                    <th className="px-6 py-4 text-center">Severity</th>
                    <th className="px-6 py-4">Date / Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredAnomalies.map(a => (
                    <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {categoryIcon(a.category)}
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{categoryLabel(a.category)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-700 max-w-[320px]">{a.description}</td>
                      <td className="px-6 py-4 text-right text-xs font-bold text-slate-900 finance-nums">
                        {a.amount !== undefined ? formatCurrency(a.amount) : '-'}
                      </td>
                      <td className="px-6 py-4 text-center">{severityBadge(a.severity)}</td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          {a.date && <span className="text-xs text-slate-500">{a.date}</span>}
                          {a.transactionRef && <span className="text-[10px] text-slate-400 font-mono">{a.transactionRef}</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {fraudIndicators.length > 0 && (
          <div className="prime-card overflow-hidden" style={{ borderColor: '#fecaca' }}>
            <div className="p-4 flex items-center justify-between" style={{ borderBottom: '1.4px solid #fecaca', background: '#fef2f2' }}>
              <h3 className="font-bold text-sm flex items-center gap-2" style={{ color: '#991b1b' }}>
                <ShieldAlert size={14} />
                Fraud Indicators
                <span className="text-[10px] font-bold ml-2" style={{ color: '#b5493f' }}>({fraudIndicators.length} detected)</span>
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-rose-50/50 text-rose-700 font-medium border-b border-rose-200 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-4">Type</th>
                    <th className="px-6 py-4">Detail</th>
                    <th className="px-6 py-4 text-right">Amount</th>
                    <th className="px-6 py-4 text-center">Severity</th>
                    <th className="px-6 py-4">Recommendation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rose-100">
                  {fraudIndicators.map(fi => (
                    <tr key={fi.id} className="hover:bg-rose-50/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <ShieldAlert size={14} className="text-rose-500" />
                          <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider">{fi.fraudType.replace(/_/g, ' ')}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-700 max-w-[300px]">{fi.description}</td>
                      <td className="px-6 py-4 text-right text-xs font-bold text-slate-900 finance-nums">
                        {fi.amount !== undefined ? formatCurrency(fi.amount) : '-'}
                      </td>
                      <td className="px-6 py-4 text-center">{severityBadge(fi.severity)}</td>
                      <td className="px-6 py-4 text-xs text-slate-600 max-w-[250px]">{fi.recommendation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnomalyDetection;
