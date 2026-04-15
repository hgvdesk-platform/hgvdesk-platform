/**
 * HGV PLATFORM — MAIN SERVER
 * Workshop  → /api/jobs/*
 * Inspect   → /api/inspections/*
 * Parts     → /api/parts/*
 * Command   → /api/overview, /api/activity, /api/auth/login
 * Admin     → /api/admin/*
 * DVLA      → /api/dvla/lookup
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// ══════════════════════════════════════════════
// ERROR MONITORING
// ══════════════════════════════════════════════

const ERROR_LOG = '/var/log/hgv-errors.log';

function logError(source, err) {
  const entry = `[${new Date().toISOString()}] [${source}] ${err.message || err}\n${err.stack || ''}\n---\n`;
  try { fs.appendFileSync(ERROR_LOG, entry); } catch (e) { console.error('[LOG WRITE FAIL]', e.message); }
}

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
  logError('UNHANDLED_REJECTION', reason instanceof Error ? reason : new Error(String(reason)));
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
  logError('UNCAUGHT_EXCEPTION', err);
});

const { requireAuth, requireApiKey } = require('./auth');
const admin = require('./routes/admin');
const workshop = require('./routes/workshop');
const technicians = require('./routes/technicians');
const inspect = require('./routes/inspect');
const billing = require('./routes/billing');
const dvsa    = require('./routes/dvsa');
const parts = require('./routes/parts');
const command = require('./routes/command');
const ai = require('./routes/ai');
const stripeRoutes = require('./routes/stripe');
const pdf = require('./routes/pdf');
const settings = require('./routes/settings');
const vehicles = require('./routes/vehicles');

const PORT = process.env.PORT || 3000;
const FRONTEND = path.join(__dirname, '..', 'frontend');

// ══════════════════════════════════════════════
// RATE LIMITING (in-memory sliding window)
// ══════════════════════════════════════════════

const rateBuckets = {};
const RATE_CLEANUP_INTERVAL = 60000;
setInterval(() => {
  const now = Date.now();
  for (const ip of Object.keys(rateBuckets)) {
    const b = rateBuckets[ip];
    for (const tier of Object.keys(b)) {
      b[tier] = b[tier].filter(t => now - t < 60000);
      if (!b[tier].length) delete b[tier];
    }
    if (!Object.keys(b).length) delete rateBuckets[ip];
  }
}, RATE_CLEANUP_INTERVAL);

function rateLimit(ip, tier, limit) {
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (!rateBuckets[ip]) rateBuckets[ip] = {};
  if (!rateBuckets[ip][tier]) rateBuckets[ip][tier] = [];
  const now = Date.now();
  const window = rateBuckets[ip][tier].filter(t => now - t < 60000);
  rateBuckets[ip][tier] = window;
  if (window.length >= limit) return false;
  window.push(now);
  return true;
}

function getRateTier(path) {
  if (path.startsWith('/api/auth/login') || path.startsWith('/api/auth/signup')) return { tier: 'auth', limit: 10 };
  return { tier: 'api', limit: 100 };
}

// ══════════════════════════════════════════════
// SECURITY HEADERS
// ══════════════════════════════════════════════

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// ══════════════════════════════════════════════
// INPUT SANITISATION
// ══════════════════════════════════════════════

function sanitiseValue(val) {
  if (typeof val === 'string') {
    return val.replace(/\0/g, '').trim().slice(0, 10000);
  }
  if (Array.isArray(val)) return val.map(sanitiseValue);
  if (val && typeof val === 'object') {
    const out = {};
    for (const k of Object.keys(val)) out[k] = sanitiseValue(val[k]);
    return out;
  }
  return val;
}

// ══════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET') return resolve({});
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 10 * 1024 * 1024) { req.destroy(); reject(new Error('Body too large')); return; }
      body += chunk;
    });
    req.on('end', () => {
      try { resolve(sanitiseValue(JSON.parse(body || '{}'))); }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

// Stripe webhooks require the exact request bytes for signature verification.
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://hgvdesk.co.uk,https://www.hgvdesk.co.uk')
  .split(',').map(s => s.trim()).filter(Boolean);

function buildCors(req) {
  const origin = req && req.headers && req.headers.origin;
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Vary': 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(res, status, data) {
  const headers = { 'Content-Type': 'application/json', ...(res._cors || {}) };
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

function ok(res, data) { json(res, 200, { success: true, data }); }
function created(res, data) { json(res, 201, { success: true, data }); }
function unauth(res, msg) { json(res, 401, { success: false, error: msg }); }

// ══════════════════════════════════════════════
// AUTH HELPER
// ══════════════════════════════════════════════

async function getAuth(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return requireAuth(req);
  }
  return requireApiKey(req);
}

// ══════════════════════════════════════════════
// STATIC FILE SERVING
// ══════════════════════════════════════════════

const PAGES = {
  '/': 'landing.html',
  '/login': 'login.html',
  '/signup': 'signup.html',
  '/signup-success': 'signup-success.html',
  '/workshop': 'workshop.html',
  '/inspect': 'inspect.html',
  '/parts': 'parts.html',
  '/command': 'command.html',
  '/admin': 'admin.html',
  '/technician': 'technician.html',
  '/tech-dashboard': 'tech-dashboard.html',
  '/job-sheet': 'job-sheet.html',
  '/customers': 'customers.html',
  '/invoices': 'invoices.html',
  '/reports': 'reports.html',
  '/privacy': 'privacy.html',
  '/terms': 'terms.html',
  '/contact': 'contact.html',
  '/forgot-password': 'forgot-password.html',
  '/reset-password': 'reset-password.html',
  '/settings': 'settings.html',
  '/vehicles': 'vehicles.html',
};

function servePage(res, filename) {
  const fp = path.join(FRONTEND, filename);
  fs.readFile(fp, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' });
    res.end(data);
  });
}

function serveStatic(res, filePath, contentType) {
  const fp = path.join(FRONTEND, filePath);
  fs.readFile(fp, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// ══════════════════════════════════════════════
// ROUTE HANDLERS
// Each returns `true` if it handled the request, falsy otherwise.
// ══════════════════════════════════════════════

const IMAGE_MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif',
};

function serveImage(ctx, res) {
  const rel = ctx.p.slice(1);
  if (rel.includes('..')) { json(res, 400, { error: 'bad path' }); return true; }
  const ct = IMAGE_MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream';
  serveStatic(res, rel, ct);
  return true;
}

async function serveConfigJs(res) {
  const apiKey = process.env.PUBLIC_API_KEY || '';
  let logoLight = null, logoDark = null, orgName = null;
  if (apiKey) {
    try {
      const db = require('./db');
      const org = await db.queryOne('SELECT name, logo_light, logo_dark FROM organisations WHERE api_key = $1', [apiKey]);
      if (org) { logoLight = org.logo_light; logoDark = org.logo_dark; orgName = org.name; }
    } catch (e) { /* ignore */ }
  }
  const cfg = 'window.HGV_CONFIG = ' + JSON.stringify({ apiKey, orgName, logoLight, logoDark }) + ';\n';
  res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(cfg);
  return true;
}

