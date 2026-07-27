import React, { useEffect, useMemo, useState } from 'react';
import { logger } from '@/services/logger';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { currencyService } from '../../services/currencyService';
import { useExamination } from '../../context/ExaminationContext';
import { useData, REFRESH_INTERVAL } from '../../context/DataContext';
import { useModuleRefresh } from '../../hooks/useModuleRefresh';
import { toast } from '../../components/Toast';
import {
  Plus,
  Search,
  DollarSign,
  FileText,
  CheckCircle,
  Clock,
  ExternalLink,
  RefreshCw,
  Download,
  Trash2,
  Droplet,
  MoreVertical,
  Calculator,
  CheckSquare,
  FileOutput,
  Edit3,
  Repeat,
  X
} from 'lucide-react';
import { buildRecurringDraftFromExaminationBatch } from '../../utils/recurringConversion';
import '../inventory/inventory-reference.css';

const ExaminationHub: React.FC = () => {
  const DEFAULT_TONER_PAGES_PER_UNIT = 20000;

  const navigate = useNavigate();
  const { companyConfig } = useAuth();
  const {
    batches,
    schools,
    loading,
    batchLoadError,
    loadAllData,
    deleteBatches,
    calculateBatch,
    approveBatch,
    generateInvoice,
    deleteBatch
  } = useExamination();
  const { refreshAllData } = useData();

  // 5-minute poll + focus refresh
  useModuleRefresh(async () => {
    await Promise.allSettled([
      loadAllData(),
      refreshAllData()
    ]);
  }, { interval: REFRESH_INTERVAL });

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSchool, setSelectedSchool] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Action menu state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  const getSchoolName = (schoolId: string) => {
    return schools.find((school) => String(school.id) === String(schoolId))?.name || 'Unknown School';
  };

  const resolvePositiveNumber = (...values: any[]) => {
    for (const value of values) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return null;
  };

  const isCalculatedBatch = (batch: any) => String(batch?.status || '').toLowerCase() === 'calculated';

  const getBatchClassCount = (batch: any) => {
    const rawCount = Number(
      batch?.class_count
      ?? batch?.classCount
      ?? batch?.classes?.length
      ?? 0
    );
    return Number.isFinite(rawCount) && rawCount >= 0 ? rawCount : 0;
  };

  const getBatchPageCount = (batch: any): number => {
    if (!batch || typeof batch !== 'object') {
      return 0;
    }

    // Priority 1: Use batch-level total_pages from backend (now includes summary mode calculation)
    const explicitTotal = Number(batch?.total_pages ?? batch?.totalPages ?? 0);
    if (Number.isFinite(explicitTotal) && explicitTotal > 0) {
      return Math.round(explicitTotal);
    }

    // Priority 2: Calculate from classes if available (for detail view or if backend didn't have it)
    if (Array.isArray(batch?.classes)) {
      const calculatedFromSubjects = batch.classes.reduce((sum: number, cls: any) => {
        if (!cls || typeof cls !== 'object') {
          return sum;
        }
        
        // First try to use class-level calculated_total_pages if available
        const classCalcPages = Number(cls?.calculated_total_pages ?? 0);
        if (Number.isFinite(classCalcPages) && classCalcPages > 0) {
          return sum + classCalcPages;
        }

        // Otherwise calculate from subjects
        const subjects = Array.isArray(cls?.subjects) ? cls.subjects : [];
        return sum + subjects.reduce((subjectSum: number, subject: any) => {
          if (!subject || typeof subject !== 'object') {
            return subjectSum;
          }
          // Use subject's total_pages if available (calculated during batch calculation)
          const subjectTotalPages = Number(subject?.total_pages ?? 0);
          if (Number.isFinite(subjectTotalPages) && subjectTotalPages > 0) {
            return subjectSum + subjectTotalPages;
          }
          // Fallback: calculate from pages and copies
          const learners = Math.max(0, Math.floor(Number(cls?.number_of_learners) || 0));
          const pages = Math.max(1, Math.floor(Number(subject?.pages) || 0));
          const extraCopies = Math.max(0, Math.floor(Number(subject?.extra_copies) || 0));
          return subjectSum + (pages * (learners + extraCopies));
        }, 0);
      }, 0);
      if (Number.isFinite(calculatedFromSubjects) && calculatedFromSubjects > 0) {
        return Math.round(calculatedFromSubjects);
      }
    }

    return 0;
  };

  const getBatchSheetCount = (batch: any): number => {
    if (!batch || typeof batch !== 'object') {
      return 0;
    }

    // Priority 1: Use batch-level total_sheets if available and > 0
    const explicitTotal = resolvePositiveNumber(batch?.total_sheets, batch?.totalSheets);
    if (explicitTotal !== null) {
      return Math.round(explicitTotal);
    }

    // Priority 2: Calculate from subjects' total_sheets (most accurate)
    if (Array.isArray(batch?.classes)) {
      const calculatedFromSubjects = batch.classes.reduce((sum: number, cls: any) => {
        if (!cls || typeof cls !== 'object') {
          return sum;
        }
        const subjects = Array.isArray(cls?.subjects) ? cls.subjects : [];
        return sum + subjects.reduce((subjectSum: number, subject: any) => {
          if (!subject || typeof subject !== 'object') {
            return subjectSum;
          }
          // Use subject's total_sheets if available (calculated during batch calculation)
          const subjectTotalSheets = resolvePositiveNumber(subject?.total_sheets, subject?.totalSheets);
          if (subjectTotalSheets !== null) {
            return subjectSum + subjectTotalSheets;
          }
          // Fallback: calculate from pages and copies
          const learners = Math.max(0, Math.floor(Number(cls?.number_of_learners) || 0));
          const pages = Math.max(0, Math.floor(Number(subject?.pages ?? subject?.pages_per_paper) || 0));
          const extraCopies = Math.max(0, Math.floor(Number(subject?.extra_copies) || 0));
          const copies = learners + extraCopies;

          if (pages > 0 && copies > 0) {
            return subjectSum + (Math.ceil(pages / 2) * copies);
          }

          const totalPages = resolvePositiveNumber(subject?.total_pages, subject?.totalPages);
          if (totalPages !== null) return subjectSum + Math.ceil(totalPages / 2);
          return subjectSum;
        }, 0);
      }, 0);

      if (Number.isFinite(calculatedFromSubjects) && calculatedFromSubjects > 0) {
        return Math.round(calculatedFromSubjects);
      }
    }

    // Priority 3: Calculate from total pages
    const totalPages = getBatchPageCount(batch);
    return totalPages > 0 ? Math.ceil(totalPages / 2) : 0;
  };

  const getBatchTonerPagesPerUnit = (batch: any) => {
    return resolvePositiveNumber(
      batch?.toner_pages_per_unit,
      batch?.pricing_settings?.constants?.toner_pages_per_unit,
      batch?.pricingSettings?.constants?.toner_pages_per_unit,
      batch?.pricingSettings?.constants?.tonerPagesPerUnit
    ) ?? DEFAULT_TONER_PAGES_PER_UNIT;
  };

  const getBatchTonerNeeded = (batch: any) => {
    const totalPages = getBatchPageCount(batch);
    if (totalPages <= 0) return 0;
    return totalPages / getBatchTonerPagesPerUnit(batch);
  };

  const stats = useMemo(() => {
    const calculatedBatches = batches.filter(isCalculatedBatch);

    return {
      totalBatches: batches.length,
      approvedBatches: batches.filter((batch) => batch.status === 'Approved').length,
      invoicedBatches: batches.filter((batch) => batch.status === 'Invoiced').length,
      totalAmount: batches.reduce((sum, batch) => sum + (batch.total_amount || 0), 0),
      calculatedBatches: calculatedBatches.length,
      totalTonerNeeded: calculatedBatches.reduce((sum, batch) => sum + getBatchTonerNeeded(batch), 0),
      totalPaperNeeded: calculatedBatches.reduce((sum, batch) => sum + getBatchSheetCount(batch), 0)
    };
  }, [batches]);

  const filteredBatches = useMemo(() => {
    return batches
      .filter((batch) => {
        const normalizedSearch = searchTerm.toLowerCase();
        const matchesSearch =
          searchTerm === '' ||
          String(batch.name || '').toLowerCase().includes(normalizedSearch) ||
          String(batch.exam_type || '').toLowerCase().includes(normalizedSearch) ||
          getSchoolName(String(batch.school_id)).toLowerCase().includes(normalizedSearch);

        const matchesSchool = selectedSchool === '' || String(batch.school_id) === String(selectedSchool);
        const matchesStatus = selectedStatus === '' || batch.status === selectedStatus;

        return matchesSearch && matchesSchool && matchesStatus;
      })
      .sort((a, b) => {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [batches, searchTerm, selectedSchool, selectedStatus, schools]);

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'Draft':
        return {
          badgeClass: 'bg-slate-100 text-slate-700 border border-slate-200',
          icon: <Clock size={12} />
        };
      case 'Calculated':
        return {
          badgeClass: 'bg-blue-50 text-blue-700 border border-blue-100',
          icon: <FileText size={12} />
        };
      case 'Approved':
        return {
          badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
          icon: <CheckCircle size={12} />
        };
      case 'Invoiced':
        return {
          badgeClass: 'bg-green-50 text-green-700 border border-green-100',
          icon: <DollarSign size={12} />
        };
      default:
        return {
          badgeClass: 'bg-slate-100 text-slate-700 border border-slate-200',
          icon: <RefreshCw size={12} />
        };
    }
  };

  // Bulk selection handlers
  const toggleBatchSelection = (batchId: string) => {
    const newSelected = new Set(selectedBatchIds);
    if (newSelected.has(batchId)) {
      newSelected.delete(batchId);
    } else {
      newSelected.add(batchId);
    }
    setSelectedBatchIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedBatchIds.size === filteredBatches.length) {
      setSelectedBatchIds(new Set());
    } else {
      setSelectedBatchIds(new Set(filteredBatches.map(b => b.id)));
    }
  };

  const clearSelection = () => {
    setSelectedBatchIds(new Set());
  };

  const handleBatchRowClick = (event: React.MouseEvent<HTMLElement>, batch: any) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, a, [data-row-action="true"]')) {
      return;
    }
    const batchRef = String(batch.batch_number || batch.batchNumber || batch.id || '').trim();
    navigate(`/examination/batches/${batch.id}`, { state: { name: batchRef } });
  };

  const handleBulkDelete = async () => {
    if (selectedBatchIds.size === 0) return;
    
    setIsDeleting(true);
    try {
      const results = await deleteBatches(Array.from(selectedBatchIds));
      
      if (results.success.length > 0) {
        toast.success(`Successfully deleted ${results.success.length} batch(es)`);
      }
      
      if (results.failed.length > 0) {
        toast.error(`Failed to delete ${results.failed.length} batch(es)`);
        logger.error('Failed deletions:', results.failed);
      }

      try {
        await loadAllData();
      } catch (refreshError) {
        console.warn('Failed to refresh batches after bulk delete:', refreshError);
      }
      setSelectedBatchIds(new Set());
      setShowDeleteConfirm(false);
    } catch (error) {
      toast.error('Failed to delete batches');
      logger.error('Bulk delete error:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  // Single batch action handlers
  const handleCalculate = async (batchId: string) => {
    setActionLoading(batchId);
    try {
      await calculateBatch(batchId);
      toast.success('Batch calculated successfully');
      loadAllData();
    } catch (error) {
      toast.error('Failed to calculate batch');
      logger.error('Calculate error:', error);
    } finally {
      setActionLoading(null);
      setOpenMenuId(null);
    }
  };

  const handleApprove = async (batchId: string) => {
    setActionLoading(batchId);
    try {
      const { warnings } = await approveBatch(batchId);
      if (warnings && warnings.length > 0) {
        warnings.forEach(w => toast.warning(w.message));
        toast.warning('Batch approved with inventory warnings.');
      } else {
        toast.success('Batch approved successfully');
      }
      loadAllData();
    } catch (error) {
      toast.error('Failed to approve batch');
      logger.error('Approve error:', error);
    } finally {
      setActionLoading(null);
      setOpenMenuId(null);
    }
  };

  const handleGenerateInvoice = async (batchId: string) => {
    setActionLoading(batchId);
    try {
      const result = await generateInvoice(batchId);
      if (result.success) {
        toast.success('Invoice generated successfully');
        loadAllData();
      } else {
        toast.error('Failed to generate invoice');
      }
    } catch (error) {
      toast.error('Failed to generate invoice');
      logger.error('Invoice generation error:', error);
    } finally {
      setActionLoading(null);
      setOpenMenuId(null);
    }
  };

  const handleConvertToRecurring = (batch: any) => {
    const recurringDraft = buildRecurringDraftFromExaminationBatch(batch, getSchoolName(String(batch.school_id)));
    navigate('/sales-flow/subscriptions', {
      state: {
        action: 'create',
        recurringDraft
      }
    });
    setOpenMenuId(null);
    toast.success('Batch loaded into a recurring invoice draft');
  };

  const handleDeleteSingle = async (batchId: string) => {
    if (!confirm('Are you sure you want to delete this batch? This action cannot be undone.')) {
      setOpenMenuId(null);
      return;
    }
    setActionLoading(batchId);
    try {
      await deleteBatch(batchId);
      toast.success('Batch deleted successfully');
      loadAllData();
    } catch (error) {
      toast.error('Failed to delete batch');
      logger.error('Delete error:', error);
    } finally {
      setActionLoading(null);
      setOpenMenuId(null);
    }
  };

  const exportData = () => {
    const csvContent = [
      ['Batch Name', 'School', 'Classes', 'Status', 'Amount', 'Created'],
      ...filteredBatches.map((batch) => [
        batch.name,
        getSchoolName(String(batch.school_id)),
        getBatchClassCount(batch),
        batch.status,
        `${batch.currency || currencyService.getCurrency(currencyService.getBaseCurrency())?.symbol || companyConfig?.currencySymbol || 'MWK'} ${(batch.total_amount || 0).toLocaleString()}`,
        new Date(batch.created_at).toLocaleDateString()
      ])
    ]
      .map((row) => row.join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `examination-batches-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    toast.success('Data exported successfully');
  };

  return (
    <div className="h-full flex flex-col p-4 md:p-6 max-w-[1600px] mx-auto w-full font-normal overflow-y-auto custom-scrollbar">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 shrink-0">
        <div>
          <h1 className="text-[22px] font-semibold text-slate-900 tracking-tight">Examination Printing</h1>
          <p className="text-xs text-slate-500 mt-0.5">Batch pricing, cost review, and invoice workflow</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={loadAllData}
            disabled={loading}
            className="flex items-center gap-1.5 bg-indigo-50 text-indigo-700 px-4 py-2 rounded-xl font-medium hover:bg-indigo-100 text-sm shadow-sm transition-all border border-indigo-100 disabled:opacity-60"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={exportData}
            className="flex items-center gap-1.5 bg-slate-50 text-slate-700 px-4 py-2 rounded-xl font-medium hover:bg-slate-100 text-sm shadow-sm transition-all border border-slate-200"
          >
            <Download size={16} />
            Export
          </button>
          <button
            onClick={() => navigate('/examination/batches/new')}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-xl font-medium hover:bg-blue-700 text-sm shadow-sm transition-all"
          >
            <Plus size={16} />
            Create Batch
          </button>
        </div>
      </div>

      <div className="kpi-grid-dash mb-6 shrink-0">
        <div className="kpi-card-dash" style={{ borderLeft: '3px solid #2563EB' }}>
          <div className="kpi-card-icon" style={{ color: '#2563EB', background: '#2563EB12' }}>
            <FileText size={18} />
          </div>
          <div className="kpi-card-body">
            <div className="kpi-card-label">Total Batches</div>
            <div className="kpi-card-value">{stats.totalBatches}</div>
            <div className="kpi-card-sub">Active and historical</div>
          </div>
        </div>
        <div className="kpi-card-dash" style={{ borderLeft: '3px solid #10B981' }}>
          <div className="kpi-card-icon" style={{ color: '#10B981', background: '#10B98112' }}>
            <DollarSign size={18} />
          </div>
          <div className="kpi-card-body">
            <div className="kpi-card-label">Total Amount</div>
            <div className="kpi-card-value">
              {currencyService.getCurrency(currencyService.getBaseCurrency())?.symbol || companyConfig?.currencySymbol || 'MWK'}
              {stats.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            <div className="kpi-card-sub">Across all batches</div>
          </div>
        </div>
        <div className="kpi-card-dash" style={{ borderLeft: '3px solid #7C3AED' }}>
          <div className="kpi-card-icon" style={{ color: '#7C3AED', background: '#7C3AED12' }}>
            <Droplet size={18} />
          </div>
          <div className="kpi-card-body">
            <div className="kpi-card-label">Total Toner Needed</div>
            <div className="kpi-card-value">
              {stats.totalTonerNeeded.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="ml-1 text-xs font-semibold text-slate-500">kg</span>
            </div>
            <div className="kpi-card-sub">For calculated batches</div>
          </div>
        </div>
        <div className="kpi-card-dash" style={{ borderLeft: '3px solid #F59E0B' }}>
          <div className="kpi-card-icon" style={{ color: '#F59E0B', background: '#F59E0B12' }}>
            <FileText size={18} />
          </div>
          <div className="kpi-card-body">
            <div className="kpi-card-label">Total Papers Needed</div>
            <div className="kpi-card-value">
              {stats.totalPaperNeeded.toLocaleString()}
              <span className="ml-1 text-xs font-semibold text-slate-500">sheets</span>
            </div>
            <div className="kpi-card-sub">Across {stats.calculatedBatches} calculated batch(es)</div>
          </div>
        </div>
        <div className="kpi-card-dash" style={{ borderLeft: '3px solid #16A34A' }}>
          <div className="kpi-card-icon" style={{ color: '#16A34A', background: '#16A34A12' }}>
            <CheckCircle size={18} />
          </div>
          <div className="kpi-card-body">
            <div className="kpi-card-label">Ready / Invoiced</div>
            <div className="kpi-card-value">{stats.approvedBatches} / {stats.invoicedBatches}</div>
            <div className="kpi-card-sub">Approval lifecycle</div>
          </div>
        </div>
      </div>

      <div className="bg-white/70 backdrop-blur-xl p-4 md:p-5 rounded-2xl border border-white/60 shadow-sm mb-4 shrink-0">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search batches, exam type, or school"
              className="w-full rounded-xl border border-slate-200 bg-white px-9 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
            />
          </div>
          <select
            value={selectedSchool}
            onChange={(event) => setSelectedSchool(event.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 min-w-[220px]"
          >
            <option value="">All Schools</option>
            {schools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.name}
              </option>
            ))}
          </select>
          <select
            value={selectedStatus}
            onChange={(event) => setSelectedStatus(event.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 min-w-[180px]"
          >
            <option value="">All Statuses</option>
            <option value="Draft">Draft</option>
            <option value="Calculated">Calculated</option>
            <option value="Approved">Approved</option>
            <option value="Invoiced">Invoiced</option>
          </select>
        </div>
      </div>

      {/* Bulk Action Bar */}
      {selectedBatchIds.size > 0 && (
        <div className="flex items-center justify-between bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 mb-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-rose-800">
              {selectedBatchIds.size} batch{selectedBatchIds.size !== 1 ? 'es' : ''} selected
            </span>
            <button
              onClick={clearSelection}
              className="text-xs text-rose-600 hover:text-rose-800 underline"
            >
              Clear selection
            </button>
          </div>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            disabled={isDeleting}
            className="inline-flex items-center gap-1.5 bg-rose-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-rose-700 transition-colors disabled:opacity-60"
          >
            <Trash2 size={14} />
            {isDeleting ? 'Deleting...' : 'Delete Selected'}
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0">
        {batchLoadError ? (
          <div className="bg-rose-50 rounded-2xl border border-rose-200 shadow-sm p-10 text-center">
            <RefreshCw className="h-10 w-10 mx-auto mb-3 text-rose-400" />
            <p className="text-base font-semibold text-rose-800">Unable to load batches</p>
            <p className="text-sm text-rose-700 mt-1">{batchLoadError}</p>
            <button
              onClick={loadAllData}
              disabled={loading}
              className="mt-4 inline-flex items-center gap-1.5 bg-rose-100 text-rose-700 px-4 py-2 rounded-xl font-medium hover:bg-rose-200 text-sm shadow-sm transition-all border border-rose-200 disabled:opacity-60"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Retry
            </button>
          </div>
        ) : filteredBatches.length === 0 ? (
          <div className="bg-white/70 backdrop-blur-xl rounded-2xl border border-white/60 shadow-sm p-10 text-center">
            <FileText className="h-10 w-10 mx-auto mb-3 text-slate-300" />
            <p className="text-base font-semibold text-slate-800">No batches found</p>
            <p className="text-sm text-slate-500 mt-1">Adjust filters or create a new examination batch.</p>
          </div>
        ) : (
          <div className="bg-white/90 rounded-2xl overflow-hidden border border-slate-200/80 shadow-sm">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-[13px]">
<thead className="bg-slate-50/80 backdrop-blur text-slate-500 sticky top-0 z-10 shadow-sm">
                  <tr>
                      <th className="table-header w-10 px-1 text-center">
                        <input
                          type="checkbox"
                          checked={selectedBatchIds.size === filteredBatches.length && filteredBatches.length > 0}
                          onChange={toggleSelectAll}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                      </th>
                      <th className="table-header flex-1 min-w-[100px]">Batch</th>
                      <th className="table-header flex-1 min-w-[140px]">School</th>
                      <th className="table-header flex-1 min-w-[90px]">Exam Type</th>
                      <th className="table-header flex-1 min-w-[100px]">Academic</th>
                      <th className="table-header flex-1 min-w-[70px] text-right">Classes</th>
                      <th className="table-header flex-1 min-w-[100px] text-right">Amount</th>
                      <th className="table-header flex-1 min-w-[80px]">Status</th>
                      <th className="table-header w-10 text-right">Action</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100/50">
                  {filteredBatches.map((batch) => {
                    const statusConfig = getStatusConfig(batch.status);
                    const schoolName = getSchoolName(String(batch.school_id));
                    const batchReference = String(batch.batch_number || batch.batchNumber || batch.id || '').trim();
                    return (
                      <tr
                        key={batch.id}
                        className="hover:bg-blue-50/50 transition-colors cursor-pointer"
                        onClick={(event) => handleBatchRowClick(event, batch)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setOpenMenuId(batch.id);
                        }}
                      >
<td className="table-body-cell w-10 px-1">
                          <input
                            type="checkbox"
                            checked={selectedBatchIds.has(batch.id)}
                            onChange={() => toggleBatchSelection(batch.id)}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                        </td>
                        <td className="table-body-cell flex-1 min-w-[100px]">
                          <div className="font-semibold text-slate-900 font-mono">{batchReference || batch.id}</div>
                        </td>
                        <td className="table-body-cell flex-1 min-w-[140px] text-slate-600">
                          {schoolName}
                          {batch.sub_account_name && <span className="text-slate-400 ml-1">({batch.sub_account_name})</span>}
                        </td>
                        <td className="table-body-cell flex-1 min-w-[90px] text-slate-700">{batch.exam_type}</td>
                        <td className="table-body-cell flex-1 min-w-[100px] text-slate-600">{batch.academic_year} Term {batch.term}</td>
                        <td className="table-body-cell flex-1 min-w-[70px] text-right finance-nums text-slate-700">{getBatchClassCount(batch)}</td>
                        <td className="table-body-cell flex-1 min-w-[100px] text-right font-semibold finance-nums text-slate-900">
                          {batch.currency || currencyService.getCurrency(currencyService.getBaseCurrency())?.symbol || companyConfig?.currencySymbol || 'MWK'}
                          {(batch.total_amount || 0).toLocaleString(undefined, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 2
                          })}
                        </td>
                        <td className="table-body-cell flex-1 min-w-[80px]">
                          <span className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold ${statusConfig.badgeClass}`}>
                            {statusConfig.icon}
                            {batch.status}
                          </span>
                        </td>
                        <td className="table-body-cell w-10 text-right">
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => setOpenMenuId(openMenuId === batch.id ? null : batch.id)}
                              disabled={actionLoading === batch.id}
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors disabled:opacity-50"
                            >
                              {actionLoading === batch.id ? (
                                <RefreshCw size={16} className="animate-spin" />
                              ) : (
                                <MoreVertical size={16} />
                              )}
                            </button>
                            
                            {openMenuId === batch.id && (
                              <div className="absolute right-0 mt-1 w-48 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50">
                                {/* View/Edit - Available for all statuses */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    const batchRef = String(batch.batch_number || batch.batchNumber || batch.id || '').trim();
                                    navigate(`/examination/batches/${batch.id}`, { state: { name: batchRef } });
                                  }}
                                  className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                >
                                  <Edit3 size={14} className="text-slate-500" />
                                  {batch.status === 'Draft' || batch.status === 'Calculated' ? 'Edit' : 'View Details'}
                                </button>
                                
                                {/* Calculate - Only for Draft */}
                                {batch.status === 'Draft' && (
                                  <button
                                    type="button"
                                    onClick={() => handleCalculate(batch.id)}
                                    disabled={actionLoading === batch.id}
                                    className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                  >
                                    <Calculator size={14} className="text-blue-500" />
                                    Calculate
                                  </button>
                                )}
                                
                                {/* Approve - Only for Calculated */}
                                {batch.status === 'Calculated' && (
                                  <button
                                    type="button"
                                    onClick={() => handleApprove(batch.id)}
                                    disabled={actionLoading === batch.id}
                                    className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                  >
                                    <CheckSquare size={14} className="text-emerald-500" />
                                    Approve
                                  </button>
                                )}
                                
                                {/* Generate Invoice - Only for Approved */}
                                {batch.status === 'Approved' && (
                                  <button
                                    type="button"
                                    onClick={() => handleGenerateInvoice(batch.id)}
                                    disabled={actionLoading === batch.id}
                                    className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                  >
                                    <FileOutput size={14} className="text-violet-500" />
                                    Generate Invoice
                                  </button>
                                )}
                                
                                {/* View Invoice - Only for Invoiced */}
                                {batch.status === 'Invoiced' && batch.invoice_id && (
                                  <button
                                    type="button"
                                    onClick={() => navigate(`/sales/invoice/${batch.invoice_id}`)}
                                    className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                  >
                                    <FileText size={14} className="text-green-500" />
                                    View Invoice
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => handleConvertToRecurring(batch)}
                                  className="w-full px-4 py-2 text-left text-sm text-indigo-700 hover:bg-indigo-50 flex items-center gap-2"
                                >
                                  <Repeat size={14} className="text-indigo-500" />
                                  Convert to Recurring
                                </button>
                                
                                <div className="border-t border-slate-100 my-1" />
                                
                                {/* Delete - Only for Draft and Calculated */}
                                {(batch.status === 'Draft' || batch.status === 'Calculated') && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteSingle(batch.id)}
                                    disabled={actionLoading === batch.id}
                                    className="w-full px-4 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 flex items-center gap-2"
                                  >
                                    <Trash2 size={14} className="text-rose-500" />
                                    Delete
                                  </button>
                                )}
                                
                                {/* Close menu */}
                                <button
                                  type="button"
                                  onClick={() => setOpenMenuId(null)}
                                  className="w-full px-4 py-2 text-left text-sm text-slate-500 hover:bg-slate-50 flex items-center gap-2"
                                >
                                  <X size={14} className="text-slate-400" />
                                  Close
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(15, 23, 42, 0.6)',
          padding: '40px 20px', fontFamily: "'Inter','DM Sans',sans-serif", fontSize: 13.5,
        }} onClick={() => { if (!isDeleting) setShowDeleteConfirm(false); }}>
          <div style={{
            width: 480, maxWidth: '100%',
            background: '#FEFDFB', borderRadius: 14, padding: 28,
            boxShadow: '0 30px 70px -20px rgba(0,0,0,.55), 0 8px 24px -8px rgba(0,0,0,.35)',
            position: 'relative'
          }} onClick={(e) => e.stopPropagation()}>
            {/* accent stripe */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 4,
              borderRadius: '14px 14px 0 0',
              background: 'linear-gradient(90deg, #146b60, #3fa294 40%, #d99a3f 100%)'
            }} />
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginTop: 8 }}>
              <div style={{
                flexShrink: 0, width: 44, height: 44, borderRadius: 10,
                background: 'rgba(213,43,30,.12)', color: '#b5493f',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <Trash2 size={22} />
              </div>
              <div style={{ flex: 1 }}>
                <h2 style={{
                  fontFamily: "'DM Serif Display', 'Georgia', serif", fontWeight: 400,
                  fontSize: 20, margin: 0, color: '#0b3e39', letterSpacing: 0.2
                }}>
                  Delete Batches
                </h2>
                <p style={{ fontSize: 13, color: '#5c6567', marginTop: 8, lineHeight: 1.5 }}>
                  Are you sure you want to delete <strong>{selectedBatchIds.size} batch{selectedBatchIds.size !== 1 ? 'es' : ''}</strong>?
                  This action cannot be undone.
                </p>
                <div style={{
                  marginTop: 12, padding: 12, borderRadius: 9,
                  background: '#fbead080', border: '1px solid #eec27a',
                  fontSize: 12, color: '#92400e'
                }}>
                  <strong>Note:</strong> Only Draft or Calculated batches can be deleted. 
                  Approved and Invoiced batches will remain.
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
              <button onClick={() => setShowDeleteConfirm(false)} disabled={isDeleting}
                style={{
                  fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
                  padding: '9px 18px', borderRadius: 9, cursor: 'pointer',
                  background: '#FEFDFB', border: '1.4px solid #e4ddd1', color: '#5c6567',
                  transition: 'all .15s ease'
                }}>
                Cancel
              </button>
              <button onClick={handleBulkDelete} disabled={isDeleting}
                style={{
                  fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
                  padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid transparent',
                  background: '#b5493f', color: '#fff', display: 'flex', alignItems: 'center', gap: 7,
                  opacity: isDeleting ? 0.6 : 1, transition: 'all .15s ease'
                }}>
                <RefreshCw size={14} className={isDeleting ? 'animate-spin' : ''} />
                {isDeleting ? 'Deleting...' : `Delete ${selectedBatchIds.size} Batch${selectedBatchIds.size !== 1 ? 'es' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExaminationHub;
