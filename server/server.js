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

const { requireAuth, requireApiKey } = require('./auth');
const admin = require('./routes/admin');
const workshop = require('./routes/workshop');
const technicians = require('./routes/technicians');
const inspect = require('./routes/inspect');
const billing = require('./routes/billing');
const dvsa    = require('./routes/dvsa');
const parts = require('./routes/parts');
const command = require('./routes/command');

const PORT = process.env.PORT || 3000;
const FRONTEND = path.join(__dirname, '..', 'frontend');

// ══════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'DELETE') return resolve({});
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
};

function json(res, status, data) {
  const headers = { 'Content-Type': 'application/json', ...CORS };
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
};

function servePage(res, filename) {
  const fp = path.join(FRONTEND, filename);
  fs.readFile(fp, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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

async function handlePublicRoutes(ctx, req, res) {
  const { p, method } = ctx;

  if (PAGES[p] && method === 'GET') { servePage(res, PAGES[p]); return true; }

  if (p === '/api.js' && method === 'GET') {
    serveStatic(res, 'api.js', 'application/javascript');
    return true;
  }

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

  if (p === '/api/technician/login' && method === 'POST') {
    return handleTechnicianLogin(req, res);
  }

  if (p === '/api/technician/jobs' && method === 'GET') {
    return handleTechnicianJobs(req, res);
  }

  return false;
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

  return false;
}

async function handleWorkshop(ctx, req, res) {
  const { p, method, body, caller, qs } = ctx;

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

  return false;
}

async function handleInspect(ctx, res) {
  const { p, method, body, caller, qs } = ctx;

  if (p === '/api/inspections' && method === 'GET') { ok(res, await inspect.getInspections(caller, qs)); return true; }
  if (p === '/api/inspections' && method === 'POST') { created(res, await inspect.createInspection(body, caller)); return true; }

  const inspIdMatch = p.match(/^\/api\/inspections\/(\d+)$/);
  if (inspIdMatch) {
    const id = parseInt(inspIdMatch[1]);
    if (method === 'PUT') { ok(res, await inspect.updateInspection(body, caller, id)); return true; }
    if (method === 'DELETE') { ok(res, await inspect.deleteInspection(caller, id)); return true; }
  }

  if (p === '/api/sync/assigned-job' && method === 'POST') { ok(res, await inspect.receiveAssignedJob(body, caller)); return true; }

  if (p === '/api/defects' && method === 'GET') { ok(res, await inspect.getDefects(caller, qs)); return true; }
  const defectIdMatch = p.match(/^\/api\/defects\/(\d+)$/);
  if (defectIdMatch && method === 'PUT') { ok(res, await inspect.updateDefect(body, caller, parseInt(defectIdMatch[1]))); return true; }
  if (p === '/api/inspection-defects' && method === 'POST') { ok(res, await inspect.raiseDefects(body, caller)); return true; }

  return false;
}

async function handleParts(ctx, res) {
  const { p, method, body, caller, qs } = ctx;

  if (p === '/api/parts' && method === 'GET') { ok(res, await parts.getParts(caller, qs)); return true; }
  if (p === '/api/parts' && method === 'POST') { created(res, await parts.createPart(body, caller)); return true; }

  const partIdMatch = p.match(/^\/api\/parts\/(\d+)$/);
  if (partIdMatch) {
    const id = parseInt(partIdMatch[1]);
    if (method === 'PUT') { ok(res, await parts.updatePart(body, caller, id)); return true; }
    if (method === 'DELETE') { ok(res, await parts.deletePart(caller, id)); return true; }
  }

  if (p === '/api/inbound/job' && method === 'POST') { ok(res, await parts.receiveInboundJob(body, caller)); return true; }

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
    await renderInspectionPreview(parseInt(previewMatch[1]), res);
    return true;
  }

  return false;
}

async function sendInspectionReportRoute(inspId, body, caller, res) {
  const { email } = body;
  if (!email) { json(res, 400, { error: 'email required' }); return true; }
  const db = require('./db');
  const insp = await db.queryOne('SELECT * FROM inspections WHERE id = $1 AND org_id = $2', [inspId, caller.id || caller.org_id]);
  if (!insp) { json(res, 404, { error: 'Inspection not found' }); return true; }
  const { sendInspectionReport } = require('./mailer');
  const result2 = await sendInspectionReport({
    to: email,
    vehicleReg: insp.vehicle_reg,
    inspectionId: insp.inspection_id,
    result: insp.result,
    inspectorName: insp.inspector_name,
    notes: insp.notes,
    orgName: caller.org_name || 'HGVDesk'
  });
  ok(res, { sent: result2.sent, to: email });
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

async function renderInspectionPreview(inspId, res) {
  const { queryOne, queryAll } = require('./db');
  const insp = await queryOne('SELECT * FROM inspections WHERE id = $1', [inspId]);
  if (!insp) { res.writeHead(404); res.end('Not found'); return; }
  const defects = await queryAll('SELECT * FROM defects WHERE inspection_id = $1', [inspId]);
  const checks = parseMaybeJson(insp.check_items, []);
  const date = new Date(insp.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const resultColor = previewResultColor(insp.result);
  const resultLabel = (insp.result || 'Pending').toUpperCase();
  const checksHtml = buildChecksHtml(checks);
  const defectsHtml = buildDefectsHtml(defects);

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Inspection Report - ${insp.vehicle_reg}</title><link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:"DM Sans",-apple-system,sans-serif;background:#f5f5f7;color:#1d1d1f;padding:40px 20px;}.page{max-width:800px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;}.header{background:#1d1d1f;padding:32px 40px;color:#fff;display:flex;justify-content:space-between;align-items:flex-start;}.logo{font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#888;margin-bottom:8px;}.reg{font-size:36px;font-weight:700;letter-spacing:0.05em;}.result-badge{padding:8px 20px;border-radius:8px;font-size:14px;font-weight:700;letter-spacing:0.05em;background:${resultColor};color:#fff;}.body{padding:40px;}.section{margin-bottom:32px;}.section-title{font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#888;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #e5e5e5;}.meta-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:32px;}.meta-item{background:#f5f5f7;border-radius:10px;padding:16px;}.meta-label{font-size:11px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;}.meta-value{font-size:14px;font-weight:600;color:#1d1d1f;}@media print{body{background:#fff;padding:0;}.page{box-shadow:none;border-radius:0;}}.print-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 20px;background:#1d1d1f;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:24px;font-family:inherit;}@media print{.print-btn{display:none;}}</style></head><body><div style="max-width:800px;margin:0 auto 20px;"><button class="print-btn" onclick="window.print()">Print / Save PDF</button></div><div class="page"><div class="header"><div><div class="logo">HGVDesk &mdash; Inspection Report</div><div class="reg">${insp.vehicle_reg}</div><div style="font-size:14px;color:#888;margin-top:4px;">${insp.inspection_type} &bull; ${date}</div></div><div class="result-badge">${resultLabel}</div></div><div class="body"><div class="meta-grid"><div class="meta-item"><div class="meta-label">Inspection ID</div><div class="meta-value">${insp.inspection_id}</div></div><div class="meta-item"><div class="meta-label">Inspector</div><div class="meta-value">${insp.inspector_name || 'Not recorded'}</div></div><div class="meta-item"><div class="meta-label">Status</div><div class="meta-value">${insp.status}</div></div><div class="meta-item"><div class="meta-label">Nil Defect</div><div class="meta-value">${insp.nil_defect ? 'Yes' : 'No'}</div></div><div class="meta-item"><div class="meta-label">Mileage</div><div class="meta-value">${insp.overall_mileage || 'Not recorded'}</div></div><div class="meta-item"><div class="meta-label">Completed</div><div class="meta-value">${insp.completed_at ? new Date(insp.completed_at).toLocaleDateString('en-GB') : 'In progress'}</div></div></div><div class="section"><div class="section-title">Check Items</div>${checksHtml}</div><div class="section"><div class="section-title">Defects</div>${defectsHtml}</div>${insp.notes ? '<div class="section"><div class="section-title">Notes</div><p style="font-size:13px;color:#636366;line-height:1.6;">' + insp.notes + '</p></div>' : ''}</div></div></body></html>`;

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

async function router(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ctx = {
    p: parsed.pathname.replace(/\/+$/, '') || '/',
    method: req.method,
    qs: Object.fromEntries(parsed.searchParams),
    body: {},
    caller: null,
  };

  if (ctx.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (await handlePublicRoutes(ctx, req, res)) return;

  // ── ALL OTHER ROUTES REQUIRE AUTH ──
  try {
    ctx.caller = await getAuth(req);
  } catch (e) {
    return unauth(res, e.message || 'Unauthorised');
  }

  ctx.body = ['POST', 'PUT', 'PATCH'].includes(ctx.method) ? await readBody(req) : {};

  if (await handleAdmin(ctx, res)) return;
  if (await handleWorkshop(ctx, req, res)) return;
  if (await handleInspect(ctx, res)) return;
  if (await handleParts(ctx, res)) return;
  if (await handleCommand(ctx, res)) return;
  if (await handleInspectionReports(ctx, res)) return;
  if (await handleTechnicians(ctx, res)) return;
  if (await handleJobLibrary(ctx, res)) return;
  if (await handleCustomers(ctx, res)) return;
  if (await handleInvoices(ctx, res)) return;

  json(res, 404, { success: false, error: 'Not found' });
}

// ══════════════════════════════════════════════
// SERVER
// ══════════════════════════════════════════════

const server = http.createServer(async (req, res) => {
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
    console.log('║     HGV PLATFORM — FLEETCOMMAND.CO.UK        ║');
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