async function handleStaticPublic(ctx, res) {
  const { p, method } = ctx;
  if (method !== 'GET') return false;
  if (PAGES[p]) { servePage(res, PAGES[p]); return true; }
  if (p === '/api.js') { serveStatic(res, 'api.js', 'application/javascript'); return true; }
  if (p === '/branding.js') { serveStatic(res, 'branding.js', 'application/javascript'); return true; }
  if (p === '/arthur.js') { serveStatic(res, 'arthur.js', 'application/javascript'); return true; }
  if (p === '/config.js') return serveConfigJs(res);
  if (p.startsWith('/images/')) return serveImage(ctx, res);
  return false;
}

async function handlePublicApi(ctx, res) {
  const { p, method } = ctx;
  const req = ctx.req;

  if (p === '/api/health') {
    ok(res, {
      status: 'healthy',
      uptime: Math.floor(process.uptime()),
      systems: { workshop: 'live', inspect: 'live', parts: 'live', command: 'live' }
    });
    return true;
  }
  if ((p === '/api/dvla/lookup' || p === '/api/dvsa/lookup') && method === 'POST') {
    return handleDvsaLookup(req, res);
  }
  if (p === '/api/auth/login' && method === 'POST') {
    const body = await readBody(req);
    ok(res, await command.handleLogin(body));
    return true;
  }
  if (p === '/api/technician/login' && method === 'POST') return handleTechnicianLogin(req, res);
  if (p === '/api/technician/jobs' && method === 'GET') return handleTechnicianJobs(req, res);
  return false;
}

async function handlePublicBilling(ctx, res) {
  const { p, method } = ctx;
  const req = ctx.req;

  if (p === '/api/billing/plans' && method === 'GET') {
    ok(res, { plans: stripeRoutes.publicPlans() });
    return true;
  }
  if (p === '/api/auth/signup' && method === 'POST') {
    const body = await readBody(req);
    ok(res, await stripeRoutes.signup(body));
    return true;
  }
  if (p === '/api/stripe/webhook' && method === 'POST') return handleStripeWebhook(req, res);
  return false;
}

async function handleForgotPassword(req, res) {
  const body = await readBody(req);
  const email = (body.email || '').toLowerCase().trim();
  if (!email) { json(res, 400, { error: 'email required' }); return; }
  const db = require('./db');
  const crypto = require('crypto');
  const user = await db.queryOne('SELECT id FROM users WHERE email = $1 AND active = true', [email]);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600000).toISOString();
    await db.query('UPDATE users SET reset_token = $1, reset_expires = $2 WHERE id = $3', [token, expires, user.id]);
    const { resendSend } = require('./mailer');
    const origin = process.env.PUBLIC_BASE_URL || 'https://hgvdesk.co.uk';
    await resendSend({
      from: process.env.FROM_EMAIL || 'noreply@hgvdesk.co.uk',
      to: [email],
      subject: 'HGVDesk — Password Reset',
      html: '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;"><h2 style="color:#0a1929;">Reset your password</h2><p>Click the link below to set a new password. This link expires in 1 hour.</p><a href="' + origin + '/reset-password?token=' + token + '" style="display:inline-block;padding:12px 24px;background:#ff5500;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Reset password</a><p style="margin-top:16px;font-size:12px;color:#999;">If you didn\'t request this, ignore this email.</p></div>'
    }).catch(() => {});
  }
  ok(res, { sent: true });
}

