import React, { useEffect, useState, useCallback } from 'react';
import { FileText, RefreshCw, Download, Loader2 } from 'lucide-react';
import { createElement } from 'react';
import { pdf } from '@react-pdf/renderer';
import { portalLifecycle } from '../../services/portalApiClient';
import { attachDocumentSecurity } from '../../utils/documentSecurity';
import { initializePrimePdfFonts } from '../shared/components/PDF/templateSettings';
import { PrimeDocument } from '../shared/components/PDF/PrimeDocument';
import { useAuth } from '../../context/AuthContext';
import PortalPageHeader from './components/PortalPageHeader';
import PortalButton from './components/PortalButton';
import PortalInput from './components/PortalInput';
import PortalCard from './components/PortalCard';
import ErrorBanner from './components/ErrorBanner';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { portalTheme, formatK } from './constants';

interface Transaction {
  date: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

interface StatementData {
  opening_balance: number;
  closing_balance: number;
  transactions: Transaction[];
}

const CustomerStatements: React.FC = () => {
  const [data, setData] = useState<StatementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [downloading, setDownloading] = useState(false);
  const { companyConfig } = useAuth();

  const fetchStatement = useCallback(async (start?: string, end?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await portalLifecycle.statements.list({ startDate: start, endDate: end });
      setData(result as StatementData);
    } catch (err: any) {
      setError(err.message || 'Failed to load statement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const end = new Date().toISOString().split('T')[0];
    const start = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
    setStartDate(start);
    setEndDate(end);
    fetchStatement(start, end);
  }, [fetchStatement]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      unsubscribe = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          if (type === 'entity_changed' && (
            payload?.docType === 'statement' || payload?.docType === 'invoice'
              || payload?.docType === 'payment_allocated' || payload?.docType === 'credit_note'
              || payload?.docType === 'debit_note'
          ) && !cancelled) {
            fetchStatement(startDate, endDate);
          }
        },
      });

    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [fetchStatement, startDate, endDate]);

  const handleDownloadPdf = useCallback(async () => {
    if (!data) return;
    setDownloading(true);
    try {
      await initializePrimePdfFonts();

      const transactions = (data.transactions || []).map((t) => ({
        date: t.date,
        reference: t.description || '',
        memo: '',
        debit: Number(t.debit || 0),
        credit: Number(t.credit || 0),
        runningBalance: Number(t.balance || 0),
      }));

      const totalInvoiced = transactions.reduce((sum, t) => sum + t.debit, 0);
      const totalReceived = transactions.reduce((sum, t) => sum + t.credit, 0);

      const statementData = {
        date: new Date().toLocaleDateString(),
        customerName: companyConfig?.companyName || 'Customer',
        startDate: startDate || 'N/A',
        endDate: endDate || 'N/A',
        currency: 'MWK',
        openingBalance: Number(data.opening_balance || 0),
        transactions,
        totalInvoiced,
        totalReceived,
        finalBalance: Number(data.closing_balance || 0),
      };

      const secured = await attachDocumentSecurity(statementData, companyConfig?.companyName);
      const blob = await pdf(
        createElement(PrimeDocument, { type: 'ACCOUNT_STATEMENT', data: secured })
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `Statement-${startDate || 'start'}_to_${endDate || 'end'}.pdf`;
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to generate statement PDF:', err);
    } finally {
      setDownloading(false);
    }
}, [data, startDate, endDate, companyConfig]);

  const handleFilter = (e: React.FormEvent) => {
    e.preventDefault();
    fetchStatement(startDate, endDate);
  };

  if (loading) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={6} /></div>;

  return (
    <div>
      <PortalPageHeader title="Account Statement" subtitle="View and download account statements for any period" icon={FileText} />

      <div className="space-y-5">
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {/* Date Filter Bar */}
        <form onSubmit={handleFilter} className="glass-panel-premium rounded-2xl p-4 flex flex-col sm:flex-row flex-wrap items-end gap-3 border border-slate-200/80 shadow-xs">
          <div className="flex gap-3 flex-1 flex-wrap min-w-0">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Start Date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 outline-none focus:border-teal-500/60 transition-all" />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">End Date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 outline-none focus:border-teal-500/60 transition-all" />
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button type="submit" className="btn-press px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 flex items-center gap-2 transition-all">
              <RefreshCw size={14} /> Filter
            </button>
            {data && data.transactions.length > 0 && (
              <button type="button" onClick={handleDownloadPdf} disabled={downloading} className="btn-press px-4 py-2.5 rounded-xl text-xs font-bold text-white flex items-center gap-2 transition-all shadow-md shadow-teal-900/25 disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: 'linear-gradient(135deg, #146b60 0%, #0f544c 100%)' }}>
                {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {downloading ? 'Generating…' : 'Download PDF'}
              </button>
            )}
          </div>
        </form>

        {/* Balance Summary Cards */}
        {data && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="glass-panel-premium rounded-2xl p-5 border border-slate-200/80 shadow-xs">
              <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400 block mb-2">Opening Balance</span>
              <span className="text-2xl font-extrabold text-slate-900" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatK(data.opening_balance || 0)}</span>
            </div>
            <div className={`glass-panel-premium rounded-2xl p-5 border shadow-xs ${Number(data.closing_balance) < 0 ? 'border-red-200/80' : 'border-emerald-200/80'}`}>
              <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400 block mb-2">Closing Balance</span>
              <span className={`text-2xl font-extrabold ${Number(data.closing_balance) < 0 ? 'text-red-600' : 'text-emerald-600'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{formatK(data.closing_balance || 0)}</span>
            </div>
          </div>
        )}

        {/* Transaction Rows */}
        {!data ? null : data.transactions.length === 0 ? (
          <EmptyState icon={<FileText size={32} />} title="No transactions" description="No transactions found for the selected period." />
        ) : (
          <div className="space-y-3">
            <div className="text-xs font-semibold text-slate-500 px-1">{data.transactions.length} transactions</div>
            <div className="space-y-2">
              {data.transactions.map((t, i) => (
                <div key={`${t.date}-${t.description}-${i}`} className="glass-panel-interactive rounded-2xl p-4 flex items-center justify-between gap-4 border border-slate-200/80 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-900 leading-tight">{t.description}</p>
                    <p className="text-[11px] font-medium text-slate-500 mt-0.5">{new Date(t.date).toLocaleDateString()}</p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    {t.debit ? (
                      <div className="text-right">
                        <span className="text-[11px] font-bold text-red-500 uppercase tracking-wider block">Debit</span>
                        <span className="text-xs font-extrabold text-red-600" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatK(t.debit)}</span>
                      </div>
                    ) : null}
                    {t.credit ? (
                      <div className="text-right">
                        <span className="text-[11px] font-bold text-emerald-500 uppercase tracking-wider block">Credit</span>
                        <span className="text-xs font-extrabold text-emerald-600" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatK(t.credit)}</span>
                      </div>
                    ) : null}
                    <div className="text-right min-w-[80px] pl-3 border-l border-slate-200">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Balance</span>
                      <span className="text-xs font-extrabold text-slate-900" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatK(t.balance)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomerStatements;
