const express = require('express')
const router = express.Router()
const { db } = require('../db.cjs')

function parseJson(value) {
  if (!value || value === 'null' || value === 'undefined') return null
  try { return JSON.parse(value) } catch { return value }
}

function withDb(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err)
      else resolve(rows || [])
    })
  })
}

function getOne(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err)
      else resolve(row || null)
    })
  })
}

function runQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err)
      else resolve({ id: this.lastID, changes: this.changes })
    })
  })
}

// ─── Membership Tiers ───
router.get('/tiers', async (req, res) => {
  try {
    const rows = await withDb('SELECT * FROM engagement_membership_tiers ORDER BY level ASC', [])
    res.json(rows.map(r => ({ ...r, benefits: parseJson(r.benefits_json) })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/tiers', async (req, res) => {
  try {
    const { id, name, level, description, color, icon, minSpend, entrySpend, minFrequency, minClv, pointMultiplier, cashbackRate, prioritySupport, exclusivePricing, exclusiveCampaigns, freeShipping, birthdayReward, annualReward, benefits, status } = req.body
    await runQuery(
      `INSERT INTO engagement_membership_tiers (id, name, level, description, color, icon, min_spend, entry_spend, min_frequency, min_clv, point_multiplier, cashback_rate, priority_support, exclusive_pricing, exclusive_campaigns, free_shipping, birthday_reward, annual_reward, benefits_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? )`,
      [id || `T${Date.now()}`, name, level || 0, description || null, color || null, icon || null, minSpend || 0, entrySpend || 0, minFrequency || 0, minClv || 0, pointMultiplier || 1, cashbackRate || 0, prioritySupport ? 1 : 0, exclusivePricing ? 1 : 0, exclusiveCampaigns ? 1 : 0, freeShipping ? 1 : 0, birthdayReward || 0, annualReward || 0, benefits ? JSON.stringify(benefits) : null, status || 'active']
    )
    res.status(201).json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/tiers/:id', async (req, res) => {
  try {
    const { name, level, description, color, icon, minSpend, entrySpend, minFrequency, minClv, pointMultiplier, cashbackRate, prioritySupport, exclusivePricing, exclusiveCampaigns, freeShipping, birthdayReward, annualReward, benefits, status } = req.body
    await runQuery(
      `UPDATE engagement_membership_tiers SET name=?, level=?, description=?, color=?, icon=?, min_spend=?, entry_spend=?, min_frequency=?, min_clv=?, point_multiplier=?, cashback_rate=?, priority_support=?, exclusive_pricing=?, exclusive_campaigns=?, free_shipping=?, birthday_reward=?, annual_reward=?, benefits_json=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [name, level, description, color, icon, minSpend, entrySpend, minFrequency, minClv, pointMultiplier, cashbackRate, prioritySupport ? 1 : 0, exclusivePricing ? 1 : 0, exclusiveCampaigns ? 1 : 0, freeShipping ? 1 : 0, birthdayReward, annualReward, benefits ? JSON.stringify(benefits) : null, status, req.params.id]
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/tiers/:id', async (req, res) => {
  try {
    await runQuery('DELETE FROM engagement_membership_tiers WHERE id=?', [req.params.id])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Gift Cards ───
router.get('/gift-cards', async (req, res) => {
  try {
    const rows = await withDb('SELECT * FROM engagement_gift_cards ORDER BY created_at DESC', [])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/gift-cards', async (req, res) => {
  try {
    const { id, code, pin, customerId, issuerId, initialBalance, type, expiresAt, rechargeable, transferable, designColor, giftMessage, purchasedWith } = req.body
    await runQuery(
      `INSERT INTO engagement_gift_cards (id, code, pin, customer_id, issuer_id, initial_balance, current_balance, type, expires_at, rechargeable, transferable, design_color, gift_message, purchased_with)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? )`,
      [id || `GC${Date.now()}`, code, pin || null, customerId || null, issuerId || null, initialBalance || 0, initialBalance || 0, type || 'digital', expiresAt || null, rechargeable ? 1 : 0, transferable ? 1 : 0, designColor || null, giftMessage || null, purchasedWith || null]
    )
    res.status(201).json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/gift-cards/:id', async (req, res) => {
  try {
    const { currentBalance, status, pin, cancelReason } = req.body
    await runQuery(
      `UPDATE engagement_gift_cards SET current_balance=?, status=?, pin=COALESCE(?, pin), cancel_reason=COALESCE(?, cancel_reason), updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [currentBalance, status, pin, cancelReason, req.params.id]
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Promotions ───
router.get('/promotions', async (req, res) => {
  try {
    const rows = await withDb('SELECT * FROM engagement_promotions ORDER BY created_at DESC', [])
    res.json(rows.map(r => ({ ...r, bundleItems: parseJson(r.bundle_items_json), customerIds: parseJson(r.customer_ids_json), tierIds: parseJson(r.tier_ids_json) })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/promotions', async (req, res) => {
  try {
    const { id, name, description, type, value, categoryId, brand, bundleItems, buyXQty, getYQty, getYDiscount, minPurchase, maxDiscount, maxUses, customerIds, tierIds, campaignId, stackingRule, priority, startsAt, expiresAt, status, createdBy } = req.body
    await runQuery(
      `INSERT INTO engagement_promotions (id, name, description, type, value, category_id, brand, bundle_items_json, buy_x_qty, get_y_qty, get_y_discount, min_purchase, max_discount, max_uses, customer_ids_json, tier_ids_json, campaign_id, stacking_rule, priority, starts_at, expires_at, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? )`,
      [id || `PROMO${Date.now()}`, name, description || null, type, value || 0, categoryId || null, brand || null, bundleItems ? JSON.stringify(bundleItems) : null, buyXQty || 0, getYQty || 0, getYDiscount || 0, minPurchase || 0, maxDiscount || 0, maxUses || 0, customerIds ? JSON.stringify(customerIds) : null, tierIds ? JSON.stringify(tierIds) : null, campaignId || null, stackingRule || 'best_only', priority || 0, startsAt || new Date().toISOString(), expiresAt || null, status || 'active', createdBy || req.user?.id || 'system']
    )
    res.status(201).json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/promotions/:id', async (req, res) => {
  try {
    const { name, description, type, value, categoryId, brand, bundleItems, buyXQty, getYQty, getYDiscount, minPurchase, maxDiscount, maxUses, customerIds, tierIds, stackingRule, priority, startsAt, expiresAt, status } = req.body
    await runQuery(
      `UPDATE engagement_promotions SET name=?, description=?, type=?, value=?, category_id=?, brand=?, bundle_items_json=?, buy_x_qty=?, get_y_qty=?, get_y_discount=?, min_purchase=?, max_discount=?, max_uses=?, customer_ids_json=?, tier_ids_json=?, stacking_rule=?, priority=?, starts_at=?, expires_at=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [name, description, type, value, categoryId, brand, bundleItems ? JSON.stringify(bundleItems) : null, buyXQty, getYQty, getYDiscount, minPurchase, maxDiscount, maxUses, customerIds ? JSON.stringify(customerIds) : null, tierIds ? JSON.stringify(tierIds) : null, stackingRule, priority, startsAt, expiresAt, status, req.params.id]
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/promotions/:id', async (req, res) => {
  try {
    await runQuery('DELETE FROM engagement_promotions WHERE id=?', [req.params.id])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Cashback ───
router.get('/cashback', async (req, res) => {
  try {
    const rows = await withDb('SELECT * FROM engagement_cashback ORDER BY created_at DESC', [])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/cashback/:id/approve', async (req, res) => {
  try {
    const entry = await getOne('SELECT * FROM engagement_cashback WHERE id=?', [req.params.id])
    if (!entry) return res.status(404).json({ error: 'Cashback entry not found' })
    await runQuery(
      `UPDATE engagement_cashback SET status='approved', approved_at=CURRENT_TIMESTAMP, approved_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [req.user?.id || 'system', req.params.id]
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/cashback/:id/pay', async (req, res) => {
  try {
    const { walletTxId } = req.body
    await runQuery(
      `UPDATE engagement_cashback SET status='paid', wallet_tx_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [walletTxId || null, req.params.id]
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Points ───
router.get('/points', async (req, res) => {
  try {
    const { customerId } = req.query
    let query = 'SELECT * FROM engagement_points'
    const params = []
    if (customerId) { query += ' WHERE customer_id = ?'; params.push(customerId) }
    const rows = await withDb(query + ' ORDER BY created_at DESC', params)
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/point-balances', async (req, res) => {
  try {
    const { customerId } = req.query
    let query = 'SELECT * FROM engagement_point_balances'
    const params = []
    if (customerId) { query += ' WHERE customer_id = ?'; params.push(customerId) }
    const rows = await withDb(query, params)
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Customer Tiers ───
router.get('/customer-tiers', async (req, res) => {
  try {
    const rows = await withDb('SELECT * FROM engagement_customer_tiers', [])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Affiliates ───
router.get('/affiliates', async (req, res) => {
  try {
    const rows = await withDb('SELECT * FROM engagement_affiliates', [])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/affiliate-commissions', async (req, res) => {
  try {
    const rows = await withDb('SELECT * FROM engagement_affiliate_commissions ORDER BY created_at DESC', [])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Rewards ───
router.get('/rewards', async (req, res) => {
  try {
    const rows = await withDb('SELECT * FROM engagement_customer_rewards ORDER BY created_at DESC', [])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Timeline ───
router.get('/timeline', async (req, res) => {
  try {
    const { customerId } = req.query
    let query = 'SELECT * FROM engagement_timeline'
    const params = []
    if (customerId) { query += ' WHERE customer_id = ?'; params.push(customerId) }
    const rows = await withDb(query + ' ORDER BY timestamp DESC LIMIT 200', params)
    res.json(rows.map(r => ({ ...r, metadata: parseJson(r.metadata_json) })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Audit ───
router.get('/audit', async (req, res) => {
  try {
    const rows = await withDb('SELECT * FROM engagement_audit ORDER BY timestamp DESC LIMIT 200', [])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Analytics ───
router.get('/analytics', async (req, res) => {
  try {
    const { period, periodStart, periodEnd } = req.query
    let query = 'SELECT * FROM engagement_analytics'
    const params = []
    if (period) { query += ' AND period = ?'; params.push(period) }
    if (periodStart) { query += ' AND period_start >= ?'; params.push(periodStart) }
    if (periodEnd) { query += ' AND period_end <= ?'; params.push(periodEnd) }
    const rows = await withDb(query + ' ORDER BY generated_at DESC LIMIT 1', params)
    res.json(rows.map(r => ({ ...r, ...parseJson(r.data_json), id: r.id, period: r.period, periodStart: r.period_start, periodEnd: r.period_end, generatedAt: r.generated_at })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Settings ───
router.get('/settings', async (req, res) => {
  try {
    const row = await getOne('SELECT value FROM settings WHERE key=?', ['engagementSettings'])
    res.json(row ? parseJson(row.value) : null)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/settings', async (req, res) => {
  try {
    const value = JSON.stringify(req.body)
    await runQuery(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ? , CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`,
      ['engagementSettings', value]
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router