import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Plus, Send, Loader2, Paperclip, Trash2, Download, Image as ImageIcon, FileText, X } from 'lucide-react';
import { portalApi, uploadTicketAttachment, getTicketAttachments, deleteTicketAttachment, TicketAttachment } from '../../services/portalApiClient';
import PortalPageHeader from './components/PortalPageHeader';
import PortalButton from './components/PortalButton';
import PortalInput from './components/PortalInput';
import ErrorBanner from './components/ErrorBanner';
import EmptyState from './components/EmptyState';
import PortalLoadingSkeleton from './components/PortalLoadingSkeleton';
import StatusBadge from './components/StatusBadge';
import { useToast } from './components/Toast';
import { portalTheme } from './constants';

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
  attachments?: TicketAttachment[];
}

const CustomerSupport: React.FC = () => {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<'tickets' | 'new'>('tickets');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);

  const [newTicket, setNewTicket] = useState({ subject: '', message: '', priority: 'normal' });
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [ticketAttachments, setTicketAttachments] = useState<Record<string, TicketAttachment[]>>({});
  const [uploadingAttachment, setUploadingAttachment] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

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
      } catch (err: any) {
        addToast('error', err.message || 'Failed to load ticket details');
      }
    }
    if (!ticketAttachments[ticket.id]) {
      handleLoadAttachments(ticket.id);
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
      addToast('success', 'Reply sent');
    } catch (err: any) {
      addToast('error', err.message || 'Failed to send reply');
    } finally {
      setSendingReply(false);
    }
  };

  const handleStatusChange = async (ticketId: string, newStatus: string) => {
    setUpdatingStatus(ticketId);
    try {
      await portalApi.put(`/support/tickets/${ticketId}/status`, { status: newStatus });
      setTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, status: newStatus } : t)));
      addToast('success', `Ticket ${newStatus === 'closed' ? 'closed' : 'reopened'}`);
    } catch (err: any) {
      addToast('error', err.message || 'Failed to update ticket status');
    } finally {
      setUpdatingStatus(null);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTicket.subject.trim() || !newTicket.message.trim()) return;
    setCreating(true);
    setCreateMsg(null);
    try {
      await portalApi.post('/support/tickets', newTicket);
      addToast('success', 'Support ticket created successfully');
      setNewTicket({ subject: '', message: '', priority: 'normal' });
      fetchTickets();
      setActiveTab('tickets');
    } catch (err: any) {
      addToast('error', err.message || 'Failed to create ticket');
    } finally {
      setCreating(false);
    }
  };

  const handleUploadAttachment = async (ticketId: string, file: File) => {
    setUploadingAttachment(ticketId);
    setAttachmentError(null);
    try {
      const attachment = await uploadTicketAttachment(ticketId, file);
      setTicketAttachments((prev) => ({
        ...prev,
        [ticketId]: [...(prev[ticketId] || []), attachment],
      }));
      addToast('success', `File "${file.name}" uploaded`);
    } catch (err: any) {
      setAttachmentError(err.message || 'Failed to upload attachment');
      addToast('error', err.message || 'Failed to upload attachment');
    } finally {
      setUploadingAttachment(null);
    }
  };

  const handleDeleteAttachment = async (ticketId: string, attachmentId: string) => {
    try {
      await deleteTicketAttachment(ticketId, attachmentId);
      setTicketAttachments((prev) => ({
        ...prev,
        [ticketId]: (prev[ticketId] || []).filter((a) => a.id !== attachmentId),
      }));
      addToast('success', 'Attachment deleted');
    } catch (err: any) {
      addToast('error', err.message || 'Failed to delete attachment');
    }
  };

  const handleLoadAttachments = async (ticketId: string) => {
    if (ticketAttachments[ticketId]) return;
    try {
      const attachments = await getTicketAttachments(ticketId);
      setTicketAttachments((prev) => ({ ...prev, [ticketId]: attachments }));
    } catch {
      // Silently fail - attachments are optional
    }
  };

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
            <MessageCircle size={19} color="#fff" />
          </div>
          <div>
            <h1 style={{
              fontFamily: "'DM Serif Display', 'Georgia', serif", fontWeight: 400,
              fontSize: 22, margin: 0, color: teal[800], letterSpacing: 0.2
            }}>
              Support
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 11.5, color: inkSoft, letterSpacing: 0.02 }}>
              Get help with your account
            </p>
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 30px 8px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
          <button
            onClick={() => setActiveTab('tickets')}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', fontSize: 12, fontWeight: 600,
              borderRadius: 8, border: 'none', cursor: 'pointer',
              background: activeTab === 'tickets' ? teal[50] : `rgba(217,154,63,.08)`,
              color: activeTab === 'tickets' ? teal[700] : inkSoft,
              transition: 'all .15s ease'
            }}
          >
            <MessageCircle size={14} /> My Tickets
          </button>
          <button
            onClick={() => setActiveTab('new')}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', fontSize: 12, fontWeight: 600,
              borderRadius: 8, border: 'none', cursor: 'pointer',
              background: activeTab === 'new' ? teal[50] : `rgba(217,154,63,.08)`,
              color: activeTab === 'new' ? teal[700] : inkSoft,
              transition: 'all .15s ease'
            }}
          >
            <Plus size={14} /> New Ticket
          </button>
        </div>

        {activeTab === 'tickets' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  fontFamily: "'Inter', sans-serif", fontSize: 12.5, fontWeight: 500,
                  color: ink, background: paper,
                  border: `1.4px solid ${hairline}`, borderRadius: 8,
                  padding: '6px 10px', outline: 'none', cursor: 'pointer',
                  minWidth: 120
                }}
              >
                <option value="all">All Tickets</option>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
            </div>

            {loading ? (
              <PortalLoadingSkeleton type="list" count={5} />
            ) : error ? (
              <ErrorBanner message={error} onDismiss={() => setError(null)} />
            ) : tickets.length === 0 ? (
              <EmptyState icon={<MessageCircle size={28} />} title="No support tickets" description="You haven't created any support tickets yet." action={{ label: 'Create Ticket', onClick: () => setActiveTab('new') }} />
            ) : (
              <div className="space-y-2">
                {tickets.filter((t) => statusFilter === 'all' || t.status === statusFilter).map((ticket) => (
                  <div key={ticket.id} style={{
                    background: paper, borderRadius: 14,
                    border: `1.4px solid ${hairline}`,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(255,255,255,.04)',
                    overflow: 'hidden'
                  }}>
                    <button
                      type="button"
                      onClick={() => handleExpand(ticket)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleExpand(ticket); } }}
                      style={{
                        width: '100%', padding: '14px 20px', cursor: 'pointer',
                        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
                        background: portalTheme.paper, borderRadius: 14,
                        border: `1.4px solid ${portalTheme.hairline}`,
                        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                        transition: 'all .15s ease',
                        textAlign: 'left',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = portalTheme.teal[50]; }}
                      onMouseLeave={e => { e.currentTarget.style.background = portalTheme.paper; }}
                      aria-expanded={expandedId === ticket.id}
                      aria-label={`Ticket: ${ticket.subject}`}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 500, color: ink }}>{ticket.subject}</p>
                        <p style={{ fontSize: 11, color: inkSoft, marginTop: 2, lineHeight: 1.4 }}>{ticket.message}</p>
                        <p style={{ fontSize: 10, color: inkSoft, marginTop: 2 }}>{new Date(ticket.created_at).toLocaleDateString()}</p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <StatusBadge status={ticket.status} size="sm" />
                        {ticket.status !== 'closed' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleStatusChange(ticket.id, 'closed'); }}
                            disabled={updatingStatus === ticket.id}
                            title="Close ticket"
                            style={{
                              padding: '4px 8px', fontSize: 11, fontWeight: 600,
                              color: inkSoft, background: 'transparent',
                              border: `1px solid ${hairline}`, borderRadius: 6,
                              cursor: 'pointer', transition: 'all .15s ease'
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = teal[50]; e.currentTarget.style.color = teal[700]; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = inkSoft; }}
                          >
                            Close
                          </button>
                        )}
                        {ticket.status === 'closed' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleStatusChange(ticket.id, 'open'); }}
                            disabled={updatingStatus === ticket.id}
                            title="Reopen ticket"
                            style={{
                              padding: '4px 8px', fontSize: 11, fontWeight: 600,
                              color: inkSoft, background: 'transparent',
                              border: `1px solid ${hairline}`, borderRadius: 6,
                              cursor: 'pointer', transition: 'all .15s ease'
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = teal[50]; e.currentTarget.style.color = teal[700]; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = inkSoft; }}
                          >
                            Reopen
                          </button>
                        )}
                      </div>
                    </button>

                    {expandedId === ticket.id && (
                      <div style={{ borderTop: `1px solid ${hairline}`, padding: '14px 20px' }}>
                        {(ticket.messages || []).map((msg, i) => (
                          <div key={i} style={{ background: teal[50], borderRadius: 10, padding: '10px 14px', marginBottom: 8 }}>
                            <p style={{ fontSize: 10, color: inkSoft, marginBottom: 2 }}>{msg.created_at ? new Date(msg.created_at).toLocaleString() : ''}</p>
                            <p style={{ fontSize: 13, color: ink }}>{msg.message}</p>
                          </div>
                        ))}
                        {/* Attachment Section */}
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                            <Paperclip size={12} color={inkSoft} />
                            <span style={{ fontSize: 11, fontWeight: 600, color: inkSoft }}>Attachments</span>
                          </div>
                          {/* Upload button */}
                          <label htmlFor={`file-upload-${ticket.id}`} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '5px 10px', fontSize: 11, fontWeight: 500,
                            color: teal[700], background: teal[50],
                            border: `1px solid ${teal[200]}`, borderRadius: 6,
                            cursor: 'pointer', transition: 'all .15s ease'
                          }}>
                            <Paperclip size={11} />
                            {uploadingAttachment === ticket.id ? 'Uploading...' : 'Attach File'}
                          </label>
                          <input
                            id={`file-upload-${ticket.id}`}
                            type="file"
                            accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.zip"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                if (file.size > 10 * 1024 * 1024) {
                                  addToast('error', 'File size must be under 10MB');
                                  return;
                                }
                                handleUploadAttachment(ticket.id, file);
                              }
                              e.target.value = '';
                            }}
                            style={{ display: 'none' }}
                          />
                          {attachmentError && (
                            <p style={{ fontSize: 10, color: '#dc2626', marginTop: 4 }}>{attachmentError}</p>
                          )}
                          {/* Attachment list */}
                          {(ticketAttachments[ticket.id] || []).length > 0 && (
                            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {(ticketAttachments[ticket.id] || []).map((att) => (
                                <div key={att.id} style={{
                                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                  padding: '4px 8px', background: paper, borderRadius: 6,
                                  border: `1px solid ${hairline}`, fontSize: 11
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                    {att.mime_type.startsWith('image/') ? (
                                      <ImageIcon size={12} color={teal[600]} />
                                    ) : (
                                      <FileText size={12} color={inkSoft} />
                                    )}
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={att.original_name}>
                                      {att.original_name}
                                    </span>
                                    <span style={{ color: inkSoft, fontSize: 10 }}>
                                      ({(att.size_bytes / 1024).toFixed(1)} KB)
                                    </span>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <a
                                      href={`/portal/support/tickets/${ticket.id}/attachments/${att.id}`}
                                      download={att.original_name}
                                      style={{ color: teal[600], cursor: 'pointer', textDecoration: 'none' }}
                                      title="Download"
                                    >
                                      <Download size={11} />
                                    </a>
                                    <button
                                      onClick={() => handleDeleteAttachment(ticket.id, att.id)}
                                      title="Delete"
                                      style={{
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        color: '#dc2626', padding: 0, display: 'flex'
                                      }}
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                          <input
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            placeholder="Type your reply..."
                            style={{
                              flex: 1, height: 38, padding: '0 12px',
                              fontFamily: "'Inter', sans-serif", fontSize: 13,
                              color: ink, background: paper,
                              border: `1.4px solid ${hairline}`, borderRadius: 9,
                              outline: 'none'
                            }}
                            onFocus={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.boxShadow = `0 0 0 3px ${teal[50]}`; }}
                            onBlur={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.boxShadow = 'none'; }}
                          />
                          <button
                            onClick={() => handleReply(ticket.id)}
                            disabled={sendingReply || !replyText.trim()}
                            style={{
                              fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
                              padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid transparent',
                              background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
                              color: '#fff', display: 'flex', alignItems: 'center', gap: 7,
                              boxShadow: '0 6px 16px -6px rgba(15,84,76,.55)',
                              opacity: (sendingReply || !replyText.trim()) ? 0.5 : 1
                            }}
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
          <form onSubmit={handleCreateTicket} style={{
            background: paper, borderRadius: 14,
            border: `1.4px solid ${hairline}`,
            boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(255,255,255,.04)',
            padding: '24px 30px'
          }}>
            {createMsg && (
              <div className={`mb-5 p-3.5 border rounded-xl text-sm ${createMsg.includes('successfully') ? 'bg-teal-50 border-teal-200 text-teal-700' : 'bg-rose-50 border-rose-200 text-rose-600'}`}>
                {createMsg}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 12, fontWeight: 600, color: teal[800],
                  marginBottom: 6, letterSpacing: 0.01
                }}>
                  Subject
                </label>
                <input
                  value={newTicket.subject}
                  onChange={(e) => setNewTicket((t) => ({ ...t, subject: e.target.value }))}
                  placeholder="Brief description of your issue"
                  style={{
                    width: '100%', fontFamily: "'Inter', sans-serif", fontSize: 13.5,
                    color: ink, background: paper,
                    border: `1.4px solid ${hairline}`, borderRadius: 9,
                    padding: '9px 12px', outline: 'none',
                    transition: 'border-color .15s ease, box-shadow .15s ease, background .15s ease'
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.boxShadow = `0 0 0 3px ${teal[50]}`; }}
                  onBlur={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.boxShadow = 'none'; }}
                />
              </div>
              <div>
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 12, fontWeight: 600, color: teal[800],
                  marginBottom: 6, letterSpacing: 0.01
                }}>
                  Message
                </label>
                <textarea
                  value={newTicket.message}
                  onChange={(e) => setNewTicket((t) => ({ ...t, message: e.target.value }))}
                  rows={4}
                  placeholder="Describe your issue in detail"
                  style={{
                    width: '100%', fontFamily: "'Inter', sans-serif", fontSize: 13.5,
                    color: ink, background: paper,
                    border: `1.4px solid ${hairline}`, borderRadius: 9,
                    padding: '9px 12px', outline: 'none', lineHeight: 1.5,
                    transition: 'border-color .15s ease, box-shadow .15s ease, background .15s ease'
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.boxShadow = `0 0 0 3px ${teal[50]}`; }}
                  onBlur={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.boxShadow = 'none'; }}
                />
              </div>
              <div>
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 12, fontWeight: 600, color: teal[800],
                  marginBottom: 6, letterSpacing: 0.01
                }}>
                  Priority
                </label>
                <select
                  value={newTicket.priority}
                  onChange={(e) => setNewTicket((t) => ({ ...t, priority: e.target.value }))}
                  style={{
                    width: '100%', fontFamily: "'Inter', sans-serif", fontSize: 13.5,
                    color: ink, background: paper,
                    border: `1.4px solid ${hairline}`, borderRadius: 9,
                    padding: '9px 12px', outline: 'none',
                    transition: 'border-color .15s ease, box-shadow .15s ease, background .15s ease',
                    appearance: 'none',
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%235c6567'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 12px center',
                    paddingRight: 30,
                    cursor: 'pointer'
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = teal[200]; e.currentTarget.style.boxShadow = `0 0 0 3px ${teal[50]}`; }}
                  onBlur={e => { e.currentTarget.style.borderColor = hairline; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                disabled={creating || !newTicket.subject.trim() || !newTicket.message.trim()}
                style={{
                  fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
                  padding: '9px 18px', borderRadius: 9, cursor: 'pointer', border: '1.4px solid transparent',
                  background: `linear-gradient(155deg, ${teal[500]}, ${teal[700]})`,
                  color: '#fff', display: 'flex', alignItems: 'center', gap: 7,
                  boxShadow: '0 6px 16px -6px rgba(15,84,76,.55)',
                  opacity: (creating || !newTicket.subject.trim() || !newTicket.message.trim()) ? 0.5 : 1
                }}
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {creating ? 'Submitting...' : 'Submit Ticket'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default CustomerSupport;
