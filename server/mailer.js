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

async function sendInspectionReport({ to, vehicleReg, inspectionId, result, inspectorName, notes, orgName }) {
  if (!RESEND_API_KEY) { console.error('[MAILER] No RESEND_API_KEY set'); return { sent: false }; }
  const resultColor = result === 'pass' ? '#1d9e75' : result === 'advisory' ? '#ff9500' : '#ff3b30';
  const payload = {
    from: FROM_EMAIL,
    to: [to],
    subject: 'Inspection Report — ' + vehicleReg,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <div style="background:#1d1d1f;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;display:flex;align-items:center;justify-content:space-between;">
          <h2 style="margin:0;font-size:18px;">Inspection Report</h2>
          <span style="background:${resultColor};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;">${(result||'Pending').toUpperCase()}</span>
        </div>
        <div style="background:#f5f5f7;padding:20px;border-radius:0 0 10px 10px;border:1px solid #e5e5e7;border-top:none;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;font-size:12px;color:#888;font-weight:700;text-transform:uppercase;">Vehicle</td><td style="padding:8px 0;font-size:14px;font-weight:700;font-family:monospace;">${vehicleReg}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#888;font-weight:700;text-transform:uppercase;">Inspection ID</td><td style="padding:8px 0;font-size:14px;">${inspectionId}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#888;font-weight:700;text-transform:uppercase;">Inspector</td><td style="padding:8px 0;font-size:14px;">${inspectorName || 'Unknown'}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#888;font-weight:700;text-transform:uppercase;">Result</td><td style="padding:8px 0;font-size:14px;font-weight:700;color:${resultColor};">${(result||'Pending').toUpperCase()}</td></tr>
            ${notes ? '<tr><td style="padding:8px 0;font-size:12px;color:#888;font-weight:700;text-transform:uppercase;vertical-align:top;">Notes</td><td style="padding:8px 0;font-size:14px;">' + notes + '</td></tr>' : ''}
          </table>
          <div style="margin-top:20px;">
            <a href="https://hgvdesk.co.uk/inspect" style="background:#FF6B00;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">View Full Report</a>
          </div>
        </div>
        <p style="font-size:11px;color:#888;margin-top:12px;text-align:center;">HGVDesk &bull; hgvdesk.co.uk</p>
      </div>
    `
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
