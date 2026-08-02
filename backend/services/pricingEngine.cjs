/**
 * Backend Pricing Engine
 * Replicates frontend pricing logic for server-side validation
 * 
 * CRITICAL: All pricing calculations MUST go through this engine
 * to ensure consistency between frontend and backend
 */

const { getDatabase } = require('../db.cjs');
const getDb = () => getDatabase();
const { roundToCurrency, calculateMarginAmount } = require('../utils/mathUtils.cjs');

const PRICING_ENGINE_VERSION = "1.0.0";

/**
 * Normalize snapshot entry from various formats
 */
const normalizeSnapshot = (adj) => ({
  name: adj.name || 'Adjustment',
  type: adj.type || (adj.percentage !== undefined ? 'PERCENTAGE' : 'FIXED'),
  value: Number(adj.value) || 0,
  percentage: adj.percentage ?? (adj.type === 'PERCENTAGE' ? adj.value : undefined),
  adjustmentId: adj.adjustmentId,
  adjustmentCategory: adj.adjustmentCategory,
  isActive: adj.isActive !== false
});

/**
 * Normalize array of adjustments
 */
const normalizeAdjustments = (input) => {
  if (!input || !Array.isArray(input)) return [];
  return input.map(normalizeSnapshot);
};

/**
 * Calculate adjustment total from snapshots
 */
const calculateAdjustmentTotal = (snapshots) => {
  return roundToCurrency(
    snapshots.reduce((sum, s) => sum + (s.calculatedAmount || 0), 0)
  );
};

/**
 * Resolve margin from profit margin service
 */
const resolveMargin = async (itemId, categoryId) => {
  return new Promise((resolve) => {
    if (itemId) {
      getDb().get(
        `SELECT margin_value, margin_type, scope FROM profit_margin_settings WHERE scope = 'line_item' AND scope_ref_id = ? AND is_active = 1 AND deleted_at IS NULL`,
        [itemId],
        (err, row) => {
          if (err || row) {
            return resolve({ ...row, source: 'line_item' });
          }
          resolveCategoryMargin(categoryId, resolve);
        }
      );
    } else {
      resolveCategoryMargin(categoryId, resolve);
    }
  });
};

const resolveCategoryMargin = (categoryId, resolve) => {
  if (categoryId) {
    getDb().get(
      `SELECT margin_value, margin_type, scope FROM profit_margin_settings WHERE scope = 'category' AND scope_ref_id = ? AND is_active = 1 AND deleted_at IS NULL`,
      [categoryId],
      (err, row) => {
        if (err || row) {
          return resolve({ ...row, source: 'category' });
        }
        resolveGlobalMargin( resolve);
      }
    );
  } else {
    resolveGlobalMargin( resolve);
  }
};

const resolveGlobalMargin = ( resolve) => {
  getDb().get(
    `SELECT margin_value, margin_type, scope FROM profit_margin_settings WHERE scope = 'global' AND is_active = 1 AND deleted_at IS NULL`,
    [],
    (err, row) => {
      if (err || row) {
        return resolve({ ...row, source: 'global', margin_value: row?.margin_value ?? 0, margin_type: row?.margin_type ?? 'percentage' });
      }
      resolve({ margin_value: 0, margin_type: 'percentage', source: 'system' });
    }
  );
};

/**
 * Resolve volume-based margin if enabled
 */
/**
 * Default volume discount tiers: minPages -> discountPercent
 * Overridable via pricingSettings.volumeDiscountTiers
 */
const DEFAULT_VOLUME_DISCOUNT_TIERS = [
  { minPages: 500, discountPercent: 25 },
  { minPages: 250, discountPercent: 15 },
  { minPages: 180, discountPercent: 10 },
];

/**
 * Resolve volume / run-length discount percentage.
 * Accepts optional custom tiers array; falls back to DEFAULT_VOLUME_DISCOUNT_TIERS.
 * Returns the % to SUBTRACT from the selling price (not the margin to use).
 * Returns 0 when no tier matches (no discount applied).
 */
const resolveVolumeMargin = (pages, margin, customTiers) => {
  const p = Number(pages) || 0;
  const tiers = customTiers && customTiers.length > 0 ? customTiers : DEFAULT_VOLUME_DISCOUNT_TIERS;
  const sorted = [...tiers].sort((a, b) => b.minPages - a.minPages);
  for (const tier of sorted) {
    if (p >= tier.minPages) return tier.discountPercent;
  }
  return 0;
};

/**
 * Normalize snapshots with calculated amounts
 */
