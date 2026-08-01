import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, File, Download, FileSpreadsheet, ArrowUpRight } from 'lucide-react';
import { portalApi } from '../../services/portalApiClient';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

const teal = {
  50: '#eef7f6', 100: '#d3ece9', 200: '#a6d9d3', 300: '#72c0b7',
  400: '#3fa294', 500: '#1f8577', 600: '#146b60', 700: '#0f544c',
  800: '#0b3e39', 900: '#082e2a'
};
const amber = { 100: '#fbead0', 300: '#eec27a', 500: '#d99a3f', 600: '#b97e2b' };
const paper = '#FEFDFB';
const ink = '#23282A';
const inkSoft = '#5c6567';
const hairline = '#e4ddd1';

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

  useEffect(() => {
    portalApi.get<Document[]>('/documents')
      .then(setDocuments)
      .catch((err) => setError(err.message || 'Failed to load documents'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 max-w-4xl mx-auto"><PortalLoadingSkeleton type="table" count={6} /></div>;
  if (error) return <div className="p-8 max-w-4xl mx-auto"><div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 text-sm">{error}</div></div>;

  const grouped: Record<string, Document[]> = {};
  documents.forEach((doc) => {
    const type = doc.type || 'Other';
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(doc);
  });

  const typeKeys = Object.keys(grouped);

  return (
    <div style={{
      background: paper,
      borderRadius: 14,
      overflow: 'hidden'
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '22px 28px 18px',
        borderBottom: `1px solid ${hairline}`,
        background: paper
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 10px -3px rgba(15,84,76,.6)', flexShrink: 0
          }}>
            <FileText size={19} color="#fff" />
          </div>
          <div>
            <h1 style={{
              fontFamily: "'DM Serif Display', 'Georgia', serif", fontWeight: 400,
              fontSize: 22, margin: 0, color: teal[800], letterSpacing: 0.2
            }}>
              Documents
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 11.5, color: inkSoft, letterSpacing: 0.02 }}>
              Access your invoices, receipts, statements and more
            </p>
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 30px 8px' }}>
        {documents.length === 0 ? (
          <EmptyState icon={FileText} title="No documents available" description="Your documents will appear here once generated." />
        ) : (
          <div className="space-y-8">
            {typeKeys.map((type) => (
              <div key={type}>
                <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 capitalize" style={{ color: inkSoft }}>{type}s</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {grouped[type].map((doc) => (
                    <div key={doc.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '14px 16px', textAlign: 'left',
                      background: paper, borderRadius: 14,
                      border: `1.4px solid ${hairline}`,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(255,255,255,.04)',
                      cursor: 'pointer', transition: 'all .15s ease'
                    }}
                      onMouseEnter={e => { e.currentTarget.style.background = teal[50]; e.currentTarget.style.borderColor = teal[200]; }}
                      onMouseLeave={e => { e.currentTarget.style.background = paper; e.currentTarget.style.borderColor = hairline; }}
                    >
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: teal[50], color: teal[600] }}>
                        {typeIcons[doc.type?.toLowerCase()] || <File size={20} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: ink }}>{doc.title}</p>
                        <p className="text-xs mt-1" style={{ color: inkSoft }}>
                          {doc.date ? new Date(doc.date).toLocaleDateString() : ''}
                          {doc.amount !== undefined ? ` • K ${Number(doc.amount).toFixed(2)}` : ''}
                        </p>
                      </div>
                      {doc.url?.startsWith('#/') ? (
                        <Link
                          to={doc.url.slice(2)}
                          className="p-2 rounded-lg shrink-0 transition-colors"
                          style={{ color: inkSoft }}
                          onMouseEnter={e => { e.currentTarget.style.color = teal[700]; e.currentTarget.style.background = teal[50]; }}
                          onMouseLeave={e => { e.currentTarget.style.color = inkSoft; e.currentTarget.style.background = 'transparent'; }}
                          title="Open document"
                        >
                          <ArrowUpRight size={16} />
                        </Link>
                      ) : (
                        <a
                          href={doc.url}
                          download
                          className="p-2 rounded-lg shrink-0 transition-colors"
                          style={{ color: inkSoft }}
                          onMouseEnter={e => { e.currentTarget.style.color = teal[700]; e.currentTarget.style.background = teal[50]; }}
                          onMouseLeave={e => { e.currentTarget.style.color = inkSoft; e.currentTarget.style.background = 'transparent'; }}
                          title="Download"
                        >
                          <Download size={16} />
                        </a>
                      )}
                    </div>
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