async function handleResetPassword(req, res) {
  const body = await readBody(req);
  const { token, password } = body;
  if (!token || !password || password.length < 8) { json(res, 400, { error: 'Token and password (min 8 chars) required' }); return; }
  const db = require('./db');
  const bcrypt = require('bcryptjs');
  const user = await db.queryOne('SELECT id FROM users WHERE reset_token = $1 AND reset_expires > NOW()', [token]);
  if (!user) { json(res, 400, { success: false, error: 'Invalid or expired reset link. Request a new one.' }); return; }
  const hash = await bcrypt.hash(password, 10);
  await db.query('UPDATE users SET password_hash = $1, reset_token = NULL, reset_expires = NULL WHERE id = $2', [hash, user.id]);
  ok(res, { reset: true });
}

async function handleContactForm(req, res) {
  const body = await readBody(req);
  const { name, company, email, phone, fleet, message } = body || {};
  if (!name || !email) { json(res, 400, { error: 'name and email required' }); return; }
  const { resendSend } = require('./mailer');
  const rows = [['Name',name],['Company',company],['Email',email],['Phone',phone],['Fleet',fleet],['Message',(message||'').replace(/\n/g,'<br>')]];
  const tableRows = rows.map(([lbl,val]) => '<tr><td style="padding:8px;font-weight:700;color:#666;' + (lbl==='Message'?'vertical-align:top;':'') + '">' + lbl + '</td><td style="padding:8px;">' + (val||'') + '</td></tr>').join('');
  await resendSend({
    from: process.env.FROM_EMAIL || 'noreply@hgvdesk.co.uk',
    to: [process.env.ALERT_EMAIL || 'james@hgvdesk.co.uk'],
    subject: 'HGVDesk Contact: ' + (company || name),
    html: '<div style="font-family:sans-serif;padding:20px;"><h2 style="color:#0a1929;">New Contact Form Submission</h2><table style="border-collapse:collapse;width:100%;">' + tableRows + '</table></div>'
  });
  ok(res, { sent: true });
}

async function handlePublicAuth(ctx, res) {
  const { p, method } = ctx;
  if (p === '/api/auth/forgot-password' && method === 'POST') { await handleForgotPassword(ctx.req, res); return true; }
  if (p === '/api/auth/reset-password' && method === 'POST') { await handleResetPassword(ctx.req, res); return true; }
  if (p === '/api/auth/verify-email' && method === 'GET') {
    const token = new URL(ctx.req.url, 'http://localhost').searchParams.get('token');
    if (!token) { json(res, 400, { error: 'token required' }); return true; }
    const db = require('./db');
    const user = await db.queryOne('SELECT id FROM users WHERE verify_token = $1', [token]);
    if (!user) { json(res, 400, { success: false, error: 'Invalid verification link.' }); return true; }
    await db.query('UPDATE users SET email_verified = true, verify_token = NULL WHERE id = $1', [user.id]);
    res.writeHead(302, { Location: '/login?verified=1' });
    res.end();
    return true;
  }
  if (p === '/api/auth/resend-verification' && method === 'POST') {
    const body = await readBody(ctx.req);
    const email = (body.email || '').toLowerCase().trim();
    if (!email) { json(res, 400, { error: 'email required' }); return true; }
    const db = require('./db');
    const crypto = require('crypto');
    const user = await db.queryOne('SELECT id, email_verified, verify_token FROM users WHERE email = $1 AND active = true', [email]);
    if (user && !user.email_verified) {
      const token = crypto.randomBytes(32).toString('hex');
      await db.query('UPDATE users SET verify_token = $1 WHERE id = $2', [token, user.id]);
      const { resendSend } = require('./mailer');
      const origin = process.env.PUBLIC_BASE_URL || 'https://hgvdesk.co.uk';
      await resendSend({
        from: process.env.FROM_EMAIL || 'noreply@hgvdesk.co.uk', to: [email],
        subject: 'HGVDesk — Verify Your Email',
        html: '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;"><h2 style="color:#0a1929;">Verify your email</h2><p>Click below to verify your account.</p><a href="' + origin + '/api/auth/verify-email?token=' + token + '" style="display:inline-block;padding:12px 24px;background:#ff5500;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Verify email</a></div>'
      }).catch(() => {});
    }
    ok(res, { sent: true });
    return true;
  }
  if (p === '/api/contact' && method === 'POST') { await handleContactForm(ctx.req, res); return true; }
  return false;
}

async function handlePublicRoutes(ctx, res) {
  if (await handleStaticPublic(ctx, res)) return true;
  if (await handlePublicApi(ctx, res)) return true;
  if (await handlePublicAuth(ctx, res)) return true;
  if (await handlePublicBilling(ctx, res)) return true;
  return false;
}

async function handleStripeWebhook(req, res) {
  const raw = await readRawBody(req);
  const sig = req.headers['stripe-signature'];
  try {
    const result = await stripeRoutes.webhook(raw, sig);
    json(res, 200, result);
  } catch (e) {
    console.error('[STRIPE WEBHOOK]', e.message || e);
    json(res, e.status || 400, { error: e.message || 'Webhook error' });
  }
  return true;
}

async function handleDvsaLookup(req, res) {
  const b = await readBody(req);
  const reg = (b.reg || '').toUpperCase().replace(/\s/g, '');
  if (!reg) { json(res, 400, { error: 'reg required' }); return true; }
  try { ok(res, await dvsa.handleDvsa(reg, process.env)); }
  catch (e) {
    console.error('[DVSA ERROR]', e.message || e);
    json(res, e.status || 500, { error: e.message || 'DVSA lookup error' });
  }
  return true;
}

