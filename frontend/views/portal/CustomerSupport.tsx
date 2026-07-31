import React, { useEffect, useState } from 'react';
import { MessageCircle, Plus, Send, Loader2 } from 'lucide-react';
import { portalApi } from '../../services/portalApiClient';
import StatusBadge from './components/StatusBadge';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';

interface TicketMessage {
  id?: string;
  message: string;
  created_at?: string;
}

interface Ticket {
  id: string;
  subject: string;
  message: string;
  status: string;
  priority: string;
  created_at: string;
  latest_message?: string;
  messages?: TicketMessage[];
}

const priorityColors: Record<string, string> = {
  low: 'bg-slate-500/20 text-slate-700 border-slate-500/30',
  normal: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  high: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  urgent: 'bg-rose-500/20 text-rose-600 border-rose-500/30',
};

const CustomerSupport: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'tickets' | 'new'>('tickets');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  const [newTicket, setNewTicket] = useState({ subject: '', message: '', priority: 'normal' });
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  const fetchTickets = () => {
    setLoading(true);
    portalApi.get<Ticket[]>('/support/tickets')
      .then(setTickets)
      .catch((err) => setError(err.message || 'Failed to load tickets'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  const handleExpand = async (ticket: Ticket) => {
    if (expandedId === ticket.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(ticket.id);
    if (!ticket.messages) {
      try {
        const detail = await portalApi.get<Ticket>(`/support/tickets/${ticket.id}`);
        setTickets((prev) => prev.map((t) => (t.id === ticket.id ? { ...t, messages: detail.messages || [] } : t)));
      } catch {
        // ignore
      }
    }
  };

  const handleReply = async (ticketId: string) => {
    if (!replyText.trim()) return;
    setSendingReply(true);
    try {
      await portalApi.post(`/support/tickets/${ticketId}/messages`, { message: replyText });
      setReplyText('');
      const detail = await portalApi.get<Ticket>(`/support/tickets/${ticketId}`);
      setTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, messages: detail.messages || [] } : t)));
    } catch {
      // ignore
    } finally {
      setSendingReply(false);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTicket.subject.trim() || !newTicket.message.trim()) return;
    setCreating(true);
    setCreateMsg(null);
    try {
      await portalApi.post('/support/tickets', newTicket);
      setCreateMsg('Ticket created successfully.');
      setNewTicket({ subject: '', message: '', priority: 'normal' });
      fetchTickets();
      setActiveTab('tickets');
    } catch (err: any) {
      setCreateMsg(err.message || 'Failed to create ticket.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Support</h1>
        <p className="text-sm text-slate-500 mt-1">Get help with your account</p>
      </div>

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('tickets')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            activeTab === 'tickets' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'
          }`}
        >
          <MessageCircle size={16} className="inline mr-1.5" />My Tickets
        </button>
        <button
          onClick={() => setActiveTab('new')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            activeTab === 'new' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'
          }`}
        >
          <Plus size={16} className="inline mr-1.5" />New Ticket
        </button>
      </div>

      {activeTab === 'tickets' && (
        <>
          {loading ? (
            <PortalLoadingSkeleton type="list" count={5} />
          ) : error ? (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 text-sm">{error}</div>
          ) : tickets.length === 0 ? (
            <EmptyState icon={<MessageCircle size={28} />} title="No support tickets" description="You haven't created any support tickets yet." action={{ label: 'Create Ticket', onClick: () => setActiveTab('new') }} />
          ) : (
            <div className="space-y-3">
              {tickets.map((ticket) => (
                <div key={ticket.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div
                    onClick={() => handleExpand(ticket)}
                    className="p-4 flex items-start justify-between gap-4 cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900">{ticket.subject}</p>
                      <p className="text-xs text-slate-400 mt-1 line-clamp-2">{ticket.message}</p>
                      <p className="text-[10px] text-slate-600 mt-1">{new Date(ticket.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${priorityColors[ticket.priority?.toLowerCase()] || priorityColors.normal}`}>
                        {ticket.priority}
                      </span>
                      <StatusBadge status={ticket.status} size="sm" />
                    </div>
                  </div>

                  {expandedId === ticket.id && (
                    <div className="border-t border-slate-200 p-4 space-y-3">
                      {(ticket.messages || []).map((msg, i) => (
                        <div key={i} className="bg-slate-100 rounded-lg p-3">
                          <p className="text-xs text-slate-400 mb-1">{msg.created_at ? new Date(msg.created_at).toLocaleString() : ''}</p>
                          <p className="text-sm text-slate-700">{msg.message}</p>
                        </div>
                      ))}
                      <div className="flex gap-2 pt-2">
                        <input
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Type your reply..."
                          className="flex-1 h-10 px-3 bg-slate-100 border border-slate-600/60 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                        />
                        <button
                          onClick={() => handleReply(ticket.id)}
                          disabled={sendingReply || !replyText.trim()}
                          className="px-4 h-10 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg flex items-center gap-1.5 text-sm font-semibold transition-colors"
                        >
                          {sendingReply ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                          Send
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'new' && (
        <form onSubmit={handleCreateTicket} className="bg-white border border-slate-200 rounded-xl p-6">
          {createMsg && (
            <div className={`mb-5 p-3.5 border rounded-xl text-sm ${createMsg.includes('successfully') ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-rose-50 border-rose-200 text-rose-600'}`}>
              {createMsg}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Subject</label>
              <input
                value={newTicket.subject}
                onChange={(e) => setNewTicket((t) => ({ ...t, subject: e.target.value }))}
                placeholder="Brief description of your issue"
                className="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Message</label>
              <textarea
                value={newTicket.message}
                onChange={(e) => setNewTicket((t) => ({ ...t, message: e.target.value }))}
                rows={4}
                placeholder="Describe your issue in detail"
                className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60 resize-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Priority</label>
              <select
                value={newTicket.priority}
                onChange={(e) => setNewTicket((t) => ({ ...t, priority: e.target.value }))}
                className="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={creating || !newTicket.subject.trim() || !newTicket.message.trim()}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {creating ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              {creating ? 'Submitting...' : 'Submit Ticket'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default CustomerSupport;
