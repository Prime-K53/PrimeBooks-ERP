const express = require('express');
const router = express.Router();
const { db } = require('../db.cjs');
const { sendSafeError } = require('../utils/errors.cjs');

router.get('/', (req, res) => {
  try {
    const assets = db.prepare('SELECT * FROM assets ORDER BY created_at DESC').all();
    res.json(assets);
  } catch (err) {
    console.error('[Assets] List error:', err);
    sendSafeError(res, 500, 'INTERNAL_ERROR');
  }
});

router.get('/:id', (req, res) => {
  try {
    const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    res.json(asset);
  } catch (err) {
    console.error('[Assets] Get error:', err);
    sendSafeError(res, 500, 'INTERNAL_ERROR');
  }
});

router.post('/', (req, res) => {
  try {
    const { name, asset_type, serial_number, model, manufacturer, purchase_date, purchase_cost, current_value, useful_life_years, status, location, assigned_to, notes, warranty_expiry } = req.body;
    if (!name || !asset_type) return res.status(400).json({ error: 'Name and asset_type are required' });
    const id = `AST-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO assets (id, name, asset_type, serial_number, model, manufacturer, purchase_date, purchase_cost, current_value, useful_life_years, status, location, assigned_to, notes, warranty_expiry, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? , ?, ?)`).run(
      id, name, asset_type, serial_number || null, model || null, manufacturer || null,
      purchase_date || null, purchase_cost || 0, current_value || purchase_cost || 0,
      useful_life_years || 5, status || 'active', location || null, assigned_to || null,
      notes || null, warranty_expiry || null, now, now
    );
    const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
    res.status(201).json(asset);
  } catch (err) {
    console.error('[Assets] Create error:', err);
    sendSafeError(res, 500, 'INTERNAL_ERROR');
  }
});

router.put('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Asset not found' });
    const fields = ['name', 'asset_type', 'serial_number', 'model', 'manufacturer', 'purchase_date', 'purchase_cost', 'current_value', 'useful_life_years', 'status', 'location', 'assigned_to', 'notes', 'warranty_expiry', 'last_maintenance', 'next_maintenance'];
    const updates = [];
    const values = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
    }
    if (updates.length === 0) return res.json(existing);
    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(req.params.id);
    values.push();
    db.prepare(`UPDATE assets SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
    res.json(asset);
  } catch (err) {
    console.error('[Assets] Update error:', err);
    sendSafeError(res, 500, 'INTERNAL_ERROR');
  }
});

router.delete('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Asset not found' });
    db.prepare('DELETE FROM assets WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[Assets] Delete error:', err);
    sendSafeError(res, 500, 'INTERNAL_ERROR');
  }
});

module.exports = router;