async function handleTechnicianLogin(req, res) {
  const b = await readBody(req);
  const { username, password } = b;
  if (!username || !password) { json(res, 400, { error: 'Username and password required' }); return true; }
  const bcrypt = require('bcryptjs');
  const { queryOne } = require('./db');
  const { signToken } = require('./auth');
  const tech = await queryOne(
    'SELECT t.*, o.api_key FROM technicians t JOIN organisations o ON t.org_id = o.id WHERE t.username = $1 AND t.active = true AND o.active = true',
    [username.trim().toLowerCase()]
  );
  if (!tech) { json(res, 401, { error: 'Invalid username or password' }); return true; }
  const valid = await bcrypt.compare(password, tech.password_hash);
  if (!valid) { json(res, 401, { error: 'Invalid username or password' }); return true; }
  const token = signToken({ techId: tech.id, orgId: tech.org_id, role: 'technician' });
  json(res, 200, { token, name: tech.name, apiKey: tech.api_key });
  return true;
}

async function handleTechnicianJobs(req, res) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) { json(res, 401, { error: 'Unauthorised' }); return true; }
  const { verifyToken } = require('./auth');
  const { queryOne, queryAll } = require('./db');
  let decoded;
  try { decoded = verifyToken(authHeader.slice(7)); } catch (e) { json(res, 401, { error: 'Token invalid or expired' }); return true; }
  if (decoded.role !== 'technician') { json(res, 403, { error: 'Forbidden' }); return true; }
  const tech = await queryOne('SELECT name FROM technicians WHERE id = $1', [decoded.techId]);
  if (!tech) { json(res, 401, { error: 'Technician not found' }); return true; }
  const jobs = await queryAll(
    'SELECT id, vehicle_reg, inspection_type, customer_name, priority, status, notes, created_at FROM jobs WHERE org_id = $1 AND technician_name = $2 ORDER BY created_at DESC',
    [decoded.orgId, tech.name]
  );
  json(res, 200, { jobs });
  return true;
}

async function handleAdmin(ctx, res) {
  const { p, method, body, caller } = ctx;

  if (p === '/api/admin/organisations' && method === 'GET') { ok(res, await admin.getOrganisations(caller)); return true; }
  if (p === '/api/admin/organisations' && method === 'POST') { ok(res, await admin.createOrganisation(body, caller)); return true; }

  const orgIdMatch = p.match(/^\/api\/admin\/organisations\/(\d+)$/);
  if (orgIdMatch && method === 'PUT') { ok(res, await admin.updateOrganisation(body, caller, parseInt(orgIdMatch[1]))); return true; }

  if (p === '/api/admin/users' && method === 'GET') { ok(res, await admin.getUsers(caller)); return true; }
  if (p === '/api/admin/users' && method === 'POST') { ok(res, await admin.createUser(body, caller)); return true; }

  const userIdMatch = p.match(/^\/api\/admin\/users\/(\d+)$/);
  if (userIdMatch && method === 'PUT') { ok(res, await admin.updateUser(body, caller, parseInt(userIdMatch[1]))); return true; }

  if (p === '/api/admin/errors' && method === 'GET') {
    try {
      const log = fs.readFileSync(ERROR_LOG, 'utf8');
      const entries = log.split('---\n').filter(Boolean).slice(-50).reverse();
      ok(res, { entries, count: entries.length });
    } catch (e) {
      ok(res, { entries: [], count: 0 });
    }
    return true;
  }

  return false;
}

async function handleWorkshop(ctx, res) {
  const { p, method, body, caller, qs } = ctx;
  const req = ctx.req;

  if (p === '/api/jobs' && method === 'GET') { ok(res, await workshop.getJobs(req, caller, qs)); return true; }
  if (p === '/api/jobs' && method === 'POST') { created(res, await workshop.createJob(body, caller)); return true; }

  const jobIdMatch = p.match(/^\/api\/jobs\/(\d+)$/);
  if (jobIdMatch) {
    const id = parseInt(jobIdMatch[1]);
    if (method === 'GET') { ok(res, await workshop.getJob(req, caller, id)); return true; }
    if (method === 'PUT') { ok(res, await workshop.updateJob(body, caller, id)); return true; }
    if (method === 'DELETE') { ok(res, await workshop.deleteJob(caller, id)); return true; }
  }

  const sendMatch = p.match(/^\/api\/jobs\/(\d+)\/send$/);
  if (sendMatch && method === 'POST') { ok(res, await workshop.sendToFloor(body, caller, parseInt(sendMatch[1]))); return true; }

  if (p === '/api/sync/parts-update' && method === 'POST') { ok(res, await workshop.receivePartsUpdate(body, caller)); return true; }
  if (p === '/api/jobs/bulk' && method === 'DELETE') { ok(res, await workshop.bulkDeleteJobs(caller, body.ids)); return true; }

  return false;
}

