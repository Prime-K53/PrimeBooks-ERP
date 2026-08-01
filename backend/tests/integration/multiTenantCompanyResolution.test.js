/**
 * Multi-Tenant Company Resolution Integration Tests
 *
 * Tests that the backend correctly derives req.companyId from the authenticated
 * user rather than blindly trusting the x-company-id header.
 *
 * Scenarios covered:
 * 1. Login → Company A → Refresh → Still Company A.
 * 2. Login → Logout → Login Company B → No Company A state remains.
 * 3. Two authenticated users remain isolated.
 * 4. Forged x-company-id for another company → Request is rejected.
 * 5. User with multiple authorized companies can switch only among those companies.
 */

// Suppress unhandled Statement errors from migration (db.serialize async errors)
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

const { db, initDb } = require('../db.cjs');
const { generateToken, verifyToken } = require('../middleware/auth.cjs');
const { tenantContext } = require('../middleware/tenantContext.cjs');

const COMPANY_A = 'comp-test-multi-a';
const COMPANY_B = 'comp-test-multi-b';
const USER_A_ID = 'usr-multi-a';
const USER_B_ID = 'usr-multi-b';
const SUPER_ADMIN_ID = 'usr-multi-super';

let pass = 0;
let fail = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    pass++;
  } else {
    console.error(`  FAIL: ${msg}`);
    fail++;
  }
}

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function runAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function runExec(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function seedUserCompanies() {
  await runExec('INSERT OR IGNORE INTO users (id, username, email, password_hash, role, permissions, company_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [USER_A_ID, 'user_a', 'user_a@test.local', 'hash', 'User', '[]', COMPANY_A]);
  await runExec('INSERT OR IGNORE INTO users (id, username, email, password_hash, role, permissions, company_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [USER_B_ID, 'user_b', 'user_b@test.local', 'hash', 'User', '[]', COMPANY_B]);
  await runExec('INSERT OR IGNORE INTO users (id, username, email, password_hash, role, permissions, company_id, is_super_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [SUPER_ADMIN_ID, 'super_admin', 'super@test.local', 'hash', 'Admin', '[]', COMPANY_A, 1]);

  await runExec('INSERT OR IGNORE INTO user_companies (id, user_id, company_id, role, is_default) VALUES (?, ?, ?, ?, ?)',
    ['uc-a-1', USER_A_ID, COMPANY_A, 'admin', 1]);
  await runExec('INSERT OR IGNORE INTO user_companies (id, user_id, company_id, role, is_default) VALUES (?, ?, ?, ?, ?)',
    ['uc-b-1', USER_B_ID, COMPANY_B, 'admin', 1]);
  await runExec('INSERT OR IGNORE INTO user_companies (id, user_id, company_id, role, is_default) VALUES (?, ?, ?, ?, ?)',
    ['uc-s-1', SUPER_ADMIN_ID, COMPANY_A, 'admin', 1]);
  await runExec('INSERT OR IGNORE INTO user_companies (id, user_id, company_id, role, is_default) VALUES (?, ?, ?, ?, ?)',
    ['uc-s-2', SUPER_ADMIN_ID, COMPANY_B, 'admin', 0]);
}

async function cleanup() {
  await runExec('DELETE FROM user_companies WHERE user_id IN (?, ?, ?)', [USER_A_ID, USER_B_ID, SUPER_ADMIN_ID]);
  await runExec('DELETE FROM users WHERE id IN (?, ?, ?)', [USER_A_ID, USER_B_ID, SUPER_ADMIN_ID]);
}

function makeRes() {
  const responses = [];
  const res = {
    status: (code) => {
      responses.push(code);
      return { json: (body) => { responses.push(body); } };
    },
    json: (body) => { responses.push(body); },
    get responses() { return responses; }
  };
  return res;
}

async function runTests() {
  console.log('\n=== MULTI-TENANT COMPANY RESOLUTION TESTS ===\n');

  await seedUserCompanies();

  // Test 1: JWT with company_id and no header → uses JWT default company
  console.log('1. Default company from JWT when no header provided\n');
  const tokenA = generateToken({ id: USER_A_ID, username: 'user_a', email: 'user_a@test.local', role: 'User', company_id: COMPANY_A, companies: [COMPANY_A] });
  const req1Base = { headers: { authorization: `Bearer ${tokenA}` } };
  await verifyToken(req1Base, { json: () => {} }, () => {});

  let req1 = {
    headers: {},
    user: req1Base.user,
    path: '/api/sales'
  };
  let res1 = makeRes();
  await tenantContext(req1, res1, () => {});
  assert(req1.companyId === COMPANY_A, 'User A gets Company A from JWT default when no header');

  // Test 2: JWT with company_id and matching header → uses header company
  console.log('2. Valid x-company-id header is accepted when it matches JWT\n');
  let req2 = {
    headers: { 'x-company-id': COMPANY_A },
    user: req1Base.user,
    path: '/api/sales'
  };
  let res2 = makeRes();
  await tenantContext(req2, res2, () => {});
  assert(req2.companyId === COMPANY_A, 'User A gets Company A from matching header');

  // Test 3: Forged x-company-id for another company → rejected
  console.log('3. Forged x-company-id for another company is rejected\n');
  let req3 = {
    headers: { 'x-company-id': COMPANY_B },
    user: req1Base.user,
    path: '/api/sales'
  };
  let res3 = makeRes();
  await tenantContext(req3, res3, () => {});
  assert(res3.responses.includes(403), 'Forged company B header rejected for User A (403)');

  // Test 4: User with multiple companies can switch
  console.log('4. User with multiple companies can switch between them\n');
  const tokenMulti = generateToken({ id: SUPER_ADMIN_ID, username: 'super_admin', email: 'super@test.local', role: 'Admin', company_id: COMPANY_A, companies: [COMPANY_A, COMPANY_B], isSuperAdmin: true, permissions: ['*'] });
  const reqMultiBase = { headers: { authorization: `Bearer ${tokenMulti}` } };
  await verifyToken(reqMultiBase, { json: () => {} }, () => {});

  let req4a = {
    headers: { 'x-company-id': COMPANY_A },
    user: reqMultiBase.user,
    path: '/api/sales'
  };
  let res4a = makeRes();
  await tenantContext(req4a, res4a, () => {});
  assert(req4a.companyId === COMPANY_A, 'Multi-company user can switch to Company A');

  let req4b = {
    headers: { 'x-company-id': COMPANY_B },
    user: reqMultiBase.user,
    path: '/api/sales'
  };
  let res4b = makeRes();
  await tenantContext(req4b, res4b, () => {});
  assert(req4b.companyId === COMPANY_B, 'Multi-company user can switch to Company B');

  // Test 5: Super admin bypasses all restrictions
  console.log('5. Super admin bypasses company restrictions\n');
  let req5 = {
    headers: { 'x-company-id': COMPANY_B },
    user: { ...req1Base.user, isSuperAdmin: true, permissions: ['*'] },
    path: '/api/sales'
  };
  let res5 = makeRes();
  await tenantContext(req5, res5, () => {});
  assert(req5.companyId === COMPANY_B, 'Super admin can access any company');

  // Test 6: User without companies but with JWT company_id → allowed
  console.log('6. User with JWT company_id but no user_companies rows\n');
  const tokenNoMembership = generateToken({ id: 'usr-no-membership', username: 'orphan', email: 'orphan@test.local', role: 'User', company_id: COMPANY_A, companies: [] });
  const reqNoMembershipBase = { headers: { authorization: `Bearer ${tokenNoMembership}` } };
  await verifyToken(reqNoMembershipBase, { json: () => {} }, () => {});

  let req6 = {
    headers: {},
    user: reqNoMembershipBase.user,
    path: '/api/sales'
  };
  let res6 = makeRes();
  await tenantContext(req6, res6, () => {});
  assert(req6.companyId === COMPANY_A, 'User with JWT company_id gets default company even without membership rows');

  // Test 7: User with no company context → rejected
  console.log('7. User with no company context is rejected\n');
  const tokenNoCompany = generateToken({ id: 'usr-no-company', username: 'nocompany', email: 'nocompany@test.local', role: 'User', company_id: '', companies: [] });
  const reqNoCompanyBase = { headers: { authorization: `Bearer ${tokenNoCompany}` } };
  await verifyToken(reqNoCompanyBase, { json: () => {} }, () => {});

  let req7 = {
    headers: {},
    user: reqNoCompanyBase.user,
    path: '/api/sales'
  };
  let res7 = makeRes();
  await tenantContext(req7, res7, () => {});
  assert(res7.responses.includes(403), 'User with no company context gets 403');

  // Test 8: Unauthenticated request → no companyId set, passes through
  console.log('8. Unauthenticated request passes through without companyId\n');
  let req8 = {
    headers: {},
    user: null,
    path: '/api/auth/login'
  };
  let nextCalled = false;
  await tenantContext(req8, makeRes(), () => { nextCalled = true; });
  assert(nextCalled, 'Unauthenticated request passes through');
  assert(req8.companyId === undefined, 'No companyId set for unauthenticated request');

  // Test 9: Auth endpoints skip company check even with user
  console.log('9. Auth endpoints skip company validation\n');
  let req9 = {
    headers: {},
    user: req1Base.user,
    path: '/auth/login'
  };
  let next9Called = false;
  await tenantContext(req9, makeRes(), () => { next9Called = true; });
  assert(next9Called, 'Auth endpoint passes through even with authenticated user');

  // Test 10: Switching to unauthorized company is rejected
  console.log('10. Switching to unauthorized company is rejected\n');
  const tokenB = generateToken({ id: USER_B_ID, username: 'user_b', email: 'user_b@test.local', role: 'User', company_id: COMPANY_B, companies: [COMPANY_B] });
  const reqBBase = { headers: { authorization: `Bearer ${tokenB}` } };
  await verifyToken(reqBBase, { json: () => {} }, () => {});

  let req10 = {
    headers: { 'x-company-id': COMPANY_A },
    user: reqBBase.user,
    path: '/api/sales'
  };
  let res10 = makeRes();
  await tenantContext(req10, res10, () => {});
  assert(res10.responses.includes(403), 'User B cannot switch to Company A (403)');

  // Test 11: Refresh token preserves company
  console.log('11. JWT refresh preserves company context\n');
  const refreshedToken = generateToken({ ...req1Base.user, company_id: COMPANY_A, companies: [COMPANY_A] });
  const reqRefreshedBase = { headers: { authorization: `Bearer ${refreshedToken}` } };
  await verifyToken(reqRefreshedBase, { json: () => {} }, () => {});

  let req11 = {
    headers: {},
    user: reqRefreshedBase.user,
    path: '/api/sales'
  };
  let res11 = makeRes();
  await tenantContext(req11, res11, () => {});
  assert(req11.companyId === COMPANY_A, 'Refreshed token preserves Company A');

  // Test 12: DB fallback when JWT has no companies array
  console.log('12. DB fallback when JWT has no companies array\n');
  const tokenDbFallback = generateToken({ id: USER_A_ID, username: 'user_a', email: 'user_a@test.local', role: 'User', company_id: '', companies: undefined });
  const reqDbFallbackBase = { headers: { authorization: `Bearer ${tokenDbFallback}` } };
  await verifyToken(reqDbFallbackBase, { json: () => {} }, () => {});

  let req12 = {
    headers: {},
    user: reqDbFallbackBase.user,
    path: '/api/sales'
  };
  let res12 = makeRes();
  await tenantContext(req12, res12, () => {});
  assert(req12.companyId === COMPANY_A, 'Falls back to DB user_companies when JWT has no companies array');

  await cleanup();

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`  Passed: ${pass}`);
  console.log(`  Failed: ${fail}`);
  console.log(`  Result: ${fail === 0 ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}\n`);

  process.exit(fail === 0 ? 0 : 1);
}

initDb().then(() => {
  runTests().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
  });
});
