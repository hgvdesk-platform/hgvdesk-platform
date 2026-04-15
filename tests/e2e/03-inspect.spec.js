const { test, expect } = require('@playwright/test');
const { BASE, TEST_VEHICLE, apiHeaders } = require('../fixtures/test-data');

let createdInspId;

test.describe('Inspections', () => {
  test('create an inspection', async ({ request }) => {
    const res = await request.post(`${BASE}/api/inspections`, {
      headers: apiHeaders(),
      data: {
        vehicleReg: TEST_VEHICLE.reg,
        inspectionType: 'T50',
        inspectorName: 'Test Inspector',
        status: 'complete',
        checkItems: {
          Horn_operation_and_effectiveness: 'pass',
          Body_panels_secure_no_damage: 'pass',
          Service_brake_operation: 'pass',
          Parking_brake_operation_and_efficiency: 'pass',
        },
        brakeTestData: { sbe: 62, pbe: 22, axles: {} },
        tyreData: { t0_0: { depth: '6.2', condition: 'ok' }, t0_1: { depth: '5.8', condition: 'ok' } },
        defects: [],
        nilDefect: true,
        notes: 'E2E test inspection — nil defect',
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const insp = body.data ? body.data.inspection : body.inspection;
    expect(insp).toBeTruthy();
    expect(insp.result).toBe('pass');
    createdInspId = insp.id;
  });

  test('create inspection with defect → result is fail', async ({ request }) => {
    const res = await request.post(`${BASE}/api/inspections`, {
      headers: apiHeaders(),
      data: {
        vehicleReg: 'FAIL TEST',
        inspectionType: 'T50',
        inspectorName: 'Test Inspector',
        status: 'complete',
        checkItems: { Horn: 'pass' },
        brakeTestData: { sbe: 55, pbe: 18 },
        tyreData: {},
        defects: [{ severity: 'critical', description: 'NS front disc below min', title: 'Brake disc worn' }],
        nilDefect: false,
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const insp = body.data ? body.data.inspection : body.inspection;
    expect(insp.result).toBe('fail');
  });

  test('create inspection with rectified defect → result is pass', async ({ request }) => {
    const res = await request.post(`${BASE}/api/inspections`, {
      headers: apiHeaders(),
      data: {
        vehicleReg: 'RECT TEST',
        inspectionType: 'T50',
        inspectorName: 'Test Inspector',
        status: 'complete',
        checkItems: { Horn: 'pass' },
        brakeTestData: { sbe: 55, pbe: 18 },
        tyreData: {},
        defects: [{ severity: 'critical', description: 'Repaired', title: 'Fixed', resolved: true, resolvedBy: 'Tech' }],
        nilDefect: false,
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const insp = body.data ? body.data.inspection : body.inspection;
    expect(insp.result).toBe('pass');
  });

  test('list inspections returns results', async ({ request }) => {
    const res = await request.get(`${BASE}/api/inspections`, { headers: apiHeaders() });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const list = body.data ? body.data.inspections : body.inspections;
    expect(list.length).toBeGreaterThan(0);
  });

  test('inspect page loads', async ({ page }) => {
    await page.goto('/inspect');
    await page.waitForLoadState('networkidle');
    expect(await page.title()).toContain('Inspect');
  });
});
