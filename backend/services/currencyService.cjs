/**
 * Currency Management Service
 * Handles multi-currency support and exchange rates
 */
const BaseService = require('./baseService.cjs');

class CurrencyService extends BaseService {
  constructor() {
    super();
    this.defaultCurrency = 'USD';
    this.exchangeRates = new Map();
  }

  /**
   * Get company's default currency
   */
  async getCompanyCurrency(companyId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        "SELECT value FROM settings WHERE key = 'default_currency' AND company_id = ?",
        [companyId],
        (err, row) => {
          if (err) return reject(err);
          resolve(row?.value || this.defaultCurrency);
        }
      );
    });
  }

  /**
   * Get exchange rate between two currencies
   */
  async getExchangeRate(fromCurrency, toCurrency, date = null, companyId = null) {
    const cid = String(companyId || '').trim();
    const cacheKey = `${cid || 'global'}:${fromCurrency}_${toCurrency}_${date || 'latest'}`;
    
    // Check cache first
    if (this.exchangeRates.has(cacheKey)) {
      return this.exchangeRates.get(cacheKey);
    }

    return new Promise((resolve, reject) => {
      let query = `
        SELECT rate FROM exchange_rates 
        WHERE from_currency = ? AND to_currency = ?
      `;
      const params = [fromCurrency, toCurrency];

      if (date) {
        query += ' AND date <= ? ORDER BY date DESC LIMIT 1';
        params.push(date);
      } else {
        query += ' ORDER BY date DESC LIMIT 1';
      }

      this.db.get(query, params, (err, row) => {
        if (err) return reject(err);
        
        const rate = row ? Number(row.rate) : 1;
        
        // Cache the rate
        this.exchangeRates.set(cacheKey, rate);
        
        resolve(rate);
      });
    });
  }

  /**
   * Convert amount from one currency to another
   */
  async convert(amount, fromCurrency, toCurrency, date = null) {
    if (fromCurrency === toCurrency) {
      return Number(amount);
    }

    const rate = await this.getExchangeRate(fromCurrency, toCurrency, date);
    return Number((Number(amount) * rate).toFixed(2));
  }

  /**
   * Update exchange rate
   */
  async updateExchangeRate(fromCurrency, toCurrency, rate, date = null, companyId = null) {
    const rateDate = date || new Date().toISOString().split('T')[0];
    const cid = String(companyId || '').trim();
    const cacheKey = `${cid || 'global'}:${fromCurrency}_${toCurrency}_${rateDate || 'latest'}`;
    
    const svc = this;
    return new Promise((resolve, reject) => {
      svc.db.run(
        `INSERT INTO exchange_rates (from_currency, to_currency, rate, date)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(from_currency, to_currency, date) 
         DO UPDATE SET rate = excluded.rate`,
        [fromCurrency, toCurrency, rate, rateDate],
        function (err) {
          if (err) return reject(err);
          svc.exchangeRates.delete(cacheKey);
          resolve({ fromCurrency, toCurrency, rate, date: rateDate });
        }
      );
    });
  }

  /**
   * Get all supported currencies
   */
  async getCurrencies() {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM currencies WHERE is_active = 1 ORDER BY code',
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        }
      );
    });
  }

  /**
   * Add a new currency
   */
  async addCurrency(code, name, symbol, decimalPlaces = 2) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO currencies (code, name, symbol, decimal_places, is_active)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(code) DO UPDATE SET 
         name = excluded.name, symbol = excluded.symbol, 
         decimal_places = excluded.decimal_places`,
        [code, name, symbol, decimalPlaces],
        function (err) {
          if (err) return reject(err);
          resolve({ code, name, symbol, decimalPlaces });
        }
      );
    });
  }

  /**
   * Format amount in currency
   */
  formatAmount(amount, currencyCode, locale = 'en-US') {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(amount);
    } catch (e) {
      // Fallback if currency code is invalid
      return `${currencyCode} ${Number(amount).toFixed(2)}`;
    }
  }

  /**
   * Parse currency string to number
   */
  parseCurrency(currencyString) {
    // Remove currency symbols and commas
    const cleaned = currencyString.replace(/[^0-9.-]/g, '');
    return Number(cleaned);
  }
}

module.exports = CurrencyService;