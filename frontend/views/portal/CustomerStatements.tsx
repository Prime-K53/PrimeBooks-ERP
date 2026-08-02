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
import { portalTheme } from './constants';

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

  const fetchStatement = async (start?: string, end?: string) => {
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
  };

  useEffect(() => {
    const end = new Date().toISOString().split('T')[0];
    const start = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
    setStartDate(start);
    setEndDate(end);
    fetchStatement(start, end);
  }, []);

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
                K {Number(data.opening_balance || 0).toFixed(2)}
              </div>
            </PortalCard>
            <PortalCard style={{ padding: '20px 24px' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: portalTheme.inkSoft, marginBottom: 6, display: 'block' }}>Closing Balance</span>
              <div style={{ fontSize: 20, fontWeight: 700, color: portalTheme.ink, fontFamily: "'JetBrains Mono', monospace" }}>
                K {Number(data.closing_balance || 0).toFixed(2)}
              </div>
            </PortalCard>
          </div>
        )}
      </div>

      <div style={{ padding: '0 28px 28px' }}>
        {!data ? null : data.transactions.length === 0 ? (
          <EmptyState icon={<FileText size={28} />} title="No transactions" description="No transactions found for the selected period." />
        ) : (
          <div style={{ background: portalTheme.paper, borderRadius: 14, border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13px] table-fixed">
                <thead>
                  <tr style={{ background: portalTheme.teal[50] }}>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Date</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-left" style={{ color: portalTheme.inkSoft }}>Description</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: portalTheme.inkSoft }}>Debit</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: portalTheme.inkSoft }}>Credit</th>
                    <th className="px-5 py-3 font-bold text-[10px] uppercase tracking-wider text-right" style={{ color: portalTheme.inkSoft }}>Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100/50">
                  {data.transactions.map((t, i) => (
                    <tr key={`${t.date}-${t.description}-${i}`} className="text-slate-700 hover:bg-[#eef7f6] transition-colors">
<td className="px-5 py-3 text-slate-500 whitespace-nowrap" data-label="Date">{new Date(t.date).toLocaleDateString()}</td>
                       <td className="px-5 py-3" data-label="Description">{t.description}</td>
                       <td className="px-5 py-3 text-right font-mono" style={{ color: portalTheme.danger }} data-label="Debit">{t.debit ? `K ${Number(t.debit).toFixed(2)}` : '-'}</td>
                       <td className="px-5 py-3 text-right font-mono" style={{ color: portalTheme.teal[600] }} data-label="Credit">{t.credit ? `K ${Number(t.credit).toFixed(2)}` : '-'}</td>
                       <td className="px-5 py-3 text-right font-mono font-semibold" data-label="Balance">K {Number(t.balance).toFixed(2)}</td>
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

export default CustomerStatements;