async function handleInspections(ctx, res) {
  const { p, method, body, caller, qs } = ctx;

  if (p === '/api/inspections' && method === 'GET') { ok(res, await inspect.getInspections(caller, qs)); return true; }
  if (p === '/api/inspections' && method === 'POST') { created(res, await inspect.createInspection(body, caller)); return true; }
  if (p === '/api/inspections/bulk' && method === 'DELETE') { ok(res, await inspect.bulkDeleteInspections(caller, body.ids)); return true; }

  const inspIdMatch = p.match(/^\/api\/inspections\/(\d+)$/);
  if (inspIdMatch) {
    const id = parseInt(inspIdMatch[1]);
    if (method === 'PUT') { ok(res, await inspect.updateInspection(body, caller, id)); return true; }
    if (method === 'DELETE') { ok(res, await inspect.deleteInspection(caller, id)); return true; }
  }

  if (p === '/api/sync/assigned-job' && method === 'POST') { ok(res, await inspect.receiveAssignedJob(body, caller)); return true; }

  // Inspection parts (parts used during inspection)
  const inspPartsMatch = p.match(/^\/api\/inspections\/(\d+)\/parts$/);
  if (inspPartsMatch && method === 'GET') { ok(res, await inspect.getInspectionParts(caller, parseInt(inspPartsMatch[1]))); return true; }
  if (inspPartsMatch && method === 'POST') { created(res, await inspect.addInspectionPart({ ...body, inspectionId: parseInt(inspPartsMatch[1]) }, caller)); return true; }

  const inspPartDelMatch = p.match(/^\/api\/inspection-parts\/(\d+)$/);
  if (inspPartDelMatch && method === 'DELETE') { ok(res, await inspect.removeInspectionPart(caller, parseInt(inspPartDelMatch[1]))); return true; }

  const inspCostMatch = p.match(/^\/api\/inspections\/(\d+)\/costs$/);
  if (inspCostMatch && method === 'POST') { ok(res, await inspect.calculateInspectionCosts(caller, parseInt(inspCostMatch[1]))); return true; }

  return false;
}

async function handleDefects(ctx, res) {
  const { p, method, body, caller, qs } = ctx;

  if (p === '/api/defects' && method === 'GET') { ok(res, await inspect.getDefects(caller, qs)); return true; }
  const defectIdMatch = p.match(/^\/api\/defects\/(\d+)$/);
  if (defectIdMatch && method === 'PUT') { ok(res, await inspect.updateDefect(body, caller, parseInt(defectIdMatch[1]))); return true; }
  if (p === '/api/inspection-defects' && method === 'POST') { ok(res, await inspect.raiseDefects(body, caller)); return true; }

  return false;
}

async function handleInspect(ctx, res) {
  if (await handleInspections(ctx, res)) return true;
  return handleDefects(ctx, res);
}

async function handleParts(ctx, res) {
  const { p, method, body, caller, qs } = ctx;

  if (p === '/api/parts' && method === 'GET') { ok(res, await parts.getParts(caller, qs)); return true; }
  if (p === '/api/parts' && method === 'POST') { created(res, await parts.createPart(body, caller)); return true; }
  if (p === '/api/parts/bulk' && method === 'DELETE') { ok(res, await parts.bulkDeleteParts(caller, body.ids)); return true; }

  const partIdMatch = p.match(/^\/api\/parts\/(\d+)$/);
  if (partIdMatch) {
    const id = parseInt(partIdMatch[1]);
    if (method === 'PUT') { ok(res, await parts.updatePart(body, caller, id)); return true; }
    if (method === 'DELETE') { ok(res, await parts.deletePart(caller, id)); return true; }
  }

  if (p === '/api/inbound/job' && method === 'POST') { ok(res, await parts.receiveInboundJob(body, caller)); return true; }

  return false;
}

async function fetchMaintenancePrediction(reg, orgId) {
  const db = require('./db');
  const inspections = await db.queryAll(
    `SELECT id, inspection_id, inspection_type, result, overall_mileage, nil_defect, created_at
     FROM inspections
     WHERE org_id = $1 AND UPPER(REPLACE(vehicle_reg, ' ', '')) = UPPER(REPLACE($2, ' ', ''))
     ORDER BY created_at DESC LIMIT 5`,
    [orgId, reg]
  );
  if (inspections.length) {
    const ids = inspections.map(i => i.id);
    const defectRows = await db.queryAll(
      `SELECT inspection_id, title, description, severity, category, resolved
       FROM defects WHERE inspection_id = ANY($1::int[])`, [ids]
    );
    const byInsp = {};
    for (const d of defectRows) (byInsp[d.inspection_id] ||= []).push(d);
    for (const insp of inspections) insp.defects = byInsp[insp.id] || [];
  }
  return ai.maintenancePrediction({ vehicleReg: reg, inspections });
}

async function handleAi(ctx, res) {
  const { p, method, body, caller } = ctx;
  if (p === '/api/ai/defect-suggestion' && method === 'POST') { ok(res, await ai.defectSuggestion(body)); return true; }
  if (p === '/api/ai/repair-suggestion' && method === 'POST') { ok(res, await ai.repairSuggestion(body)); return true; }
  if (p === '/api/ai/search' && method === 'POST') { ok(res, await ai.nlSearch({ query: body && body.query, caller })); return true; }
  if (p === '/api/ai/technical-assistant' && method === 'POST') { ok(res, await ai.technicalAssistant(body)); return true; }
  const predMatch = p.match(/^\/api\/vehicles\/([^/]+)\/maintenance-prediction$/);
  if (predMatch && method === 'GET') {
    ok(res, await fetchMaintenancePrediction(decodeURIComponent(predMatch[1]).toUpperCase().trim(), caller.id || caller.org_id));
    return true;
  }
  return false;
}

