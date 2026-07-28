import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSales } from '../../context/SalesContext';
import { useFinance } from '../../context/FinanceContext';
import { format, parseISO, differenceInDays, subMonths } from 'date-fns';
import {
  Users, Printer, AlertTriangle, Clock, FileText, Eye,
  Search, X, ChevronDown, CreditCard, TrendingDown, TrendingUp,
  Building2, Phone, Mail
} from 'lucide-react';
import { currencyService } from '../../services/currencyService';
import { useLocation, useSearchParams } from 'react-router-dom';

const teal = { 50: '#eef7f6', 100: '#d3ece9', 200: '#a6d9d3', 500: '#1f8577', 600: '#146b60', 700: '#0f544c', 800: '#0b3e39', 900: '#082e2a' };
const amber = { 100: '#fbead0', 300: '#eec27a', 500: '#d99a3f' };
const paper = '#FEFDFB';
const ink = '#23282A';
const inkSoft = '#5c6567';
const hairline = '#e4ddd1';
const danger = '#b5493f';

interface AgingBucket { current: number; days1to30: number; days31to60: number; days61to90: number; over90: number; }
interface LedgerTransaction { id: string; date: string; type: 'INVOICE' | 'PAYMENT' | 'POS_SALE'; reference: string; description: string; subAccount: string; debit: number; credit: number; balance: number; status?: string; }
interface PreviewData { customerName: string; customerEmail?: string; customerPhone?: string; customerAddress?: string; statementDate: string; periodStart: string; periodEnd: string; openingBalance: number; transactions: LedgerTransaction[]; totalDebits: number; totalCredits: number; closingBalance: number; aging: AgingBucket; totalOutstanding: number; }

const baseInput: React.CSSProperties = { width: '100%', fontFamily: "'Inter',sans-serif", fontSize: 13, color: ink, background: paper, border: `1.4px solid ${hairline}`, borderRadius: 9, padding: '9px 12px', outline: 'none' };
const card: React.CSSProperties = { background: paper, borderRadius: 14, border: `1.4px solid ${hairline}`, boxShadow: '0 1px 3px rgba(0,0,0,.04)' };
const cardPad: React.CSSProperties = { ...card, padding: 24 };
const kpiCard: React.CSSProperties = { padding: '12px 16px', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.04)', border: `1.4px solid ${hairline}`, display: 'flex', alignItems: 'center', gap: 16 };