const normalizeSnapshots = (rawSnapshots, baseAmount) => {
  if (!rawSnapshots || rawSnapshots.length === 0) return [];

  return rawSnapshots.map(snap => {
    const value = Number(snap.value) || 0;
    const isPct = snap.type === 'PERCENTAGE' || snap.type === 'PERCENT' || snap.type === 'percentage';
    const calculatedAmount = isPct
      ? roundToCurrency(baseAmount * (value / 100))
      : roundToCurrency(value);

    return {
      name: snap.name || 'Adjustment',
      type: isPct ? 'PERCENTAGE' : 'FIXED',
      value,
      percentage: isPct ? value : undefined,
      calculatedAmount,
      adjustmentId: snap.adjustmentId,
      adjustmentCategory: snap.adjustmentCategory,
      isActive: snap.isActive
    };
  });
};

/**
 * Get pricing settings
 */
const getPricingSettings = () => {
  return new Promise((resolve) => {
    getDb().all(
      "SELECT key, value FROM settings WHERE key LIKE 'pricingSettings.%'",
      [],
      (err, rows) => {
        if (err || !rows || !rows.length) {
          return resolve({ enableRounding: true, defaultMethod: 'ALWAYS_UP_50', customStep: 50 });
        }
        const settings = { enableRounding: true, defaultMethod: 'ALWAYS_UP_50', customStep: 50 };
        (rows || []).forEach(row => {
          try {
            const key = row.key.replace('pricingSettings.', '');
            const val = JSON.parse(row.value);
            settings[key] = val;
          } catch {}
        });
        resolve(settings);
      }
    );
  });
};

/**
 * Apply rounding to price
 */
const applyRounding = (price, settings) => {
  if (!settings?.enableRounding) return roundToCurrency(price);

  const method = settings.defaultMethod || 'ALWAYS_UP_50';
  const step = settings.customStep || 50;
  const original = roundToCurrency(price);

  let rounded;
  switch (method) {
    case 'NEAREST_10':
    case 'NEAREST_50':
    case 'NEAREST_100': {
      const stepVal = method === 'NEAREST_10' ? 10 : method === 'NEAREST_50' ? 50 : 100;
      rounded = Math.round(original / stepVal) * stepVal;
      break;
    }
    case 'ALWAYS_UP_10':
    case 'ALWAYS_UP_50':
    case 'ALWAYS_UP_100':
    case 'ALWAYS_UP_500':
    case 'ALWAYS_UP_CUSTOM': {
      const stepVal = method === 'ALWAYS_UP_10' ? 10 : method === 'ALWAYS_UP_50' ? 50 : method === 'ALWAYS_UP_100' ? 100 : method === 'ALWAYS_UP_500' ? 500 : (step || 50);
      rounded = Math.ceil(original / stepVal) * stepVal;
      break;
    }
    case 'PSYCHOLOGICAL': {
      const mag = original >= 1000 ? 1000 : original >= 100 ? 100 : 10;
      rounded = Math.floor(original / mag) * mag + (mag - 1);
      if (rounded < original) rounded += mag;
      break;
    }
    default:
      rounded = original;
  }

  if (rounded < original) {
    const minStep = method.includes('10') ? 10 : method.includes('50') ? 50 : method.includes('100') ? 100 : 50;
    rounded = Math.ceil(original / minStep) * minStep;
  }

  return roundToCurrency(rounded);
};

/**
 * Core pricing calculation - matches frontend calculateSellingPrice
 */
