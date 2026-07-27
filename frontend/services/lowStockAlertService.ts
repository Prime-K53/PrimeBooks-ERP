import { dbService } from './db';

interface LowStockItem {
  id: string;
  name: string;
  sku?: string;
  stock: number;
  reorderPoint: number;
}

interface AlertConfig {
  enabled: boolean;
  recipients: string[];
  threshold: number;
  lastAlertedAt: string | null;
}

const STORAGE_KEY = 'prime_erp_low_stock_alert_config';
const BACKEND_URL = import.meta.env.VITE_API_URL || 'https://primebooks-erp.onrender.com';

export const getAlertConfig = async (): Promise<AlertConfig> => {
  try {
    const saved = await dbService.getSetting<AlertConfig>(STORAGE_KEY);
    if (saved) return saved;
  } catch {}
  return { enabled: true, recipients: [], threshold: 10, lastAlertedAt: null };
};

export const saveAlertConfig = async (config: AlertConfig) => {
  await dbService.saveSetting(STORAGE_KEY, config);
};

export const checkAndSendLowStockAlerts = async (items: LowStockItem[]) => {
  const config = await getAlertConfig();
  if (!config.enabled || config.recipients.length === 0) return;

  const lowItems = items.filter(i => i.stock <= i.reorderPoint && i.reorderPoint > 0);
  if (lowItems.length === 0) return;

  const lastAlert = config.lastAlertedAt ? new Date(config.lastAlertedAt) : null;
  const now = new Date();
  const cooldownHours = 24;

  if (lastAlert && (now.getTime() - lastAlert.getTime()) < cooldownHours * 3600000) return;

  try {
    await fetch(`${BACKEND_URL}/api/notifications/email/low-stock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: lowItems.map(i => ({ name: i.name, sku: i.sku, stock: i.stock, reorderPoint: i.reorderPoint })),
        recipients: config.recipients,
      }),
    });
    await saveAlertConfig({ ...config, lastAlertedAt: now.toISOString() });
  } catch (err) {
    console.warn('[LowStockAlert] Backend unavailable — alert queued for next attempt');
  }
};
