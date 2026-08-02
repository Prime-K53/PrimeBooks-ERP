const { db, getDatabase } = require('../db.cjs');

function getDb() {
  return getDatabase();
}

class ReferralNotificationService {
  async sendRewardApprovedNotification(reward, referral) {
    return this._sendNotification({
      type: 'reward_approved',
      title: 'Reward Approved',
      message: `Your reward of ${reward.amount} has been approved and credited to your wallet.`,
      recipientId: reward.customer_id,
      referralId: referral.id,
      rewardId: reward.id});
  }

  async sendRewardRejectedNotification(reward, referral, reason) {
    return this._sendNotification({
      type: 'reward_rejected',
      title: 'Reward Rejected',
      message: `Your reward of ${reward.amount} has been rejected. Reason: ${reason}`,
      recipientId: reward.customer_id,
      referralId: referral.id,
      rewardId: reward.id});
  }

  async sendReversalProcessedNotification(reversal, reward) {
    return this._sendNotification({
      type: 'reversal_processed',
      title: 'Reversal Processed',
      message: `A reversal has been processed for reward ${reward.id}.`,
      recipientId: reward.customer_id,
      rewardId: reward.id});
  }

  async sendReferralConvertedNotification(referral) {
    return this._sendNotification({
      type: 'referral_converted',
      title: 'Referral Converted',
      message: `A referral you made has been converted.`,
      recipientId: referral.referred_by_id,
      referralId: referral.id});
  }

  async _sendNotification({ type, title, message, recipientId, referralId, rewardId}) {
    const db = getDb();
    const id = require('crypto').randomUUID();

    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO notifications (id, type, title, message, recipient_id, referral_id, reward_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ? , 'pending', CURRENT_TIMESTAMP)`,
        [id, type, title, message, recipientId, referralId || null, rewardId || null],
        (err) => {
          if (err) {
            console.error('[ReferralNotification] Failed to create notification:', err.message);
            resolve(null);
          } else {
            resolve({ id, type, title, message, recipientId });
          }
        }
      );
    });
  }

  async getNotifications(recipientId, limit = 20) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM notifications WHERE recipient_id = ? ORDER BY created_at DESC LIMIT ?`,
        [recipientId, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  async markAsRead(notificationId) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE notifications SET status = 'read', read_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [notificationId],
        (err) => {
          if (err) reject(err);
          else resolve({ success: true });
        }
      );
    });
  }
}

module.exports = ReferralNotificationService;
