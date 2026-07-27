const BASE_URL = import.meta.env.VITE_API_URL || 'https://primebooks-erp.onrender.com';

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const raw = sessionStorage.getItem('nexus_user');
    if (raw) {
      const user = JSON.parse(raw);
      if (user?.id) headers['x-user-id'] = user.id;
      if (user?.role) headers['x-user-role'] = user.role;
      if (user?.email) headers['x-user-email'] = user.email;
    }
  } catch {}
  try {
    const companyConfig = localStorage.getItem('nexus_company_config');
    if (companyConfig) {
      const parsed = JSON.parse(companyConfig);
      if (parsed?.companyId) headers['x-company-id'] = parsed.companyId;
    }
  } catch {}
  return headers;
}

function snakeToCamel(str: string): string {
  if (str === 'created_at') return 'date';
  if (str === 'updated_at') return 'updatedAt';
  if (str === 'converted_at') return 'convertedAt';
  if (str === 'approved_at') return 'approvedAt';
  if (str === 'cancelled_at') return 'cancelledAt';
  if (str === 'requested_at') return 'requestedAt';
  if (str === 'rejected_at') return 'rejectedAt';
  if (str === 'completed_at') return 'completedAt';
  if (str === 'generated_at') return 'generatedAt';
  if (str === 'start_date') return 'startDate';
  if (str === 'end_date') return 'endDate';
  if (str === 'reward_type') return 'rewardType';
  if (str === 'reward_value') return 'rewardValue';
  if (str === 'customer_id') return 'customerId';
  if (str === 'referred_by_id') return 'referredById';
  if (str === 'referred_by_name') return 'referredByName';
  if (str === 'referral_code') return 'referralCode';
  if (str === 'pending_invoice_id') return 'pendingInvoiceId';
  if (str === 'pending_invoice_amount') return 'pendingInvoiceAmount';
  if (str === 'converted_invoice_id') return 'convertedInvoiceId';
  if (str === 'company_id') return 'companyId';
  if (str === 'invoice_id') return 'invoiceId';
  if (str === 'invoice_amount') return 'invoiceAmount';
  if (str === 'wallet_transaction_id') return 'walletTransactionId';
  if (str === 'referral_id') return 'referralId';
  if (str === 'entity_type') return 'entityType';
  if (str === 'entity_id') return 'entityId';
  if (str === 'actor_id') return 'actorId';
  if (str === 'actor_name') return 'actorName';
  if (str === 'event_type') return 'eventType';
  if (str === 'metadata_json') return 'metadataJson';
  if (str === 'field_name') return 'fieldName';
  if (str === 'old_value') return 'oldValue';
  if (str === 'new_value') return 'newValue';
  if (str === 'correlation_id') return 'correlationId';
  if (str === 'ip_address') return 'ipAddress';
  if (str === 'user_agent') return 'userAgent';
  if (str === 'cancel_reason') return 'cancelReason';
  if (str === 'bonus_multiplier') return 'bonusMultiplier';
  if (str === 'target_segments_json') return 'targetSegmentsJson';
  if (str === 'excluded_customers_json') return 'excludedCustomersJson';
  if (str === 'terms_json') return 'termsJson';
  if (str === 'min_purchase_amount') return 'minPurchaseAmount';
  if (str === 'max_reward_amount') return 'maxRewardAmount';
  if (str === 'max_rewards_per_customer') return 'maxRewardsPerCustomer';
  if (str === 'max_total_rewards') return 'maxTotalRewards';
  if (str === 'total_rewards_given') return 'totalRewardsGiven';
  if (str === 'reward_percentage') return 'rewardPercentage';
  if (str === 'total_referrals') return 'totalReferrals';
  if (str === 'active_referrals') return 'activeReferrals';
  if (str === 'converted_referrals') return 'convertedReferrals';
  if (str === 'total_rewards_amount') return 'totalRewardsAmount';
  if (str === 'approved_rewards_amount') return 'approvedRewardsAmount';
  if (str === 'paid_rewards_amount') return 'paidRewardsAmount';
  if (str === 'pending_rewards_amount') return 'pendingRewardsAmount';
  if (str === 'average_reward_amount') return 'averageRewardAmount';
  if (str === 'conversion_rate') return 'conversionRate';
  if (str === 'revenue_attributed') return 'revenueAttributed';
  if (str === 'reward_id') return 'rewardId';
  if (str === 'requested_by') return 'requestedBy';
  if (str === 'approved_by') return 'approvedBy';
  if (str === 'rejected_by') return 'rejectedBy';
  if (str === 'reject_reason') return 'rejectReason';
  if (str === 'period_start') return 'periodStart';
  if (str === 'period_end') return 'periodEnd';
  if (str === 'settings_json') return 'settingsJson';
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function transformKeys<T>(obj: any): T {
  if (obj === null || obj === undefined) return obj as T;
  if (Array.isArray(obj)) return obj.map(transformKeys) as T;
  if (typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      const camelKey = snakeToCamel(key);
      result[camelKey] = transformKeys(obj[key]);
    }
    return result as T;
  }
  return obj as T;
}

