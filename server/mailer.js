const https = require('https');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@hgvdesk.co.uk';
const ALERT_EMAIL = process.env.ALERT_EMAIL || 'james.m.smith54@outlook.com';

function resendSend(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const opts = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendFailedInspectionAlert({ vehicleReg, inspectorName, inspectionId, result, notes, orgName }) {
  if (!RESEND_API_KEY) { console.error('[MAILER] No RESEND_API_KEY set'); return; }
  const payload = {
    from: FROM_EMAIL,
    to: [ALERT_EMAIL],
    subject: '🚨 FAILED INSPECTION — ' + vehicleReg,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <div style="background:#ff3b30;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;">
          <h2 style="margin:0;font-size:18px;">Failed Inspection Alert</h2>
        </div>
        <div style="background:#f5f5f7;padding:20px;border-radius:0 0 10px 10px;border:1px solid #e5e5e7;border-top:none;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;font-size:12px;color:#888;font-weight:700;text-transform:uppercase;">Vehicle</td><td style="padding:8px 0;font-size:14px;font-weight:700;font-family:monospace;">${vehicleReg}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#888;font-weight:700;text-transform:uppercase;">Inspector</td><td style="padding:8px 0;font-size:14px;">${inspectorName || 'Unknown'}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#888;font-weight:700;text-transform:uppercase;">Inspection ID</td><td style="padding:8px 0;font-size:14px;">${inspectionId}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#888;font-weight:700;text-transform:uppercase;">Result</td><td style="padding:8px 0;font-size:14px;font-weight:700;color:#ff3b30;">${result ? result.toUpperCase() : 'FAIL'}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#888;font-weight:700;text-transform:uppercase;">Organisation</td><td style="padding:8px 0;font-size:14px;">${orgName || 'HGVDesk'}</td></tr>
            ${notes ? '<tr><td style="padding:8px 0;font-size:12px;color:#888;font-weight:700;text-transform:uppercase;vertical-align:top;">Notes</td><td style="padding:8px 0;font-size:14px;">' + notes + '</td></tr>' : ''}
          </table>
          <div style="margin-top:20px;">
            <a href="https://hgvdesk.co.uk/inspect" style="background:#1d1d1f;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">View in HGVDesk</a>
          </div>
        </div>
        <p style="font-size:11px;color:#888;margin-top:12px;text-align:center;">HGVDesk &bull; hgvdesk.co.uk</p>
      </div>
    `
  };
  try {
    const result2 = await resendSend(payload);
    if (result2.status === 200 || result2.status === 201) {
      console.log('[MAILER] Alert sent for ' + vehicleReg);
    } else {
      console.error('[MAILER] Failed:', JSON.stringify(result2.body));
    }
  } catch (err) {
    console.error('[MAILER] Error:', err.message);
  }
}

const { buildInspectionReportHtml } = require('./report-html');

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function resultColor(r) {
  if (r === 'pass') return '#1d9e75';
  if (r === 'advisory') return '#ff9500';
  return '#ff3b30';
}

function sectionHead(title) {
  return `<tr><td colspan="2" style="padding:16px 0 6px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#FF6B00;border-bottom:1px solid #e5e5e7;">${escapeHtml(title)}</td></tr>`;
}

function metaRow(label, val) {
  return `<tr><td style="padding:6px 0;font-size:12px;color:#888;font-weight:700;text-transform:uppercase;width:130px;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:6px 0;font-size:13px;">${escapeHtml(val)}</td></tr>`;
}

function buildCheckItemsHtml(checkItems) {
  if (!checkItems || typeof checkItems !== 'object') return '';
  const entries = Object.entries(checkItems);
  if (!entries.length) return '';
  let html = sectionHead('Check Items');
  for (const [item, state] of entries) {
    const color = state === 'pass' ? '#1d9e75' : state === 'fail' ? '#ff3b30' : '#ff9500';
    const label = String(state || 'n/a').toUpperCase();
    html += `<tr><td style="padding:4px 0;font-size:12px;">${escapeHtml(item)}</td><td style="padding:4px 0;font-size:12px;font-weight:700;color:${color};">${label}</td></tr>`;
  }
  return html;
}

function buildTyreHtml(tyreData) {
  if (!tyreData || typeof tyreData !== 'object') return '';
  const entries = Object.entries(tyreData);
  if (!entries.length) return '';
  let html = sectionHead('Tyre Data');
  html += '<tr><td colspan="2"><table style="width:100%;border-collapse:collapse;">';
  html += '<tr style="background:#f0f0f2;"><th style="padding:5px 8px;font-size:10px;font-weight:700;text-align:left;">Position</th><th style="padding:5px 8px;font-size:10px;font-weight:700;text-align:center;">Depth</th><th style="padding:5px 8px;font-size:10px;font-weight:700;text-align:center;">Condition</th></tr>';
  for (const [pos, data] of entries) {
    const d = typeof data === 'object' ? data : { depth: data };
    const cond = (d.condition || 'ok').toUpperCase();
    const condColor = cond === 'DEF' ? '#ff3b30' : cond === 'ADV' ? '#ff9500' : '#1d9e75';
    html += `<tr><td style="padding:4px 8px;font-size:12px;">${escapeHtml(pos)}</td><td style="padding:4px 8px;font-size:12px;text-align:center;">${escapeHtml(d.depth || d.tread || '-')}mm</td><td style="padding:4px 8px;font-size:12px;text-align:center;font-weight:700;color:${condColor};">${cond}</td></tr>`;
  }
  html += '</table></td></tr>';
  return html;
}

function buildBrakeHtml(brakeData) {
  if (!brakeData || typeof brakeData !== 'object') return '';
  let html = sectionHead('Brake Test Results');
  if (brakeData.sbe) html += metaRow('Service Brake Eff.', brakeData.sbe + '%');
  if (brakeData.pbe) html += metaRow('Parking Brake Eff.', brakeData.pbe + '%');
  const axles = brakeData.axles || {};
  for (const [axle, data] of Object.entries(axles)) {
    const d = typeof data === 'object' ? data : {};
    const pass = d.pass ? 'PASS' : 'FAIL';
    const color = d.pass ? '#1d9e75' : '#ff3b30';
    html += `<tr><td style="padding:4px 0;font-size:12px;">${escapeHtml(axle)}</td><td style="padding:4px 0;font-size:12px;font-weight:700;color:${color};">NS ${escapeHtml(d.ns||'-')}kN / OS ${escapeHtml(d.os||'-')}kN — ${pass}</td></tr>`;
  }
  return html;
}

function buildDefectsHtml(defects) {
  if (!defects || !defects.length) return '';
  let html = sectionHead('Defects (' + defects.length + ')');
  for (const d of defects) {
    const sevColor = d.severity === 'critical' ? '#ff3b30' : '#ff9500';
    const status = d.resolved ? '<span style="color:#1d9e75;font-weight:700;"> [RECTIFIED]</span>' : '';
    html += `<tr><td colspan="2" style="padding:8px 0;border-bottom:1px solid #f0f0f2;">
      <div style="font-size:13px;font-weight:600;">${escapeHtml(d.title || d.description || 'Defect')}</div>
      <div style="font-size:11px;color:${sevColor};font-weight:700;text-transform:uppercase;">${escapeHtml(d.severity)}${status}</div>
      ${d.description && d.description !== d.title ? '<div style="font-size:12px;color:#636366;margin-top:2px;">' + escapeHtml(d.description) + '</div>' : ''}
      ${d.resolved_by ? '<div style="font-size:11px;color:#1d9e75;margin-top:4px;">Rectified by: ' + escapeHtml(d.resolved_by) + '</div>' : ''}
      ${d.resolution_notes ? '<div style="font-size:11px;color:#636366;margin-top:2px;">Notes: ' + escapeHtml(d.resolution_notes) + '</div>' : ''}
    </td></tr>`;
  }
  return html;
}

async function sendInspectionReport({ to, inspection, orgName, aiSummary }) {
  if (!RESEND_API_KEY) { console.error('[MAILER] No RESEND_API_KEY set'); return { sent: false }; }
  const insp = inspection;
  const payload = {
    from: FROM_EMAIL,
    to: [to],
    subject: `Inspection Report — ${insp.vehicle_reg} — ${(insp.result || 'Pending').toUpperCase()}`,
    html: buildInspectionReportHtml(insp, { aiSummary, orgName }),
  };
  try {
    const r = await resendSend(payload);
    if (r.status === 200 || r.status === 201) {
      console.log('[MAILER] Report sent to ' + to);
      return { sent: true, to };
    }
    console.error('[MAILER] Report failed:', JSON.stringify(r.body));
    return { sent: false, message: JSON.stringify(r.body) };
  } catch (err) {
    console.error('[MAILER] Error:', err.message);
    return { sent: false, message: err.message };
  }
}

module.exports = { sendFailedInspectionAlert, sendInspectionReport };
