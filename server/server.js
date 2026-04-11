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
// ROUTER
// ══════════════════════════════════════════════

async function router(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = parsed.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;
  const qs = Object.fromEntries(parsed.searchParams);

  // ── CORS PREFLIGHT ──
  if (method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  // ── STATIC PAGES ──
  if (PAGES[p] && method === 'GET') {
    return servePage(res, PAGES[p]);
  }

  // ── STATIC ASSETS ──
  if (p === '/api.js' && method === 'GET') {
    return serveStatic(res, 'api.js', 'application/javascript');
  }

  // ── HEALTH CHECK ──
  if (p === '/api/health') {
    return ok(res, {
      status: 'healthy',
      uptime: Math.floor(process.uptime()),
      systems: { workshop: 'live', inspect: 'live', parts: 'live', command: 'live' }
    });
  }

  // ── DVSA MOT HISTORY LOOKUP (replaces DVLA) ──
  if ((p === '/api/dvla/lookup' || p === '/api/dvsa/lookup') && method === 'POST') {
    const b = await readBody(req);
    const reg = (b.reg || '').toUpperCase().replace(/\s/g, '');
    if (!reg) return json(res, 400, { error: 'reg required' });

    const CLIENT_ID = process.env.DVSA_CLIENT_ID;
    const CLIENT_SECRET = process.env.DVSA_CLIENT_SECRET;
    const API_KEY = process.env.DVSA_API_KEY;
    const SCOPE = process.env.DVSA_SCOPE;
    const TOKEN_URL = process.env.DVSA_TOKEN_URL;

    if (!CLIENT_ID || !API_KEY) return json(res, 500, { error: 'DVSA not configured' });

    try {
      // Step 1: Get OAuth2 token
      const tokenPayload = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope: SCOPE
      }).toString();

      const tokenResult = await new Promise((resolve, reject) => {
        const url = new URL(TOKEN_URL);
        const opts = {
          hostname: url.hostname,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(tokenPayload)
          }
        };
        const req2 = https.request(opts, (res2) => {
          let data = '';
          res2.on('data', d => data += d);
          res2.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch (e) { resolve({}); }
          });
        });
        req2.on('error', reject);
        req2.write(tokenPayload);
        req2.end();
      });

      if (!tokenResult.access_token) {
        console.error('[DVSA TOKEN ERROR]', tokenResult);
        return json(res, 500, { error: 'DVSA authentication failed' });
      }

      // Step 2: Call MOT History API
      const motResult = await new Promise((resolve, reject) => {
        const opts = {
          hostname: 'history.mot.api.gov.uk',
          path: '/v1/trade/vehicles/registration/' + encodeURIComponent(reg),
          method: 'GET',
          headers: {
            'Accept': 'application/json+v6',
            'Authorization': 'Bearer ' + tokenResult.access_token,
            'x-api-key': API_KEY
          }
        };
        const req2 = https.request(opts, (res2) => {
          let data = '';
          res2.on('data', d => data += d);
          res2.on('end', () => {
            try { resolve({ status: res2.statusCode, body: JSON.parse(data) }); }
            catch (e) { resolve({ status: res2.statusCode, body: {} }); }
          });
        });
        req2.on('error', reject);
        req2.end();
      });

      if (motResult.status === 200) {
        const v = motResult.body;
        const tests = v.motTests || [];
        const latest = tests[0] || {};
        return ok(res, {
          reg,
          make: v.make || '',
          model: v.model || '',
          colour: v.primaryColour || '',
          year: v.manufactureYear || '',
          fuelType: v.fuelType || '',
          engineSize: v.engineSize || '',
          dvlaId: v.dvlaId || '',
          motExpiry: latest.expiryDate || '',
          motResult: latest.testResult || '',
          motDate: latest.completedDate || '',
          mileage: latest.odometerValue ? latest.odometerValue + ' ' + (latest.odometerUnit || 'mi') : '',
          defectsOnLatest: (latest.defects || []).filter(d => d.type === 'FAIL').map(d => d.text),
          advisoriesOnLatest: (latest.defects || []).filter(d => d.type === 'ADVISORY').map(d => d.text),
          testHistory: tests.slice(0, 10).map(t => ({
            date: t.completedDate,
            result: t.testResult,
            expiry: t.expiryDate,
            mileage: t.odometerValue ? t.odometerValue + ' ' + (t.odometerUnit || 'mi') : '',
            defects: (t.defects || []).filter(d => d.type === 'FAIL').length,
            advisories: (t.defects || []).filter(d => d.type === 'ADVISORY').length
          }))
        });
      }
      return json(res, motResult.status, { error: 'DVSA lookup failed', details: motResult.body });
    } catch (e) {
      console.error('[DVSA ERROR]', e.message);
      return json(res, 500, { error: 'DVSA lookup error' });
    }
  }

  // ── LOGIN (no auth required) ──
  if (p === '/api/auth/login' && method === 'POST') {
    const body = await readBody(req);
    const result = await command.handleLogin(body);
    return ok(res, result);
  }


  // ── TECHNICIAN LOGIN (no auth required) ──
  if (p === '/api/technician/login' && method === 'POST') {
    const b = await readBody(req);
    const { username, password } = b;
    if (!username || !password) return json(res, 400, { error: 'Username and password required' });
    const bcrypt = require('bcryptjs');
    const { queryOne } = require('./db');
    const { signToken } = require('./auth');
    const tech = await queryOne(
      'SELECT t.*, o.api_key FROM technicians t JOIN organisations o ON t.org_id = o.id WHERE t.username = $1 AND t.active = true AND o.active = true',
      [username.trim().toLowerCase()]
    );
    if (!tech) return json(res, 401, { error: 'Invalid username or password' });
    const valid = await bcrypt.compare(password, tech.password_hash);
    if (!valid) return json(res, 401, { error: 'Invalid username or password' });
    const token = signToken({ techId: tech.id, orgId: tech.org_id, role: 'technician' });
    return json(res, 200, { token, name: tech.name, apiKey: tech.api_key });
  }

  // ── TECHNICIAN JOBS (Bearer token required) ──
  if (p === '/api/technician/jobs' && method === 'GET') {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) return json(res, 401, { error: 'Unauthorised' });
    const { verifyToken } = require('./auth');
    const { queryOne, queryAll } = require('./db');
    let decoded;
    try { decoded = verifyToken(authHeader.slice(7)); } catch(e) { return json(res, 401, { error: 'Token invalid or expired' }); }
    if (decoded.role !== 'technician') return json(res, 403, { error: 'Forbidden' });
    const tech = await queryOne('SELECT name FROM technicians WHERE id = $1', [decoded.techId]);
    if (!tech) return json(res, 401, { error: 'Technician not found' });
    const jobs = await queryAll(
      'SELECT id, vehicle_reg, inspection_type, customer_name, priority, status, notes, created_at FROM jobs WHERE org_id = $1 AND technician_name = $2 ORDER BY created_at DESC',
      [decoded.orgId, tech.name]
    );
    return json(res, 200, { jobs });
  }

  // ══════════════════════════════════════════════
  // ALL OTHER ROUTES REQUIRE AUTH
  // ══════════════════════════════════════════════

  let caller;
  try {
    caller = await getAuth(req);
  } catch (e) {
    return unauth(res, e.message || 'Unauthorised');
  }

  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req) : {};

  // ── ADMIN API ──
  if (p === '/api/admin/organisations' && method === 'GET')
    return ok(res, await admin.getOrganisations(caller));

  if (p === '/api/admin/organisations' && method === 'POST')
    return ok(res, await admin.createOrganisation(body, caller));

  const orgIdMatch = p.match(/^\/api\/admin\/organisations\/(\d+)$/);
  if (orgIdMatch && method === 'PUT')
    return ok(res, await admin.updateOrganisation(body, caller, parseInt(orgIdMatch[1])));

  if (p === '/api/admin/users' && method === 'GET')
    return ok(res, await admin.getUsers(caller));

  if (p === '/api/admin/users' && method === 'POST')
    return ok(res, await admin.createUser(body, caller));

  const userIdMatch = p.match(/^\/api\/admin\/users\/(\d+)$/);
  if (userIdMatch && method === 'PUT')
    return ok(res, await admin.updateUser(body, caller, parseInt(userIdMatch[1])));

  // ── WORKSHOP API ──
  if (p === '/api/jobs' && method === 'GET')
    return ok(res, await workshop.getJobs(req, caller, qs));

  if (p === '/api/jobs' && method === 'POST')
    return created(res, await workshop.createJob(body, caller));

  const jobIdMatch = p.match(/^\/api\/jobs\/(\d+)$/);

  if (jobIdMatch && method === 'GET')
    return ok(res, await workshop.getJob(req, caller, parseInt(jobIdMatch[1])));

  if (jobIdMatch && method === 'PUT')
    return ok(res, await workshop.updateJob(body, caller, parseInt(jobIdMatch[1])));

  if (jobIdMatch && method === 'DELETE')
    return ok(res, await workshop.deleteJob(caller, parseInt(jobIdMatch[1])));

  const sendMatch = p.match(/^\/api\/jobs\/(\d+)\/send$/);
  if (sendMatch && method === 'POST')
    return ok(res, await workshop.sendToFloor(body, caller, parseInt(sendMatch[1])));

  if (p === '/api/sync/parts-update' && method === 'POST')
    return ok(res, await workshop.receivePartsUpdate(body, caller));

  // ── INSPECT API ──
  if (p === '/api/inspections' && method === 'GET')
    return ok(res, await inspect.getInspections(caller, qs));

  if (p === '/api/inspections' && method === 'POST')
    return created(res, await inspect.createInspection(body, caller));

  const inspIdMatch = p.match(/^\/api\/inspections\/(\d+)$/);

  if (inspIdMatch && method === 'PUT')
    return ok(res, await inspect.updateInspection(body, caller, parseInt(inspIdMatch[1])));

  if (inspIdMatch && method === 'DELETE')
    return ok(res, await inspect.deleteInspection(caller, parseInt(inspIdMatch[1])));

  if (p === '/api/sync/assigned-job' && method === 'POST')
    return ok(res, await inspect.receiveAssignedJob(body, caller));

  if (p === '/api/defects' && method === 'GET') { return ok(res, await inspect.getDefects(caller, qs)); }
  const defectIdMatch = p.match(/^\/api\/defects\/(\d+)$/);
  if (defectIdMatch && method === 'PUT') { return ok(res, await inspect.updateDefect(body, caller, parseInt(defectIdMatch[1]))); }
  if (p === '/api/inspection-defects' && method === 'POST') {
    return ok(res, await inspect.raiseDefects(body, caller));
  }

  // ── PARTS API ──
  if (p === '/api/parts' && method === 'GET') {
    return ok(res, await parts.getParts(caller, qs));
  }

  if (p === '/api/parts' && method === 'POST')
    return created(res, await parts.createPart(body, caller));

  const partIdMatch = p.match(/^\/api\/parts\/(\d+)$/);

  if (partIdMatch && method === 'PUT')
    return ok(res, await parts.updatePart(body, caller, parseInt(partIdMatch[1])));

  if (partIdMatch && method === 'DELETE')
    return ok(res, await parts.deletePart(caller, parseInt(partIdMatch[1])));

  if (p === '/api/inbound/job' && method === 'POST')
    return ok(res, await parts.receiveInboundJob(body, caller));

  // ── COMMAND API ──
  if (p === '/api/overview' && method === 'GET')
    return ok(res, await command.getOverview(caller));

  if (p === '/api/activity' && method === 'GET')
    return ok(res, await command.getActivity(caller, qs));


  // INSPECTION REPORT PREVIEW
  // ── INSPECTION REPORT SEND ──
  const reportSendMatch = p.match(/^\/api\/inspections\/(\d+)\/report$/);
  if (reportSendMatch && method === 'POST') {
    const inspId = parseInt(reportSendMatch[1]);
    const { email } = body;
    if (!email) return json(res, 400, { error: 'email required' });
    const db = require('./db');
    const insp = await db.queryOne('SELECT * FROM inspections WHERE id = $1 AND org_id = $2', [inspId, caller.id || caller.org_id]);
    if (!insp) return json(res, 404, { error: 'Inspection not found' });
    const { sendInspectionReport } = require('./mailer');
    const result2 = await sendInspectionReport({
      to: email,
      vehicleReg: insp.vehicle_reg,
      inspectionId: insp.inspection_id,
      result: insp.result,
      inspectorName: insp.inspector_name,
      notes: insp.notes,
      orgName: caller.org_name || 'HGV Manager'
    });
    return ok(res, { sent: result2.sent, to: email });
  }

  const previewMatch = p.match(/^\/api\/inspections\/(\d+)\/report\/preview$/);
  if (previewMatch && method === 'GET') {
    const { queryOne, queryAll } = require('./db');
    const inspId = parseInt(previewMatch[1]);
    const insp = await queryOne('SELECT * FROM inspections WHERE id = $1', [inspId]);
    if (!insp) { res.writeHead(404); res.end('Not found'); return; }
    const defects = await queryAll('SELECT * FROM defects WHERE inspection_id = $1', [inspId]);
    const checks = insp.check_items ? JSON.parse(insp.check_items) : [];
    const tyres = insp.tyre_data ? JSON.parse(insp.tyre_data) : null;
    const date = new Date(insp.created_at).toLocaleDateString('en-GB', {day:'2-digit',month:'long',year:'numeric'});
    const resultColor = insp.result === 'pass' ? '#1d9e75' : insp.result === 'fail' ? '#e24b4a' : insp.result === 'advisory' ? '#ba7517' : '#636366';
    const resultLabel = (insp.result || 'Pending').toUpperCase();

    let checksHtml = '';
    if (checks.length) {
      checksHtml = '<table style="width:100%;border-collapse:collapse;margin-bottom:24px;"><thead><tr style="background:#f5f5f7;"><th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#636366;border-bottom:1px solid #e5e5e5;">Check Item</th><th style="padding:10px 12px;text-align:center;font-size:12px;font-weight:600;color:#636366;border-bottom:1px solid #e5e5e5;">Result</th><th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#636366;border-bottom:1px solid #e5e5e5;">Notes</th></tr></thead><tbody>';
      for (const c of checks) {
        const cr = (c.result || c.state || '').toLowerCase();
        const cc = cr === 'pass' ? '#1d9e75' : cr === 'fail' ? '#e24b4a' : cr === 'advisory' || cr === 'adv' ? '#ba7517' : '#636366';
        checksHtml += '<tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:10px 12px;font-size:13px;">' + (c.label || c.name || c.id || '') + '</td><td style="padding:10px 12px;text-align:center;"><span style="font-size:11px;font-weight:700;color:' + cc + ';text-transform:uppercase;">' + (cr || '-') + '</span></td><td style="padding:10px 12px;font-size:12px;color:#636366;">' + (c.notes || '-') + '</td></tr>';
      }
      checksHtml += '</tbody></table>';
    } else {
      checksHtml = '<p style="color:#636366;font-size:13px;margin-bottom:24px;">No check items recorded.</p>';
    }

    let defectsHtml = '';
    if (defects.length) {
      defectsHtml = '<table style="width:100%;border-collapse:collapse;margin-bottom:24px;"><thead><tr style="background:#fff5f5;"><th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#636366;border-bottom:1px solid #e5e5e5;">Defect</th><th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#636366;border-bottom:1px solid #e5e5e5;">Category</th><th style="padding:10px 12px;text-align:center;font-size:12px;font-weight:600;color:#636366;border-bottom:1px solid #e5e5e5;">Severity</th><th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#636366;border-bottom:1px solid #e5e5e5;">Description</th></tr></thead><tbody>';
      for (const d of defects) {
        const sc = d.severity === 'critical' ? '#e24b4a' : d.severity === 'major' ? '#ba7517' : '#636366';
        defectsHtml += '<tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:10px 12px;font-size:13px;font-weight:600;">' + (d.title || '') + '</td><td style="padding:10px 12px;font-size:12px;color:#636366;">' + (d.category || '') + '</td><td style="padding:10px 12px;text-align:center;"><span style="font-size:11px;font-weight:700;color:' + sc + ';text-transform:uppercase;">' + (d.severity || '') + '</span></td><td style="padding:10px 12px;font-size:12px;color:#636366;">' + (d.description || '-') + '</td></tr>';
      }
      defectsHtml += '</tbody></table>';
    } else {
      defectsHtml = '<p style="color:#1d9e75;font-size:13px;margin-bottom:24px;">No defects recorded.</p>';
    }

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Inspection Report - ${insp.vehicle_reg}</title><link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:"DM Sans",-apple-system,sans-serif;background:#f5f5f7;color:#1d1d1f;padding:40px 20px;}.page{max-width:800px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;}.header{background:#1d1d1f;padding:32px 40px;color:#fff;display:flex;justify-content:space-between;align-items:flex-start;}.logo{font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#888;margin-bottom:8px;}.reg{font-size:36px;font-weight:700;letter-spacing:0.05em;}.result-badge{padding:8px 20px;border-radius:8px;font-size:14px;font-weight:700;letter-spacing:0.05em;background:${resultColor};color:#fff;}.body{padding:40px;}.section{margin-bottom:32px;}.section-title{font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#888;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #e5e5e5;}.meta-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:32px;}.meta-item{background:#f5f5f7;border-radius:10px;padding:16px;}.meta-label{font-size:11px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;}.meta-value{font-size:14px;font-weight:600;color:#1d1d1f;}@media print{body{background:#fff;padding:0;}.page{box-shadow:none;border-radius:0;}}.print-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 20px;background:#1d1d1f;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:24px;font-family:inherit;}@media print{.print-btn{display:none;}}</style></head><body><div style="max-width:800px;margin:0 auto 20px;"><button class="print-btn" onclick="window.print()">Print / Save PDF</button></div><div class="page"><div class="header"><div><div class="logo">HGV Manager &mdash; Inspection Report</div><div class="reg">${insp.vehicle_reg}</div><div style="font-size:14px;color:#888;margin-top:4px;">${insp.inspection_type} &bull; ${date}</div></div><div class="result-badge">${resultLabel}</div></div><div class="body"><div class="meta-grid"><div class="meta-item"><div class="meta-label">Inspection ID</div><div class="meta-value">${insp.inspection_id}</div></div><div class="meta-item"><div class="meta-label">Inspector</div><div class="meta-value">${insp.inspector_name || 'Not recorded'}</div></div><div class="meta-item"><div class="meta-label">Status</div><div class="meta-value">${insp.status}</div></div><div class="meta-item"><div class="meta-label">Nil Defect</div><div class="meta-value">${insp.nil_defect ? 'Yes' : 'No'}</div></div><div class="meta-item"><div class="meta-label">Mileage</div><div class="meta-value">${insp.overall_mileage || 'Not recorded'}</div></div><div class="meta-item"><div class="meta-label">Completed</div><div class="meta-value">${insp.completed_at ? new Date(insp.completed_at).toLocaleDateString('en-GB') : 'In progress'}</div></div></div><div class="section"><div class="section-title">Check Items</div>${checksHtml}</div><div class="section"><div class="section-title">Defects</div>${defectsHtml}</div>${insp.notes ? '<div class="section"><div class="section-title">Notes</div><p style="font-size:13px;color:#636366;line-height:1.6;">' + insp.notes + '</p></div>' : ''}</div></div></body></html>`;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // TECHNICIANS
  if (p === '/api/technicians' && method === 'GET') { return json(res, 200, await technicians.listTechnicians(caller)); }
  if (p === '/api/technicians' && method === 'POST') { return json(res, 200, await technicians.createTechnician(body, caller)); }
  const techMatch = p.match(/^\/api\/technicians\/(\d+)$/);
  if (techMatch && method === 'PUT') { return json(res, 200, await technicians.updateTechnician(caller, parseInt(techMatch[1]), body)); }
  if (techMatch && method === 'DELETE') { return json(res, 200, await technicians.deleteTechnician(caller, parseInt(techMatch[1]))); }
  const techReset = p.match(/^\/api\/technicians\/(\d+)\/reset-password$/);
  // ── JOB LIBRARY API ──
  if (p === '/api/job-library' && method === 'GET') { return ok(res, await workshop.getJobLibrary(caller)); }
  const jobLinesMatch = p.match(/^\/api\/jobs\/(\d+)\/lines$/);
  if (jobLinesMatch && method === 'GET') { return ok(res, await workshop.getJobLines(caller, parseInt(jobLinesMatch[1]))); }
  if (jobLinesMatch && method === 'POST') { return ok(res, await workshop.saveJobLines(body, caller, parseInt(jobLinesMatch[1]))); }

  // ── CUSTOMERS API ──
  if (p === '/api/customers' && method === 'GET') { return ok(res, await billing.getCustomers(caller)); }
  if (p === '/api/customers' && method === 'POST') { return created(res, await billing.createCustomer(body, caller)); }
  const custMatch = p.match(/^\/api\/customers\/(\d+)$/);
  if (custMatch && method === 'PUT') { return ok(res, await billing.updateCustomer(body, caller, parseInt(custMatch[1]))); }
  if (custMatch && method === 'DELETE') { return ok(res, await billing.deleteCustomer(caller, parseInt(custMatch[1]))); }

  // ── INVOICES API ──
  if (p === '/api/invoices' && method === 'GET') { return ok(res, await billing.getInvoices(caller, qs)); }
  if (p === '/api/invoices' && method === 'POST') { return created(res, await billing.createInvoice(body, caller)); }
  if (p === '/api/invoices/generate-from-job' && method === 'POST') { return created(res, await billing.generateFromJob(body, caller)); }
  const invMatch = p.match(/^\/api\/invoices\/(\d+)$/);
  if (invMatch && method === 'GET') { return ok(res, await billing.getInvoice(caller, parseInt(invMatch[1]))); }
  if (invMatch && method === 'DELETE') { return ok(res, await billing.deleteInvoice(caller, parseInt(invMatch[1]))); }
  const invStatusMatch = p.match(/^\/api\/invoices\/(\d+)\/status$/);
  if (invStatusMatch && method === 'PUT') { return ok(res, await billing.updateInvoiceStatus(body, caller, parseInt(invStatusMatch[1]))); }

  // ── 404 ──




  if (techReset && method === 'POST') { return json(res, 200, await technicians.resetPassword(caller, parseInt(techReset[1]))); }

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
