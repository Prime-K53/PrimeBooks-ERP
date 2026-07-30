import React, { useEffect, useState } from 'react';
import { FileText, File, Download, FileSpreadsheet } from 'lucide-react';
import { portalApi } from '../../services/portalApiClient';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

interface Document {
  id: string;
  type: string;
  title: string;
  date: string;
  url: string;
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

  useEffect(() => {
    portalApi.get<Document[]>('/documents')
      .then(setDocuments)
      .catch((err) => setError(err.message || 'Failed to load documents'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 max-w-7xl mx-auto"><PortalLoadingSkeleton type="list" count={6} /></div>;
  if (error) return <div className="p-6 max-w-7xl mx-auto"><div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 text-rose-300 text-sm">{error}</div></div>;

  const grouped: Record<string, Document[]> = {};
  documents.forEach((doc) => {
    const type = doc.type || 'Other';
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(doc);
  });

  const typeKeys = Object.keys(grouped);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-100">Documents</h1>
        <p className="text-sm text-slate-400 mt-1">Access your invoices, receipts, statements and more</p>
      </div>

      {documents.length === 0 ? (
        <EmptyState icon={<FileText size={28} />} title="No documents available" description="Your documents will appear here once generated." />
      ) : (
        <div className="space-y-8">
          {typeKeys.map((type) => (
            <div key={type}>
              <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3 capitalize">{type}s</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {grouped[type].map((doc) => (
                  <div key={doc.id} className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 flex items-center gap-3 hover:bg-slate-700/40 transition-colors group">
                    <div className="w-10 h-10 rounded-lg bg-slate-700/60 flex items-center justify-center text-slate-400 shrink-0">
                      {typeIcons[doc.type?.toLowerCase()] || <File size={20} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-200 truncate">{doc.title}</p>
                      <p className="text-xs text-slate-500">{doc.date ? new Date(doc.date).toLocaleDateString() : ''}</p>
                    </div>
                    <a
                      href={doc.url}
                      download
                      className="p-2 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Download size={16} />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CustomerDocuments;
