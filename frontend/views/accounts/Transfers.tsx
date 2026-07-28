import React, { useState, useEffect, useMemo } from 'react';
import { Transfer } from '../../types';
import { useFinance } from '../../context/FinanceContext';
import { useData, REFRESH_INTERVAL } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { useModuleRefresh } from '../../hooks/useModuleRefresh';
import { useBankingStore } from '../../context/BankingContext';
import {
  RefreshCw, Plus, Search, Filter, Download, ArrowRightLeft,
  Building2, Wallet, TrendingUp, TrendingDown, Calendar,
  User, Hash, DollarSign, Clock, CheckCircle, XCircle,
  AlertCircle, Eye, Edit, Trash2, ChevronDown
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns';
import { exportToCSV } from '../../services/excelService';
import { generateNextId } from '../../utils/helpers';
import { currencyService } from '../../services/currencyService';
import { getDefaultDate, validateDateInFY } from '../../utils/financialYearUtils';

const Transfers: React.FC = () => {
  const { transfers, executeTransfer } = useFinance();
  const {
    accounts: bankingAccounts,
    fetchBankingData,
    createTransaction: createBankTransaction
  } = useBankingStore();
  const { notify, companyConfig } = useAuth();
  const currency = companyConfig?.currencySymbol || currencyService.getCurrency(currencyService.getBaseCurrency())?.symbol || '$';
  
  // State
  const [showModal, setShowModal] = useState<'create' | 'view' | null>(null);
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({
    start: startOfMonth(new Date()).toISOString().split('T')[0],
    end: endOfMonth(new Date()).toISOString().split('T')[0]
  });
  const [filterStatus, setFilterStatus] = useState<'all' | 'completed'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'from' | 'to'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Form state
  const [formData, setFormData] = useState({
    date: getDefaultDate(),
    amount: '',
    fromAccountId: '',
    toAccountId: '',
    description: '',
    reference: ''
  });

  const { refreshAllData } = useData();

  // 5-minute poll + focus refresh
  useModuleRefresh(async () => {
    await Promise.allSettled([
      fetchBankingData(),
      refreshAllData()
    ]);
  }, { interval: REFRESH_INTERVAL });

  // Filter and sort transfers
  const filteredTransfers = useMemo(() => {
    return transfers
      .filter(transfer => {
        const transferDate = parseISO(transfer.date);
        const startDate = parseISO(dateRange.start);
        const endDate = parseISO(dateRange.end);
        return isWithinInterval(transferDate, { start: startDate, end: endDate });
      })
      .filter(transfer => {
        if (!searchTerm) return true;
        const fromAccount = bankingAccounts.find(a => a.id === transfer.fromAccountId)?.name || '';
        const toAccount = bankingAccounts.find(a => a.id === transfer.toAccountId)?.name || '';
        return (
          transfer.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          transfer.reference?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          fromAccount.toLowerCase().includes(searchTerm.toLowerCase()) ||
          toAccount.toLowerCase().includes(searchTerm.toLowerCase())
        );
      })
      .filter(transfer => {
        if (filterStatus === 'all') return true;
        return transfer.status === filterStatus;
      })
      .sort((a, b) => {
        let aValue: any, bValue: any;
        
        switch (sortBy) {
          case 'date':
            aValue = new Date(a.date).getTime();
            bValue = new Date(b.date).getTime();
            break;
          case 'amount':
            aValue = a.amount;
            bValue = b.amount;
            break;
          case 'from':
            aValue = bankingAccounts.find(acc => acc.id === a.fromAccountId)?.name || '';
            bValue = bankingAccounts.find(acc => acc.id === b.fromAccountId)?.name || '';
            break;
          case 'to':
            aValue = bankingAccounts.find(acc => acc.id === a.toAccountId)?.name || '';
            bValue = bankingAccounts.find(acc => acc.id === b.toAccountId)?.name || '';
            break;
          default:
            aValue = new Date(a.date).getTime();
            bValue = new Date(b.date).getTime();
        }
        
        if (sortOrder === 'asc') {
          if (typeof aValue === 'string' && typeof bValue === 'string') return aValue.localeCompare(bValue);
          return aValue > bValue ? 1 : -1;
        } else {
          if (typeof aValue === 'string' && typeof bValue === 'string') return bValue.localeCompare(aValue);
          return aValue < bValue ? 1 : -1;
        }
      });
  }, [transfers, dateRange, searchTerm, filterStatus, sortBy, sortOrder, bankingAccounts]);

  const activeBankAccounts = useMemo(() => {
    return bankingAccounts.filter(account => account.status === 'Active');
  }, [bankingAccounts]);

  // Account balances summary
  const accountBalances = useMemo(() => {
    const balances: Record<string, number> = {};

    bankingAccounts.forEach(account => {
      balances[account.id] = account.availableBalance ?? account.balance ?? 0;
    });

    return balances;
  }, [bankingAccounts]);

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.fromAccountId || !formData.toAccountId) {
      notify('Please select both source and destination accounts', 'error');
      return;
    }
    
    if (formData.fromAccountId === formData.toAccountId) {
      notify('Source and destination accounts cannot be the same', 'error');
      return;
    }
    
    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      notify('Please enter a valid amount', 'error');
      return;
    }
    
    // Check if source account has sufficient balance
    const fromAccount = bankingAccounts.find(a => a.id === formData.fromAccountId);
    if (fromAccount) {
      const fromAccountBalance = accountBalances[fromAccount.id] || 0;
      
      if (fromAccountBalance < amount) {
        notify('Insufficient balance in source account', 'error');
        return;
}
    }

    // Validate date against active financial year
    const dateError = validateDateInFY(formData.date);
    if (dateError) { notify(dateError, "error"); return; }

    try {
      const transferId = generateNextId('TRF', transfers, companyConfig);
      const reference = formData.reference || transferId;
      const newTransfer: Transfer = {
        id: transferId,
        date: formData.date,
        amount: amount,
        fromAccountId: formData.fromAccountId,
        toAccountId: formData.toAccountId,
        description: formData.description,
        reference
      };
      
      await executeTransfer(newTransfer);

      // Mirror transfers to banking transactions so bank balances stay accurate.
      await createBankTransaction({
        date: formData.date,
        amount,
        type: 'Withdrawal',
        description: formData.description || `Transfer to ${getAccountName(formData.toAccountId)}`,
        reference,
        bankAccountId: formData.fromAccountId,
        counterparty: { name: getAccountName(formData.toAccountId) },
        category: 'Transfer',
        reconciled: false
      });

      await createBankTransaction({
        date: formData.date,
        amount,
        type: 'Deposit',
        description: formData.description || `Transfer from ${getAccountName(formData.fromAccountId)}`,
        reference,
        bankAccountId: formData.toAccountId,
        counterparty: { name: getAccountName(formData.fromAccountId) },
        category: 'Transfer',
        reconciled: false
      });
      
      // Reset form
      setFormData({
        date: new Date().toISOString().split('T')[0],
        amount: '',
        fromAccountId: '',
        toAccountId: '',
        description: '',
        reference: ''
      });
      
      setShowModal(null);
    } catch (error: any) {
      notify(`Transfer failed: ${error.message}`, 'error');
    }
  };

  // Export to CSV
  const handleExport = () => {
    const exportData = filteredTransfers.map(transfer => ({
      'Date': format(parseISO(transfer.date), 'yyyy-MM-dd'),
      'From Account': bankingAccounts.find(a => a.id === transfer.fromAccountId)?.name || transfer.fromAccountId,
      'To Account': bankingAccounts.find(a => a.id === transfer.toAccountId)?.name || transfer.toAccountId,
      'Amount': transfer.amount.toFixed(2),
      'Description': transfer.description || '',
      'Reference': transfer.reference || ''
    }));
    
    exportToCSV(exportData, `transfers-${format(new Date(), 'yyyy-MM-dd')}`);
  };

  // Get account name by ID
  const getAccountName = (accountId: string) => {
    return bankingAccounts.find(a => a.id === accountId)?.name || accountId;
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto h-[calc(100vh-4rem)] flex flex-col">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 shrink-0">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-3">
            <ArrowRightLeft className="text-blue-600" size={28} />
            Account Transfers
          </h1>
          <p className="text-sm text-slate-500 mt-1 font-medium">
            Transfer funds between your accounts and track all movements
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            style={{ padding: '9px 18px', borderRadius: 9, cursor: 'pointer', background: '#FEFDFB', border: '1.4px solid #e4ddd1', color: '#5c6567', display: 'flex', alignItems: 'center', gap: 7, transition: 'all .15s ease', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}
            onMouseEnter={e => { e.currentTarget.style.background = '#eef7f6'; e.currentTarget.style.borderColor = '#a6d9d3'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#FEFDFB'; e.currentTarget.style.borderColor = '#e4ddd1'; }}
          >
            <Download size={16} />
            Export
          </button>
          <button
            onClick={() => setShowModal('create')}
            disabled={activeBankAccounts.length < 2}
            style={{ padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid transparent', background: 'linear-gradient(155deg, #1f8577, #0f544c)', color: '#fff', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 6px 16px -6px rgba(15,84,76,.55)', transition: 'all .15s ease', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}
            onMouseEnter={e => { if (!e.currentTarget.disabled) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 20px -6px rgba(15,84,76,.65)'; } }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 6px 16px -6px rgba(15,84,76,.55)'; }}
          >
            <Plus size={16} /> New Transfer
          </button>
        </div>
      </div>

      {activeBankAccounts.length < 2 && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          At least two active banking accounts are required to create transfers.
        </div>
      )}

      {/* Summary Cards (QBO Style) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 mb-6 shrink-0">
        <div className="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-slate-100 flex items-center gap-4 border-l-4 border-l-emerald-500 hover:bg-slate-50 transition-all duration-200">
          <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-lg shrink-0"><TrendingUp size={20} /></div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight leading-none mb-1.5">Total Transfers</p>
            <p className="text-lg md:text-xl font-semibold text-emerald-600">{filteredTransfers.length}</p>
          </div>
        </div>
        <div className="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-slate-100 flex items-center gap-4 border-l-4 border-l-blue-500 hover:bg-slate-50 transition-all duration-200">
          <div className="p-2.5 bg-blue-50 text-blue-600 rounded-lg shrink-0"><DollarSign size={20} /></div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight leading-none mb-1.5">Total Amount</p>
            <p className="text-lg md:text-xl font-semibold text-blue-600">{currency}{filteredTransfers.reduce((sum, t) => sum + t.amount, 0).toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-slate-100 flex items-center gap-4 border-l-4 border-l-violet-500 hover:bg-slate-50 transition-all duration-200">
          <div className="p-2.5 bg-violet-50 text-violet-600 rounded-lg shrink-0"><Building2 size={20} /></div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight leading-none mb-1.5">Active Accounts</p>
            <p className="text-lg md:text-xl font-semibold text-violet-600">{activeBankAccounts.length}</p>
          </div>
        </div>
        <div className="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-slate-100 flex items-center gap-4 border-l-4 border-l-amber-500 hover:bg-slate-50 transition-all duration-200">
          <div className="p-2.5 bg-amber-50 text-amber-600 rounded-lg shrink-0"><Clock size={20} /></div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight leading-none mb-1.5">This Period</p>
            <p className="text-sm font-semibold text-slate-900">{format(parseISO(dateRange.start), 'MMM dd')} - {format(parseISO(dateRange.end), 'MMM dd')}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-6 shrink-0">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search transfers..."
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Start Date</label>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">End Date</label>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as 'all' | 'completed')}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">All Transfers</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Sort By</label>
            <div className="flex gap-1">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'date' | 'amount' | 'from' | 'to')}
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="date">Date</option>
                <option value="amount">Amount</option>
                <option value="from">From Account</option>
                <option value="to">To Account</option>
              </select>
              <button
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                className="px-2 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <ChevronDown 
                  size={16} 
                  className={`text-slate-500 ${sortOrder === 'desc' ? 'rotate-180' : ''} transition-transform`} 
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Transfers Table */}
      <div className="bg-white rounded-[1.5rem] border border-slate-200 shadow-sm flex-1 overflow-hidden">
        <div className="p-[24px] border-b border-slate-200 bg-slate-50">
          <h3 className="font-semibold text-slate-800 tracking-tighter text-[16px]">
            Transfer History ({filteredTransfers.length} records)
          </h3>
        </div>
        
        <div className="overflow-y-auto" style={{ height: 'calc(100% - 80px)' }}>
          {filteredTransfers.length === 0 ? (
            <div className="text-center text-slate-400 py-12">
              <ArrowRightLeft size={48} className="mx-auto text-slate-200 mb-4" />
              <p className="text-sm italic">No transfers found for the selected period.</p>
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="p-4">Date</th>
                  <th className="p-4">From Account</th>
                  <th className="p-4">To Account</th>
                  <th className="p-4 text-right">Amount</th>
                  <th className="p-4">Description</th>
                  <th className="p-4">Reference</th>
                  <th className="p-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransfers.map((transfer) => (
                  <tr key={transfer.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <Calendar size={14} className="text-slate-400" />
                        {format(parseISO(transfer.date), 'MMM dd, yyyy')}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="p-2 bg-red-100 rounded-lg">
                          <TrendingDown size={14} className="text-red-600" />
                        </div>
                        <div>
                          <div className="font-medium text-slate-900">
                            {getAccountName(transfer.fromAccountId)}
                          </div>
                          <div className="text-xs text-slate-500">
                            Balance: {currency}{accountBalances[transfer.fromAccountId]?.toLocaleString() || '0.00'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="p-2 bg-green-100 rounded-lg">
                          <TrendingUp size={14} className="text-green-600" />
                        </div>
                        <div>
                          <div className="font-medium text-slate-900">
                            {getAccountName(transfer.toAccountId)}
                          </div>
                          <div className="text-xs text-slate-500">
                            Balance: {currency}{accountBalances[transfer.toAccountId]?.toLocaleString() || '0.00'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <span className="font-bold text-lg text-slate-900">
                        {currency}{transfer.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className="text-slate-600">
                        {transfer.description || '-'}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className="font-mono text-xs bg-slate-100 px-2 py-1 rounded">
                        {transfer.reference || '-'}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setSelectedTransfer(transfer);
                            setShowModal('view');
                          }}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="View details"
                        >
                          <Eye size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Transfer Modal */}
      {showModal === 'create' && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-[1.5rem] shadow-2xl w-full max-w-md overflow-hidden animate-fadeIn flex">
            <div style={{ width: 4, background: 'linear-gradient(180deg, #1f8577, #0f544c)', flexShrink: 0 }} />
            <div className="flex-1">
              <div className="p-[24px] border-b border-slate-100 flex justify-between items-center">
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(155deg, #1f8577, #0f544c)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 10px -3px rgba(15,84,76,.4)' }}>
                    <ArrowRightLeft size={18} color="#fff" />
                  </div>
                  <div>
                    <h2 style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontWeight: 400, fontSize: 20, margin: 0, color: '#0b3e39', letterSpacing: 0.2 }}>
                      New Transfer
                    </h2>
                    <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#5c6567', letterSpacing: 0.02 }}>Account Transfers</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowModal(null)}
                  style={{ padding: '6px', borderRadius: 8, border: '1.4px solid #e4ddd1', background: '#FEFDFB', color: '#5c6567', cursor: 'pointer', transition: 'all .15s ease' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#eef7f6'; e.currentTarget.style.color = '#0f544c'; e.currentTarget.style.borderColor = '#a6d9d3'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#FEFDFB'; e.currentTarget.style.color = '#5c6567'; e.currentTarget.style.borderColor = '#e4ddd1'; }}
                >
                  <X size={15} />
                </button>
              </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.06, textTransform: 'uppercase', color: '#5c6567', marginBottom: 5, display: 'block' }}>Transfer Date</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  className="w-full"
                  style={{ padding: '8px 10px', border: '1.4px solid #e4ddd1', borderRadius: 7, fontSize: 13, color: '#23282A', background: '#FEFDFB', outline: 'none', fontFamily: 'inherit' }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#3fa294'; e.currentTarget.style.background = '#eef7f6'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#e4ddd1'; e.currentTarget.style.background = '#FEFDFB'; }}
                  required
                />
              </div>
              
              <div>
                <label style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.06, textTransform: 'uppercase', color: '#5c6567', marginBottom: 5, display: 'block' }}>Amount</label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="number"
                    step="0.01"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    placeholder="0.00"
                    className="w-full"
                    style={{ paddingLeft: 34, paddingRight: 10, paddingTop: 8, paddingBottom: 8, border: '1.4px solid #e4ddd1', borderRadius: 7, fontSize: 13, color: '#23282A', background: '#FEFDFB', outline: 'none', fontFamily: 'inherit' }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#3fa294'; e.currentTarget.style.background = '#eef7f6'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#e4ddd1'; e.currentTarget.style.background = '#FEFDFB'; }}
                    required
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.06, textTransform: 'uppercase', color: '#5c6567', marginBottom: 5, display: 'block' }}>From Account</label>
                  <select
                    value={formData.fromAccountId}
                    onChange={(e) => setFormData({ ...formData, fromAccountId: e.target.value })}
                    className="w-full"
                    style={{ padding: '8px 10px', border: '1.4px solid #e4ddd1', borderRadius: 7, fontSize: 13, color: '#23282A', background: '#FEFDFB', outline: 'none', fontFamily: 'inherit' }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#3fa294'; e.currentTarget.style.background = '#eef7f6'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#e4ddd1'; e.currentTarget.style.background = '#FEFDFB'; }}
                    required
                  >
                    <option value="">Select account</option>
                    {activeBankAccounts
                      .filter(acc => acc.id !== formData.toAccountId)
                      .map(account => (
                        <option key={account.id} value={account.id}>
                          {account.name} (Balance: {currency}{(accountBalances[account.id] || 0).toLocaleString()})
                        </option>
                      ))}
                  </select>
                </div>
                
                <div>
                  <label style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.06, textTransform: 'uppercase', color: '#5c6567', marginBottom: 5, display: 'block' }}>To Account</label>
                  <select
                    value={formData.toAccountId}
                    onChange={(e) => setFormData({ ...formData, toAccountId: e.target.value })}
                    className="w-full"
                    style={{ padding: '8px 10px', border: '1.4px solid #e4ddd1', borderRadius: 7, fontSize: 13, color: '#23282A', background: '#FEFDFB', outline: 'none', fontFamily: 'inherit' }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#3fa294'; e.currentTarget.style.background = '#eef7f6'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#e4ddd1'; e.currentTarget.style.background = '#FEFDFB'; }}
                    required
                  >
                    <option value="">Select account</option>
                    {activeBankAccounts
                      .filter(acc => acc.id !== formData.fromAccountId)
                      .map(account => (
                        <option key={account.id} value={account.id}>
                          {account.name} (Balance: {currency}{(accountBalances[account.id] || 0).toLocaleString()})
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              
              <div>
                <label style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.06, textTransform: 'uppercase', color: '#5c6567', marginBottom: 5, display: 'block' }}>Description (Optional)</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Transfer description"
                  className="w-full"
                  style={{ padding: '8px 10px', border: '1.4px solid #e4ddd1', borderRadius: 7, fontSize: 13, color: '#23282A', background: '#FEFDFB', outline: 'none', fontFamily: 'inherit' }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#3fa294'; e.currentTarget.style.background = '#eef7f6'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#e4ddd1'; e.currentTarget.style.background = '#FEFDFB'; }}
                />
              </div>
              
              <div>
                <label style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.06, textTransform: 'uppercase', color: '#5c6567', marginBottom: 5, display: 'block' }}>Reference (Optional)</label>
                <input
                  type="text"
                  value={formData.reference}
                  onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                  placeholder="Reference number"
                  className="w-full"
                  style={{ padding: '8px 10px', border: '1.4px solid #e4ddd1', borderRadius: 7, fontSize: 13, color: '#23282A', background: '#FEFDFB', outline: 'none', fontFamily: 'inherit' }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#3fa294'; e.currentTarget.style.background = '#eef7f6'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#e4ddd1'; e.currentTarget.style.background = '#FEFDFB'; }}
                />
              </div>
              
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(null)}
                  style={{ flex: 1, padding: '9px 18px', borderRadius: 9, cursor: 'pointer', background: '#FEFDFB', border: '1.4px solid #e4ddd1', color: '#5c6567', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, transition: 'all .15s ease', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#eef7f6'; e.currentTarget.style.borderColor = '#a6d9d3'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#FEFDFB'; e.currentTarget.style.borderColor = '#e4ddd1'; }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ flex: 1, padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid transparent', background: 'linear-gradient(155deg, #1f8577, #0f544c)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, boxShadow: '0 6px 16px -6px rgba(15,84,76,.55)', transition: 'all .15s ease', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 20px -6px rgba(15,84,76,.65)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 6px 16px -6px rgba(15,84,76,.55)'; }}
                >
                  Transfer Funds
                </button>
              </div>
            </form>
          </div>
        </div>
        </div>
      )}

      {/* View Transfer Modal */}
      {showModal === 'view' && selectedTransfer && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-[1.5rem] shadow-2xl w-full max-w-md overflow-hidden animate-fadeIn flex">
            <div style={{ width: 4, background: 'linear-gradient(180deg, #1f8577, #0f544c)', flexShrink: 0 }} />
            <div className="flex-1">
              <div className="p-[24px] border-b border-slate-100 flex justify-between items-center">
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(155deg, #1f8577, #0f544c)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 10px -3px rgba(15,84,76,.4)' }}>
                    <ArrowRightLeft size={18} color="#fff" />
                  </div>
                  <div>
                    <h2 style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontWeight: 400, fontSize: 20, margin: 0, color: '#0b3e39', letterSpacing: 0.2 }}>
                      Transfer Details
                    </h2>
                    <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#5c6567', letterSpacing: 0.02 }}>Account Transfers</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowModal(null)}
                  style={{ padding: '6px', borderRadius: 8, border: '1.4px solid #e4ddd1', background: '#FEFDFB', color: '#5c6567', cursor: 'pointer', transition: 'all .15s ease' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#eef7f6'; e.currentTarget.style.color = '#0f544c'; e.currentTarget.style.borderColor = '#a6d9d3'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#FEFDFB'; e.currentTarget.style.color = '#5c6567'; e.currentTarget.style.borderColor = '#e4ddd1'; }}
                >
                  <X size={15} />
                </button>
              </div>
            
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 p-4 rounded-lg">
                  <div className="text-xs text-slate-500 mb-1">Date</div>
                  <div className="font-medium">{format(parseISO(selectedTransfer.date), 'MMMM dd, yyyy')}</div>
                </div>
                <div className="bg-slate-50 p-4 rounded-lg">
                  <div className="text-xs text-slate-500 mb-1">Amount</div>
                  <div className="font-bold text-lg text-slate-900">{currency}{selectedTransfer.amount.toLocaleString()}</div>
                </div>
              </div>
              
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-slate-500 mb-1">From Account</div>
                  <div className="font-medium flex items-center gap-2">
                    <TrendingDown size={16} className="text-red-500" />
                    {getAccountName(selectedTransfer.fromAccountId)}
                  </div>
                </div>
                
                <div>
                  <div className="text-xs text-slate-500 mb-1">To Account</div>
                  <div className="font-medium flex items-center gap-2">
                    <TrendingUp size={16} className="text-green-500" />
                    {getAccountName(selectedTransfer.toAccountId)}
                  </div>
                </div>
                
                {selectedTransfer.description && (
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Description</div>
                    <div className="font-medium">{selectedTransfer.description}</div>
                  </div>
                )}
                
                {selectedTransfer.reference && (
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Reference</div>
                    <div className="font-mono text-sm bg-slate-100 px-2 py-1 rounded inline-block">
                      {selectedTransfer.reference}
                    </div>
                  </div>
                )}
              </div>
              
              <div className="pt-4">
                <button
                  onClick={() => setShowModal(null)}
                  style={{ width: '100%', padding: '9px 18px', borderRadius: 9, cursor: 'pointer', background: '#FEFDFB', border: '1.4px solid #e4ddd1', color: '#5c6567', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, transition: 'all .15s ease', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#eef7f6'; e.currentTarget.style.borderColor = '#a6d9d3'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#FEFDFB'; e.currentTarget.style.borderColor = '#e4ddd1'; }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
};

export default Transfers;
