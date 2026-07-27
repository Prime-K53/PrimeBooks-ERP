import { ExaminationBatchNotification, NotificationAuditLog, NotificationType, NotificationPriority } from '../types';
import { logger } from '@/services/logger';
import { getUrl, API_BASE_URL } from '../config/api.js';
import { dbService } from './db';
import { examinationDb } from './examinationDb';
import { getHeaders, joinPath, safeJson, toServiceError, isLikelyNetworkError } from './examinationServiceUtils';

const REQUEST_TIMEOUT_MS = 30000;
const HEAVY_REQUEST_TIMEOUT_MS = 180000;
const FALLBACK_CANDIDATE_TIMEOUT_MS = 12000;
const BACKEND_RETRY_COOLDOWN_MS = 60000;
const PASSWORD_BYPASS_USER_ID = 'USR-PASSWORD-BYPASS';
const loggedLocalNotificationStores = new Set<string>();

const EXAM_BACKEND_URL = (import.meta as any)?.env?.VITE_EXAM_BACKEND_URL;

const API_BASE_CANDIDATES = () => {
  if (!EXAM_BACKEND_URL) return [];
  return [`${EXAM_BACKEND_URL}/api/examination`];
};
let backendRetryAfter = 0;

const getLocalNotificationsForUser = async (
  userId: string,
  limit: number
): Promise<ExaminationBatchNotification[]> => {
  let localNotifications: ExaminationBatchNotification[];
  try {
    localNotifications = await examinationDb.examinationBatchNotifications.toArray() as ExaminationBatchNotification[];
  } catch {
    localNotifications = await dbService.getAll<ExaminationBatchNotification>('examinationBatchNotifications');
  }
  if (!loggedLocalNotificationStores.has(userId)) {
    loggedLocalNotificationStores.add(userId);
    logger.debug('[NotificationService] Using cached notifications from local storage');
  }
  return (localNotifications || [])
    .filter(n => n.user_id === userId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);
};

const markBackendUnavailable = () => {
  backendRetryAfter = Date.now() + BACKEND_RETRY_COOLDOWN_MS;
};

const clearBackendUnavailable = () => {
  backendRetryAfter = 0;
};

const shouldUseLocalNotificationsOnly = (userId?: string) => {
  const currentUserId = String(userId || '').trim();
  if (currentUserId === PASSWORD_BYPASS_USER_ID) return true;
  if (API_BASE_CANDIDATES().length === 0) return true;
  return Boolean(import.meta.env?.DEV)
    && String(import.meta.env?.VITE_USE_REMOTE_EXAM_NOTIFICATION_API || '').toLowerCase() !== 'true';
};

