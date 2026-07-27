function tenantContext(req, res, next) {
  const rawCompanyId = req.headers['x-company-id'];
  req.companyId = (rawCompanyId && typeof rawCompanyId === 'string' && rawCompanyId.trim()) ? rawCompanyId.trim() : '';

  if (!req.user || !req.user.id) {
    return next();
  }

  // Skip company check for auth endpoints (login, register, etc.)
  if (req.path && (req.path.startsWith('/auth/') || req.path === '/auth')) {
    return next();
  }

  // Skip company membership check for header-based auth (trusted local origins only)
  // and for Supabase auth (tenant isolation handled by Supabase RLS)
  if (req.authMode === 'header' || req.authMode === 'supabase') {
    return next();
  }

  // Require company_id for all authenticated non-auth API requests
  if (!req.companyId) {
    return res.status(400).json({
      error: 'Company context required',
      message: 'x-company-id header is required for authenticated requests'
    });
  }

  try {
    const { db } = require('../db.cjs');
    return db.get('SELECT 1 FROM user_companies WHERE user_id = ? AND company_id = ?', [req.user.id, req.companyId], (err, row) => {
      if (err) {
        return next();
      }
      if (!row) {
        return res.status(403).json({
          error: 'Cross-company access denied',
          message: 'You do not belong to this company'
        });
      }
      next();
    });
  } catch (err) {
    return next();
  }
}

module.exports = { tenantContext };
