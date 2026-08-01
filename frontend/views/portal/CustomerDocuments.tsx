import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, File, Download, FileSpreadsheet, ArrowUpRight, Search } from 'lucide-react';
import { portalLifecycle } from '../../services/portalApiClient';
import PortalPageHeader from './components/PortalPageHeader';
import PortalInput from './components/PortalInput';
import PortalCard from './components/PortalCard';
import ErrorBanner from './components/ErrorBanner';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import { portalTheme } from './constants';

interface Document {
  id: string;
  type: string;
  title: string;
  date: string;
  url: string;
  amount?: number;
}

const typeIcons: Record<string, React.ReactNode> = {
  invoice: <FileText size={20} />,
  receipt: <FileText size={20} />,
  statement: <FileSpreadsheet size={20} />,
  report: <File size={20} />,
};

const CustomerDocuments: React.FC = () => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    portalLifecycle.documents.list()
      .then(setDocuments)
      .catch((err) => setError(err.message || 'Failed to load documents'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sub = await portalLifecycle.subscribe({
        onEvent: (type, payload) => {
          if (type === 'entity_changed' && !cancelled) {
            portalLifecycle.documents.list()
              .then(setDocuments)
              .catch(() => {});
          }
        },
      });
      if (!cancelled) return sub;
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = documents.filter((doc) =>
    doc.title?.toLowerCase().includes(search.toLowerCase()) ||
    doc.type?.toLowerCase().includes(search.toLowerCase())
  );

  const grouped: Record<string, Document[]> = {};
  filtered.forEach((doc) => {
    const type = doc.type || 'Other';
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(doc);
  });
  const typeKeys = Object.keys(grouped);

  if (loading) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={6} /></div>;

  return (
    <div style={{ background: portalTheme.paper, borderRadius: 14, overflow: 'hidden' }}>
      <PortalPageHeader title="Documents" subtitle="Access your invoices, receipts, statements and more" icon={FileText} />

      <div style={{ padding: '20px 28px 8px' }}>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <div style={{ position: 'relative', maxWidth: 360 }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: portalTheme.inkSoft }} />
          <PortalInput label="" placeholder="Search documents..." value={search} onChange={(v) => setSearch(v)} onFocus={() => {}} onBlur={() => {}} style={{ paddingLeft: 32 }} />
        </div>
      </div>

      <div style={{ padding: '16px 28px 28px' }}>
        {filtered.length === 0 ? (
          <EmptyState icon={<FileText size={28} />} title="No documents available" description={search ? 'No documents match your search.' : 'Your documents will appear here once generated.'} />
        ) : (
          <div className="space-y-8">
            {typeKeys.map((type) => (
              <div key={type}>
                <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 capitalize" style={{ color: portalTheme.inkSoft }}>{type}s</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {grouped[type].map((doc) => (
                    <PortalCard key={doc.id} hoverable className="flex items-center gap-3 p-4">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: portalTheme.teal[50], color: portalTheme.teal[600] }}>
                        {typeIcons[doc.type?.toLowerCase()] || <File size={20} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: portalTheme.ink }}>{doc.title}</p>
                        <p className="text-xs mt-1" style={{ color: portalTheme.inkSoft }}>
                          {doc.date ? new Date(doc.date).toLocaleDateString() : ''}
                          {doc.amount !== undefined ? ` • K ${Number(doc.amount).toFixed(2)}` : ''}
                        </p>
                      </div>
                      {doc.url?.startsWith('#/') ? (
                        <Link
                          to={doc.url.slice(2)}
                          className="p-2 rounded-lg shrink-0 transition-colors hover:text-[#146b60] hover:bg-[#eef7f6]"
                          style={{ color: portalTheme.inkSoft }}
                          title="Open document"
                        >
                          <ArrowUpRight size={16} />
                        </Link>
                      ) : (
                        <a
                          href={doc.url}
                          download
                          className="p-2 rounded-lg shrink-0 transition-colors hover:text-[#146b60] hover:bg-[#eef7f6]"
                          style={{ color: portalTheme.inkSoft }}
                          title="Download"
                        >
                          <Download size={16} />
                        </a>
                      )}
                    </PortalCard>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomerDocuments;