const calculatePriceCore = async (input) => {
  const {
    itemId,
    categoryId,
    baseCost,
    basePrice,
    quantity = 1,
    adjustments,
    context
  } = input;

  const safeCost = roundToCurrency(Number(baseCost) || 0);
  const safeQty = Math.max(1, Math.floor(Number(quantity) || 1));

  // When basePrice is explicitly provided (manually set item price), use it directly
  // without recalculating margins, matching frontend behavior.
  if (basePrice != null && !isNaN(basePrice) && basePrice > 0) {
    const unitPrice = applyRounding(basePrice, await getPricingSettings());
    const totalPrice = roundToCurrency(unitPrice * safeQty);
    const normalizedAdjustments = normalizeSnapshots(adjustments || [], safeCost);
    const adjustmentTotal = calculateAdjustmentTotal(normalizedAdjustments);
    const marginAmount = roundToCurrency(unitPrice - safeCost - adjustmentTotal);
    return {
      unitPrice,
      totalPrice,
      cost: safeCost,
      marginAmount,
      adjustmentSnapshots: normalizedAdjustments,
      adjustmentTotal,
      roundingDifference: 0,
      pricingVersion: PRICING_ENGINE_VERSION
    };
  }

  const initialBase = roundToCurrency(Number(basePrice) || safeCost);

  const normalizedAdjustments = normalizeSnapshots(adjustments || [], initialBase);
  
  let runningCost = safeCost;
  let adjustmentTotal = calculateAdjustmentTotal(normalizedAdjustments);
  let currentSnapshots = [...normalizedAdjustments];

  const margin = await resolveMargin(itemId, categoryId);
  const shouldApply = margin.source !== 'system' || (margin.margin_value ?? 0) > 0;
  
  let marginAmount = 0;
  if (shouldApply) {
    const costAfterAdjustments = runningCost + adjustmentTotal;
    marginAmount = calculateMarginAmount(costAfterAdjustments, margin);
  }

  // Step 1: Pre-discount price = cost + adjustments + margin
  let sellingPrice = runningCost + adjustmentTotal + marginAmount;

  // Step 2: Volume / run-length discount (System B) — % off the selling price, not a margin replacement
  if (context !== 'EXAMINATION' && margin.apply_volume_margins) {
    const pages = input.pages || (input.serviceDetails?.pages) || 0;
    const volumeDiscountPct = resolveVolumeMargin(pages, margin);
    if (volumeDiscountPct > 0) {
      sellingPrice = roundToCurrency(sellingPrice * (1 - volumeDiscountPct / 100));
      // Recalculate effective margin
      marginAmount = roundToCurrency(sellingPrice - (runningCost + adjustmentTotal));
      if (marginAmount < 0) marginAmount = 0;
    }
  }

  const pricingSettings = await getPricingSettings();
  const roundedPrice = applyRounding(sellingPrice, pricingSettings);
  
  const unitPrice = safeQty > 0 ? roundToCurrency(roundedPrice / safeQty) : roundedPrice;
  const totalPrice = roundToCurrency(roundedPrice);
  const cost = roundToCurrency(runningCost * safeQty);

  const finalSnapshots = marginAmount > 0 ? [
    ...currentSnapshots.filter(s => s.name !== 'Profit Margin'),
    {
      name: 'Profit Margin',
      type: margin.margin_type === 'percentage' ? 'PERCENTAGE' : 'FIXED',
      value: margin.margin_value ?? 0,
      percentage: margin.margin_type === 'percentage' ? margin.margin_value : undefined,
      calculatedAmount: marginAmount
    }
  ] : currentSnapshots;

  return {
    unitPrice,
    totalPrice,
    cost,
    costPerUnit: runningCost,
    marginAmount,
    marginSource: margin.source,
    adjustmentTotal: calculateAdjustmentTotal(normalizedAdjustments),
    adjustmentSnapshots: normalizedAdjustments,
    finalSnapshots,
    pricingVersion: PRICING_ENGINE_VERSION
  };
};

/**
 * Main exported function - calculate selling price
 */
const calculateSellingPrice = async (input) => {
  if (!input.context) {
    throw new Error("Pricing context is required");
  }
  if (input.baseCost == null || isNaN(input.baseCost)) {
    throw new Error("Invalid base cost");
  }
  if (input.baseCost < 0) {
    throw new Error("Base cost cannot be negative");
  }

  return calculatePriceCore(input);
};

/**
 * Validate transaction price integrity
 * Throws error if validation fails
 */
const validateTransactionPrice = async (lineItem) => {
  const {
    itemId,
    categoryId,
    cost,
    price,
    quantity = 1,
    adjustmentSnapshots = [],
    adjustmentTotal: declaredTotal = 0,
    pricingVersion
  } = lineItem;

  const serverPricing = await calculateSellingPrice({
    itemId,
    categoryId,
    baseCost: cost,
    basePrice: price,
    quantity,
    adjustments: adjustmentSnapshots,
    context: 'TRANSACTION_VALIDATION'
  });

  const priceDiff = Math.abs(serverPricing.unitPrice - price);
  if (priceDiff > 0.01) {
    console.error("🚨 Pricing mismatch detected", {
      itemId: itemId,
      clientPrice: price,
      serverPrice: serverPricing.unitPrice,
      difference: priceDiff,
      pricingVersion: pricingVersion,
      engineVersion: PRICING_ENGINE_VERSION,
      cost: cost,
      quantity: quantity,
      timestamp: new Date().toISOString()
    });
    throw new Error(`Price mismatch: expected ${serverPricing.unitPrice}, got ${price}. Transaction rejected.`);
  }

  const snapshotTotal = calculateAdjustmentTotal(adjustmentSnapshots);
  const adjDiff = Math.abs(snapshotTotal - declaredTotal);
  if (adjDiff > 0.01) {
    console.error("🚨 Adjustment total mismatch", {
      itemId: itemId,
      clientAdjustmentTotal: declaredTotal,
      calculatedAdjustmentTotal: snapshotTotal,
      difference: adjDiff,
      pricingVersion: pricingVersion,
      snapshots: adjustmentSnapshots
    });
    throw new Error(`Invalid adjustment total: expected ${snapshotTotal}, got ${declaredTotal}.`);
  }

  return { valid: true, serverPrice: serverPricing, engineVersion: PRICING_ENGINE_VERSION };
};

module.exports = {
  PRICING_ENGINE_VERSION,
  calculateSellingPrice,
  calculatePriceCore,
  validateTransactionPrice,
  roundToCurrency,
  resolveMargin
};