async function handlePdf(ctx, res) {
  const { p, method, caller } = ctx;
  if (method !== 'GET') return false;
  const orgId = caller.id || caller.org_id;

  const inspPdf = p.match(/^\/api\/inspections\/(\d+)\/pdf$/);
  if (inspPdf) {
    const { pdf: buf, filename } = await pdf.inspectionPdf(parseInt(inspPdf[1]), orgId);
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'Content-Length': buf.length });
    res.end(buf);
    return true;
  }

  const invPdf = p.match(/^\/api\/invoices\/(\d+)\/pdf$/);
  if (invPdf) {
    const { pdf: buf, filename } = await pdf.invoicePdf(parseInt(invPdf[1]), orgId);
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'Content-Length': buf.length });
    res.end(buf);
    return true;
  }

  const jobPdf = p.match(/^\/api\/jobs\/(\d+)\/pdf$/);
  if (jobPdf) {
    const { pdf: buf, filename } = await pdf.jobPdf(parseInt(jobPdf[1]), orgId);
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'Content-Length': buf.length });
    res.end(buf);
    return true;
  }

  return false;
}

async function handleBranding(ctx, res) {
  const { p, method, caller } = ctx;
  if (p === '/api/org/branding' && method === 'GET') {
    ok(res, {
      orgName: caller.name || caller.org_name || 'HGVDesk',
      logoLight: caller.logo_light || null,
      logoDark: caller.logo_dark || null,
    });
    return true;
  }
  return false;
}

async function handleBilling(ctx, res) {
  const { p, method, caller } = ctx;
  if (p === '/api/billing/me' && method === 'GET') {
    ok(res, await stripeRoutes.getMyBilling(caller));
    return true;
  }
  return false;
}

async function handleCommand(ctx, res) {
  const { p, method, caller, qs } = ctx;
  if (p === '/api/overview' && method === 'GET') { ok(res, await command.getOverview(caller)); return true; }
  if (p === '/api/activity' && method === 'GET') { ok(res, await command.getActivity(caller, qs)); return true; }
  return false;
}

async function handleInspectionReports(ctx, res) {
  const { p, method, body, caller } = ctx;

  const reportSendMatch = p.match(/^\/api\/inspections\/(\d+)\/report$/);
  if (reportSendMatch && method === 'POST') {
    return sendInspectionReportRoute(parseInt(reportSendMatch[1]), body, caller, res);
  }

  const previewMatch = p.match(/^\/api\/inspections\/(\d+)\/report\/preview$/);
  if (previewMatch && method === 'GET') {
    await renderInspectionPreview(parseInt(previewMatch[1]), caller.id || caller.org_id, res);
    return true;
  }

  return false;
}

async function fetchFullInspection(inspId, orgId) {
  const db = require('./db');
  const insp = await db.queryOne('SELECT * FROM inspections WHERE id = $1 AND org_id = $2', [inspId, orgId]);
  if (!insp) return null;
  const defects = await db.queryAll(
    'SELECT * FROM defects WHERE inspection_id = $1 ORDER BY severity DESC, created_at ASC', [insp.id]
  );
  insp.defects = defects;
  insp.checkItems = parseMaybeJson(insp.check_items, {});
  insp.tyreData = parseMaybeJson(insp.tyre_data, {});
  insp.brakeData = parseMaybeJson(insp.brake_test_data, {});
  return insp;
}

async function sendInspectionReportRoute(inspId, body, caller, res) {
  const { email } = body;
  if (!email) { json(res, 400, { error: 'email required' }); return true; }
  const orgId = caller.id || caller.org_id;
  const insp = await fetchFullInspection(inspId, orgId);
  if (!insp) { json(res, 404, { error: 'Inspection not found' }); return true; }

  const { summary } = await ai.inspectionSummarySafe({
    vehicleReg: insp.vehicle_reg,
    inspectionType: insp.inspection_type,
    result: insp.result,
    inspectorName: insp.inspector_name,
    nilDefect: insp.nil_defect,
    notes: insp.notes,
    defects: insp.defects,
  });

  const { sendInspectionReport } = require('./mailer');
  const result2 = await sendInspectionReport({
    to: email,
    inspection: insp,
    orgName: caller.org_name || caller.name || 'HGVDesk',
    aiSummary: summary,
    logoLight: caller.logo_light || null,
    logoDark: caller.logo_dark || null,
  });
  ok(res, { sent: result2.sent, to: email, aiSummary: summary });
  return true;
}

function parseMaybeJson(v, fallback) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return fallback; } }
  return v;
}

function previewResultColor(result) {
  if (result === 'pass') return '#1d9e75';
  if (result === 'fail') return '#e24b4a';
  if (result === 'advisory') return '#ba7517';
  return '#636366';
}

function previewCheckColor(cr) {
  if (cr === 'pass') return '#1d9e75';
  if (cr === 'fail') return '#e24b4a';
  if (cr === 'advisory' || cr === 'adv') return '#ba7517';
  return '#636366';
}

