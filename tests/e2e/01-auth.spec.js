const { test, expect } = require('@playwright/test');
const { BASE, TEST_ORG, apiHeaders } = require('../fixtures/test-data');

test.describe('Authentication', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"], input[placeholder*="email" i]')).toBeVisible();
  });

  test('login with bad password fails with 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/login`, {
      headers: apiHeaders(),
      data: { email: 'nobody@test.com', password: 'wrong' },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('health endpoint returns healthy', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.status).toBe('healthy');
  });

  test('API key auth works for protected routes', async ({ request }) => {
    const res = await request.get(`${BASE}/api/jobs`, { headers: apiHeaders() });
    expect(res.ok()).toBeTruthy();
  });

  test('request without valid API key is rejected', async ({ request }) => {
    const res = await request.get(`${BASE}/api/jobs`, { headers: { 'X-API-Key': 'invalid-key-12345' } });
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  test('forgot-password endpoint always returns success', async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/forgot-password`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email: 'test@example.com' },
    });
    expect(res.ok()).toBeTruthy();
  });
});
