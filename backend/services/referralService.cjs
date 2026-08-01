const { randomUUID } = require('crypto');
const BaseService = require('./baseService.cjs');
const ReferralNotificationService = require('./referralNotificationService.cjs');

class ReferralService extends BaseService {
  constructor() {
    super();
    this.notificationService = new ReferralNotificationService();
  }

  async _transaction(callback) {
    await this._run("BEGIN TRANSACTION");
    try {
      const result = await callback();
      await this._run("COMMIT");
      return result;
    } catch (err) {
      await this._run("ROLLBACK");
      throw err;
    }
  }

  getPaginationParams(params) {
    const page = Math.max(1, parseInt(params.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(params.limit, 10) || 20));
    const offset = (page - 1) * limit;
    return { page, limit, offset };
  }

  generateReferralCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code;
    const check = (c) => this._get(
      'SELECT 1 FROM customer_referrals WHERE referral_code = ?',
      [c]
    ).then(r => !!r);

    const generate = () => {
      let result = '';
      for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };

    const tryGenerate = async () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        code = generate();
        if (!(await check(code))) return code;
      }
      return generate();
    };

    return tryGenerate();
  }

  // ── Referral CRUD ──────────────────────────────────────────────

  async getAll(params, companyId) {
    const { page, limit, offset } = this.getPaginationParams(params);

    const conditions = ['r.company_id = ?', 'r.deleted_at IS NULL'];
    const queryParams = [companyId];

    if (params.status) {
      conditions.push('r.status = ?');
      queryParams.push(params.status);
    }

    if (params.search) {
      conditions.push('(r.customer_id LIKE ? OR r.referred_by_name LIKE ?)');
      const like = `%${params.search}%`;
      queryParams.push(like, like);
    }

    if (params.customer_id) {
      conditions.push('r.customer_id = ?');
      queryParams.push(params.customer_id);
    }

    if (params.referred_by_id) {
      conditions.push('r.referred_by_id = ?');
      queryParams.push(params.referred_by_id);
    }

    if (params.referral_code) {
      conditions.push('r.referral_code = ?');
      queryParams.push(params.referral_code);
    }

    const whereClause = conditions.join(' AND ');

    const countRow = await this._get(
      `SELECT COUNT(*) as total FROM customer_referrals r WHERE ${whereClause}`,
      queryParams
    );
    const total = countRow.total;
    const totalPages = Math.ceil(total / limit);

    const sortBy = params.sort_by || 'created_at';
    const sortDir = params.sort_dir === 'asc' ? 'ASC' : 'DESC';
    const allowedSorts = ['created_at', 'updated_at', 'status', 'customer_id', 'referred_by_name'];
    const safeSort = allowedSorts.includes(sortBy) ? sortBy : 'created_at';

    const referrals = await this._all(
      `SELECT r.* FROM customer_referrals r WHERE ${whereClause} ORDER BY r.${safeSort} ${sortDir} LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    );

    return { referrals, total, page, limit, totalPages };
  }

  async getById(id, companyId) {
    return this._get(
      'SELECT * FROM customer_referrals WHERE id = ? AND company_id = ? AND deleted_at IS NULL',
      [id, companyId]
    );
  }

  async delete(id, companyId) {
    const existing = await this.getById(id, companyId);
    if (!existing) throw new Error('Referral not found');
    if (existing.deleted_at) throw new Error('Referral already deleted');

    await this._run(
      `UPDATE customer_referrals SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?`,
      [id, companyId]
    );

    await this.addTimelineEntry({
      referralId: id,
      eventType: 'referral_cancelled',
      title: 'Referral Deleted',
      description: 'Referral was soft-deleted',
      companyId
    });

    return this.getById(id, companyId);
  }

  async register(data, companyId) {
    if (data.customer_id === data.referred_by_id) {
      throw new Error('Self-referral is not allowed');
    }

    return this._transaction(async () => {
      const id = randomUUID();
      const referralCode = data.referral_code || await this.generateReferralCode();

      await this._run(
      `INSERT INTO customer_referrals (id, customer_id, referred_by_id, referred_by_name, referral_code, status, pending_invoice_id, pending_invoice_amount, notes, company_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [id, data.customer_id, data.referred_by_id, data.referred_by_name || null,
       referralCode, data.pending_invoice_id || null, data.pending_invoice_amount || null,
       data.notes || null, companyId]
    );

    await this.addTimelineEntry({
      referralId: id,
      eventType: 'created',
      title: 'Referral Created',
      description: `Referral created for customer ${data.customer_id}`,
      actorId: data.referred_by_id,
      actorName: data.referred_by_name,
      companyId
    });

    await this.addAuditLog({
      entityType: 'referral',
      entityId: id,
      action: 'created',
      actorId: data.referred_by_id || 'system',
      actorName: data.referred_by_name || 'System',
      companyId
    });

      return this._get('SELECT * FROM customer_referrals WHERE id = ?', [id]);
    });
  }

  async update(id, data, companyId) {
    const existing = await this.getById(id, companyId);
    if (!existing) throw new Error('Referral not found');

    const fields = [];
    const params = [];
    const allowed = ['notes', 'status', 'pending_invoice_id', 'pending_invoice_amount', 'converted_invoice_id'];

    for (const field of allowed) {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        params.push(data[field] === null ? null : data[field]);
      }
    }

    if (fields.length > 0) {
      params.push(id, companyId);
      await this._run(
        `UPDATE customer_referrals SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?`,
        params
      );
    }

    return this.getById(id, companyId);
  }

  async cancel(id, actorId, actorName, reason, companyId) {
    return this._transaction(async () => {
      const existing = await this.getById(id, companyId);
      if (!existing) throw new Error('Referral not found');
      if (existing.status !== 'active') throw new Error('Referral is not active');

      await this._run(
        `UPDATE customer_referrals SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?`,
        [id, companyId]
      );

      await this.addTimelineEntry({
        referralId: id,
        eventType: 'referral_cancelled',
        title: 'Referral Cancelled',
        description: reason || 'Referral was cancelled',
        actorId,
        actorName,
        companyId
      });

      await this.addAuditLog({
        entityType: 'referral',
        entityId: id,
        action: 'cancelled',
        actorId,
        actorName,
        reason,
        fieldName: 'status',
        oldValue: existing.status,
        newValue: 'cancelled',
        companyId
      });

      return this.getById(id, companyId);
    });
  }

  async expire(id, companyId) {
    return this._transaction(async () => {
      const existing = await this.getById(id, companyId);
      if (!existing) throw new Error('Referral not found');
      if (existing.status !== 'active') throw new Error('Referral is not active');

      await this._run(
        `UPDATE customer_referrals SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?`,
        [id, companyId]
      );

      await this.addTimelineEntry({
        referralId: id,
        eventType: 'referral_expired',
        title: 'Referral Expired',
        description: 'Referral has expired',
        companyId
      });

      return this.getById(id, companyId);
    });
  }

  // ── Reward Management ──────────────────────────────────────────

  async getAllRewards(params, companyId) {
    const { page, limit, offset } = this.getPaginationParams(params);
    const conditions = ['r.company_id = ?'];
    const queryParams = [companyId];

    if (params.status) {
      conditions.push('r.status = ?');
      queryParams.push(params.status);
    }

    if (params.referral_id) {
      conditions.push('r.referral_id = ?');
      queryParams.push(params.referral_id);
    }

    const whereClause = conditions.join(' AND ');

    const countRow = await this._get(
      `SELECT COUNT(*) as total FROM referral_rewards r WHERE ${whereClause}`,
      queryParams
    );
    const total = countRow.total;
    const totalPages = Math.ceil(total / limit);

    const rewards = await this._all(
      `SELECT r.* FROM referral_rewards r WHERE ${whereClause} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    );

    return { rewards, total, page, limit, totalPages };
  }

  async getPendingRewards(companyId) {
    return this._all(
      "SELECT * FROM referral_rewards WHERE company_id = ? AND status = 'pending' ORDER BY created_at ASC",
      [companyId]
    );
  }

  async getRewardById(id, companyId) {
    return this._get(
      'SELECT * FROM referral_rewards WHERE id = ? AND company_id = ?',
      [id, companyId]
    );
  }

  async createReward(data, companyId) {
    return this._transaction(async () => {
      const referral = await this._get(
        "SELECT * FROM customer_referrals WHERE id = ? AND company_id = ? AND status = 'active'",
        [data.referral_id, companyId]
      );
      if (!referral) throw new Error('Referral not found or is not active');

      const settings = await this.getSettings(companyId);
      let amount = data.amount;
      if (amount === undefined || amount === null) {
        if (settings.rewardType === 'fixed') {
          amount = settings.rewardValue;
        } else {
          amount = (data.invoice_amount || 0) * (settings.rewardPercentage / 100);
        }
        if (settings.maxRewardAmount > 0 && amount > settings.maxRewardAmount) {
          amount = settings.maxRewardAmount;
        }
      }
      amount = Math.round(amount * 100) / 100;

      if (settings.minPurchaseAmount > 0 && (data.invoice_amount || 0) < settings.minPurchaseAmount) {
        throw new Error(`Invoice amount does not meet minimum purchase requirement of ${settings.minPurchaseAmount}`);
      }

      const id = randomUUID();
      await this._run(
        `INSERT INTO referral_rewards (id, referral_id, customer_id, invoice_id, invoice_amount, amount, status, company_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [id, data.referral_id, data.customer_id, data.invoice_id, data.invoice_amount || 0,
         amount, companyId]
      );

      await this.addTimelineEntry({
        referralId: data.referral_id,
        eventType: 'reward_earned',
        title: 'Reward Earned',
        description: `Reward of ${amount} earned for referral`,
        amount,
        companyId
      });

      await this.addAuditLog({
        entityType: 'reward',
        entityId: id,
        action: 'created',
        actorId: 'system',
        actorName: 'System',
        companyId
      });

      return this._get('SELECT * FROM referral_rewards WHERE id = ?', [id]);
    });
  }

  async approveReward(id, approvedBy, companyId) {
    return this._transaction(async () => {
      const reward = await this.getRewardById(id, companyId);
      if (!reward) throw new Error('Reward not found');
      if (reward.status !== 'pending') throw new Error('Reward is not in pending status');

      const referral = await this._get(
        'SELECT * FROM customer_referrals WHERE id = ? AND company_id = ?',
        [reward.referral_id, companyId]
      );

      await this._run(
        `UPDATE referral_rewards SET status = 'approved', approved_at = CURRENT_TIMESTAMP, approved_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?`,
        [approvedBy, id, companyId]
      );

      await this._run(
        `UPDATE customer_referrals SET status = 'converted', converted_invoice_id = ?, converted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?`,
        [reward.invoice_id, reward.referral_id, companyId]
      );

      if (referral) {
        await this.creditWalletForReward(reward, referral, companyId);
      }

      await this.notificationService.sendRewardApprovedNotification(reward, referral, companyId);
      await this._createPortalNotifications(
        reward.customer_id, companyId,
        'reward_approved',
        'Reward Approved',
        `Your referral reward of ${reward.amount} has been approved.`,
        reward.referral_id, reward.id
      );

      await this.addTimelineEntry({
        referralId: reward.referral_id,
        eventType: 'reward_approved',
        title: 'Reward Approved',
        description: `Reward of ${reward.amount} approved`,
        amount: reward.amount,
        actorId: approvedBy,
        companyId
      });

      await this.addAuditLog({
        entityType: 'reward',
        entityId: id,
        action: 'approved',
        actorId: approvedBy,
        fieldName: 'status',
        oldValue: 'pending',
        newValue: 'approved',
        companyId
      });

      return this._get('SELECT * FROM referral_rewards WHERE id = ?', [id]);
    });
  }

  async rejectReward(id, reason, rejectedBy, companyId) {
    return this._transaction(async () => {
      const reward = await this.getRewardById(id, companyId);
      if (!reward) throw new Error('Reward not found');
      if (reward.status !== 'pending') throw new Error('Reward is not in pending status');

      const referral = await this._get(
        'SELECT * FROM customer_referrals WHERE id = ? AND company_id = ?',
        [reward.referral_id, companyId]
      );

      await this._run(
        `UPDATE referral_rewards SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancelled_by = ?, cancel_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?`,
        [rejectedBy, reason || null, id, companyId]
      );

      await this.notificationService.sendRewardRejectedNotification(reward, referral, reason, companyId);
      await this._createPortalNotifications(
        reward.customer_id, companyId,
        'reward_rejected',
        'Reward Rejected',
        `Your referral reward of ${reward.amount} was rejected. Reason: ${reason || 'No reason provided'}`,
        reward.referral_id, reward.id
      );

      await this.addTimelineEntry({
        referralId: reward.referral_id,
        eventType: 'reward_rejected',
        title: 'Reward Rejected',
        description: reason || 'Reward was rejected',
        actorId: rejectedBy,
        companyId
      });

      await this.addAuditLog({
        entityType: 'reward',
        entityId: id,
        action: 'rejected',
        actorId: rejectedBy,
        reason,
        fieldName: 'status',
        oldValue: 'pending',
        newValue: 'cancelled',
        companyId
      });

      return this._get('SELECT * FROM referral_rewards WHERE id = ?', [id]);
    });
  }

  // ── Timeline ───────────────────────────────────────────────────

  async getTimeline(referralId, companyId) {
    return this._all(
      'SELECT * FROM referral_timeline WHERE referral_id = ? AND company_id = ? ORDER BY timestamp DESC',
      [referralId, companyId]
    );
  }

  async addTimelineEntry({ referralId, eventType, title, description, amount, actorId, actorName, metadata, companyId }) {
    const id = randomUUID();
    const metadataJson = metadata ? JSON.stringify(metadata) : null;
    await this._run(
      `INSERT INTO referral_timeline (id, referral_id, event_type, title, description, amount, actor_id, actor_name, metadata_json, timestamp, company_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
      [id, referralId, eventType, title, description || null,
       amount || null, actorId || null, actorName || null,
       metadataJson, companyId || '']
    );
    return id;
  }

  // ── Audit Log ──────────────────────────────────────────────────

  async getAuditLogs(params, companyId) {
    const { page, limit, offset } = this.getPaginationParams(params);
    const conditions = ['a.company_id = ?'];
    const queryParams = [companyId];

    if (params.entity_type) {
      conditions.push('a.entity_type = ?');
      queryParams.push(params.entity_type);
    }

    if (params.entity_id) {
      conditions.push('a.entity_id = ?');
      queryParams.push(params.entity_id);
    }

    const whereClause = conditions.join(' AND ');

    const countRow = await this._get(
      `SELECT COUNT(*) as total FROM referral_audit_logs a WHERE ${whereClause}`,
      queryParams
    );
    const total = countRow.total;
    const totalPages = Math.ceil(total / limit);

    const logs = await this._all(
      `SELECT a.* FROM referral_audit_logs a WHERE ${whereClause} ORDER BY a.timestamp DESC LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    );

    return { auditLogs: logs, total, page, limit, totalPages };
  }

  async addAuditLog(data) {
    const id = randomUUID();
    await this._run(
      `INSERT INTO referral_audit_logs (id, entity_type, entity_id, action, actor_id, actor_name, field_name, old_value, new_value, reason, correlation_id, ip_address, user_agent, timestamp, company_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
      [id, data.entityType, data.entityId, data.action,
       data.actorId || 'system', data.actorName || null,
       data.fieldName || null, data.oldValue != null ? String(data.oldValue) : null,
       data.newValue != null ? String(data.newValue) : null,
       data.reason || null, data.correlationId || null,
       data.ipAddress || null, data.userAgent || null,
       data.companyId || '']
    );
    return id;
  }

  // ── Campaigns ──────────────────────────────────────────────────

  async getAllCampaigns(params, companyId) {
    const conditions = ['c.company_id = ?'];
    const queryParams = [companyId];

    if (params.status && params.status !== 'all') {
      conditions.push('r.status = ?');
      queryParams.push(params.status);
    }

    return this._all(
      `SELECT c.* FROM referral_campaigns c WHERE ${conditions.join(' AND ')} ORDER BY c.created_at DESC`,
      queryParams
    );
  }

  async getActiveCampaign(companyId) {
    const now = new Date().toISOString();
    return this._get(
      "SELECT * FROM referral_campaigns WHERE company_id = ? AND status = 'active' AND start_date <= ? AND (end_date IS NULL OR end_date >= ?) ORDER BY created_at DESC LIMIT 1",
      [companyId, now, now]
    );
  }

  async createCampaign(data, companyId) {
    const id = randomUUID();
    await this._run(
      `INSERT INTO referral_campaigns (id, name, description, start_date, end_date, status, reward_type, reward_value, reward_percentage, min_purchase_amount, max_reward_amount, max_rewards_per_customer, max_total_rewards, total_rewards_given, target_segments_json, excluded_customers_json, bonus_multiplier, terms_json, created_by, approved_by, company_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.name, data.description || null, data.start_date,
       data.end_date || null, data.status || 'draft', data.reward_type || 'percentage',
       data.reward_value || 0, data.reward_percentage || 0,
       data.min_purchase_amount || 0, data.max_reward_amount || 0,
       data.max_rewards_per_customer || 0, data.max_total_rewards || 0,
       0, data.target_segments_json || null,
       data.excluded_customers_json || null, data.bonus_multiplier || 1,
       data.terms_json || null, data.created_by || null,
       data.approved_by || null, companyId]
    );

    await this.addAuditLog({
      entityType: 'campaign',
      entityId: id,
      action: 'created',
      actorId: data.created_by || 'system',
      actorName: data.created_by || 'System',
      companyId
    });

    return this._get('SELECT * FROM referral_campaigns WHERE id = ?', [id]);
  }

  async updateCampaign(id, data, companyId) {
    const existing = await this._get(
      'SELECT * FROM referral_campaigns WHERE id = ? AND company_id = ?',
      [id, companyId]
    );
    if (!existing) throw new Error('Campaign not found');

    const fields = [];
    const params = [];
    const allowed = ['name', 'description', 'start_date', 'end_date', 'reward_type',
      'reward_value', 'reward_percentage', 'min_purchase_amount', 'max_reward_amount',
      'max_rewards_per_customer', 'max_total_rewards', 'target_segments_json',
      'excluded_customers_json', 'bonus_multiplier', 'terms_json', 'created_by', 'approved_by'];

    for (const field of allowed) {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        params.push(data[field] === null ? null : data[field]);
      }
    }

    if (fields.length > 0) {
      params.push(id, companyId);
      await this._run(
        `UPDATE referral_campaigns SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?`,
        params
      );
    }

    return this._get('SELECT * FROM referral_campaigns WHERE id = ? AND company_id = ?', [id, companyId]);
  }

  async updateCampaignStatus(id, status, companyId) {
    const existing = await this._get(
      'SELECT * FROM referral_campaigns WHERE id = ? AND company_id = ?',
      [id, companyId]
    );
    if (!existing) throw new Error('Campaign not found');

    await this._run(
      `UPDATE referral_campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?`,
      [status, id, companyId]
    );

    await this.addAuditLog({
      entityType: 'campaign',
      entityId: id,
      action: 'status_changed',
      actorId: 'system',
      actorName: 'System',
      fieldName: 'status',
      oldValue: existing.status,
      newValue: status,
      companyId
    });

    return this._get('SELECT * FROM referral_campaigns WHERE id = ? AND company_id = ?', [id, companyId]);
  }

  // ── Reversals ──────────────────────────────────────────────────

  async getAllReversals(params, companyId) {
    const { page, limit, offset } = this.getPaginationParams(params);
    const conditions = ['r.company_id = ?'];
    const queryParams = [companyId];

    if (params.status) {
      conditions.push('r.status = ?');
      queryParams.push(params.status);
    }

    const whereClause = conditions.join(' AND ');

    const countRow = await this._get(
      `SELECT COUNT(*) as total FROM referral_reversals r WHERE ${whereClause}`,
      queryParams
    );
    const total = countRow.total;
    const totalPages = Math.ceil(total / limit);

    const reversals = await this._all(
      `SELECT r.* FROM referral_reversals r WHERE ${whereClause} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    );

    return { reversals, total, page, limit, totalPages };
  }

  async createReversal(data, companyId) {
    return this._transaction(async () => {
      const reward = await this._get(
        'SELECT * FROM referral_rewards WHERE id = ? AND company_id = ?',
        [data.reward_id, companyId]
      );
      if (!reward) throw new Error('Reward not found');

      const id = randomUUID();
      await this._run(
        `INSERT INTO referral_reversals (id, reward_id, reason, status, requested_by, notes, company_id, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [id, data.reward_id, data.reason, data.requested_by || 'system',
         data.notes || null, companyId]
      );

      await this.addAuditLog({
        entityType: 'reversal',
        entityId: id,
        action: 'created',
        actorId: data.requested_by || 'system',
        actorName: data.requested_by || 'System',
        reason: data.reason,
        companyId
      });

      return this._get('SELECT * FROM referral_reversals WHERE id = ?', [id]);
    });
  }

  async approveReversal(id, approvedBy, notes, companyId) {
    return this._transaction(async () => {
      const reversal = await this._get(
        'SELECT * FROM referral_reversals WHERE id = ? AND company_id = ?',
        [id, companyId]
      );
      if (!reversal) throw new Error('Reversal not found');
      if (reversal.status !== 'pending') throw new Error('Reversal is not in pending status');

      await this._run(
        `UPDATE referral_reversals SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?`,
        [approvedBy, notes || null, id, companyId]
      );

      await this._run(
        `UPDATE referral_reversals SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?`,
        [id, companyId]
      );

      const reward = await this._get(
        'SELECT * FROM referral_rewards WHERE id = ? AND company_id = ?',
        [reversal.reward_id, companyId]
      );

      if (reward) {
        await this.notificationService.sendReversalProcessedNotification(reversal, reward, companyId);
        await this._createPortalNotifications(
          reward.customer_id, companyId,
          'reversal_processed',
          'Reversal Processed',
          `A reversal has been processed for your reward of ${reward.amount}.`,
          reward.referral_id, reward.id
        );

        await this.addTimelineEntry({
          referralId: reward.referral_id,
          eventType: 'reward_reversed',
          title: 'Reward Reversed',
          description: notes || 'Reward was reversed',
          actorId: approvedBy,
          companyId
        });
      }

      await this.addAuditLog({
        entityType: 'reversal',
        entityId: id,
        action: 'approved',
        actorId: approvedBy,
        notes,
        fieldName: 'status',
        oldValue: 'pending',
        newValue: 'completed',
        companyId
      });

      return this._get('SELECT * FROM referral_reversals WHERE id = ?', [id]);
    });
  }

  async rejectReversal(id, reason, rejectedBy, notes, companyId) {
    const reversal = await this._get(
      'SELECT * FROM referral_reversals WHERE id = ? AND company_id = ?',
      [id, companyId]
    );
    if (!reversal) throw new Error('Reversal not found');
    if (reversal.status !== 'pending') throw new Error('Reversal is not in pending status');

    await this._run(
      `UPDATE referral_reversals SET status = 'rejected', rejected_by = ?, rejected_at = CURRENT_TIMESTAMP, reject_reason = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?`,
      [rejectedBy, reason || null, notes || null, id, companyId]
    );

    const reward = await this._get(
      'SELECT * FROM referral_rewards WHERE id = ? AND company_id = ?',
      [reversal.reward_id, companyId]
    );
    if (reward) {
      await this._createPortalNotifications(
        reward.customer_id, companyId,
        'reversal_rejected',
        'Reversal Rejected',
        `Your reversal request for reward ${reward.amount} was rejected.`,
        reward.referral_id, reward.id
      );
    }

    await this.addAuditLog({
      entityType: 'reversal',
      entityId: id,
      action: 'rejected',
      actorId: rejectedBy,
      reason,
      fieldName: 'status',
      oldValue: 'pending',
      newValue: 'rejected',
      companyId
    });

    return this._get('SELECT * FROM referral_reversals WHERE id = ?', [id]);
  }

  // ── Analytics ──────────────────────────────────────────────────

  async getAnalytics(params, companyId) {
    const period = params.period || 'monthly';
    const periodStart = params.period_start || new Date().toISOString().slice(0, 10);
    const periodEnd = params.period_end || periodStart;

    let analytics = await this._get(
      `SELECT * FROM referral_analytics WHERE company_id = ? AND period = ? AND period_start = ? AND period_end = ? ORDER BY generated_at DESC LIMIT 1`,
      [companyId, period, periodStart, periodEnd]
    );

    if (!analytics) {
      analytics = await this.generateAnalytics(period, periodStart, periodEnd, companyId);
    }

    return analytics;
  }

  async getAnalyticsHistory(params, companyId) {
    return this._all(
      'SELECT * FROM referral_analytics WHERE company_id = ? ORDER BY period_start DESC',
      [companyId]
    );
  }

  async generateAnalytics(period, periodStart, periodEnd, companyId) {
    const totalReferrals = await this._get(
      'SELECT COUNT(*) as count FROM customer_referrals WHERE company_id = ? AND created_at BETWEEN ? AND ?',
      [companyId, periodStart, periodEnd + 'T23:59:59.999Z']
    );

    const activeReferrals = await this._get(
      "SELECT COUNT(*) as count FROM customer_referrals WHERE company_id = ? AND status = 'active' AND created_at BETWEEN ? AND ?",
      [companyId, periodStart, periodEnd + 'T23:59:59.999Z']
    );

    const convertedReferrals = await this._get(
      "SELECT COUNT(*) as count FROM customer_referrals WHERE company_id = ? AND status = 'converted' AND created_at BETWEEN ? AND ?",
      [companyId, periodStart, periodEnd + 'T23:59:59.999Z']
    );

    const rewardStats = await this._get(
      `SELECT
        COALESCE(SUM(amount), 0) as total_rewards,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END), 0) as approved_amount,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) as paid_amount,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) as pending_amount,
        COALESCE(AVG(amount), 0) as avg_amount
       FROM referral_rewards WHERE company_id = ? AND created_at BETWEEN ? AND ?`,
      [companyId, periodStart, periodEnd + 'T23:59:59.999Z']
    );

    const totalRewardsAmount = rewardStats.total_rewards || 0;
    const approvedRewardsAmount = rewardStats.approved_amount || 0;
    const paidRewardsAmount = rewardStats.paid_amount || 0;
    const pendingRewardsAmount = rewardStats.pending_amount || 0;
    const averageRewardAmount = rewardStats.avg_amount || 0;

    const totalCount = totalReferrals.count || 0;
    const convertedCount = convertedReferrals.count || 0;
    const conversionRate = totalCount > 0 ? (convertedCount / totalCount) * 100 : 0;

    const revenueAttributed = await this._get(
      'SELECT COALESCE(SUM(invoice_amount), 0) as revenue FROM referral_rewards WHERE company_id = ? AND created_at BETWEEN ? AND ? AND status IN (\'approved\', \'paid\')',
      [companyId, periodStart, periodEnd + 'T23:59:59.999Z']
    );

    const revenue = revenueAttributed.revenue || 0;
    const roi = totalRewardsAmount > 0 ? (revenue - totalRewardsAmount) / totalRewardsAmount : 0;

    const id = randomUUID();
    await this._run(
      `INSERT INTO referral_analytics (id, period, period_start, period_end, total_referrals, active_referrals, converted_referrals, total_rewards_amount, approved_rewards_amount, paid_rewards_amount, pending_rewards_amount, average_reward_amount, conversion_rate, revenue_attributed, roi, company_id, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [id, period, periodStart, periodEnd,
       totalReferrals.count || 0, activeReferrals.count || 0, convertedReferrals.count || 0,
       totalRewardsAmount, approvedRewardsAmount, paidRewardsAmount, pendingRewardsAmount,
       averageRewardAmount, conversionRate, revenue, roi, companyId]
    );

    return this._get('SELECT * FROM referral_analytics WHERE id = ?', [id]);
  }

  // ── Settings ───────────────────────────────────────────────────

  async getSettings(companyId) {
    const row = await this._get(
      'SELECT settings_json FROM referral_settings WHERE company_id = ?',
      [companyId]
    );

    if (!row) {
      return {
        enabled: true,
        rewardType: 'percentage',
        rewardValue: 0,
        rewardPercentage: 5,
        minPurchaseAmount: 0,
        maxRewardAmount: 0,
        requireApproval: true,
        autoApproveThreshold: 100,
        selfReferralPrevention: true,
        expiryDays: 365,
        allowMultipleRewards: true
      };
    }

    try {
      return JSON.parse(row.settings_json);
    } catch {
      return {};
    }
  }

  async updateSettings(companyId, settings) {
    const existing = await this._get(
      'SELECT id FROM referral_settings WHERE company_id = ?',
      [companyId]
    );

    const settingsJson = JSON.stringify(settings);

    if (existing) {
      await this._run(
        `UPDATE referral_settings SET settings_json = ?, updated_at = CURRENT_TIMESTAMP WHERE company_id = ?`,
        [settingsJson, companyId]
      );
    } else {
      const id = randomUUID();
      await this._run(
        `INSERT INTO referral_settings (id, company_id, settings_json) VALUES (?, ?, ?)`,
        [id, companyId, settingsJson]
      );
    }

    await this.addAuditLog({
      entityType: 'setting',
      entityId: companyId,
      action: 'updated',
      actorId: 'system',
      actorName: 'System',
      fieldName: 'settings_json',
      companyId
    });

    return this.getSettings(companyId);
  }

  async cleanupAuditLogs(retentionDays = 90, companyId) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    
    let sql = 'DELETE FROM referral_audit_logs WHERE created_at < ?';
    const params = [cutoff];
    
    if (companyId) {
      sql += ' AND company_id = ?';
      params.push(companyId);
    }
    
    const result = await this._run(sql, params);
    return { deleted: result.changes };
  }

  // ── Internal Helpers ───────────────────────────────────────────

  async _getPortalUserIdsForCustomer(customerId, companyId) {
    if (!customerId) return [];
    const rows = await this._all(
      'SELECT id FROM portal_users WHERE customer_id = ? AND company_id = ? AND status = ?',
      [customerId, companyId, 'active']
    );
    return rows.map(r => r.id);
  }

  async _createPortalNotifications(recipientCustomerId, companyId, type, title, message, referralId, rewardId) {
    const portalUserIds = await this._getPortalUserIdsForCustomer(recipientCustomerId, companyId);
    if (portalUserIds.length === 0) return;
    const now = new Date().toISOString();
    for (const portalUserId of portalUserIds) {
      await this._run(
        `INSERT INTO portal_notifications (id, portal_user_id, type, title, body, link, company_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), portalUserId, type, title, message, null, companyId, now]
      );
    }
  }

  async creditWalletForReward(reward, referral, companyId) {
    const walletTxId = randomUUID();

    const customer = await this._get(
      'SELECT * FROM customers WHERE id = ?',
      [reward.customer_id]
    );
    if (!customer) return;

    const account = await this._get(
      "SELECT id FROM chart_of_accounts WHERE company_id = ? AND type = 'liability' LIMIT 1",
      [companyId]
    );
    const accountId = account ? account.id : null;

    if (accountId) {
      await this._run(
        `INSERT INTO ledger_entries (id, account_id, account_code, account_name, entry_type, amount, currency, description, reference_type, reference_id, journal_id, entry_date, company_id, created_by)
         VALUES (?, ?, ?, ?, 'credit', ?, 'USD', ?, 'referral_reward', ?, ?, ?, ?, ?)`,
        [randomUUID(), accountId, null, null, reward.amount,
         `Referral reward credit for referral ${referral.referral_code}`,
         reward.id, walletTxId, new Date().toISOString(), companyId, 'system']
      );
    }

    await this._run(
      'UPDATE customers SET walletBalance = COALESCE(walletBalance, 0) + ? WHERE id = ?',
      [reward.amount, referral.referred_by_id || reward.customer_id]
    );

    await this._run(
      `UPDATE referral_rewards SET wallet_transaction_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?`,
      [walletTxId, reward.id, companyId]
    );
  }
}

module.exports = ReferralService;