function buildChecksHtml(checks) {
  if (!checks.length) {
    return '<p style="color:#636366;font-size:13px;margin-bottom:24px;">No check items recorded.</p>';
  }
  let html = '<table style="width:100%;border-collapse:collapse;margin-bottom:24px;"><thead><tr style="background:#f5f5f7;"><th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#636366;border-bottom:1px solid #e5e5e5;">Check Item</th><th style="padding:10px 12px;text-align:center;font-size:12px;font-weight:600;color:#636366;border-bottom:1px solid #e5e5e5;">Result</th><th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#636366;border-bottom:1px solid #e5e5e5;">Notes</th></tr></thead><tbody>';
  for (const c of checks) {
    const cr = (c.result || c.state || '').toLowerCase();
    const cc = previewCheckColor(cr);
    html += '<tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:10px 12px;font-size:13px;">' + (c.label || c.name || c.id || '') + '</td><td style="padding:10px 12px;text-align:center;"><span style="font-size:11px;font-weight:700;color:' + cc + ';text-transform:uppercase;">' + (cr || '-') + '</span></td><td style="padding:10px 12px;font-size:12px;color:#636366;">' + (c.notes || '-') + '</td></tr>';
  }
  return html + '</tbody></table>';
}

function buildDefectsHtml(defects) {
  if (!defects.length) {
    return '<p style="color:#1d9e75;font-size:13px;margin-bottom:24px;">No defects recorded.</p>';
  }
  let html = '<table style="width:100%;border-collapse:collapse;margin-bottom:24px;"><thead><tr style="background:#fff5f5;"><th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#636366;border-bottom:1px solid #e5e5e5;">Defect</th><th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#636366;border-bottom:1px solid #e5e5e5;">Category</th><th style="padding:10px 12px;text-align:center;font-size:12px;font-weight:600;color:#636366;border-bottom:1px solid #e5e5e5;">Severity</th><th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#636366;border-bottom:1px solid #e5e5e5;">Description</th></tr></thead><tbody>';
  for (const d of defects) {
    const sc = d.severity === 'critical' ? '#e24b4a' : d.severity === 'major' ? '#ba7517' : '#636366';
    html += '<tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:10px 12px;font-size:13px;font-weight:600;">' + (d.title || '') + '</td><td style="padding:10px 12px;font-size:12px;color:#636366;">' + (d.category || '') + '</td><td style="padding:10px 12px;text-align:center;"><span style="font-size:11px;font-weight:700;color:' + sc + ';text-transform:uppercase;">' + (d.severity || '') + '</span></td><td style="padding:10px 12px;font-size:12px;color:#636366;">' + (d.description || '-') + '</td></tr>';
  }
  return html + '</tbody></table>';
}

