const { test, expect } = require('@playwright/test');
const { BASE, apiHeaders } = require('../fixtures/test-data');

test.describe('Reports & Dashboards', () => {
  test('command overview returns system stats', async ({ request }) => {
    const res = await request.get(`${BASE}/api/overview`, { headers: apiHeaders() });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const data = body.data || body;
    expect(data).toHaveProperty('workshop');
    expect(data).toHaveProperty('inspect');
    expect(data).toHaveProperty('parts');
  });

  test('activity log returns entries', async ({ request }) => {
    const res = await request.get(`${BASE}/api/activity`, { headers: apiHeaders() });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const entries = body.data ? body.data.activity : body.activity;
    expect(entries.length).toBeGreaterThan(0);
  });

  test('settings endpoint works', async ({ request }) => {
    const res = await request.get(`${BASE}/api/settings`, { headers: apiHeaders() });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data).toHaveProperty('settings');
  });

  test('vehicles endpoint works', async ({ request }) => {
    const res = await request.get(`${BASE}/api/vehicles`, { headers: apiHeaders() });
    expect(res.ok()).toBeTruthy();
  });

  test('MOT alerts endpoint works', async ({ request }) => {
    const res = await request.get(`${BASE}/api/vehicles/mot-alerts`, { headers: apiHeaders() });
    expect(res.ok()).toBeTruthy();
  });

  test('notifications endpoint works', async ({ request }) => {
    const res = await request.get(`${BASE}/api/notifications`, { headers: apiHeaders() });
    expect(res.ok()).toBeTruthy();
  });

  test('alerts endpoint works', async ({ request }) => {
    const res = await request.get(`${BASE}/api/admin/alerts`, { headers: apiHeaders() });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data).toHaveProperty('counts');
  });

  test('command page loads', async ({ page }) => {
    await page.goto('/command');
    await page.waitForLoadState('networkidle');
    expect(await page.title()).toContain('Command');
  });
});
