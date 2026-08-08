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
      <PortalPageHeader title="Statements" subtitle="View account statements for any period" icon={FileText} />

      <div style={{ padding: '20px 28px 8px' }}>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        <form onSubmit={handleFilter} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12, marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 12, flex: '1 1 400px', flexWrap: 'wrap' }}>
            <PortalInput label="Start Date" type="date" value={startDate} onChange={setStartDate} />
            <PortalInput label="End Date" type="date" value={endDate} onChange={setEndDate} />
          </div>
          <PortalButton type="submit" variant="secondary" icon={RefreshCw}>Filter</PortalButton>
          {data && data.transactions.length > 0 && (
            <PortalButton variant="primary" icon={downloading ? Loader2 : Download} onClick={handleDownloadPdf} disabled={downloading}>
              {downloading ? 'Generating…' : 'Download PDF'}
            </PortalButton>
          )}
        </form>

        {data && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 18 }}>
            <PortalCard style={{ padding: '20px 24px' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: portalTheme.inkSoft, marginBottom: 6, display: 'block' }}>Opening Balance</span>
<div style={{ fontSize: 20, fontWeight: 700, color: portalTheme.ink, fontFamily: "'JetBrains Mono', monospace" }}>
  {formatK(data.opening_balance || 0)}
</div>
            </PortalCard>
            <PortalCard style={{ padding: '20px 24px' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: portalTheme.inkSoft, marginBottom: 6, display: 'block' }}>Closing Balance</span>
<div style={{ fontSize: 20, fontWeight: 700, color: portalTheme.ink, fontFamily: "'JetBrains Mono', monospace" }}>
  {formatK(data.closing_balance || 0)}
</div>
            </PortalCard>
          </div>
        )}
      </div>

      <div style={{ padding: '0 28px 28px' }}>
        {!data ? null : data.transactions.length === 0 ? (
          <EmptyState icon={<FileText size={28} />} title="No transactions" description="No transactions found for the selected period." />
        ) : (
          <div style={{ background: portalTheme.paper, borderRadius: 14, border: '1px solid rgba(16,24,40,0.05)', boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 12px 30px -16px rgba(16,24,40,0.18)', overflow: 'hidden' }}>
            <div className="space-y-2">
              {data.transactions.map((t, i) => (
                <div key={`${t.date}-${t.description}-${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', background: portalTheme.paper, borderRadius: 12, border: '1px solid rgba(16,24,40,0.05)', boxShadow: '0 1px 2px rgba(16,24,40,0.04)', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: portalTheme.ink, margin: 0 }}>{t.description}</p>
                    <p style={{ fontSize: 11, color: portalTheme.inkSoft, marginTop: 2 }}>{new Date(t.date).toLocaleDateString()}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexShrink: 0 }}>
                    {t.debit ? <span style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: portalTheme.danger }}>Debit: {formatK(t.debit)}</span> : null}
                    {t.credit ? <span style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: portalTheme.teal[600] }}>Credit: {formatK(t.credit)}</span> : null}
                    <span style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: portalTheme.ink }}>{formatK(t.balance)}</span>
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