const fetchWithTimeout = async (
  endpoint: string,
  options: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS
) => {
  let lastError: Error | null = null;
  const baseCandidates = API_BASE_CANDIDATES();
  if (baseCandidates.length === 0) {
    throw new Error('Failed to fetch: backend disabled in offline mode');
  }

  for (let index = 0; index < baseCandidates.length; index += 1) {
    const base = baseCandidates[index];
    const isLastAttempt = index === baseCandidates.length - 1;
    const controller = new AbortController();
    const timeoutForAttempt = !isLastAttempt
      ? Math.min(timeoutMs, FALLBACK_CANDIDATE_TIMEOUT_MS)
      : timeoutMs;

    let didTimeout = false;
    const timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutForAttempt);

    try {
      const url = getUrl(joinPath(base, endpoint));
      logger.debug(`[examinationNotificationService] fetch attempt ${index + 1}/${baseCandidates.length} -> ${url} (timeout ${timeoutForAttempt}ms)`);
      const start = Date.now();
      const response = await fetch(url, {
        ...options,
        headers: { ...getHeaders(), ...options.headers },
        signal: controller.signal
      });
      const duration = Date.now() - start;
      const contentType = response.headers.get('content-type') || '';
      logger.debug(`[API Response] ${response.status} ${url} in ${duration}ms (Content-Type: ${contentType})`);

      const shouldTryNext = !isLastAttempt
        && base.startsWith('/')
        && (response.status === 404 || response.status === 405 || response.status === 501);

      if (!response.ok && shouldTryNext) {
        lastError = new Error(`HTTP error! status: ${response.status}`);
        console.warn(`[examinationNotificationService] non-ok response (${response.status}) from ${url}, will try next candidate`);
        continue;
      }

      if (contentType.includes('text/html')) {
        const err = new Error('Wrong API URL or backend route missing: Received HTML instead of JSON');
        logger.error(`[API Error] HTML response detected for ${url}`, { status: response.status, contentType });
        if (shouldTryNext) {
          lastError = err;
          continue;
        }
        throw err;
      }

      return response;
    } catch (err: unknown) {
      const normalizedError = err instanceof Error ? err : new Error(String(err) || 'Unknown request error');
      if (didTimeout) {
        lastError = new Error(`Request timeout after ${timeoutMs}ms`);
      } else {
        lastError = normalizedError;
      }

      const canTryNextCandidate = !isLastAttempt && (
        didTimeout
        || normalizedError.name === 'AbortError'
        || isLikelyNetworkError(normalizedError)
      );

      if (!canTryNextCandidate) {
        throw lastError;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error('All API candidates failed');
};

export const examinationNotificationService = {
  /**
   * Create a notification for a batch event
   */
  async createBatchNotification(
    batchId: string,
    notificationType: NotificationType,
    batchDetails: Record<string, unknown>,
    userId?: string
  ): Promise<ExaminationBatchNotification> {
    const user = userId || this.getCurrentUserId();
    if (!user) {
      console.warn('[ExaminationNotification] No user ID available — skipping notification');
      return this.createAnonymousNotification(batchId, notificationType, batchDetails);
    }

    // Generate notification content based on type
    const { title, message, priority } = this.generateNotificationContent(notificationType, batchDetails);

    const notification: Partial<ExaminationBatchNotification> = {
      id: this.generateId(),
      batch_id: batchId,
      user_id: user,
      notification_type: notificationType,
      title,
      message,
      priority,
      batch_details: {
        batchId: batchDetails.id || batchId,
        batchName: batchDetails.name || 'Examination Batch',
        examinationDate: batchDetails.exam_date || batchDetails.created_at || new Date().toISOString(),
        numberOfStudents: batchDetails.expected_candidature || batchDetails.total_students || 0,
        schoolName: batchDetails.school_name,
        academicYear: batchDetails.academic_year,
        term: batchDetails.term,
        examType: batchDetails.exam_type,
        totalAmount: batchDetails.total_amount,
        status: batchDetails.status
      },
      is_read: false,
      read_at: null,
      delivered_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      expires_at: this.calculateExpiry(notificationType)
    };

    if (shouldUseLocalNotificationsOnly(user)) {
      try {
        await examinationDb.examinationBatchNotifications.put(notification as ExaminationBatchNotification);
      } catch {
        await dbService.put('examinationBatchNotifications', notification as ExaminationBatchNotification);
      }
      await this.createLocalAuditLog(notification.id || this.generateId(), user, 'CREATED', {
        notificationType,
        batchId,
        source: 'local_only_mode'
      });
      return notification as ExaminationBatchNotification;
    }

    // Try to save to backend first
    try {
      const response = await fetchWithTimeout('/notifications', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(notification)
      }, HEAVY_REQUEST_TIMEOUT_MS);

      if (!response.ok) {
        throw new Error(await toServiceError(response, 'Failed to create notification'));
      }

      const result = await safeJson(response, 'createBatchNotification');

      // Audit log for successful creation
      await this.createAuditLog(result.id, user, 'CREATED', {
        notificationType,
        batchId,
        source: 'batch_calculation'
      });

      return result;
    } catch (error) {
      logger.error('[NotificationService] Failed to create notification on backend:', error);

      // Fallback: store in local IndexedDB
      try {
        const localNotification = {
          ...notification,
          id: `local-${notification.id}`
        };
        try {
          await examinationDb.examinationBatchNotifications.put(localNotification as ExaminationBatchNotification);
        } catch {
          await dbService.put('examinationBatchNotifications', localNotification as ExaminationBatchNotification);
        }

        // Still create audit log locally
        await this.createLocalAuditLog(localNotification.id, user, 'CREATED', {
          notificationType,
          batchId,
          source: 'batch_calculation',
          error: error instanceof Error ? error.message : 'Backend unavailable, stored locally'
        });

        return localNotification as ExaminationBatchNotification;
      } catch (localError) {
        logger.error('[NotificationService] Failed to store notification locally:', localError);
        throw error;
      }
    }
  },

  /**
   * Fetch notifications for current user
   */
  async getUserNotifications(userId?: string, limit: number = 50): Promise<ExaminationBatchNotification[]> {
    const user = userId || this.getCurrentUserId();
    if (!user) {
      return [];
    }

    if (shouldUseLocalNotificationsOnly(user)) {
      return getLocalNotificationsForUser(user, limit);
    }

    if (backendRetryAfter > Date.now()) {
      try {
        logger.debug('[NotificationService] Backend cooldown active, skipping remote fetch');
        return await getLocalNotificationsForUser(user, limit);
      } catch (localError) {
        console.warn('[NotificationService] Failed to fetch local notifications during backend cooldown:', localError);
        return [];
      }
    }

    try {
      const response = await fetchWithTimeout(`/notifications?user_id=${user}&limit=${limit}`, {
        method: 'GET',
        headers: getHeaders()
      }, REQUEST_TIMEOUT_MS);

      if (!response.ok) {
        throw new Error(await toServiceError(response, 'Failed to fetch notifications'));
      }

      clearBackendUnavailable();
      return safeJson(response, 'getUserNotifications');
    } catch (error) {
      // Distinguish between network errors and server errors
      const isNetworkError = error instanceof TypeError ||
        (error instanceof Error && (
          error.message.includes('Failed to fetch') ||
          error.message.includes('ERR_CONNECTION') ||
          error.message.includes('connection closed') ||
          error.message.includes('Network') ||
          error.message.includes('timeout')
        ));

      if (isNetworkError) {
        markBackendUnavailable();
        console.warn('[NotificationService] Network error fetching notifications, falling back to local cache:', error);
      } else {
        logger.error('[NotificationService] Failed to fetch notifications from backend:', error);
      }

      // Fallback to local storage when network error occurs
      try {
        return await getLocalNotificationsForUser(user, limit);
      } catch (localError) {
        console.warn('[NotificationService] Failed to fetch local notifications:', localError);
        // Return empty array instead of propagating error
        return [];
      }
    }
  },

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string, userId?: string): Promise<void> {
    const user = userId || this.getCurrentUserId();
    if (!user) {
      throw new Error('No user ID available');
    }

    if (shouldUseLocalNotificationsOnly(user)) {
      let notifications: ExaminationBatchNotification[];
      try {
        notifications = await examinationDb.examinationBatchNotifications.toArray() as ExaminationBatchNotification[];
      } catch {
        notifications = await dbService.getAll<ExaminationBatchNotification>('examinationBatchNotifications');
      }
      const notification = notifications.find(n => n.id === notificationId || n.id === `local-${notificationId}`);
      if (notification) {
        notification.is_read = true;
        notification.read_at = new Date().toISOString();
        try {
          await examinationDb.examinationBatchNotifications.put(notification as ExaminationBatchNotification);
        } catch {
          await dbService.put('examinationBatchNotifications', notification as ExaminationBatchNotification);
        }
      }

      await this.createLocalAuditLog(notificationId, user, 'READ', { source: 'local_only_mode' });
      return;
    }

    try {
      const response = await fetchWithTimeout(`/notifications/${notificationId}/read`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ user_id: user })
      }, REQUEST_TIMEOUT_MS);

      if (!response.ok) {
        throw new Error(await toServiceError(response, 'Failed to mark notification as read'));
      }

      await this.createAuditLog(notificationId, user, 'READ', {});
    } catch (error) {
      logger.error('[NotificationService] Failed to mark notification as read on backend:', error);

      // Fallback: update local storage
      try {
        let notifications: ExaminationBatchNotification[];
        try {
          notifications = await examinationDb.examinationBatchNotifications.toArray() as ExaminationBatchNotification[];
        } catch {
          notifications = await dbService.getAll<ExaminationBatchNotification>('examinationBatchNotifications');
        }
        const notification = notifications.find(n => n.id === notificationId || n.id === `local-${notificationId}`);
        if (notification) {
          notification.is_read = true;
          notification.read_at = new Date().toISOString();
          try {
            await examinationDb.examinationBatchNotifications.put(notification as ExaminationBatchNotification);
          } catch {
            await dbService.put('examinationBatchNotifications', notification as ExaminationBatchNotification);
          }
        }

        await this.createLocalAuditLog(notificationId, user, 'READ', {
          error: error instanceof Error ? error.message : 'Backend unavailable'
        });
      } catch (localError) {
        logger.error('[NotificationService] Failed to update local notification:', localError);
        throw error;
      }
    }
  },

  /**
   * Dismiss/delete notification
   */
  async dismissNotification(notificationId: string, userId?: string): Promise<void> {
    const user = userId || this.getCurrentUserId();
    if (!user) {
      throw new Error('No user ID available');
    }

    if (shouldUseLocalNotificationsOnly(user)) {
      try {
        await examinationDb.examinationBatchNotifications.delete(notificationId);
      } catch {
        try {
          await examinationDb.examinationBatchNotifications.delete(`local-${notificationId}`);
        } catch {
          try {
            await dbService.delete('examinationBatchNotifications', notificationId);
          } catch {
            await dbService.delete('examinationBatchNotifications', `local-${notificationId}`);
          }
        }
      }

      await this.createLocalAuditLog(notificationId, user, 'DISMISSED', { source: 'local_only_mode' });
      return;
    }

    try {
      const response = await fetchWithTimeout(`/notifications/${notificationId}`, {
        method: 'DELETE',
        headers: getHeaders()
      }, REQUEST_TIMEOUT_MS);

      if (!response.ok) {
        throw new Error(await toServiceError(response, 'Failed to dismiss notification'));
      }

      await this.createAuditLog(notificationId, user, 'DISMISSED', {});
    } catch (error) {
      logger.error('[NotificationService] Failed to dismiss notification on backend:', error);

      // Fallback: remove from local storage
      try {
        const idToDelete = notificationId.startsWith('local-') ? notificationId : `local-${notificationId}`;
        try {
          await examinationDb.examinationBatchNotifications.delete(idToDelete);
        } catch {
          await dbService.delete('examinationBatchNotifications', idToDelete);
        }

        await this.createLocalAuditLog(notificationId, user, 'DISMISSED', {
          error: error instanceof Error ? error.message : 'Backend unavailable'
        });
      } catch (localError) {
        logger.error('[NotificationService] Failed to delete local notification:', localError);
        throw error;
      }
    }
  },

  /**
   * Check for duplicate notifications for a batch
   */
  async hasExistingNotification(batchId: string, notificationType: NotificationType, userId?: string): Promise<boolean> {
    const user = userId || this.getCurrentUserId();
    if (!user) return false;

    try {
      const notifications = await this.getUserNotifications(user, 100);
      return notifications.some(
        n => n.batch_id === batchId &&
        n.notification_type === notificationType &&
        !n.is_read &&
        (!n.expires_at || new Date(n.expires_at) > new Date())
      );
    } catch (error) {
      logger.error('[NotificationService] Error checking for duplicate notification:', error);
      return false;
    }
  },

  /**
   * Create audit log entry
   */
  async createAuditLog(
    notificationId: string,
    userId: string,
    action: 'CREATED' | 'DELIVERED' | 'READ' | 'DISMISSED' | 'EXPIRED' | 'FAILED',
    details: Record<string, unknown>
  ): Promise<void> {
    if (shouldUseLocalNotificationsOnly(userId)) {
      await this.createLocalAuditLog(notificationId, userId, action, details);
      return;
    }

    try {
      const auditLog: Partial<NotificationAuditLog> = {
        id: this.generateId(),
        notification_id: notificationId,
        user_id: userId,
        action,
        details_json: details,
        ip_address: this.getClientIp(),
        user_agent: navigator.userAgent,
        created_at: new Date().toISOString()
      };

      await fetchWithTimeout('/audit/notifications', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(auditLog)
      }, REQUEST_TIMEOUT_MS).catch(() => {
        // Silently fail audit logging - don't block main functionality
      });
    } catch (error) {
      console.warn('[NotificationService] Failed to create audit log:', error);
    }
  },

  /**
   * Create local audit log (for offline mode)
   */
  async createLocalAuditLog(
    notificationId: string,
    userId: string,
    action: string,
    details: Record<string, unknown>
  ): Promise<void> {
    try {
      const auditLog: Partial<NotificationAuditLog> = {
        id: `local-${this.generateId()}`,
        notification_id: notificationId,
        user_id: userId,
        action: action as NotificationAuditLog['action'],
        details_json: details,
        user_agent: navigator.userAgent,
        created_at: new Date().toISOString()
      };

      try {
        await examinationDb.notificationAuditLogs.put(auditLog as NotificationAuditLog);
      } catch {
        await dbService.put('notificationAuditLogs', auditLog as NotificationAuditLog);
      }
    } catch (error) {
      console.warn('[NotificationService] Failed to create local audit log:', error);
    }
  },

  /**
   * Generate notification content based on type
   */
  generateNotificationContent(
    type: NotificationType,
    batch: Record<string, unknown>
  ): { title: string; message: string; priority: NotificationPriority } {
    const schoolName = batch.school_name || batch.name || 'Unknown School';
    const candidateCount = batch.expected_candidature || batch.total_students || 0;
    const examDate = batch.exam_date || batch.created_at || new Date().toISOString().split('T')[0];

    switch (type) {
      case 'BATCH_CREATED':
        return {
          title: `Examination Batch Created: ${schoolName}`,
          message: `A new examination batch has been created for ${candidateCount} students. Examination date: ${examDate}.`,
          priority: 'Medium'
        };
      case 'BATCH_CALCULATED':
        return {
          title: `Examination Batch Ready: ${schoolName}`,
          message: `A new examination batch has been calculated for ${candidateCount} students. Examination date: ${examDate}. Total amount: ${batch.total_amount || 'N/A'}.`,
          priority: candidateCount > 500 ? 'High' : 'Medium'
        };

      case 'BATCH_APPROVED':
        return {
          title: `Batch Approved: ${schoolName}`,
          message: `Examination batch has been approved and is ready for invoicing. Students: ${candidateCount}.`,
          priority: 'Medium'
        };

      case 'BATCH_INVOICED':
        return {
          title: `Invoice Generated: ${schoolName}`,
          message: `Invoice has been automatically generated for the examination batch. Amount: ${batch.total_amount || 'N/A'}.`,
          priority: 'High'
        };

      case 'DEADLINE_REMINDER':
        return {
          title: `Deadline Approaching: ${schoolName}`,
          message: `Examination deadline is approaching. ${candidateCount} students affected.`,
          priority: 'Urgent'
        };

      default:
        return {
          title: 'Examination Notification',
          message: `Notification regarding examination batch for ${schoolName}.`,
          priority: 'Medium'
        };
    }
  },

  /**
   * Calculate expiry date based on notification type
   */
  calculateExpiry(type: NotificationType): string | undefined {
    const now = new Date();
    let daysToAdd: number;

    switch (type) {
      case 'BATCH_CREATED':
        daysToAdd = 7;
        break;
      case 'BATCH_CALCULATED':
        daysToAdd = 7; // Keep for 7 days
        break;
      case 'BATCH_APPROVED':
        daysToAdd = 14;
        break;
      case 'BATCH_INVOICED':
        daysToAdd = 30;
        break;
      case 'DEADLINE_REMINDER':
        daysToAdd = 3; // Short expiry for urgent reminders
        break;
      default:
        daysToAdd = 7;
    }

    const expiry = new Date(now);
    expiry.setDate(expiry.getDate() + daysToAdd);
    return expiry.toISOString();
  },

  /**
   * Get current user ID from session
   */
  getCurrentUserId(): string | null {
    const userJson = sessionStorage.getItem('nexus_user');
    if (userJson) {
      try {
        const user = JSON.parse(userJson);
        return user.id || null;
      } catch (e) {
        return null;
      }
    }
    return null;
  },

  /**
   * Generate unique ID
   */
  generateId(): string {
    return `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  },

  /**
   * Get client IP (approximation)
   */
  getClientIp(): string {
    // This is a simplified version - in production you'd get this from server
    return '127.0.0.1';
  },

  /**
   * Create notification with system user fallback when no user ID available
   */
  async createAnonymousNotification(
    batchId: string,
    notificationType: NotificationType,
    batchDetails: Record<string, unknown>
  ): Promise<ExaminationBatchNotification> {
    const { title, message, priority } = this.generateNotificationContent(notificationType, batchDetails);
    const notification: Partial<ExaminationBatchNotification> = {
      id: this.generateId(),
      batch_id: batchId,
      user_id: 'system',
      notification_type: notificationType,
      title,
      message,
      priority,
      batch_details: {
        batchId: batchDetails.id || batchId,
        batchName: batchDetails.name || 'Examination Batch',
        examinationDate: batchDetails.exam_date || batchDetails.created_at || new Date().toISOString(),
        numberOfStudents: batchDetails.expected_candidature || batchDetails.total_students || 0,
        schoolName: batchDetails.school_name,
        academicYear: batchDetails.academic_year,
        term: batchDetails.term,
        examType: batchDetails.exam_type,
        totalAmount: batchDetails.total_amount,
        status: batchDetails.status
      },
      is_read: false,
      read_at: null,
      delivered_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      expires_at: this.calculateExpiry(notificationType)
    };
    try {
      await examinationDb.examinationBatchNotifications.put(notification as ExaminationBatchNotification);
    } catch {
      await dbService.put('examinationBatchNotifications', notification as ExaminationBatchNotification);
    }
    return notification as ExaminationBatchNotification;
  }
};

export default examinationNotificationService;