async function renderInspectionPreview(inspId, orgId, res) {
  const db = require('./db');
  const insp = await db.queryOne('SELECT * FROM inspections WHERE id = $1', [inspId]);
  if (!insp) { res.writeHead(404); res.end('Not found'); return; }
  insp.defects = await db.queryAll('SELECT * FROM defects WHERE inspection_id = $1 ORDER BY severity DESC, created_at ASC', [inspId]);
  const org = orgId ? await db.queryOne('SELECT name, logo_light, logo_dark FROM organisations WHERE id = $1', [orgId]) : {};
  const { buildInspectionReportHtml } = require('./report-html');
  const html = buildInspectionReportHtml(insp, { orgName: (org&&org.name)||'HGVDesk', logoLight: org&&org.logo_light, logoDark: org&&org.logo_dark });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function handleTechnicians(ctx, res) {
  const { p, method, body, caller } = ctx;

  if (p === '/api/technicians' && method === 'GET') { json(res, 200, await technicians.listTechnicians(caller)); return true; }
  if (p === '/api/technicians' && method === 'POST') { json(res, 200, await technicians.createTechnician(body, caller)); return true; }

  const techMatch = p.match(/^\/api\/technicians\/(\d+)$/);
  if (techMatch) {
    const id = parseInt(techMatch[1]);
    if (method === 'PUT') { json(res, 200, await technicians.updateTechnician(caller, id, body)); return true; }
    if (method === 'DELETE') { json(res, 200, await technicians.deleteTechnician(caller, id)); return true; }
  }

  const techReset = p.match(/^\/api\/technicians\/(\d+)\/reset-password$/);
  if (techReset && method === 'POST') { json(res, 200, await technicians.resetPassword(caller, parseInt(techReset[1]))); return true; }

  return false;
}

async function handleJobLibrary(ctx, res) {
  const { p, method, body, caller } = ctx;

  if (p === '/api/job-library' && method === 'GET') { ok(res, await workshop.getJobLibrary(caller)); return true; }

  const jobLinesMatch = p.match(/^\/api\/jobs\/(\d+)\/lines$/);
  if (jobLinesMatch) {
    const id = parseInt(jobLinesMatch[1]);
    if (method === 'GET') { ok(res, await workshop.getJobLines(caller, id)); return true; }
    if (method === 'POST') { ok(res, await workshop.saveJobLines(body, caller, id)); return true; }
  }

  return false;
}

async function handleCustomers(ctx, res) {
  const { p, method, body, caller } = ctx;

  if (p === '/api/customers' && method === 'GET') { ok(res, await billing.getCustomers(caller)); return true; }
  if (p === '/api/customers' && method === 'POST') { created(res, await billing.createCustomer(body, caller)); return true; }
  if (p === '/api/customers/bulk' && method === 'DELETE') { ok(res, await billing.bulkDeleteCustomers(caller, body.ids)); return true; }

  const custMatch = p.match(/^\/api\/customers\/(\d+)$/);
  if (custMatch) {
    const id = parseInt(custMatch[1]);
    if (method === 'PUT') { ok(res, await billing.updateCustomer(body, caller, id)); return true; }
    if (method === 'DELETE') { ok(res, await billing.deleteCustomer(caller, id)); return true; }
  }

  return false;
}

async function handleInvoices(ctx, res) {
  const { p, method, body, caller, qs } = ctx;

  if (p === '/api/invoices' && method === 'GET') { ok(res, await billing.getInvoices(caller, qs)); return true; }
  if (p === '/api/invoices' && method === 'POST') { created(res, await billing.createInvoice(body, caller)); return true; }
  if (p === '/api/invoices/generate-from-job' && method === 'POST') { created(res, await billing.generateFromJob(body, caller)); return true; }
  if (p === '/api/invoices/bulk' && method === 'DELETE') { ok(res, await billing.bulkDeleteInvoices(caller, body.ids)); return true; }

  const invMatch = p.match(/^\/api\/invoices\/(\d+)$/);
  if (invMatch) {
    const id = parseInt(invMatch[1]);
    if (method === 'GET') { ok(res, await billing.getInvoice(caller, id)); return true; }
    if (method === 'DELETE') { ok(res, await billing.deleteInvoice(caller, id)); return true; }
  }

  const invStatusMatch = p.match(/^\/api\/invoices\/(\d+)\/status$/);
  if (invStatusMatch && method === 'PUT') { ok(res, await billing.updateInvoiceStatus(body, caller, parseInt(invStatusMatch[1]))); return true; }

  return false;
}

// ══════════════════════════════════════════════
// ROUTER
// ══════════════════════════════════════════════

async function handleVehicles(ctx, res) {
  const { p, method, body, caller, qs } = ctx;
  if (p === '/api/vehicles' && method === 'GET') { ok(res, await vehicles.getVehicles(caller, qs)); return true; }
  if (p === '/api/vehicles' && method === 'POST') { created(res, await vehicles.createVehicle(body, caller)); return true; }
  if (p === '/api/vehicles/mot-alerts' && method === 'GET') { ok(res, await vehicles.getMotAlerts(caller)); return true; }
  const vIdMatch = p.match(/^\/api\/vehicles\/(\d+)$/);
  if (vIdMatch) {
    const id = parseInt(vIdMatch[1]);
    if (method === 'GET') { ok(res, await vehicles.getVehicle(caller, id)); return true; }
    if (method === 'PUT') { ok(res, await vehicles.updateVehicle(body, caller, id)); return true; }
    if (method === 'DELETE') { ok(res, await vehicles.deleteVehicle(caller, id)); return true; }
  }
  return false;
}

async function handleSettings(ctx, res) {
  const { p, method, body, caller } = ctx;
  if (p === '/api/settings' && method === 'GET') { ok(res, await settings.getSettings(caller)); return true; }
  if (p === '/api/settings' && method === 'POST') { ok(res, await settings.saveSettings(body, caller)); return true; }
  return false;
}

const AUTHED_HANDLERS = [
  handleAdmin, handleWorkshop, handleInspect, handleAi, handlePdf, handleBranding, handleBilling,
  handleParts, handleCommand, handleInspectionReports, handleTechnicians,
  handleJobLibrary, handleCustomers, handleInvoices, handleSettings, handleVehicles,
];

async function router(req, res) {
  res._cors = buildCors(req);
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ctx = {
    req,
    p: parsed.pathname.replace(/\/+$/, '') || '/',
    method: req.method,
    qs: Object.fromEntries(parsed.searchParams),
    body: {},
    caller: null,
  };

  if (ctx.method === 'OPTIONS') {
    res.writeHead(204, res._cors);
    res.end();
    return;
  }

  if (await handlePublicRoutes(ctx, res)) return;

  // ── ALL OTHER ROUTES REQUIRE AUTH ──
  try {
    ctx.caller = await getAuth(req);
  } catch (e) {
    return unauth(res, e.message || 'Unauthorised');
  }

  ctx.body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(ctx.method) ? await readBody(req) : {};

  for (const handler of AUTHED_HANDLERS) {
    if (await handler(ctx, res)) return;
  }

  json(res, 404, { success: false, error: 'Not found' });
}

// ══════════════════════════════════════════════
// SERVER
// ══════════════════════════════════════════════

const server = http.createServer(async (req, res) => {
  // Security headers on all responses
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);

  // Rate limiting
  const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const urlPath = (req.url || '').split('?')[0];
  if (urlPath.startsWith('/api/')) {
    const { tier, limit } = getRateTier(urlPath);
    if (!rateLimit(clientIp, tier, limit)) {
      json(res, 429, { success: false, error: 'Too many requests. Please wait a moment and try again.' });
      return;
    }
  }

  try {
    await router(req, res);
  } catch (e) {
    console.error('[SERVER ERROR]', e.message, e);
    if (!res.headersSent) {
      json(res, e.status || 500, { success: false, error: e.message || 'Internal server error' });
    }
  }
});

server.listen(PORT, () => {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║         HGVDESK PLATFORM — hgvdesk.co.uk     ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log('║  Environment: production                   ║');
    console.log(`║  Port:        ${PORT}                         ║`);
    console.log('╚══════════════════════════════════════════════╝');
    console.log(`  ✅ Server live → http://localhost:${PORT}`);
    console.log(`  ✅ Workshop    → http://localhost:${PORT}/workshop`);
    console.log(`  ✅ Inspect     → http://localhost:${PORT}/inspect`);
    console.log(`  ✅ Parts       → http://localhost:${PORT}/parts`);
    console.log(`  ✅ Health      → http://localhost:${PORT}/api/health`);
});
