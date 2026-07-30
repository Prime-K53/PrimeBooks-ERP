import React from 'react';
import { FileText } from 'lucide-react';
import EmptyState from './components/EmptyState';

const CustomerQuotations: React.FC = () => {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-100">Quotations</h1>
        <p className="text-sm text-slate-400 mt-1">Manage your quotation requests</p>
      </div>
      <EmptyState
        icon={<FileText size={28} />}
        title="Quotations coming soon"
        description="This feature will be available in a future update. You'll be able to request and manage quotations here."
      />
    </div>
  );
};

export default CustomerQuotations;
