import React, { useState, useMemo, useEffect } from 'react';
import {
  Search, Plus, Filter, Download, Phone,
  MapPin, ChevronRight, User, School, Building2, Landmark,
  Trash2, Edit, ExternalLink, MoreVertical,
  DollarSign, Clock, CheckCircle, AlertCircle, TrendingUp, AlertTriangle, FileText, Target
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSales } from '../../context/SalesContext';
import { useAuth } from '../../context/AuthContext';
import { useFinance } from '../../context/FinanceContext';
import { Customer, Invoice, CustomerPayment } from '../../types';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/Pagination';
import { ClientModal } from './components/ClientModal';
import { CustomerCard } from './components/CustomerCard';
import { CustomerWorkspace } from './components/CustomerWorkspace';
import { isAfter, parseISO, subDays, format } from 'date-fns';
import { exportToCSV } from '../../utils/helpers';
import { currencyService } from '../../services/currencyService';
import { CustomerSearch } from '../../components/CustomerSearch';
import { ConfirmDialog, ConfirmDialogType } from '../../components/ConfirmDialog';

export const Clients: React.FC = () => {
  const { customers, addCustomer, updateCustomer, deleteCustomer, isLoading, customerPayments } = useSales();
  const { invoices } = useFinance();
  const { companyConfig } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const currency = companyConfig?.currencySymbol || currencyService.getCurrency(currencyService.getBaseCurrency())?.symbol || '$';

  const [searchQuery, setSearchQuery] = useState('');
   const [isModalOpen, setIsModalOpen] = useState(false);
   const [isSegmentModalOpen, setIsSegmentModalOpen] = useState(false);
   const [pendingSegment, setPendingSegment] = useState<string | undefined>();
   const [selectedCustomer, setSelectedCustomer] = useState<Customer | undefined>();
  const [selectedWorkspaceCustomer, setSelectedWorkspaceCustomer] = useState<Customer | null>(null);
  const [selectedCardCustomer, setSelectedCardCustomer] = useState<Customer | null>(null);
  const [filterStatus, setFilterStatus] = useState<'All' | 'Active' | 'Inactive' | 'Lead'>('All');
  const [selectedMetric, setSelectedMetric] = useState<'All' | 'Overdue' | 'Open' | 'Paid'>('All');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; confirmText?: string; type?: ConfirmDialogType; onConfirm?: () => void }>({ open: false, title: '', message: '' });

  // Advanced Filters State
  const [balanceRange, setBalanceRange] = useState<string>('Any Balance');
  const [customerSegment, setCustomerSegment] = useState<string>('All Segments');
  const [pipelineStageFilter, setPipelineStageFilter] = useState<string>('All Stages');

  useEffect(() => {
    const handleClickOutside = () => setActiveMenuId(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    if (location.state?.action === 'create') {
      handleAddNew();
      // Clear state to prevent reopening on refresh
      window.history.replaceState({}, document.title);
    } else if (location.state?.customerId) {
      const customer = customers.find(c => c.id === location.state.customerId);
      if (customer) {
        setSelectedWorkspaceCustomer(customer);
      }
      // Clear state to prevent reopening on refresh
      window.history.replaceState({}, document.title);
    }
  }, [location.state, customers]);

  const [expandedClientId, setExpandedClientId] = useState<string | null>(null);

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      const matchesSearch = (c.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.phone && c.phone.includes(searchQuery));
      const matchesStatus = filterStatus === 'All' || c.status === filterStatus;

      const matchesSegment = customerSegment === 'All Segments' || c.segment === customerSegment;
      const matchesPipelineStage = pipelineStageFilter === 'All Stages' || (c as Customer & Record<string, unknown>).pipelineStage === pipelineStageFilter;

      let matchesBalance = true;
      const balance = c.balance || 0;
      if (balanceRange === 'Over $1,000') matchesBalance = balance > 1000;
      else if (balanceRange === 'Over $5,000') matchesBalance = balance > 5000;
      else if (balanceRange === 'Over $10,000') matchesBalance = balance > 10000;
      else if (balanceRange === 'Negative (Credit)') matchesBalance = balance < 0;

      let matchesMetric = true;
      if (selectedMetric === 'Overdue') {
        const hasOverdue = invoices.some(inv =>
          inv.customerId === c.id &&
          inv.status !== 'Paid' &&
          inv.status !== 'Cancelled' &&
          isAfter(new Date(), parseISO(inv.dueDate))
        );
        matchesMetric = hasOverdue;
      } else if (selectedMetric === 'Open') {
        const hasOpen = invoices.some(inv =>
          inv.customerId === c.id &&
          (inv.status === 'Unpaid' || inv.status === 'Partial')
        );
        matchesMetric = hasOpen;
      } else if (selectedMetric === 'Paid') {
        const hasRecentPayment = customerPayments.some(r =>
          r.customerId === c.id &&
          r.status === 'Cleared' &&
          isAfter(parseISO(r.date), subDays(new Date(), 30))
        );
        matchesMetric = hasRecentPayment;
      }

      return matchesSearch && matchesStatus && matchesMetric && matchesSegment && matchesBalance && matchesPipelineStage;
    });
  }, [customers, searchQuery, filterStatus, selectedMetric, invoices, customerPayments, balanceRange, customerSegment, pipelineStageFilter]);

  const { currentItems, currentPage, maxPage, totalItems, next, prev, first, last, setItemsPerPage, itemsPerPage } = usePagination(filteredCustomers, 25);

  const stats = useMemo(() => {
    const today = new Date();
    const thirtyDaysAgo = subDays(today, 30);

    const totalBalance = customers.reduce((sum, c) => sum + (c.balance || 0), 0);

    // Calculate Overdue
    const overdueBalance = invoices
      .filter(inv => inv.status !== 'Paid' && inv.status !== 'Cancelled' && isAfter(today, parseISO(inv.dueDate)))
      .reduce((sum, inv) => sum + (inv.totalAmount - (inv.paidAmount || 0)), 0);

    // Calculate Open Invoices
    const openInvoicesTotal = invoices
      .filter(inv => inv.status === 'Unpaid' || inv.status === 'Partial')
      .reduce((sum, inv) => sum + (inv.totalAmount - (inv.paidAmount || 0)), 0);

    // Calculate Paid in last 30 days
    const paidLast30Days = customerPayments
      .filter(r => r.status === 'Cleared' && isAfter(parseISO(r.date), thirtyDaysAgo))
      .reduce((sum, r) => sum + r.amount, 0);

    const activeCount = customers.filter(c => c.status === 'Active').length;

    return {
      totalBalance,
      overdueBalance,
      openInvoicesTotal,
      paidLast30Days,
      activeCount
    };
  }, [customers, invoices, customerPayments]);

  const handleEdit = (customer: Customer) => {
    setSelectedCustomer(customer);
    setIsModalOpen(true);
  };

   const handleAddNew = () => {
      setIsModalOpen(true);
    };

   const handleSegmentSelect = (segment: string) => {
     setPendingSegment(segment);
     setIsSegmentModalOpen(false);
     setSelectedCustomer(undefined);
     setIsModalOpen(true);
   };

  const handleDelete = async (id: string) => {
    setConfirmState({
      open: true,
      title: 'Delete Client',
      message: 'Are you sure you want to delete this client?',
      type: 'danger',
      confirmText: 'Delete',
      onConfirm: async () => {
        await deleteCustomer(id);
      }
    });
  };

  const handleBatchDelete = async () => {
    setConfirmState({
      open: true,
      title: 'Delete Clients',
      message: `Are you sure you want to delete ${selectedIds.length} clients?`,
      type: 'danger',
      confirmText: 'Delete All',
      onConfirm: async () => {
        for (const id of selectedIds) {
          await deleteCustomer(id);
        }
        setSelectedIds([]);
      }
    });
  };

  const handleBatchStatusUpdate = async (status: 'Active' | 'Inactive') => {
    for (const id of selectedIds) {
      const customer = customers.find(c => c.id === id);
      if (customer) {
        await updateCustomer({ ...customer, status });
      }
    }
    setSelectedIds([]);
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredCustomers.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredCustomers.map(c => c.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleRowMenuClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setActiveMenuId(prev => (prev === id ? null : id));
  };

  if (selectedWorkspaceCustomer) {
    return (
      <>
        <CustomerWorkspace
          customer={selectedWorkspaceCustomer}
          onBack={() => setSelectedWorkspaceCustomer(null)}
          onEdit={(customer) => {
            setSelectedCustomer(customer);
            setIsModalOpen(true);
          }}
        />

       <ClientModal
         isOpen={isModalOpen}
         onClose={() => { setIsModalOpen(false); setPendingSegment(undefined); }}
         onSave={selectedCustomer ? updateCustomer : addCustomer}
         customer={selectedCustomer}
         initialSegment={pendingSegment}
       />
      </>
    );
  }

  const getLastTransaction = (customerId: string) => {
    const customerInvoices = invoices.filter(inv => inv.customerId === customerId || inv.customerName === customers.find(c => c.id === customerId)?.name);
    if (customerInvoices.length === 0) return 'No transactions';

    const latest = customerInvoices.reduce((prev, current) =>
      isAfter(parseISO(current.date), parseISO(prev.date)) ? current : prev
    );

    return format(parseISO(latest.date), 'MMM dd, yyyy');
  };

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 min-h-screen font-sans text-[13px] leading-[1.45]" style={{ background: '#FEFDFB' }}>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-1">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight" style={{ color: '#0b3e39' }}>Clients</h1>
          <p className="text-[13px] font-medium" style={{ color: '#5c6567' }}>Manage your client relationships and balances</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/sales-flow/leads')}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg font-semibold transition-all text-[13px]"
            style={{ background: '#FEFDFB', border: '1.4px solid #a6d9d3', color: '#0f544c' }}>
            <Target size={16} /> Lead Board
          </button>
          <button onClick={() => exportToCSV(customers.map(c => ({ 'Customer ID': c.id, 'Full name': c.name, 'Billing Address': c.billingAddress || c.address || '', 'Phone number': c.phone, 'Segment': c.segment, 'Shipping Address': c.shippingAddress || '', 'Opening Balance': c.balance || 0, 'Wallet Balance': c.walletBalance || 0, 'Branch Account': c.accountNumber || '' })), 'Clients')}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg font-semibold transition-all text-[13px] prime-btn-secondary">
            <Download size={16} /> Export
          </button>
          <button onClick={handleAddNew} className="prime-btn">
            <Plus size={18} /> New Client
          </button>
        </div>
      </div>

      {/* Money Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div onClick={() => setSelectedMetric(selectedMetric === 'Overdue' ? 'All' : 'Overdue')}
          className={`cursor-pointer transition-all duration-200 p-3 md:p-4 rounded-xl flex items-start gap-4 border-l-4 ${selectedMetric === 'Overdue' ? 'ring-2 ring-rose-500 shadow-md scale-[1.01]' : 'hover:opacity-80'}`}
          style={{ background: '#FEFDFB', border: '1.4px solid #e4ddd1', borderLeft: '4px solid #b5493f', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
          <div className="p-2.5 rounded-lg" style={{ background: '#fef2f2', color: '#b5493f' }}><AlertTriangle size={20} /></div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-tight leading-none mb-1.5" style={{ color: '#5c6567' }}>Overdue</p>
            <p className="text-lg md:text-xl font-semibold finance-nums" style={{ color: '#23282A' }}>{currency}{(stats.overdueBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
          </div>
        </div>
        <div onClick={() => setSelectedMetric(selectedMetric === 'Open' ? 'All' : 'Open')}
          className={`cursor-pointer transition-all duration-200 p-3 md:p-4 rounded-xl flex items-start gap-4 border-l-4 ${selectedMetric === 'Open' ? 'ring-2 ring-amber-500 shadow-md scale-[1.01]' : 'hover:opacity-80'}`}
          style={{ background: '#FEFDFB', border: '1.4px solid #e4ddd1', borderLeft: '4px solid #d99a3f', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
          <div className="p-2.5 rounded-lg" style={{ background: '#fbead0', color: '#d99a3f' }}><Clock size={20} /></div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-tight leading-none mb-1.5" style={{ color: '#5c6567' }}>Open Invoices</p>
            <p className="text-lg md:text-xl font-semibold finance-nums" style={{ color: '#23282A' }}>{currency}{(stats.openInvoicesTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
          </div>
        </div>
        <div onClick={() => setSelectedMetric(selectedMetric === 'Paid' ? 'All' : 'Paid')}
          className={`cursor-pointer transition-all duration-200 p-3 md:p-4 rounded-xl flex items-start gap-4 border-l-4 ${selectedMetric === 'Paid' ? 'ring-2 ring-emerald-500 shadow-md scale-[1.01]' : 'hover:opacity-80'}`}
          style={{ background: '#FEFDFB', border: '1.4px solid #e4ddd1', borderLeft: '4px solid #1f8577', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
          <div className="p-2.5 rounded-lg" style={{ background: '#d3ece9', color: '#1f8577' }}><CheckCircle size={20} /></div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-tight leading-none mb-1.5" style={{ color: '#5c6567' }}>Paid (30d)</p>
            <p className="text-lg md:text-xl font-semibold finance-nums" style={{ color: '#23282A' }}>{currency}{(stats.paidLast30Days || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
          </div>
        </div>
        <div onClick={() => setSelectedMetric('All')}
          className={`cursor-pointer transition-all duration-200 p-3 md:p-4 rounded-xl flex items-start gap-4 border-l-4 ${selectedMetric === 'All' ? 'ring-2 ring-teal-500 shadow-md scale-[1.01]' : 'hover:opacity-80'}`}
          style={{ background: '#FEFDFB', border: '1.4px solid #e4ddd1', borderLeft: '4px solid #1f8577', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
          <div className="p-2.5 rounded-lg" style={{ background: '#eef7f6', color: '#1f8577' }}><User size={20} /></div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-tight leading-none mb-1.5" style={{ color: '#5c6567' }}>Total Balance</p>
            <p className="text-lg md:text-xl font-semibold finance-nums" style={{ color: '#23282A' }}>{currency}{(stats.totalBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
          </div>
        </div>
      </div>

      {/* Main Content Card */}
      <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 overflow-hidden flex-1 flex flex-col">
        {/* Filters & Search */}
        <div className="p-3 border-b border-slate-200/60 flex justify-between items-center bg-slate-50/30 shrink-0 flex-wrap gap-2">
          <div className="flex flex-1 items-center gap-4 min-w-0">
            <div className="relative w-full max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="text"
                placeholder="Search by name, email or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 border border-slate-200/80 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white/50 font-normal"
              />
            </div>

            {selectedIds.length > 0 && (
              <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 shrink-0">
                <span className="text-[13px] font-semibold px-2.5 py-1 rounded-lg border" style={{ color: '#0b3e39', background: '#eef7f6', borderColor: '#a6d9d3' }}>
                  {selectedIds.length} Selected
                </span>
                <div className="h-5 w-px mx-1" style={{ background: '#e4ddd1' }} />
                <select
                  onChange={(e) => {
                    if (e.target.value === 'delete') handleBatchDelete();
                    else if (e.target.value === 'active') handleBatchStatusUpdate('Active');
                    else if (e.target.value === 'inactive') handleBatchStatusUpdate('Inactive');
                    e.target.value = '';
                  }}
                  className="w-auto pl-2 pr-6 py-1 border border-slate-200/80 rounded-xl text-xs bg-white/50 font-normal focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Batch Actions</option>
                  <option value="active">Make Active</option>
                  <option value="inactive">Make Inactive</option>
                  <option value="delete">Delete Selected</option>
                </select>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as 'All' | 'Active' | 'Inactive' | 'Lead')}
              className="w-auto pl-2 pr-6 py-1 border border-slate-200/80 rounded-xl text-xs bg-white/50 font-normal focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="All">All Statuses</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
              <option value="Lead">Lead</option>
              <option value="Suspended">Suspended</option>
              <option value="VIP">VIP</option>
              <option value="Prospect">Prospect</option>
              <option value="Credit Hold">Credit Hold</option>
            </select>
            <select
              value={pipelineStageFilter}
              onChange={(e) => setPipelineStageFilter(e.target.value)}
              className="w-auto pl-2 pr-6 py-1 border border-slate-200/80 rounded-xl text-xs bg-white/50 font-normal focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="All Stages">All Stages</option>
              <option value="New">New</option>
              <option value="Qualified">Qualified</option>
              <option value="Proposal">Proposal</option>
              <option value="Negotiation">Negotiation</option>
              <option value="Won">Won</option>
              <option value="Lost">Lost</option>
            </select>
            <div className="relative group">
              <button className="p-2 rounded-lg transition-all text-slate-400 hover:text-slate-600">
                <Filter size={18} />
              </button>
              <div className="absolute right-0 top-full mt-1 w-64 rounded-xl shadow-xl py-3 px-4 z-20 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 origin-top-right bg-white border border-slate-200/80">
                <h4 className="text-[11px] font-bold uppercase tracking-wider mb-3 text-slate-500">Advanced Filters</h4>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-slate-600 block mb-1">Balance Range</label>
                    <select
                      value={balanceRange}
                      onChange={(e) => setBalanceRange(e.target.value)}
                      className="w-full pl-2 pr-6 py-1.5 border border-slate-200/80 rounded-xl text-xs bg-white/50 font-normal focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="Any Balance">Any Balance</option>
                      <option value="Over $1,000">Over $1,000</option>
                      <option value="Over $5,000">Over $5,000</option>
                      <option value="Over $10,000">Over $10,000</option>
                      <option value="Negative (Credit)">Negative (Credit)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 block mb-1">Customer Segment</label>
                    <select
                      value={customerSegment}
                      onChange={(e) => setCustomerSegment(e.target.value)}
                      className="w-full pl-2 pr-6 py-1.5 border border-slate-200/80 rounded-xl text-xs bg-white/50 font-normal focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="All Segments">All Segments</option>
                      <option value="Individual">Individual</option>
                      <option value="School Account">School Account</option>
                      <option value="Institution">Institution</option>
                      <option value="Government">Government</option>
                    </select>
                  </div>
                  <button
                    onClick={() => { setBalanceRange('Any Balance'); setCustomerSegment('All Segments'); }}
                    className="w-full py-2 rounded-lg font-bold text-[11px] mt-2 transition-colors bg-slate-100 text-slate-600 hover:bg-slate-200"
                  >
                    Reset Filters
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto custom-scrollbar">
          <table className="w-full min-w-[800px] text-left text-[13px] table-fixed">
            <thead className="bg-slate-50/80 backdrop-blur text-slate-500 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="table-header text-center w-10">
                  <input type="checkbox"
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    checked={selectedIds.length === filteredCustomers.length && filteredCustomers.length > 0}
                    onChange={toggleSelectAll} />
                </th>
                <th className="table-header text-left w-[10%]">ID</th>
                <th className="table-header text-left w-[25%]">Name</th>
                <th className="table-header text-left w-[15%]">Contact Info</th>
                <th className="table-header text-left w-[12%]">Last Transaction</th>
                <th className="table-header text-right w-[10%]">Wallet</th>
                <th className="table-header text-right w-[10%]">Open Balance</th>
                <th className="table-header text-center w-[18%]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/50">
              {isLoading ? (
                <tr><td colSpan={8} className="table-body-cell text-center italic py-10">Loading clients...</td></tr>
              ) : filteredCustomers.length === 0 ? (
                <tr><td colSpan={8} className="table-body-cell text-center italic py-10">No clients found matching your criteria.</td></tr>
              ) : (
                currentItems.map((customer) => {
                  const isChecked = selectedIds.includes(customer.id);
                  return (
                    <React.Fragment key={customer.id}>
                      <tr onClick={(e) => { e.stopPropagation(); setSelectedCardCustomer(customer); }}
                        className={`transition-colors cursor-pointer group ${isChecked ? 'bg-blue-50/80' : 'hover:bg-blue-50/50 border-l-4 border-l-transparent'}`}>
                        <td className="table-body-cell text-center" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox"
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                            checked={isChecked}
                            onChange={() => toggleSelect(customer.id)} />
                        </td>
                        <td className="table-body-cell font-mono text-slate-500 font-bold truncate">
                          #{customer.id}
                        </td>
                        <td className="table-body-cell">
                          <div className="flex items-center gap-2">
                            <button onClick={(e) => { e.stopPropagation(); setExpandedClientId(expandedClientId === customer.id ? null : customer.id); }}
                              className="p-1 text-slate-400 hover:text-blue-600 rounded transition-all shrink-0">
                              <ChevronRight size={14} className={`transition-transform duration-200 ${expandedClientId === customer.id ? 'rotate-90' : ''}`} />
                            </button>
                            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-slate-100 text-slate-500 border border-slate-200">
                              {customer.segment === 'School Account' ? <School size={14} /> :
                               customer.segment === 'Institution' ? <Building2 size={14} /> :
                               customer.segment === 'Government' ? <Landmark size={14} /> :
                               <User size={14} />}
                            </div>
                            <div className="cursor-pointer hover:opacity-80 transition-opacity min-w-0"
                              onClick={(e) => { e.stopPropagation(); setSelectedWorkspaceCustomer(customer); }}>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="font-medium text-slate-900 truncate max-w-[140px]">{customer.name}</p>
                                <span className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${
                                  customer.status === 'Active' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                                  customer.status === 'Lead' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                                  customer.status === 'Suspended' ? 'bg-rose-100 text-rose-700 border-rose-200' :
                                  customer.status === 'VIP' ? 'bg-purple-100 text-purple-700 border-purple-200' :
                                  customer.status === 'Prospect' ? 'bg-teal-100 text-teal-700 border-teal-200' :
                                  customer.status === 'Credit Hold' ? 'bg-rose-100 text-rose-700 border-rose-200 line-through' :
                                  'bg-slate-100 text-slate-600 border-slate-200'
                                }`}>
                                  {customer.status}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                {(customer as Customer & Record<string, unknown>).pipelineStage && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap bg-blue-100 text-blue-700 border-blue-200">
                                    {(customer as Customer & Record<string, unknown>).pipelineStage}
                                  </span>
                                )}
                                {(customer as Customer & Record<string, unknown>).leadSource && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap bg-amber-100 text-amber-700 border-amber-200">
                                    {(customer as Customer & Record<string, unknown>).leadSource}
                                  </span>
                                )}
                                {customer.subAccounts && customer.subAccounts.length > 0 && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap bg-sky-100 text-sky-700 border-sky-200">
                                    {customer.subAccounts.length} Sub
                                  </span>
                                )}
                                {customer.creditHold && <AlertTriangle size={12} className="text-rose-500 animate-pulse" />}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="table-body-cell text-slate-500 truncate">
                          <Phone size={13} className="inline mr-1 text-slate-400" />{customer.phone || 'No phone'}
                        </td>
                        <td className="table-body-cell font-medium finance-nums truncate text-slate-700">
                          {getLastTransaction(customer.id)}
                        </td>
                        <td className="table-body-cell text-right font-medium finance-nums truncate text-teal-600">
                          {currency}{(customer.walletBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className={`table-body-cell text-right font-medium finance-nums truncate ${(customer.balance || 0) > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                          {currency}{(customer.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="table-body-cell text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-center gap-1 items-center shrink-0">
                            <button onClick={(e) => { e.stopPropagation(); setSelectedWorkspaceCustomer(customer); }}
                              className="p-1.5 text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-white border border-transparent hover:border-slate-200 rounded transition-all" title="View Profile">
                              <ChevronRight size={14} />
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); handleEdit(customer); }}
                              className="p-1.5 text-slate-400 hover:text-amber-600 bg-slate-50 hover:bg-white border border-transparent hover:border-slate-200 rounded transition-all" title="Edit">
                              <Edit size={14} />
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); navigate('/sales-flow/invoices', { state: { action: 'create', customer: customer.name } }); }}
                              className="p-1.5 text-blue-600 hover:text-blue-700 transition-all flex items-center justify-center" title="Create Invoice">
                              <DollarSign size={16} />
                            </button>
                            <button onClick={(e) => handleRowMenuClick(e, customer.id)}
                              className="p-1.5 text-slate-400 hover:text-slate-600 rounded transition-all" title="More">
                              <MoreVertical size={14} />
                            </button>
                          </div>
                          {activeMenuId === customer.id && (
                            <div onClick={(e) => e.stopPropagation()}
                              className="absolute right-0 mt-1 w-44 rounded-lg shadow-xl py-1.5 z-10 animate-in fade-in zoom-in-95 origin-top-right bg-white border border-slate-200/80"
                              style={{ position: 'absolute' }}>
                              <button onClick={() => { setActiveMenuId(null); navigate('/sales-flow/payments', { state: { action: 'create', customer: customer.name, isTopUp: true } }); }}
                                className="w-full text-left px-3 py-1.5 text-xs font-semibold flex items-center gap-2 text-slate-700 hover:bg-slate-50">
                                <DollarSign size={14} className="text-slate-400" /> Add Prepayment
                              </button>
                              <button onClick={() => { setActiveMenuId(null); navigate('/revenue/contacts', { state: { customerId: customer.id } }); }}
                                className="w-full text-left px-3 py-1.5 text-xs font-semibold flex items-center gap-2 text-slate-700 hover:bg-slate-50">
                                <FileText size={14} className="text-slate-400" /> Account Statement
                              </button>
                              <div className="h-px my-1 bg-slate-100" />
                              <button onClick={() => { setActiveMenuId(null); handleDelete(customer.id); }}
                                className="w-full text-left px-3 py-1.5 text-xs font-semibold flex items-center gap-2 text-red-600 hover:bg-slate-50">
                                <Trash2 size={14} /> Delete Client
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {expandedClientId === customer.id && customer.subAccounts && customer.subAccounts.length > 0 && (
                        <tr className="animate-in slide-in-from-top-2 duration-200 bg-slate-50/50">
                          <td></td>
                          <td colSpan={7} className="px-4 py-3">
                            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                              <div className="px-3 py-2 flex items-center justify-between bg-slate-50/80 border-b border-slate-200/60">
                                <h4 className="text-[10px] font-bold uppercase tracking-tight text-slate-500">Sub Accounts</h4>
                              </div>
                              <table className="w-full text-left text-[13px]">
                                <thead>
                                  <tr>
                                    <th className="table-header">Name</th>
                                    <th className="table-header text-right">Wallet</th>
                                    <th className="table-header text-right">Balance</th>
                                    <th className="table-header text-center">Status</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100/50">
                                  {customer.subAccounts.map((sub) => (
                                    <tr key={sub.id} className="hover:bg-blue-50/50 transition-colors">
                                      <td className="table-body-cell font-medium text-slate-900">{sub.name}</td>
                                      <td className="table-body-cell text-right font-medium finance-nums text-teal-600">
                                        {currency}{(sub.walletBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                      </td>
                                      <td className="table-body-cell text-right font-medium finance-nums text-red-600">
                                        {currency}{(sub.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                      </td>
                                      <td className="table-body-cell text-center">
                                        <span className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${sub.status === 'Active' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                          {sub.status}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={currentPage} maxPage={maxPage} totalItems={totalItems} itemsPerPage={itemsPerPage} onNext={next} onPrev={prev} onFirst={first} onLast={last} onItemsPerPageChange={setItemsPerPage} />
      </div>

      {selectedCardCustomer && (
        <CustomerCard
          customer={selectedCardCustomer}
          onClose={() => setSelectedCardCustomer(null)}
          onViewProfile={(c) => {
            setSelectedCardCustomer(null);
            setSelectedWorkspaceCustomer(c);
          }}
          onEdit={(c) => {
            setSelectedCardCustomer(null);
            handleEdit(c);
          }}
          onCreateInvoice={(c) => {
            setSelectedCardCustomer(null);
            navigate('/sales-flow/invoices', { state: { action: 'create', customer: c.name } });
          }}
          onCreateQuote={(c) => {
            setSelectedCardCustomer(null);
            navigate('/sales-flow/orders', { state: { action: 'create', customer: c.name } });
          }}
          onStatement={(c) => {
            setSelectedCardCustomer(null);
            navigate('/revenue/contacts', { state: { customerId: c.id } });
          }}
          onWhatsApp={(c) => {
            setSelectedCardCustomer(null);
            if (c.phone) {
              window.open(`https://wa.me/${c.phone.replace(/[^0-9]/g, '')}`, '_blank');
            }
          }}
        />
      )}

        <ClientModal
          isOpen={isModalOpen}
          onClose={() => { setIsModalOpen(false); setPendingSegment(undefined); }}
          onSave={selectedCustomer ? updateCustomer : addCustomer}
          customer={selectedCustomer}
          initialSegment={pendingSegment}
        />

      <ConfirmDialog
        open={confirmState.open}
        onOpenChange={(open) => !open && setConfirmState(c => ({ ...c, open: false }))}
        onConfirm={() => {
          confirmState.onConfirm?.();
          setConfirmState(c => ({ ...c, open: false }));
        }}
        onCancel={() => setConfirmState(c => ({ ...c, open: false }))}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        type={confirmState.type || 'question'}
      />

    </div>
  );
};

export default Clients;
