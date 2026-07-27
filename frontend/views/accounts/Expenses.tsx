
import React, { useState, useMemo, useRef } from 'react';
import { 
  Plus, DollarSign, Banknote as PaymentIcon, Calendar, Search, Filter, 
  Download, PieChart, TrendingUp, AlertTriangle, FileText, 
  X, CheckCircle, ArrowUpRight, ArrowDownRight, Paperclip, Tag, ExternalLink, Image as ImageIcon, Sparkles, Loader2, Activity, Zap, Eye
} from 'lucide-react';
import { 
  PieChart as RePieChart, Pie, Cell, ResponsiveContainer, Tooltip as ReTooltip, Legend 
} from 'recharts';
import { useAuth } from '../../context/AuthContext';
import { useFinance } from '../../context/FinanceContext';
import { useBankingStore } from '../../context/BankingContext';
import { Expense } from '../../types';
import { exportToCSV } from '../../services/excelService';
import { DEFAULT_ACCOUNTS, ACCOUNT_IDS } from '../../constants';
import { localFileStorage } from '../../services/localFileStorage';
import { OfflineImage } from '../../components/OfflineImage';
import { extractPaymentProofData, analyzeExpenses } from '../../services/geminiService';
import { getDefaultDate, validateDateInFY } from '../../utils/financialYearUtils';
import ReactMarkdown from 'react-markdown';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6366f1'];