async function request<T>(method: string, endpoint: string, body?: any, params?: Record<string, any>): Promise<T> {
  const url = new URL(`${BASE_URL}/api/referrals${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const res = await fetch(url.toString(), {
    method,
    headers: getHeaders(),
    body: body ? JSON.stringify(body) : undefined,
    signal: controller.signal,
  });
  clearTimeout(timeout);
  if (!res.ok) {
    let errMsg = `API error: ${res.status}`;
    try {
      const err = await res.json();
      errMsg = err.error || err.message || errMsg;
    } catch {}
    throw new Error(errMsg);
  }
  return transformKeys<T>(await res.json());
}

export const referralApiClient = {
  getAll(params?: { page?: number; limit?: number; status?: string; search?: string; sort_by?: string; sort_dir?: string }): Promise<{ referrals: any[]; total: number; page: number; limit: number; totalPages: number }> {
    return request('GET', '', undefined, params);
  },

  getById(id: string): Promise<any> {
    return request('GET', `/${id}`);
  },

  register(data: { customer_id: string; referred_by_id: string; referred_by_name?: string; notes?: string }): Promise<any> {
    return request('POST', '', data);
  },

  update(id: string, data: any): Promise<any> {
    return request('PUT', `/${id}`, data);
  },

  cancel(id: string, reason?: string): Promise<any> {
    return request('PATCH', `/${id}/cancel`, { reason });
  },

  expire(id: string): Promise<any> {
    return request('PATCH', `/${id}/expire`);
  },

  getTimeline(id: string): Promise<any[]> {
    return request('GET', `/${id}/timeline`);
  },

  getRewards(params?: { page?: number; limit?: number; status?: string; referral_id?: string }): Promise<{ rewards: any[]; total: number; page: number; limit: number; totalPages: number }> {
    return request('GET', '/rewards', undefined, params);
  },

  getPendingRewards(): Promise<any[]> {
    return request('GET', '/rewards/pending');
  },

  getRewardById(id: string): Promise<any> {
    return request('GET', `/rewards/${id}`);
  },

  createReward(data: { referral_id: string; invoice_id: string; invoice_amount: number; customer_id: string; amount?: number }): Promise<any> {
    return request('POST', '/rewards', data);
  },

  approveReward(id: string, approvedBy: string): Promise<any> {
    return request('PATCH', `/rewards/${id}/approve`, { approved_by: approvedBy });
  },

  rejectReward(id: string, reason: string, rejectedBy?: string): Promise<any> {
    return request('PATCH', `/rewards/${id}/reject`, { reason, rejected_by: rejectedBy });
  },

  getCampaigns(params?: { status?: string }): Promise<any[]> {
    return request('GET', '/campaigns', undefined, params);
  },

  createCampaign(data: any): Promise<any> {
    return request('POST', '/campaigns', data);
  },

  updateCampaign(id: string, data: any): Promise<any> {
    return request('PUT', `/campaigns/${id}`, data);
  },

  updateCampaignStatus(id: string, status: string): Promise<any> {
    return request('PATCH', `/campaigns/${id}/status`, { status });
  },

  getReversals(params?: { page?: number; limit?: number; status?: string }): Promise<{ reversals: any[]; total: number; page: number; limit: number; totalPages: number }> {
    return request('GET', '/reversals', undefined, params);
  },

  createReversal(data: { reward_id: string; reason: string; notes?: string }): Promise<any> {
    return request('POST', '/reversals', data);
  },

  approveReversal(id: string, approvedBy: string, notes?: string): Promise<any> {
    return request('PATCH', `/reversals/${id}/approve`, { approved_by: approvedBy, notes });
  },

  rejectReversal(id: string, reason: string, rejectedBy?: string, notes?: string): Promise<any> {
    return request('PATCH', `/reversals/${id}/reject`, { reason, rejected_by: rejectedBy, notes });
  },

  getAnalytics(params?: { period?: string; period_start?: string; period_end?: string }): Promise<any> {
    return request('GET', '/analytics', undefined, params);
  },

  getAnalyticsHistory(params?: { period?: string; period_start?: string; period_end?: string }): Promise<any[]> {
    return request('GET', '/analytics/history', undefined, params);
  },

  getAuditLogs(params?: { page?: number; limit?: number; entity_type?: string; entity_id?: string }): Promise<{ logs: any[]; total: number }> {
    return request('GET', '/audit', undefined, params);
  },

  getSettings(): Promise<any> {
    return request('GET', '/settings');
  },

  updateSettings(settings: any): Promise<any> {
    return request('PUT', '/settings', { settings });
  },
};
