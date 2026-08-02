const express = require('express');
const router = express.Router();
const workspaceService = require('../services/workspaceService.cjs');
const { resetDatabase } = require('../db.cjs');
const { sendSafeError } = require('../utils/errors.cjs');
const { validateBody, workspaceSchemas } = require('../middleware/validation.cjs');

router.post('/workspace/initialize', validateBody(workspaceSchemas.initialize), async (req, res) => {
  try {
    const { companyName } = req.body;
    const config = await workspaceService.initializeWorkspace(companyName || 'Prime ERP');
    res.json(config);
  } catch (err) {
    console.error('[System] Workspace initialization failed:', err);
    sendSafeError(res, 500, 'INTERNAL_ERROR');
  }
});

router.post('/workspace/sync', validateBody(workspaceSchemas.sync), async (req, res) => {
  try {
    const { filename, data } = req.body;
    const path = await workspaceService.saveToWorkspace('Sync', filename, data);
    res.json({ success: true, path });
  } catch (err) {
    console.error('[System] Workspace sync failed:', err);
    sendSafeError(res, 500, 'INTERNAL_ERROR');
  }
});

router.post('/workspace/save-document', validateBody(workspaceSchemas.saveDocument), async (req, res) => {
  try {
    const { folder, filename, data } = req.body; 
    const path = await workspaceService.saveToWorkspace(folder || 'Documents', filename, data);
    res.json({ success: true, path });
  } catch (err) {
    console.error('[System] Save document failed:', err);
    sendSafeError(res, 500, 'INTERNAL_ERROR');
  }
});

/**
 * Get the current workspace configuration.
 */
router.get('/workspace/config', (req, res) => {
  const config = workspaceService.getWorkspaceConfig();
  res.json(config || { initialized: false });
});

/**
 * Delete all data for the current organization (local SQLite).
 * Resets the database entirely since the local backend is single-tenant.
 */
router.delete('/workspace', async (req, res) => {
  try {
    resetDatabase();
    res.json({ success: true, message: 'All data has been wiped from the local database.' });
  } catch (err) {
    console.error('[System] Failed to reset database:', err);
    sendSafeError(res, 500, 'DATABASE_RESET_FAILED');
  }
});

module.exports = router;
