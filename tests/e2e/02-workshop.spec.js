const { test, expect } = require('@playwright/test');
const { BASE, TEST_VEHICLE, TEST_CUSTOMER, apiHeaders } = require('../fixtures/test-data');

let createdJobId;

test.describe('Workshop Jobs', () => {
  test('create a job', async ({ request }) => {
    const res = await request.post(`${BASE}/api/jobs`, {
      headers: apiHeaders(),
      data: {
        vehicleReg: TEST_VEHICLE.reg,
        inspectionType: 'T50',
        customerName: TEST_CUSTOMER.name,
        technicianName: 'Test Tech',
        priority: 'normal',
        notes: 'E2E test job',
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const job = body.data ? body.data.job : body.job;
    expect(job).toBeTruthy();
    expect(job.vehicle_reg).toBe(TEST_VEHICLE.reg.replace(/\s/g, '').length > 0 ? TEST_VEHICLE.reg.toUpperCase().replace(/\s+/g, ' ') : TEST_VEHICLE.reg);
    createdJobId = job.id;
  });

  test('list jobs includes the created job', async ({ request }) => {
    const res = await request.get(`${BASE}/api/jobs`, { headers: apiHeaders() });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const jobs = body.data ? body.data.jobs : body.jobs;
    expect(jobs.some(j => j.id === createdJobId)).toBeTruthy();
  });

  test('get single job', async ({ request }) => {
    const res = await request.get(`${BASE}/api/jobs/${createdJobId}`, { headers: apiHeaders() });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const job = body.data ? body.data.job : body.job;
    expect(job.id).toBe(createdJobId);
  });

  test('update job status', async ({ request }) => {
    const res = await request.put(`${BASE}/api/jobs/${createdJobId}`, {
      headers: apiHeaders(),
      data: { status: 'in_progress' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('send job to floor', async ({ request }) => {
    const res = await request.post(`${BASE}/api/jobs/${createdJobId}/send`, {
      headers: apiHeaders(),
      data: { targets: ['inspect'] },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.sent).toBe(true);
  });

  test('workshop page loads', async ({ page }) => {
    await page.goto('/workshop');
    await page.waitForLoadState('networkidle');
    const title = await page.title();
    expect(title).toContain('Workshop');
  });
});

module.exports = { getCreatedJobId: () => createdJobId };
