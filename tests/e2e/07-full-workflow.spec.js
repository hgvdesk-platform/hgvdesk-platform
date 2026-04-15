const { test, expect } = require('@playwright/test');
const { BASE, TEST_VEHICLE, TEST_CUSTOMER, TEST_PART, apiHeaders } = require('../fixtures/test-data');

test.describe('Full Workflow: Job → Inspection → Parts → Invoice', () => {
  let jobId, inspId, partId, invoiceId;

  test('Step 1: Create workshop job', async ({ request }) => {
    const res = await request.post(`${BASE}/api/jobs`, {
      headers: apiHeaders(),
      data: {
        vehicleReg: 'WF71 E2E',
        inspectionType: 'T50',
        customerName: TEST_CUSTOMER.name,
        technicianName: 'E2E Technician',
        priority: 'high',
        notes: 'Full workflow E2E test',
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    jobId = (body.data ? body.data.job : body.job).id;
    expect(jobId).toBeTruthy();
  });

  test('Step 2: Send job to inspection floor', async ({ request }) => {
    const res = await request.post(`${BASE}/api/jobs/${jobId}/send`, {
      headers: apiHeaders(),
      data: { targets: ['inspect', 'parts'] },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.sent).toBe(true);
  });

  test('Step 3: Create part for the job', async ({ request }) => {
    const res = await request.post(`${BASE}/api/parts`, {
      headers: apiHeaders(),
      data: {
        name: TEST_PART.name,
        vehicleReg: 'WF71 E2E',
        category: 'Filters',
        priority: 'normal',
        qty: 1,
        unitCost: parseFloat(TEST_PART.cost),
        jobId: jobId,
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    partId = (body.data ? body.data.part : body.part).id;
  });

  test('Step 4: Complete inspection with defect + rectification', async ({ request }) => {
    const res = await request.post(`${BASE}/api/inspections`, {
      headers: apiHeaders(),
      data: {
        vehicleReg: 'WF71 E2E',
        inspectionType: 'T50',
        inspectorName: 'E2E Inspector',
        status: 'complete',
        jobId: jobId,
        checkItems: {
          Horn_operation: 'pass',
          Body_panels: 'pass',
          Service_brake: 'pass',
          Steering_play: 'adv',
        },
        brakeTestData: { sbe: 58, pbe: 19, axles: { steer: { ns: 12, os: 11.5, imb: 4, pass: true } } },
        tyreData: { t0_0: { depth: '5.5', condition: 'ok' } },
        defects: [{
          severity: 'advisory',
          description: 'Steering play slightly above normal — monitor at next PMI',
          title: 'Steering play',
          resolved: false,
        }],
        nilDefect: false,
        notes: 'E2E workflow inspection',
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const insp = body.data ? body.data.inspection : body.inspection;
    expect(insp.result).toBe('advisory');
    inspId = insp.id;
  });

  test('Step 5: Verify job was updated by inspection', async ({ request }) => {
    const res = await request.get(`${BASE}/api/jobs/${jobId}`, { headers: apiHeaders() });
    const body = await res.json();
    const job = body.data ? body.data.job : body.job;
    expect(job.inspect_sent).toBe(true);
  });

  test('Step 6: Generate invoice from job', async ({ request }) => {
    const res = await request.post(`${BASE}/api/invoices/generate-from-job`, {
      headers: apiHeaders(),
      data: { jobId: jobId },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const inv = body.data || body;
    expect(inv.invoiceNumber).toMatch(/^INV-/);
    invoiceId = inv.invoice.id;
  });

  test('Step 7: Verify invoice has correct data', async ({ request }) => {
    const res = await request.get(`${BASE}/api/invoices/${invoiceId}`, { headers: apiHeaders() });
    const body = await res.json();
    const inv = body.data ? body.data.invoice : body.invoice;
    const lines = body.data ? body.data.lines : body.lines;
    expect(inv.vehicle_reg).toBe('WF71 E2E');
    expect(inv.customer_name).toBe(TEST_CUSTOMER.name);
    expect(parseFloat(inv.total)).toBeGreaterThan(0);
    expect(lines.length).toBeGreaterThan(0);
  });

  test('Step 8: Cleanup — delete test data', async ({ request }) => {
    if (invoiceId) await request.delete(`${BASE}/api/invoices/${invoiceId}`, { headers: apiHeaders() });
    if (partId) await request.delete(`${BASE}/api/parts/${partId}`, { headers: apiHeaders() });
    if (inspId) await request.delete(`${BASE}/api/inspections/${inspId}`, { headers: apiHeaders() });
    if (jobId) await request.delete(`${BASE}/api/jobs/${jobId}`, { headers: apiHeaders() });
  });
});
