const { test, expect } = require('@playwright/test');
const { BASE, TEST_VEHICLE, TEST_PART, apiHeaders } = require('../fixtures/test-data');

let createdPartId;

test.describe('Parts', () => {
  test('create a part', async ({ request }) => {
    const res = await request.post(`${BASE}/api/parts`, {
      headers: apiHeaders(),
      data: {
        name: TEST_PART.name,
        vehicleReg: TEST_VEHICLE.reg,
        category: 'Filters',
        priority: 'normal',
        qty: parseInt(TEST_PART.quantity),
        unitCost: parseFloat(TEST_PART.cost),
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const part = body.data ? body.data.part : body.part;
    expect(part).toBeTruthy();
    expect(part.name).toBe(TEST_PART.name);
    createdPartId = part.id;
  });

  test('list parts includes created part', async ({ request }) => {
    const res = await request.get(`${BASE}/api/parts`, { headers: apiHeaders() });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const parts = body.data ? body.data.parts : body.parts;
    expect(parts.some(p => p.id === createdPartId)).toBeTruthy();
  });

  test('update part status to ordered', async ({ request }) => {
    const res = await request.put(`${BASE}/api/parts/${createdPartId}`, {
      headers: apiHeaders(),
      data: { status: 'ordered' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const part = body.data ? body.data.part : body.part;
    expect(part.status).toBe('ordered');
  });

  test('update part status to ready', async ({ request }) => {
    const res = await request.put(`${BASE}/api/parts/${createdPartId}`, {
      headers: apiHeaders(),
      data: { status: 'ready' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('parts page loads', async ({ page }) => {
    await page.goto('/parts');
    await page.waitForLoadState('networkidle');
    expect(await page.title()).toContain('Parts');
  });
});
