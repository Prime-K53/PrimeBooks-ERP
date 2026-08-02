const express = require('express');
const router = express.Router();
const metaWhatsApp = require('../services/metaWhatsappService.cjs');
const { db } = require('../db.cjs');

function loadConfig() {
  return new Promise((resolve) => {
    db.get(
      'SELECT value FROM settings WHERE key = ?',
      ['meta_whatsapp_config'],
      (err, row) => {
        if (err || !row) return resolve(false);
        try {
          const config = JSON.parse(row.value);
          metaWhatsApp.setConfig(config.phoneNumberId, config.accessToken);
          resolve(true);
        } catch {
          resolve(false);
        }
      }
    );
  });
}

function saveConfig( phoneNumberId, accessToken) {
  return new Promise((resolve, reject) => {
    const value = JSON.stringify({ phoneNumberId, accessToken });
    db.run(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ? )',
      ['meta_whatsapp_config', value],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

router.get('/status', async (req, res) => {
  await loadConfig();
  res.json(metaWhatsApp.getStatus());
});

router.post('/config', async (req, res) => {
  const { phoneNumberId, accessToken } = req.body;
  if (!phoneNumberId || !accessToken) {
    return res.status(400).json({ success: false, error: 'Phone Number ID and Access Token are required' });
  }
  try {
    metaWhatsApp.setConfig(phoneNumberId, accessToken);
    const valid = await metaWhatsApp.verifyCredentials();
    if (!valid) {
      return res.status(400).json({ success: false, error: 'Invalid credentials — could not verify with Meta' });
    }
    await saveConfig(phoneNumberId, accessToken);
    res.json({ success: true, status: metaWhatsApp.getStatus() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/send', async (req, res) => {
  try {
    await loadConfig();
    const { to, message } = req.body;
    if (!to || !message) {
      return res.status(400).json({ success: false, error: 'Missing "to" or "message" fields' });
    }
    const result = await metaWhatsApp.sendMessage(to, message);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/config', async (req, res) => {
  await loadConfig();
  res.json({
    configured: metaWhatsApp.configured,
    phoneNumberId: metaWhatsApp.phoneNumberId || null,
  });
});

module.exports = router;