const ClientLedger: React.FC = () => {
  const { companyConfig } = useAuth();
  const { customers = [], customerPayments = [], sales = [] } = useSales();
  const { ledger = [], invoices = [] } = useFinance();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const currency = companyConfig?.currencySymbol || currencyService.getCurrency(currencyService.getBaseCurrency())?.symbol || '$';
  const gl = companyConfig?.glMapping || {};
  const arAccId = gl.accountsReceivable || '1100';
  const companyName = companyConfig?.companyName || 'Prime ERP';

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [selectedSubAccountNames, setSelectedSubAccountNames] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<'all' | '3m' | '6m' | '12m'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const formatCurrency = useCallback((val: number) => {
    if (val === undefined || val === null || isNaN(val)) return `${currency}0.00`;
    return `${currency}${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, [currency]);

  const selectedCustomer = useMemo(() => customers.find(c => c.id === selectedCustomerId), [customers, selectedCustomerId]);

  useEffect(() => {
    const routeState = (location.state as { customerId?: string; selectedId?: string; customerName?: string } | null) || null;
    const queryCustomerId = String(searchParams.get('customerId') || '').trim();
    const stateCustomerId = String(routeState?.customerId || routeState?.selectedId || '').trim();
    const stateCustomerName = String(routeState?.customerName || '').trim();
    let nextCustomerId = queryCustomerId || stateCustomerId;
    if (!nextCustomerId && stateCustomerName) nextCustomerId = customers.find(c => c.name === stateCustomerName)?.id || '';
    if (nextCustomerId && customers.some(c => c.id === nextCustomerId) && nextCustomerId !== selectedCustomerId) { setSelectedCustomerId(nextCustomerId); setSelectedSubAccountNames([]); }
  }, [searchParams, location.state, customers, selectedCustomerId]);

  useEffect(() => { if (!selectedCustomerId) return; if (customers.some(c => c.id === selectedCustomerId)) return; setSelectedCustomerId(''); setSelectedSubAccountNames([]); }, [customers, selectedCustomerId]);

  const dateCutoff = useMemo(() => {
    if (dateRange === 'all') return null;
    return subMonths(new Date(), { '3m': 3, '6m': 6, '12m': 12 }[dateRange]);
  }, [dateRange]);

  const customerStats = useMemo(() => {
    if (!selectedCustomerId) return null;
    const customerInvoices = (invoices || []).filter((inv: any) => { if (inv.customerId !== selectedCustomerId) return false; return selectedSubAccountNames.length === 0 || selectedSubAccountNames.includes(inv.subAccountName || 'Main'); });
    const customerPaymentRows = (customerPayments || []).filter((p: any) => { if (p.customerId !== selectedCustomerId) return false; return selectedSubAccountNames.length === 0 || selectedSubAccountNames.includes(p.subAccountName || 'Main'); });
    const customerSales = (sales || []).filter((s: any) => { if (s.customerId !== selectedCustomerId) return false; const t = s.totalAmount || s.total || 0; const p = s.paidAmount || 0; return (t - p) > 0.01; });

    const now = new Date();
    const aging: AgingBucket = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0 };
    const defaultPaymentTerms = 30;
    customerInvoices.filter((i: any) => i.status !== 'Paid' && i.status !== 'Cancelled').forEach((inv: any) => {
      const dueDate = inv.dueDate || (inv.date ? new Date(new Date(inv.date).getTime() + defaultPaymentTerms * 86400000).toISOString() : inv.date);
      if (!dueDate) return;
      const days = differenceInDays(now, parseISO(dueDate));
      const balance = (inv.totalAmount || 0) - (inv.paidAmount || 0);
      if (days <= 0) aging.current += balance; else if (days <= 30) aging.days1to30 += balance; else if (days <= 60) aging.days31to60 += balance; else if (days <= 90) aging.days61to90 += balance; else aging.over90 += balance;
    });
    customerSales.forEach((sale: any) => { const days = differenceInDays(now, parseISO(sale.date)); const b = (sale.totalAmount || sale.total || 0) - (sale.paidAmount || 0); if (days <= 0) aging.current += b; else if (days <= 30) aging.days1to30 += b; else if (days <= 60) aging.days31to60 += b; else if (days <= 90) aging.days61to90 += b; else aging.over90 += b; });
    const totalOutstanding = aging.current + aging.days1to30 + aging.days31to60 + aging.days61to90 + aging.over90;
    const totalPaid = customerPaymentRows.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
    const creditLimit = selectedCustomer?.creditLimit || 0;
    const creditUtilization = creditLimit > 0 ? (totalOutstanding / creditLimit) * 100 : 0;

    let customerLedgerEntries = ledger.filter((entry: any) => { const mc = entry.customerId === selectedCustomerId; const ms = selectedSubAccountNames.length === 0 || selectedSubAccountNames.includes(entry.subAccountName || 'Main'); return mc && ms; }).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (dateCutoff) customerLedgerEntries = customerLedgerEntries.filter((e: any) => new Date(e.date) >= dateCutoff);
    let openingBalance = 0;
    if (dateCutoff) {
      const allBefore = ledger.filter((entry: any) => { const mc = entry.customerId === selectedCustomerId; const ms = selectedSubAccountNames.length === 0 || selectedSubAccountNames.includes(entry.subAccountName || 'Main'); return mc && ms && new Date(entry.date) < dateCutoff; }).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
      allBefore.forEach((entry: any) => { const d = entry.debitAccountId === arAccId || entry.debitAccountId === '1100'; const c = entry.creditAccountId === arAccId || entry.creditAccountId === '1100'; if (d) openingBalance += entry.amount; if (c) openingBalance -= entry.amount; });
    }
    let runningB = openingBalance;
    const entriesWithBalance = customerLedgerEntries.map((entry: any) => { const d = entry.debitAccountId === arAccId || entry.debitAccountId === '1100'; const c = entry.creditAccountId === arAccId || entry.creditAccountId === '1100'; if (d) runningB += entry.amount; if (c) runningB -= entry.amount; return { ...entry, balance: runningB, isDebit: d, isCredit: c }; });

    const transactions: LedgerTransaction[] = [
      ...customerInvoices.filter((inv: any) => !dateCutoff || new Date(inv.date) >= dateCutoff).map((inv: any) => ({ id: inv.id, date: inv.date, type: 'INVOICE' as const, reference: inv.id, description: `Invoice #${inv.id}`, subAccount: inv.subAccountName || 'Main', debit: (inv.totalAmount || 0) - (inv.paidAmount || 0), credit: 0, balance: 0, status: inv.status })),
      ...customerPaymentRows.filter((p: any) => !dateCutoff || new Date(p.date) >= dateCutoff).map((payment: any) => ({ id: payment.id, date: payment.date, type: 'PAYMENT' as const, reference: payment.id, description: `Payment - ${payment.paymentMethod || 'Cash'}`, subAccount: payment.subAccountName || 'Main', debit: 0, credit: payment.amount || 0, balance: 0, status: 'Cleared' })),
      ...customerSales.filter((sale: any) => !dateCutoff || new Date(sale.date) >= dateCutoff).map((sale: any) => ({ id: sale.id, date: sale.date, type: 'POS_SALE' as const, reference: sale.id, description: `POS Sale #${sale.id}`, subAccount: sale.subAccountName || 'Main', debit: (sale.totalAmount || sale.total || 0) - (sale.paidAmount || 0), credit: 0, balance: 0, status: sale.status || 'Partial' })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let txB = openingBalance;
    const txs = transactions.map(tx => { txB = txB + tx.debit - tx.credit; return { ...tx, balance: txB }; });
    const totalDebits = txs.reduce((s, t) => s + t.debit, 0);
    const totalCredits = txs.reduce((s, t) => s + t.credit, 0);
    return { aging, totalOutstanding, totalPaid, creditUtilization, creditLimit, ledgerEntries: entriesWithBalance, transactions: txs, invoiceCount: customerInvoices.length, paymentCount: customerPaymentRows.length, salesCount: customerSales.length, openingBalance, totalDebits, totalCredits };
  }, [selectedCustomerId, selectedSubAccountNames, invoices, customerPayments, sales, ledger, selectedCustomer, arAccId, dateCutoff]);

  const filteredLedgerEntries = useMemo(() => {
    if (!customerStats) return [];
    if (!searchQuery) return customerStats.ledgerEntries;
    const q = searchQuery.toLowerCase();
    return customerStats.ledgerEntries.filter((e: any) => (e.description || '').toLowerCase().includes(q) || (e.referenceId || e.id || '').toLowerCase().includes(q));
  }, [customerStats, searchQuery]);

  const getAgingColor = (days: number) => { if (days <= 0) return 'from-emerald-500 to-green-600'; if (days <= 30) return 'from-blue-500 to-indigo-600'; if (days <= 60) return 'from-amber-500 to-orange-500'; if (days <= 90) return 'from-orange-500 to-red-500'; return 'from-rose-600 to-red-700'; };
  const getAgingLabel = (bucket: keyof AgingBucket) => ({ current: 'Current', days1to30: '1-30 Days', days31to60: '31-60 Days', days61to90: '61-90 Days', over90: 'Over 90' }[bucket]);
  const getAgingBg = (bucket: keyof AgingBucket) => ({ current: teal[50], days1to30: teal[50], days31to60: amber[100], days61to90: amber[100], over90: `${danger}15` }[bucket]);
  const getAgingBorder = (bucket: keyof AgingBucket) => ({ current: teal[200], days1to30: teal[200], days31to60: amber[300], days61to90: amber[300], over90: `${danger}55` }[bucket]);
  const getAgingTextColor = (bucket: keyof AgingBucket) => ({ current: teal[700], days1to30: teal[700], days31to60: amber[500], days61to90: amber[500], over90: danger }[bucket]);

  const previewData = useMemo((): PreviewData | null => {
    if (!customerStats || !selectedCustomer) return null;
    return { customerName: selectedCustomer.name, customerEmail: selectedCustomer.email, customerPhone: selectedCustomer.phone, customerAddress: selectedCustomer.address, statementDate: format(new Date(), 'yyyy-MM-dd'), periodStart: dateCutoff ? format(dateCutoff, 'yyyy-MM-dd') : format(subMonths(new Date(), 12), 'yyyy-MM-dd'), periodEnd: format(new Date(), 'yyyy-MM-dd'), openingBalance: customerStats.openingBalance, transactions: customerStats.transactions, totalDebits: customerStats.totalDebits, totalCredits: customerStats.totalCredits, closingBalance: customerStats.totalOutstanding, aging: customerStats.aging, totalOutstanding: customerStats.totalOutstanding };
  }, [customerStats, selectedCustomer, dateCutoff]);

  const renderPreviewModal = () => {
    if (!showPreview || !previewData) return null;
    const d = previewData;
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,.6)', backdropFilter: 'blur(4px)', padding: 16, fontFamily: "'Inter',sans-serif", fontSize: 13, color: ink }} onClick={() => setShowPreview(false)}>
        <div style={{ width: '100%', maxWidth: 1024, background: paper, borderRadius: 14, boxShadow: '0 30px 70px -20px rgba(0,0,0,.55)', border: `1.4px solid ${hairline}`, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: `linear-gradient(90deg, ${teal[600]}, ${teal[400]} 40%, ${amber[500]} 100%)` }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 28px 18px', borderBottom: `1px ${hairline}`, background: paper }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 10px -3px rgba(15,84,76,.6)`, flexShrink: 0 }}>
                <FileText size={19} color="#fff" />
              </div>
              <div>
                <h1 style={{ fontFamily: "'DM Serif Display', 'Georgia', serif", fontWeight: 400, fontSize: 22, margin: 0, color: teal[800], letterSpacing: 0.2 }}>Account Statement</h1>
                <p style={{ margin: '2px 0 0', fontSize: 11.5, color: inkSoft, letterSpacing: 0.02 }}>{d.customerName}</p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 9, background: teal[50], border: 'none', color: inkSoft, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}
                onMouseEnter={e => e.currentTarget.style.background = teal[100]}> <Printer size={14} /> Print</button>
              <button onClick={() => setShowPreview(false)} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 8, border: `1px ${hairline}`, background: paper, color: inkSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all .15s ease', fontSize: 16 }}
                onMouseEnter={e => { e.currentTarget.style.background = teal[50]; e.currentTarget.style.color = teal[700]; e.currentTarget.style.borderColor = teal[200]; }}
                onMouseLeave={e => { e.currentTarget.style.background = paper; e.currentTarget.style.color = inkSoft; e.currentTarget.style.borderColor = hairline; }}>
                <X size={15} />
              </button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 32, background: paper }}>
            <div style={{ maxWidth: 768, margin: '0 auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32, paddingBottom: 24, borderBottom: `2px solid ${teal[100]}` }}>
                <div>
                  <h1 style={{ fontSize: 24, fontWeight: 900, color: ink, letterSpacing: -0.02, margin: 0 }}>{companyName}</h1>
                  <p style={{ fontSize: 13, color: inkSoft, marginTop: 4 }}>Account Statement</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06, margin: 0 }}>Statement Date</p>
                  <p style={{ fontSize: 13, fontWeight: 700, color: ink, margin: 0 }}>{format(parseISO(d.statementDate), 'MMMM dd, yyyy')}</p>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginBottom: 32, padding: 20, background: teal[50], borderRadius: 12, border: `1.4px solid ${teal[100]}` }}>
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06, margin: '0 0 8px' }}>Customer</p>
                  <h3 style={{ fontSize: 18, fontWeight: 700, color: ink, margin: 0 }}>{d.customerName}</h3>
                  {d.customerEmail && <p style={{ fontSize: 13, color: inkSoft, margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}><Mail size={13} /> {d.customerEmail}</p>}
                  {d.customerPhone && <p style={{ fontSize: 13, color: inkSoft, margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}><Phone size={13} /> {d.customerPhone}</p>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06, margin: '0 0 8px' }}>Statement Period</p>
                  <p style={{ fontSize: 13, fontWeight: 600, color: ink, margin: 0 }}>{format(parseISO(d.periodStart), 'MMM dd, yyyy')} — {format(parseISO(d.periodEnd), 'MMM dd, yyyy')}</p>
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1.4px solid ${teal[100]}` }}>
                    <p style={{ fontSize: 10, fontWeight: 700, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06, margin: 0 }}>Opening Balance</p>
                    <p style={{ fontSize: 18, fontWeight: 900, color: d.openingBalance >= 0 ? danger : teal[600], margin: 0 }}>{formatCurrency(d.openingBalance)}</p>
                  </div>
                </div>
              </div>
              <div style={{ marginBottom: 32 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: ink, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={16} style={{ color: teal[500] }} /> Transaction History
                </h3>
                <table style={{ width: '100%', textAlign: 'left', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${teal[100]}` }}>
                      {['Date', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', fontSize: 10, fontWeight: 700, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06, textAlign: h === 'Debit' || h === 'Credit' || h === 'Balance' ? 'right' : 'left' }}>{h === 'Balance' ? `${h} (K)` : h === 'Debit' || h === 'Credit' ? `${h} (K)` : h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ background: teal[50], fontWeight: 600 }}>
                      <td style={{ padding: '8px 12px', color: inkSoft }} colSpan={5}>Opening Balance</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 900, color: d.openingBalance >= 0 ? danger : teal[600] }}>{formatCurrency(d.openingBalance)}</td>
                    </tr>
                    {d.transactions.map((tx, idx) => (
                      <tr key={`${tx.id}-${idx}`} style={{ borderBottom: `1.4px solid ${teal[50]}` }}
                        onMouseEnter={e => e.currentTarget.style.background = teal[50]}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <td style={{ padding: '8px 12px', color: inkSoft, fontWeight: 500 }}>{format(parseISO(tx.date), 'MMM dd, yyyy')}</td>
                        <td style={{ padding: '8px 12px', fontFamily: "'JetBrains Mono',monospace", color: inkSoft, fontSize: 11 }}>{tx.reference.slice(-10)}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{ fontWeight: 600, color: ink }}>{tx.description}</span>
                          <span style={{ marginLeft: 8, padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, background: tx.type === 'INVOICE' ? teal[50] : tx.type === 'PAYMENT' ? teal[50] : amber[100], color: tx.type === 'INVOICE' ? teal[700] : tx.type === 'PAYMENT' ? teal[600] : amber[500], border: `1.4px solid ${tx.type === 'INVOICE' ? teal[200] : tx.type === 'PAYMENT' ? teal[200] : amber[300]}` }}>
                            {tx.type === 'INVOICE' ? 'INV' : tx.type === 'PAYMENT' ? 'PAY' : 'POS'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: danger }}>{tx.debit > 0 ? formatCurrency(tx.debit) : '—'}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: teal[600] }}>{tx.credit > 0 ? formatCurrency(tx.credit) : '—'}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: ink }}>{formatCurrency(tx.balance)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: teal[50], fontWeight: 700, borderTop: `2px solid ${hairline}` }}>
                      <td style={{ padding: '12px 12px', color: ink }} colSpan={3}>Period Totals</td>
                      <td style={{ padding: '12px 12px', textAlign: 'right', color: danger }}>{formatCurrency(d.totalDebits)}</td>
                      <td style={{ padding: '12px 12px', textAlign: 'right', color: teal[600] }}>{formatCurrency(d.totalCredits)}</td>
                      <td style={{ padding: '12px 12px', textAlign: 'right', color: ink }}>{formatCurrency(d.closingBalance)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div style={{ borderTop: `2px solid ${teal[100]}`, paddingTop: 24 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: ink, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Clock size={16} style={{ color: amber[500] }} /> Aging Summary
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
                  {(Object.keys(d.aging) as (keyof AgingBucket)[]).map(bucket => (
                    <div key={bucket} style={{ padding: 12, borderRadius: 12, border: `1.4px solid ${getAgingBorder(bucket)}`, textAlign: 'center', background: getAgingBg(bucket) }}>
                      <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.06, margin: '0 0 4px', color: getAgingTextColor(bucket) }}>{getAgingLabel(bucket)}</p>
                      <p style={{ fontSize: 13, fontWeight: 900, color: getAgingTextColor(bucket), margin: 0 }}>{formatCurrency(d.aging[bucket])}</p>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 16, padding: 16, background: `linear-gradient(90deg, ${teal[800]}, ${teal[900]})`, borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff' }}>
                  <p style={{ fontSize: 11, fontWeight: 700, opacity: 0.8, textTransform: 'uppercase', letterSpacing: 0.06, margin: 0 }}>Total Outstanding</p>
                  <p style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>{formatCurrency(d.totalOutstanding)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, fontFamily: "'Inter',sans-serif", fontSize: 13, color: ink }}>
      {renderPreviewModal()}

      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: ink, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 12, background: `linear-gradient(135deg, ${teal[500]}, ${teal[700]})`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.1)' }}>
                <Users size={16} style={{ color: '#fff' }} />
              </div>
              Client Ledger
            </h2>
            <p style={{ fontSize: 12, color: inkSoft, marginTop: 4, marginLeft: 42 }}>Detailed receivables tracking and account statements</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {selectedCustomerId && customerStats && (
              <button onClick={() => setShowPreview(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', background: paper, border: `1.4px solid ${hairline}`, borderRadius: 12, fontSize: 13, fontWeight: 600, color: inkSoft, cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}
                onMouseEnter={e => { e.currentTarget.style.background = teal[50]; e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.color = teal[600]; }}
                onMouseLeave={e => { e.currentTarget.style.background = paper; e.currentTarget.style.borderColor = hairline; e.currentTarget.style.color = inkSoft; }}>
                <Eye size={16} /> Preview Statement
              </button>
            )}
            <button onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', background: paper, border: `1.4px solid ${hairline}`, borderRadius: 12, fontSize: 13, fontWeight: 600, color: inkSoft, cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
              <Printer size={16} /> Print
            </button>
          </div>
        </div>
      </div>

      <div style={{ ...card, padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06, display: 'block', marginBottom: 6 }}>Customer</label>
            <div style={{ position: 'relative' }}>
              <Users size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: inkSoft }} />
              <select value={selectedCustomerId} onChange={(e) => { setSelectedCustomerId(e.target.value); setSelectedSubAccountNames([]); }}
                style={{ ...baseInput, paddingLeft: 36, background: teal[50], cursor: 'pointer' }} className="prime-select">
                <option value="">Select a customer</option>
                {customers.map((c: any) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
              <ChevronDown size={14} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: inkSoft, pointerEvents: 'none' }} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06, display: 'block', marginBottom: 6 }}>Period</label>
            <div style={{ display: 'flex', gap: 2, background: teal[50], padding: 3, borderRadius: 12, border: `1.4px solid ${hairline}` }}>
              {([{ value: 'all', label: 'All' }, { value: '3m', label: '3 Months' }, { value: '6m', label: '6 Months' }, { value: '12m', label: '12 Months' }] as const).map((opt) => (
                <button key={opt.value} onClick={() => setDateRange(opt.value)}
                  style={{ flex: 1, padding: '6px 12px', borderRadius: 9, fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer', background: dateRange === opt.value ? `linear-gradient(155deg, ${teal[500]}, ${teal[700]})` : 'transparent', color: dateRange === opt.value ? '#fff' : inkSoft, boxShadow: dateRange === opt.value ? `0 4px 10px -4px rgba(15,84,76,.4)` : 'none' }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06, display: 'block', marginBottom: 6 }}>Sub-Accounts</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 38, alignItems: 'center' }}>
              {selectedCustomer?.subAccounts?.length > 0 ? (
                ['Main', ...selectedCustomer.subAccounts.map((s: any) => s.name)].map((sub: string) => (
                  <button key={sub} onClick={() => { setSelectedSubAccountNames(prev => prev.includes(sub) ? prev.filter(s => s !== sub) : [...prev, sub]); }}
                    style={{ padding: '4px 10px', borderRadius: 9, fontSize: 10, fontWeight: 700, border: `1.4px solid`, cursor: 'pointer', background: selectedSubAccountNames.includes(sub) ? `linear-gradient(155deg, ${teal[500]}, ${teal[700]})` : teal[50], color: selectedSubAccountNames.includes(sub) ? '#fff' : inkSoft, borderColor: selectedSubAccountNames.includes(sub) ? 'transparent' : hairline }}>
                    {sub}
                  </button>
                ))
              ) : (<span style={{ fontSize: 12, color: inkSoft, fontStyle: 'italic' }}>Select a customer first</span>)}
            </div>
          </div>
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06, display: 'block', marginBottom: 6 }}>Search</label>
            <div style={{ position: 'relative' }}>
              <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: inkSoft }} />
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search transactions..."
                style={{ ...baseInput, paddingLeft: 36, background: teal[50] }} className="prime-input" />
              {searchQuery && (<button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: inkSoft, border: 'none', background: 'transparent', cursor: 'pointer' }}><X size={14} /></button>)}
            </div>
          </div>
        </div>
      </div>

      {!selectedCustomerId && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 96, background: paper, borderRadius: 14, border: `2px dashed ${hairline}`, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
          <div style={{ width: 64, height: 64, borderRadius: 14, background: teal[50], display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1.4px solid ${teal[100]}`, marginBottom: 16 }}>
            <Users size={32} style={{ color: inkSoft }} />
          </div>
          <p style={{ fontWeight: 700, fontSize: 18, color: ink, margin: 0 }}>Select a customer to view their ledger</p>
          <p style={{ fontSize: 13, color: inkSoft, marginTop: 4 }}>Choose a customer from the dropdown above to see detailed receivables.</p>
        </div>
      )}

      {selectedCustomerId && customerStats && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div style={{ ...kpiCard, borderLeft: `4px solid ${teal[500]}` }}>
              <div style={{ padding: 10, borderRadius: 9, background: teal[50], color: teal[500], flexShrink: 0 }}><Building2 size={20} /></div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: inkSoft, textTransform: 'uppercase', letterSpacing: -0.01, margin: '0 0 4px' }}>Customer</p>
                <p style={{ fontSize: 18, fontWeight: 600, color: ink, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedCustomer?.name}</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  {selectedCustomer?.email && <span style={{ fontSize: 10, color: inkSoft }}><Mail size={10} style={{ display: 'inline', marginRight: 2 }} />{selectedCustomer.email}</span>}
                  {selectedCustomer?.phone && <span style={{ fontSize: 10, color: inkSoft }}><Phone size={10} style={{ display: 'inline', marginRight: 2 }} />{selectedCustomer.phone}</span>}
                </div>
              </div>
            </div>

            <div style={{ ...kpiCard, borderLeft: `4px solid ${danger}` }}>
              <div style={{ padding: 10, borderRadius: 9, background: customerStats.totalOutstanding > 0 ? `${danger}15` : teal[50], color: customerStats.totalOutstanding > 0 ? danger : teal[600], flexShrink: 0 }}><TrendingDown size={20} /></div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: inkSoft, textTransform: 'uppercase', letterSpacing: -0.01, margin: '0 0 4px' }}>Outstanding</p>
                <p style={{ fontSize: 18, fontWeight: 600, color: customerStats.totalOutstanding > 0 ? danger : teal[600], margin: 0 }}>{formatCurrency(customerStats.totalOutstanding)}</p>
                <p style={{ fontSize: 10, color: inkSoft, margin: '2px 0 0' }}>{customerStats.invoiceCount} invoice{customerStats.invoiceCount !== 1 ? 's' : ''}</p>
              </div>
            </div>

            <div style={{ ...kpiCard, borderLeft: `4px solid ${teal[500]}` }}>
              <div style={{ padding: 10, borderRadius: 9, background: teal[50], color: teal[600], flexShrink: 0 }}><TrendingUp size={20} /></div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: inkSoft, textTransform: 'uppercase', letterSpacing: -0.01, margin: '0 0 4px' }}>Total Paid</p>
                <p style={{ fontSize: 18, fontWeight: 600, color: teal[600], margin: 0 }}>{formatCurrency(customerStats.totalPaid)}</p>
                <p style={{ fontSize: 10, color: inkSoft, margin: '2px 0 0' }}>{customerStats.paymentCount} payment{customerStats.paymentCount !== 1 ? 's' : ''}</p>
              </div>
            </div>

            <div style={{ padding: '12px 16px', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.04)', border: `1.4px solid ${hairline}`, display: 'flex', alignItems: 'center', gap: 16, borderLeft: `4px solid ${customerStats.creditUtilization > 80 ? danger : customerStats.creditUtilization > 50 ? amber[500] : inkSoft}`, background: customerStats.creditUtilization > 80 ? `linear-gradient(135deg, ${danger}, ${danger})` : customerStats.creditUtilization > 50 ? `linear-gradient(135deg, ${amber[500]}, ${amber[500]})` : `linear-gradient(135deg, ${teal[800]}, ${teal[900]})`, color: '#fff' }}>
              <div style={{ padding: 10, borderRadius: 9, background: 'rgba(255,255,255,.15)', color: '#fff', flexShrink: 0 }}><CreditCard size={20} /></div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ fontSize: 10, fontWeight: 700, opacity: 0.7, textTransform: 'uppercase', letterSpacing: -0.01, margin: '0 0 4px' }}>Credit Limit</p>
                <p style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{formatCurrency(customerStats.creditLimit || 0)}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,.2)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 999, background: 'rgba(255,255,255,.8)', width: `${Math.min(customerStats.creditUtilization, 100)}%` }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.8 }}>{customerStats.creditUtilization.toFixed(0)}%</span>
                </div>
              </div>
            </div>
          </div>

          <div style={cardPad}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ fontWeight: 700, color: ink, fontSize: 13, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Clock size={16} style={{ color: amber[500] }} /> Receivables Aging
              </h3>
              <span style={{ fontSize: 10, fontWeight: 700, color: inkSoft, background: teal[50], padding: '4px 8px', borderRadius: 9, border: `1.4px solid ${hairline}` }}>
                Total: {formatCurrency(customerStats.totalOutstanding)}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
              {(Object.keys(customerStats.aging) as (keyof AgingBucket)[]).map(bucket => (
                <div key={bucket} style={{ padding: 16, borderRadius: 12, border: `1.4px solid ${getAgingBorder(bucket)}`, textAlign: 'center', background: getAgingBg(bucket) }}>
                  <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.06, color: getAgingTextColor(bucket), margin: 0 }}>{getAgingLabel(bucket)}</p>
                  <p style={{ fontSize: 18, fontWeight: 900, marginTop: 6, color: getAgingTextColor(bucket) }}>{formatCurrency(customerStats.aging[bucket])}</p>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: `1.4px solid ${teal[100]}`, background: teal[50], display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontWeight: 700, color: ink, fontSize: 13, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText size={16} style={{ color: teal[500] }} /> Ledger Statement
                <span style={{ fontSize: 10, fontWeight: 500, color: inkSoft, marginLeft: 8 }}>({customerStats.openingBalance !== 0 ? `Opening: ${formatCurrency(customerStats.openingBalance)}` : ''})</span>
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: inkSoft, fontWeight: 500 }}>
                <span>{customerStats.ledgerEntries.length} entries</span>
              </div>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: 480, overflowY: 'auto' }}>
              <table style={{ width: '100%', textAlign: 'left', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr style={{ borderBottom: `1.4px solid ${teal[200]}`, background: teal[50], fontSize: 10, fontWeight: 700, color: inkSoft, textTransform: 'uppercase', letterSpacing: 0.06 }}>
                    <th style={{ padding: '12px 16px' }}>Date</th>
                    <th style={{ padding: '12px 16px' }}>Description</th>
                    <th style={{ padding: '12px 16px' }}>Reference</th>
                    <th style={{ padding: '12px 16px' }}>Sub-Account</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Debit (+)</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Credit (-)</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {customerStats.openingBalance !== 0 && (
                    <tr style={{ background: teal[50], fontWeight: 600 }}>
                      <td style={{ padding: '10px 16px', color: inkSoft, fontSize: 12 }} colSpan={4}>Opening Balance</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: inkSoft }} colSpan={2}></td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: customerStats.openingBalance >= 0 ? danger : teal[600] }}>{formatCurrency(customerStats.openingBalance)}</td>
                    </tr>
                  )}
                  {filteredLedgerEntries.map((entry: any) => (
                    <tr key={entry.id} style={{ borderBottom: `1.4px solid ${teal[50]}` }}
                      onMouseEnter={e => e.currentTarget.style.background = teal[50]}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '10px 16px', color: inkSoft, fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap' }}>{format(parseISO(entry.date), 'MMM dd, yyyy')}</td>
                      <td style={{ padding: '10px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 600, color: ink }}>{entry.description}</span>
                          {entry.type && (
                            <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, border: `1.4px solid`, background: entry.type === 'INVOICE' || (entry.isDebit && !entry.isCredit) ? teal[50] : teal[50], color: entry.type === 'INVOICE' || (entry.isDebit && !entry.isCredit) ? teal[700] : teal[600], borderColor: entry.type === 'INVOICE' || (entry.isDebit && !entry.isCredit) ? teal[200] : teal[200] }}>
                              {entry.type === 'INVOICE' || (entry.isDebit && !entry.isCredit) ? 'DR' : 'CR'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '10px 16px', fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: inkSoft }}>{entry.referenceId || entry.id?.slice(-8)}</td>
                      <td style={{ padding: '10px 16px', color: inkSoft, fontSize: 12 }}>{entry.subAccountName || 'Main'}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: danger }}>{entry.isDebit ? formatCurrency(entry.amount) : '—'}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: teal[600] }}>{entry.isCredit ? formatCurrency(entry.amount) : '—'}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: ink }}>{formatCurrency(entry.balance)}</td>
                    </tr>
                  ))}
                  {filteredLedgerEntries.length === 0 && (
                    <tr><td colSpan={7} style={{ padding: 48, textAlign: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: inkSoft }}>
                        <FileText size={24} style={{ opacity: 0.4 }} />
                        <p style={{ fontWeight: 600, margin: 0 }}>No ledger entries found</p>
                        <p style={{ fontSize: 12, margin: 0 }}>Try adjusting the filters or search query</p>
                      </div>
                    </td></tr>
                  )}
                </tbody>
                {filteredLedgerEntries.length > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: `2px solid ${teal[200]}`, background: teal[50] }}>
                      <td style={{ padding: '12px 16px', fontSize: 12, fontWeight: 700, color: inkSoft }} colSpan={4}>Closing Balance</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: danger }}>{formatCurrency(customerStats.totalDebits)}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: teal[600] }}>{formatCurrency(customerStats.totalCredits)}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 900, fontSize: 15, color: customerStats.totalOutstanding >= 0 ? danger : teal[600] }}>{formatCurrency(customerStats.totalOutstanding)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ClientLedger;