import React from 'react';

interface Column<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
  width?: string;
  align?: 'left' | 'right' | 'center';
  sticky?: boolean;
}

interface PortalTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  onRowClick?: (item: T) => void;
  expandable?: boolean;
  renderExpanded?: (item: T) => React.ReactNode;
  loading?: boolean;
  emptyMessage?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  onSearch?: (query: string) => void;
}

function PortalTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  expandable,
  renderExpanded,
  loading,
  emptyMessage = 'No records found',
  searchable,
  searchPlaceholder = 'Search...',
  onSearch,
}: PortalTableProps<T>) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [expandedRows, setExpandedRows] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    onSearch?.(searchQuery);
  }, [searchQuery]);

  const toggleRow = (key: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="glass-panel rounded-[var(--radius-md)] overflow-hidden">
      {searchable && (
        <div className="px-4 py-3 border-b border-slate-200/60">
          <div className="relative">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-brand-200 focus:ring-2 focus:ring-brand-500/10 transition-all"
            />
            <svg className="absolute left-3 top-2.5 text-slate-400" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-200/60">
              {expandable && <th className="w-10 px-4 py-3" />}
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''} ${col.sticky ? 'sticky left-0 bg-white/95 backdrop-blur z-10' : ''}`}
                  style={{ width: col.width }}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100/80">
            {loading ? (
              <tr><td colSpan={columns.length + (expandable ? 1 : 0)} className="px-4 py-12 text-center text-sm text-slate-400">Loading...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={columns.length + (expandable ? 1 : 0)} className="px-4 py-12 text-center text-sm text-slate-400">{emptyMessage}</td></tr>
            ) : (
              data.map((item) => {
                const key = keyExtractor(item);
                const isExpanded = expandedRows.has(key);
                return (
                  <React.Fragment key={key}>
                    <tr
                      className={`group transition-colors ${onRowClick ? 'cursor-pointer hover:bg-slate-50/60' : ''}`}
                      onClick={() => onRowClick?.(item)}
                    >
                      {expandable && (
                        <td className="px-4 py-3">
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleRow(key); }}
                            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
                            aria-label={isExpanded ? 'Collapse' : 'Expand'}
                          >
                            <svg
                              className="transition-transform duration-200"
                              style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                              width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                            >
                              <path d="m9 18 6-6-6-6" />
                            </svg>
                          </button>
                        </td>
                      )}
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={`px-4 py-3 text-sm text-slate-700 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''} ${col.sticky ? 'sticky left-0 bg-white/95 backdrop-blur z-10' : ''}`}
                        >
                          {col.render ? col.render(item) : (item as any)[col.key]}
                        </td>
                      ))}
                    </tr>
                    {expandable && isExpanded && renderExpanded && (
                      <tr>
                        <td colSpan={columns.length + 1} className="px-4 py-0 bg-slate-50/40">
                          <div className="py-4">{renderExpanded(item)}</div>
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
    </div>
  );
}

export default PortalTable;
