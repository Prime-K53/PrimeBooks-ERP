/**
 * Enterprise Cloud-Native Inventory Creation & ID Architecture Refactor Test Suite
 * 
 * Verifies:
 * 1. Backend/Database primary key UUID generation (client IDs are ignored)
 * 2. Strict tenant company_id and created_by lockdown
 * 3. Business SKU uniqueness per tenant with HTTP 409 Conflict
 * 4. Multi-tenant SKU isolation (same SKU allowed across different companies)
 * 5. Concurrent creation safety without lost updates or duplicate IDs
 * 6. Input validation (400 Bad Request for missing name)
 */

const request = require('supertest');

process.env.NODE_ENV = 'test';

let app;
let db;

const TENANT_A = 'tenant-company-alpha';
const TENANT_B = 'tenant-company-beta';
const USER_A = 'user-admin-alpha';

const tenantAHeaders = {
  'x-company-id': TENANT_A,
  'x-user-id': USER_A,
  'x-user-role': 'Admin',
  'Content-Type': 'application/json'
};

const tenantBHeaders = {
  'x-company-id': TENANT_B,
  'x-user-id': 'user-admin-beta',
  'x-user-role': 'Admin',
  'Content-Type': 'application/json'
};

beforeAll(async () => {
  const { db: testDb, initDb } = require('../../db.cjs');
  db = testDb;
  await initDb();
  app = require('../../index.cjs');
  await new Promise(r => setTimeout(r, 300));
});

afterAll(async () => {
  await new Promise((resolve) => {
    db.run('DELETE FROM inventory WHERE company_id IN (?, ?)', [TENANT_A, TENANT_B], resolve);
  });
});

describe('Cloud-Native Inventory Creation Architecture & ID Lockdown', () => {
  test('1. Backend generates UUID primary key and sets tenant metadata (client IDs are ignored)', async () => {
    const payload = {
      id: 'CLIENT-LOCAL-ID-TO-BE-IGNORED',
      name: 'Steel Rod 12mm',
      sku: 'SKU-STEEL-12MM',
      quantity: 150,
      cost_per_unit: 25.5,
      selling_price: 35.0,
      unit: 'kg',
      company_id: 'HACKED-COMPANY-OVERRIDE'
    };

    const res = await request(app)
      .post('/api/inventory')
      .set(tenantAHeaders)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.id).not.toBe('CLIENT-LOCAL-ID-TO-BE-IGNORED');
    // Verify valid UUID format (36 characters with hyphens)
    expect(res.body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(res.body.company_id).toBe(TENANT_A);
    expect(res.body.created_by).toBe(USER_A);
    expect(res.body.name).toBe('Steel Rod 12mm');
    expect(res.body.sku).toBe('SKU-STEEL-12MM');
  });

  test('2. Missing name returns 400 Bad Request', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .set(tenantAHeaders)
      .send({ name: '   ', quantity: 10 });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('3. Duplicate SKU within same tenant returns HTTP 409 Conflict (no overwrites)', async () => {
    const payload1 = {
      name: 'Copper Wire 2mm',
      sku: 'SKU-COPPER-2MM',
      quantity: 50
    };

    const res1 = await request(app)
      .post('/api/inventory')
      .set(tenantAHeaders)
      .send(payload1);

    expect(res1.status).toBe(201);

    // Try creating duplicate SKU in same tenant
    const payload2 = {
      name: 'Copper Wire Duplicate',
      sku: 'SKU-COPPER-2MM',
      quantity: 100
    };

    const res2 = await request(app)
      .post('/api/inventory')
      .set(tenantAHeaders)
      .send(payload2);

    expect(res2.status).toBe(409);
    expect(res2.body).toHaveProperty('error');
    expect(res2.body.code).toBe('SKU_ALREADY_EXISTS');
  });

  test('4. Multi-Tenant SKU Isolation (identical SKU allowed in different tenant)', async () => {
    const payloadTenantB = {
      name: 'Copper Wire Tenant B',
      sku: 'SKU-COPPER-2MM', // Same SKU as Tenant A
      quantity: 200
    };

    const res = await request(app)
      .post('/api/inventory')
      .set(tenantBHeaders)
      .send(payloadTenantB);

    expect(res.status).toBe(201);
    expect(res.body.company_id).toBe(TENANT_B);
    expect(res.body.sku).toBe('SKU-COPPER-2MM');
  });

  test('5. PUT /api/inventory/:id SKU conflict detection & update lockdown', async () => {
    // Create item 1
    const item1 = (await request(app).post('/api/inventory').set(tenantAHeaders).send({ name: 'Item 1', sku: 'SKU-MOD-001' })).body;
    // Create item 2
    const item2 = (await request(app).post('/api/inventory').set(tenantAHeaders).send({ name: 'Item 2', sku: 'SKU-MOD-002' })).body;

    // Try updating item2 SKU to item1 SKU -> expect 409 Conflict
    const updateRes = await request(app)
      .put(`/api/inventory/${item2.id}`)
      .set(tenantAHeaders)
      .send({ sku: 'SKU-MOD-001' });

    expect(updateRes.status).toBe(409);

    // Valid update to item2 name -> expect success
    const validUpdate = await request(app)
      .put(`/api/inventory/${item2.id}`)
      .set(tenantAHeaders)
      .send({ name: 'Item 2 Updated' });

    expect(validUpdate.status).toBe(200);
    expect(validUpdate.body.success).toBe(true);
  });

  test('6. Concurrent Inventory Creation under load (10 parallel requests)', async () => {
    const requests = Array.from({ length: 10 }).map((_, idx) =>
      request(app)
        .post('/api/inventory')
        .set(tenantAHeaders)
        .send({
          name: `Concurrent Item ${idx}`,
          sku: `SKU-CONCURRENT-${idx}-${Date.now()}`,
          quantity: idx * 10
        })
    );

    const responses = await Promise.all(requests);

    const statusCodes = responses.map(r => r.status);
    expect(statusCodes.every(code => code === 201)).toBe(true);

    const generatedIds = responses.map(r => r.body.id);
    const uniqueIds = new Set(generatedIds);
    expect(uniqueIds.size).toBe(10);
  });
});
