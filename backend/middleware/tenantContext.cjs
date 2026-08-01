async function getUserCompanies(userId) {
  try {
    const { db } = require('../db.cjs');
    return new Promise((resolve) => {
      db.all('SELECT company_id, is_default FROM user_companies WHERE user_id = ?', [userId], (err, rows) => {
        if (err) return resolve(null);
        resolve(rows || []);
      });
    });
  } catch {
    return null;
  }
}

function isSuperAdmin(user) {
  return Boolean(user?.isSuperAdmin || (Array.isArray(user?.permissions) && user.permissions.includes('*')));
}

async function tenantContext(req, res, next) {
  try {
    const rawCompanyId = req.headers['x-company-id'];
    const requestedCompanyId = (rawCompanyId && typeof rawCompanyId === 'string' && rawCompanyId.trim()) ? rawCompanyId.trim() : '';

    if (!req.user || !req.user.id) {
      return next();
    }

    // Portal requests authenticate via portal JWTs and carry their own
    // company_id on req.portalUser. Skip the admin tenant check for them.
    if (req.portalUser) {
      return next();
    }

    // Skip company check for auth endpoints (login, register, etc.)
    if (req.path && (req.path.startsWith('/auth/') || req.path === '/auth')) {
      return next();
    }

    // Super admins bypass all company restrictions
    if (isSuperAdmin(req.user)) {
      req.companyId = requestedCompanyId || req.user.company_id || '';
      return next();
    }

    // Determine allowed companies from JWT or DB
    const jwtCompanies = Array.isArray(req.user.companies) ? req.user.companies : [];
    const jwtDefaultCompany = req.user.company_id || '';
    let allowedCompanies = jwtCompanies;

    if (allowedCompanies.length === 0 && req.user.id) {
      const dbCompanies = await getUserCompanies(req.user.id);
      if (dbCompanies && dbCompanies.length > 0) {
        allowedCompanies = dbCompanies.map(c => c.company_id);
      }
    }

    // If no allowed companies found, use JWT default or reject
    if (allowedCompanies.length === 0) {
      if (jwtDefaultCompany) {
        allowedCompanies = [jwtDefaultCompany];
      } else {
        return res.status(403).json({
          error: 'No company access',
          message: 'You do not belong to any company'
        });
      }
    }

    // Determine the final company ID to use
    let finalCompanyId = '';
    if (requestedCompanyId) {
      // Validate requested company against allowed companies
      if (!allowedCompanies.includes(requestedCompanyId)) {
        return res.status(403).json({
          error: 'Cross-company access denied',
          message: 'You do not have access to the requested company'
        });
      }
      finalCompanyId = requestedCompanyId;
    } else {
      // Use default company from JWT or first allowed company
      finalCompanyId = jwtDefaultCompany && allowedCompanies.includes(jwtDefaultCompany) ? jwtDefaultCompany : allowedCompanies[0];
    }

    req.companyId = finalCompanyId;
    next();
  } catch (err) {
    console.error('[tenantContext] Error:', err);
    res.status(500).json({ error: 'Failed to resolve company context' });
  }
}

module.exports = { tenantContext };