const Expenses: React.FC = () => {
  const { user, companyConfig, checkPermission, notify, isOnline } = useAuth();
  const { expenses, addExpense, approveExpense } = useFinance();
  const { accounts: bankAccounts, fetchBankingData } = useBankingStore();
  
  React.useEffect(() => {
    fetchBankingData?.();
  }, [fetchBankingData]);
  const currency = companyConfig?.currencySymbol || '$';

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState<'This Month' | 'Last Month' | 'All Time'>('This Month');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachedFileId, setAttachedFileId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  const handleAiAudit = async () => {
    setIsAiLoading(true);
    try {
        const result = await analyzeExpenses(expenses as Expense[]);
        setAiAnalysis(result);
    } catch (error) {
        notify("AI Audit failed", "error");
    } finally {
        setIsAiLoading(false);
    }
  };

  const canEdit = checkPermission('accounts.edit');

  const [formData, setFormData] = useState({
    amount: '',
    category: 'General',
    description: '',
date: getDefaultDate(),
    accountId: ACCOUNT_IDS.CASH_DRAWER,
    status: 'Paid'
  });

  const predefinedCategories = [
      'General', 'Utilities', 'Transport', 'Rent', 'Salaries', 'Marketing', 
      'Cost of Goods', 'Maintenance', 'Office Supplies', 'Meals & Entertainment', 
      'Insurance', 'Software Subscriptions', 'Legal & Professional'
  ];

  const categories = ['All', ...Array.from(new Set([...predefinedCategories, ...expenses.map(e => e.category)]))];

  const filteredExpenses = useMemo(() => {
    const now = new Date();
    let data = expenses;
    if (dateFilter === 'This Month') {
      data = data.filter(e => {
        const d = new Date(e.date);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      });
    } else if (dateFilter === 'Last Month') {
      const lastMonth = new Date();
      lastMonth.setMonth(now.getMonth() - 1);
      data = data.filter(e => {
        const d = new Date(e.date);
        return d.getMonth() === lastMonth.getMonth() && d.getFullYear() === lastMonth.getFullYear();
      });
    }
    return data.filter(e => 
      (categoryFilter === 'All' || e.category === categoryFilter) &&
      (e.description.toLowerCase().includes(searchTerm.toLowerCase()) || 
       e.amount.toString().includes(searchTerm) ||
       e.recordedBy.toLowerCase().includes(searchTerm.toLowerCase()))
    ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [expenses, searchTerm, categoryFilter, dateFilter]);

  const stats = useMemo(() => {
    const total = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
    const count = filteredExpenses.length;
    const avg = count > 0 ? total / count : 0;
    const catMap: Record<string, number> = {};
    filteredExpenses.forEach(e => {
      catMap[e.category] = (catMap[e.category] || 0) + e.amount;
    });
    const chartData = Object.entries(catMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    const highestExpense = filteredExpenses.length > 0 ? filteredExpenses.reduce((prev, current) => (prev.amount > current.amount) ? prev : current) : null;
    return { total, count, avg, chartData, highestExpense };
  }, [filteredExpenses]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;

    const dateError = validateDateInFY(formData.date);
    if (dateError) {
      notify(dateError, "error");
      return;
    }

    const amt = parseFloat(formData.amount);
    if (!formData.amount || isNaN(amt) || amt <= 0) {
        notify("Please enter a valid positive expense amount.", "error");
        return;
    }
    if (!formData.description.trim()) {
        notify("Expense description is required for the audit trail.", "error");
        return;
    }
    if (!formData.category) {
        notify("Please select a category for this expense.", "error");
        return;
    }

    addExpense({ 
      id: '',
      date: new Date(formData.date).toISOString(), 
      amount: amt, 
      category: formData.category, 
      description: formData.description, 
      recordedBy: user?.username || 'Unknown', 
      status: formData.status,
      paymentProofUrl: attachedFileId || undefined,
      accountId: formData.accountId
    });

    setFormData({ amount: '', category: 'General', description: '', date: getDefaultDate(), accountId: ACCOUNT_IDS.CASH_DRAWER, status: 'Paid' });
    setAttachedFileId(null); 
    setIsAddModalOpen(false);
  };

  const handleExport = () => {
    exportToCSV(filteredExpenses.map(e => ({ Date: new Date(e.date).toLocaleDateString(), ID: e.id, Category: e.category, Description: e.description, Amount: e.amount, User: e.recordedBy })), 'expenses_report');
  };

  const handleAttach = () => { if (canEdit) fileInputRef.current?.click(); };
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          try {
              const id = await localFileStorage.save(file);
              setAttachedFileId(id);
              if (isScanning) {
                  if (!isOnline) { notify("Scanning requires internet.", "error"); setIsScanning(false); return; }
                  const reader = new FileReader();
                  reader.onload = async (ev) => {
                      const base64 = ev.target?.result as string;
                      try {
                          const data = await extractPaymentProofData(base64);
                          if (data) { setFormData(prev => ({ ...prev, amount: data.amount?.toString() || prev.amount, date: data.date || prev.date, description: data.description || prev.description, category: data.category || prev.category })); notify("Payment proof scanned successfully!", "success"); }
                      } catch (err) { notify("Could not extract data.", "error"); } finally { setIsScanning(false); }
                  };
                  reader.readAsDataURL(file);
              } else notify("Payment proof attached", "success");
          } catch (e) { notify("Failed to attach payment proof", "error"); setIsScanning(false); }
          e.target.value = '';
      }
  };

  const handleMagicScan = () => { setIsScanning(true); fileInputRef.current?.click(); };
  const handleViewPaymentProof = async (fileId: string) => {
      const url = await localFileStorage.getUrl(fileId);
      if (url) window.open(url, '_blank');
      else notify("Payment proof file not found", "error");
  };

  const renderDetailModal = () => {
    if (!selectedExpense) return null;
    return (
      <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 border border-white/60">
          <div className="p-6 border-b border-slate-100 flex justify-between items-start bg-slate-50">
            <div><h2 className="text-xl font-bold text-slate-900">Expense Details</h2><p className="text-xs text-slate-500 font-mono mt-1">{selectedExpense.id}</p></div>
            <button onClick={() => { setSelectedExpense(null); setAttachedFileId(null); }} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
          </div>
          <div className="p-6 space-y-6 text-[12px]">
            <div className="flex justify-between items-center p-4 bg-red-50 rounded-xl border border-red-100">
               <div className="flex items-center gap-3"><div className="p-2 bg-red-100 text-red-600 rounded-lg"><DollarSign size={24} /></div><div><p className="text-[10px] font-bold text-red-800 uppercase">Total Amount</p><p className="text-2xl font-bold text-slate-900">{currency}{selectedExpense.amount.toLocaleString()}</p></div></div>
               <div className="text-right">
                 <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                   selectedExpense.status === 'Pending Approval' 
                     ? 'bg-amber-100 text-amber-700' 
                     : 'bg-emerald-100 text-emerald-700'
                 }`}>
                   {selectedExpense.status || 'Paid'}
                 </span>
               </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
               <div><label className="block text-slate-500 text-[10px] font-bold uppercase mb-1">Date</label><div className="font-medium text-slate-800 flex items-center gap-2"><Calendar size={14} className="text-slate-400"/>{new Date(selectedExpense.date).toLocaleDateString()} {new Date(selectedExpense.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div></div>
               <div><label className="block text-slate-500 text-[10px] font-bold uppercase mb-1">Category</label><div className="font-medium text-slate-800 flex items-center gap-2"><Tag size={14} className="text-slate-400"/>{selectedExpense.category}</div></div>
               <div className="col-span-2"><label className="block text-slate-500 text-[10px] font-bold uppercase mb-1">Description</label><div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-slate-700">{selectedExpense.description}</div></div>
               <div><label className="block text-slate-500 text-[10px] font-bold uppercase mb-1">Recorded By</label><div className="font-medium text-slate-800 flex items-center gap-2"><div className="w-5 h-5 bg-slate-200 rounded-full flex items-center justify-center text-[10px]">{selectedExpense.recordedBy.charAt(0)}</div>{selectedExpense.recordedBy}</div></div>
            </div>
            <div className="border-t border-slate-100 pt-4">
               <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-3">Ledger Impact</h4>
               <div className="bg-slate-800 text-white p-3 rounded-lg font-mono text-[10px] space-y-1">
                 <div className="flex justify-between">
                   <span className="text-red-300">DR Expense: {selectedExpense.category}</span>
                   <span>{currency}{selectedExpense.amount.toFixed(2)}</span>
                 </div>
                 <div className="flex justify-between">
                   <span className="text-emerald-300 pl-4">
                     CR {selectedExpense.accountId === ACCOUNT_IDS.BANK ? 'Main Bank Account' : 
                         selectedExpense.accountId === ACCOUNT_IDS.MOBILE_MONEY ? 'Mobile Money' : 
                         'Cash Drawer'}
                   </span>
                   <span>{currency}{selectedExpense.amount.toFixed(2)}</span>
                 </div>
               </div>
            </div>
            <div>
               <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-2">Attachments</h4>
               {selectedExpense.paymentProofUrl ? (
                   <div className="space-y-3"><div className="h-40 bg-slate-100 rounded-lg overflow-hidden border border-slate-200 relative group"><OfflineImage src={selectedExpense.paymentProofUrl} alt="Payment Proof Preview" className="w-full h-full object-contain" fallback={<div className="w-full h-full flex items-center justify-center text-slate-400 text-xs"><ImageIcon size={24} className="mb-1"/><br/>Preview Unavailable</div>}/><div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={() => handleViewPaymentProof(selectedExpense.paymentProofUrl!)} className="bg-white text-slate-800 px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-2"><ExternalLink size={14}/> Open Full File</button></div></div><button onClick={() => handleViewPaymentProof(selectedExpense.paymentProofUrl!)} className="flex items-center gap-2 p-2 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold hover:bg-blue-100 w-full justify-center transition-colors"><ExternalLink size={14}/> Open in New Tab</button></div>
               ) : <div className="text-center text-xs text-slate-400 italic p-2 border border-dashed rounded-lg">No payment proof attached.</div>}
            </div>

            {selectedExpense.status === 'Pending Approval' && checkPermission('accounts.approve') && (
              <div className="pt-4 border-t border-slate-100">
                <button 
                  onClick={async () => {
                    await approveExpense(selectedExpense.id);
                    setSelectedExpense(null);
                  }}
                  className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 flex items-center justify-center gap-2 shadow-lg shadow-emerald-200 text-sm transition-transform active:scale-95"
                >
                  <CheckCircle size={18}/> Approve & Post to Ledger
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full max-w-[1600px] mx-auto font-normal">
      {isAddModalOpen && canEdit && (
        <div className="fixed inset-0 z-[70] bg-[rgba(15,23,42,0.6)] flex items-center justify-center p-4" style={{fontFamily:"'Inter','DM Sans',sans-serif"}}>
           <div className="w-full max-w-md bg-[#FEFDFB] rounded-[14px] shadow-[0_30px_70px_-20px_rgba(0,0,0,.55),0_8px_24px_-8px_rgba(0,0,0,.35)] flex flex-col overflow-hidden relative">
              <div className="absolute top-0 left-0 right-0 h-[4px]" style={{background:'linear-gradient(90deg,#146b60,#3fa294 40%,#d99a3f 100%)'}}></div>
              <div className="flex items-center justify-between px-7 pt-[22px] pb-[18px] border-b border-[#e4ddd1]">
                 <div className="flex items-center gap-[14px]">
                    <div className="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0" style={{background:'linear-gradient(155deg,#1f8577,#0f544c)',boxShadow:'0 4px 10px -3px rgba(15,84,76,.6)'}}><PaymentIcon size={19} className="text-white"/></div>
                    <div>
                       <h1 className="text-[22px] m-0 text-[#0b3e39] tracking-[0.2px]" style={{fontFamily:"'DM Serif Display','Georgia',serif",fontWeight:400}}>New Expense</h1>
                    </div>
                 </div>
                 <div className="flex gap-2">{isOnline && <button onClick={handleMagicScan} className="text-xs bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-3 py-1.5 rounded-lg font-bold hover:shadow-md transition-all flex items-center gap-1" disabled={isScanning}>{isScanning ? <Loader2 size={12} className="animate-spin"/> : <Sparkles size={12}/>}Magic Scan</button>}<button onClick={() => setIsAddModalOpen(false)} className="w-8 h-8 rounded-lg border border-[#e4ddd1] bg-[#FEFDFB] text-[#5c6567] flex items-center justify-center cursor-pointer hover:bg-[#eef7f6] hover:text-[#0f544c] hover:border-[#a6d9d3] transition-all"><X size={15}/></button></div>
              </div>
              <form onSubmit={handleSubmit} className="px-7 py-5 space-y-4" style={{fontSize:13.5,color:'#23282A'}}>
                 <div className="grid grid-cols-2 gap-4"><div><label className="block text-[10px] font-bold text-[#5c6567] mb-1 uppercase tracking-[0.08em]">Date</label><input type="date" className="w-full p-2 border border-[#e4ddd1] rounded-lg text-sm bg-[#FEFDFB]" style={{fontFamily:"'Inter',sans-serif",color:'#23282A'}} value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} /></div></div>
                 <div><label className="block text-[10px] font-bold text-[#5c6567] mb-1 uppercase tracking-[0.08em]">Amount ({currency})</label><input type="number" step="0.01" autoFocus required className="w-full p-3 border border-[#e4ddd1] rounded-lg text-xl font-bold outline-none" style={{color:'#23282A',background:'#FEFDFB',fontFamily:"'JetBrains Mono',monospace"}} value={formData.amount} onChange={e => {
                   const val = e.target.value;
                   setFormData({...formData, amount: val});
                 }} placeholder="0.00" /></div>
                 <div><label className="block text-[10px] font-bold text-[#5c6567] mb-1 uppercase tracking-[0.08em]">Category</label><select className="w-full p-2 border border-[#e4ddd1] rounded-lg text-sm" style={{background:'#FEFDFB',color:'#23282A',fontFamily:"'Inter',sans-serif"}} value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>{categories.filter(c => c !== 'All').map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                 <div>
                   <label className="block text-[10px] font-bold text-[#5c6567] mb-1 uppercase tracking-[0.08em]">Payment Account</label>
                   <select 
                     className="w-full p-2 border border-[#e4ddd1] rounded-lg text-sm" 
                     style={{background:'#FEFDFB',color:'#23282A',fontFamily:"'Inter',sans-serif"}}
                     value={formData.accountId} 
                     onChange={e => setFormData({...formData, accountId: e.target.value})}
                   >
                     <option value={ACCOUNT_IDS.CASH_DRAWER}>Cash Drawer (1000)</option>
                     <option value={ACCOUNT_IDS.BANK}>Main Bank Account (1050)</option>
                     <option value={ACCOUNT_IDS.MOBILE_MONEY}>Mobile Money (1060)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#5c6567] mb-1 uppercase tracking-[0.08em]">Status</label>
                    <select className="w-full p-2 border border-[#e4ddd1] rounded-lg text-sm" style={{background:'#FEFDFB',color:'#23282A',fontFamily:"'Inter',sans-serif"}} value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
                      <option value="Paid">Paid</option>
                      <option value="Pending Approval">Pending Approval</option>
                    </select>
                  </div>
                  <div><label className="block text-[10px] font-bold text-[#5c6567] mb-1 uppercase tracking-[0.08em]">Description</label><textarea className="w-full p-2 border border-[#e4ddd1] rounded-lg h-24 resize-none text-sm outline-none" style={{color:'#23282A',background:'#FEFDFB',fontFamily:"'Inter',sans-serif"}} required value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="What was this for?" /></div>
                 <div><label className="block text-[10px] font-bold text-[#5c6567] mb-1 uppercase tracking-[0.08em]">Payment Proof Image</label><input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} accept="image/*" /><div className={`flex items-center gap-2 p-3 border border-dashed border-[#e4ddd1] rounded-lg text-[#5c6567] text-xs cursor-pointer hover:bg-[#eef7f6] transition-colors ${attachedFileId ? 'bg-[#eef7f6] border-[#a6d9d3] text-[#146b60]' : ''}`} onClick={handleAttach}><Paperclip size={16}/><span>{attachedFileId ? 'Proof Attached!' : 'Click to upload payment proof'}</span>{attachedFileId && <CheckCircle size={16} className="text-[#1f8577] ml-auto"/>}</div>{attachedFileId && <div className="mt-2 h-20 rounded-lg overflow-hidden border border-[#e4ddd1] bg-[#eef7f6]"><OfflineImage src={attachedFileId} alt="Preview" className="w-full h-full object-contain" /></div>}</div>
                 <button type="submit" className="w-full py-3 rounded-lg border-none text-white font-semibold flex items-center justify-center gap-2 shadow-[0_6px_16px_-6px_rgba(15,84,76,.55)] transition-all active:scale-[0.98] text-sm cursor-pointer" style={{background:'linear-gradient(155deg,#1f8577,#0f544c)',fontFamily:"'Inter',sans-serif"}}><CheckCircle size={18}/> Record Expense</button>
              </form>
           </div>
        </div>
      )}

      {renderDetailModal()}

      <div className="px-6 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
         <div><h1 className="text-lg font-bold text-slate-900 flex items-center gap-2 tracking-tight"><TrendingUp className="text-red-600" size={20}/> Expense Management</h1><p className="text-slate-500 text-xs mt-0.5">Track and analyze operational spending</p></div>
         <div className="flex gap-2">
            <button 
                onClick={handleAiAudit}
                disabled={isAiLoading}
                className="flex items-center gap-2 px-3 py-1.5 bg-white/70 border border-white/60 rounded-xl text-slate-600 font-bold hover:bg-white hover:border-red-300 text-xs shadow-sm transition-colors backdrop-blur-md disabled:opacity-50"
            >
                {isAiLoading ? <Loader2 className="animate-spin text-red-600" size={14} /> : <Sparkles className="text-red-600" size={14} />}
                {aiAnalysis ? 'Update Audit' : 'AI Strategic Audit'}
            </button>
            <button onClick={handleExport} className="flex items-center gap-2 px-3 py-1.5 bg-white/70 border border-white/60 rounded-xl text-slate-600 font-bold hover:bg-white text-xs shadow-sm transition-colors backdrop-blur-md"><Download size={14}/> Export</button>
            {canEdit && <button onClick={() => setIsAddModalOpen(true)} className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-lg shadow-blue-200 text-xs transition-all"><Plus size={14}/> New Expense</button>}
         </div>
      </div>

      {aiAnalysis && (
        <div className="mx-6 mb-6 bg-gradient-to-r from-red-50 to-orange-50 border border-red-100 rounded-2xl p-4 shadow-sm animate-in fade-in slide-in-from-top-4 duration-500 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                <PaymentIcon size={60} className="text-red-600" />
            </div>
            <div className="flex items-start gap-3 relative">
                <div className="w-8 h-8 rounded-xl bg-white shadow-sm flex items-center justify-center shrink-0 border border-red-100">
                    <Sparkles className="text-red-600" size={16} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="text-[10px] font-black text-red-900 uppercase tracking-widest">AI Expenditure Audit Insight</h3>
                        <button onClick={() => setAiAnalysis(null)} className="text-red-400 hover:text-red-600 transition-colors">
                            <X size={14} />
                        </button>
                    </div>
                    <div className="prose prose-sm prose-red max-w-none text-red-900/80 font-medium text-[12px]">
                        <ReactMarkdown>{aiAnalysis}</ReactMarkdown>
                    </div>
                </div>
            </div>
        </div>
      )}

      <div className="px-6 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 shrink-0">
            {[
                { label: `Total Spend (${dateFilter})`, value: `${currency}${stats.total.toLocaleString()}`, icon: TrendingUp, color: 'blue' },
                { label: 'Avg Transaction', value: `${currency}${stats.avg.toLocaleString(undefined, {maximumFractionDigits: 0})}`, icon: Activity, color: 'purple' },
                { label: 'Highest Category', value: stats.chartData.length > 0 ? stats.chartData[0].name : 'N/A', icon: Zap, color: 'amber' },
                { label: 'Expense Count', value: stats.count, icon: FileText, color: 'rose' }
            ].map((kpi, idx) => (
                <div key={idx} className="bg-white/80 backdrop-blur-md border border-slate-200/60 p-3.5 rounded-2xl shadow-sm hover:shadow-md transition-all group flex items-center gap-3">
                    <div className={`p-2 rounded-xl bg-${kpi.color}-50 text-${kpi.color}-600 group-hover:scale-110 transition-transform`}>
                        <kpi.icon size={18}/>
                    </div>
                    <div className="min-w-0">
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest truncate">{kpi.label}</p>
                        <p className="text-sm font-black text-slate-900 tracking-tight truncate">{kpi.value}</p>
                    </div>
                </div>
            ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col lg:flex-row px-6 pb-6 gap-6 text-[12px]">
         <div className="flex-1 flex flex-col bg-white/70 backdrop-blur-xl rounded-2xl shadow-sm border border-white/60 overflow-hidden min-w-0">
            <div className="p-3 border-b border-slate-200/60 flex flex-wrap gap-3 items-center bg-slate-50/30 shrink-0">
               <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14}/><input type="text" placeholder="Search expenses..." className="w-full pl-9 pr-4 py-1.5 border border-slate-200/80 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white/50" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/></div>
               <select className="p-1.5 border border-slate-200/80 rounded-xl text-xs bg-white/50 font-medium text-slate-600" value={dateFilter} onChange={e => setDateFilter(e.target.value)}><option>This Month</option><option>Last Month</option><option>All Time</option></select>
               <select className="p-1.5 border border-slate-200/80 rounded-xl text-xs bg-white/50 font-medium text-slate-600" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar">
               <table className="w-full text-left">
                  <thead className="bg-slate-50/80 backdrop-blur text-slate-500 font-bold border-b border-slate-200/60 sticky top-0 z-10 shadow-sm text-xs"><tr><th className="px-4 py-3 w-24">Date</th><th className="px-4 py-3">Description</th><th className="px-4 py-3">Category</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Action</th></tr></thead>
                  <tbody className="divide-y divide-slate-100/50">
                     {filteredExpenses.length === 0 && <tr><td colSpan={6} className="p-12 text-center text-slate-400 italic">No expenses found matching criteria.</td></tr>}
                     {filteredExpenses.map(exp => (
                        <tr key={exp.id} className="hover:bg-blue-50/30 cursor-pointer group transition-colors">
                           <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap" onClick={() => setSelectedExpense(exp)}>{new Date(exp.date).toLocaleDateString()}</td>
                           <td className="px-4 py-2.5 font-medium text-slate-800" onClick={() => setSelectedExpense(exp)}>{exp.description}<div className="text-[10px] text-slate-400 font-normal flex gap-1 items-center">{exp.id} • By {exp.recordedBy}{exp.paymentProofUrl && <Paperclip size={10} className="text-blue-500"/>}</div></td>
                           <td className="px-4 py-2.5" onClick={() => setSelectedExpense(exp)}><span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">{exp.category}</span></td>
                           <td className="px-4 py-2.5 text-right font-bold text-slate-900" onClick={() => setSelectedExpense(exp)}>
                             <div>{currency}{exp.amount.toFixed(2)}</div>
                           </td>
                           <td className="px-4 py-2.5 text-center" onClick={() => setSelectedExpense(exp)}>
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border tracking-tight uppercase ${exp.status === 'Paid' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
                                    {exp.status || 'Paid'}
                                </span>
                           </td>
                           <td className="px-4 py-2.5 text-right">
                                <div className="flex justify-end gap-2">
                                    <button 
                                        onClick={() => setSelectedExpense(exp)}
                                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                        title="View Details"
                                    >
                                        <Eye size={14}/>
                                    </button>
                                </div>
                           </td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            </div>
         </div>
         <div className="w-full lg:w-80 bg-slate-50/50 rounded-2xl border border-slate-200/60 flex flex-col overflow-y-auto shadow-inner custom-scrollbar p-4 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm relative shrink-0"><h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2 text-xs uppercase tracking-wider"><PieChart size={14}/> Category Breakdown</h3><div style={{ width: '100%', height: 192, minHeight: 150 }} className="relative"><ResponsiveContainer width="100%" height="100%" minHeight={150} minWidth={0}><RePieChart><Pie data={stats.chartData} cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={5} dataKey="value">{stats.chartData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}</Pie><ReTooltip formatter={(val: number) => `${currency}${val.toLocaleString()}`} /><Legend verticalAlign="bottom" height={36} iconSize={8} wrapperStyle={{fontSize:'10px'}}/></RePieChart></ResponsiveContainer><div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none pb-8"><div className="text-[9px] text-slate-400 font-bold uppercase">Total</div><div className="text-xs font-bold text-slate-800">{currency}{stats.total.toLocaleString()}</div></div></div></div>
            <div className="space-y-3 shrink-0"><h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider flex items-center gap-2"><AlertTriangle size={14} className="text-amber-500"/> Smart Insights</h3>{stats.highestExpense && <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm"><div className="text-[10px] font-bold text-red-600 uppercase mb-1 flex items-center gap-1"><ArrowUpRight size={10}/> High Value</div><p className="text-[12px] text-slate-600 mb-1 leading-tight">Largest single expense: <b>{stats.highestExpense.description}</b>.</p><div className="text-sm font-bold text-slate-900">{currency}{stats.highestExpense.amount.toLocaleString()}</div></div>}<div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm"><div className="text-[10px] font-bold text-blue-600 uppercase mb-1 flex items-center gap-1"><FileText size={10}/> Top Category</div><p className="text-[12px] text-slate-600 leading-tight"><b>{stats.chartData.length > 0 ? stats.chartData[0].name : 'None'}</b> accounts for the majority of costs.</p></div></div>
         </div>
      </div>
    </div>
  );
};

export default Expenses;
