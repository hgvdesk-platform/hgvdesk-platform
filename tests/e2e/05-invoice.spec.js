const { test, expect } = require('@playwright/test');
const { BASE, TEST_VEHICLE, TEST_CUSTOMER, apiHeaders } = require('../fixtures/test-data');

let testJobId;
let testInvoiceId;

test.describe('Invoices', () => {
  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${BASE}/api/jobs`, {
      headers: apiHeaders(),
      data: {
        vehicleReg: TEST_VEHICLE.reg,
        inspectionType: 'T50',
        customerName: TEST_CUSTOMER.name,
        technicianName: 'Invoice Tech',
        priority: 'normal',
        notes: 'Invoice test job',
      },
    });
    const body = await res.json();
    testJobId = (body.data ? body.data.job : body.job).id;
  });

  test('generate invoice from job', async ({ request }) => {
    const res = await request.post(`${BASE}/api/invoices/generate-from-job`, {
      headers: apiHeaders(),
      data: { jobId: testJobId },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const inv = body.data || body;
    expect(inv.invoiceNumber).toBeTruthy();
    expect(inv.invoiceNumber).toMatch(/^INV-/);
    testInvoiceId = inv.invoice.id;
  });

  test('list invoices includes generated invoice', async ({ request }) => {
    const res = await request.get(`${BASE}/api/invoices`, { headers: apiHeaders() });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const invoices = body.data ? body.data.invoices : body.invoices;
    expect(invoices.some(i => i.id === testInvoiceId)).toBeTruthy();
  });

  test('get invoice detail with lines', async ({ request }) => {
    const res = await request.get(`${BASE}/api/invoices/${testInvoiceId}`, { headers: apiHeaders() });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const inv = body.data ? body.data.invoice : body.invoice;
    const lines = body.data ? body.data.lines : body.lines;
    expect(inv.status).toBe('draft');
    expect(parseFloat(inv.total)).toBeGreaterThan(0);
    expect(lines.length).toBeGreaterThan(0);
  });

  test('mark invoice as sent', async ({ request }) => {
    const res = await request.put(`${BASE}/api/invoices/${testInvoiceId}/status`, {
      headers: apiHeaders(),
      data: { status: 'sent' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('mark invoice as paid', async ({ request }) => {
    const res = await request.put(`${BASE}/api/invoices/${testInvoiceId}/status`, {
      headers: apiHeaders(),
      data: { status: 'paid' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('invoices page loads', async ({ page }) => {
    await page.goto('/invoices');
    await page.waitForLoadState('networkidle');
    expect(await page.title()).toContain('Invoice');
  });
});
