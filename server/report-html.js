/**
 * HGVDESK — Premium report HTML builder
 * Shared across: email (mailer.js), preview (server.js), invoice
 * Uses table-based layout for email client compatibility.
 */

const C = {
  dark: '#0d1f2d',
  darkMid: '#16293a',
  orange: '#f55a00',
  orangeLight: '#ff7a2e',
  bg: '#f2f4f6',
  card: '#ffffff',
  border: '#e5e7ea',
  text: '#1a2332',
  muted: '#6b7b8d',
  label: '#8694a5',
  passGreen: '#3b6d11',
  passBg: '#eaf3de',
  advAmber: '#854f0b',
  advBg: '#faeeda',
  failRed: '#a32d2d',
  failBg: '#fcebeb',
  repairGreen: '#1d9e75',
  repairBg: '#e8f8f2',
};

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
    dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function resultBadge(result) {
  const r = (result || 'pending').toLowerCase();
  let bg, color, label;
  if (r === 'pass') { bg = C.passBg; color = C.passGreen; label = 'PASS'; }
  else if (r === 'advisory') { bg = C.advBg; color = C.advAmber; label = 'ADVISORY'; }
  else if (r === 'fail') { bg = C.failBg; color = C.failRed; label = 'FAIL'; }
  else { bg = '#eee'; color = '#666'; label = 'PENDING'; }
  return `<span style="display:inline-block;padding:4px 12px;border-radius:4px;background:${bg};color:${color};font-size:11px;font-weight:700;letter-spacing:1px;">${label}</span>`;
}

function condBadge(cond) {
  const c = (cond || 'ok').toLowerCase();
  if (c === 'ok') return `<span style="display:inline-block;padding:2px 8px;border-radius:3px;background:${C.passBg};color:${C.passGreen};font-size:10px;font-weight:700;">OK</span>`;
  if (c === 'adv') return `<span style="display:inline-block;padding:2px 8px;border-radius:3px;background:${C.advBg};color:${C.advAmber};font-size:10px;font-weight:700;">ADV</span>`;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:3px;background:${C.failBg};color:${C.failRed};font-size:10px;font-weight:700;">DEF</span>`;
}

function sevBadge(severity) {
  const s = (severity || 'advisory').toLowerCase();
  if (s === 'critical') return `<span style="display:inline-block;padding:3px 10px;border-radius:3px;background:${C.failBg};color:${C.failRed};font-size:10px;font-weight:700;letter-spacing:0.5px;">CRITICAL</span>`;
  return `<span style="display:inline-block;padding:3px 10px;border-radius:3px;background:${C.advBg};color:${C.advAmber};font-size:10px;font-weight:700;letter-spacing:0.5px;">ADVISORY</span>`;
}

function sectionTitle(title) {
  return `<tr><td colspan="4" style="padding:24px 0 8px;"><div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${C.label};">${esc(title)}</div></td></tr>`;
}

// ══════════════════════════════════════════════
// INSPECTION REPORT
// ══════════════════════════════════════════════

function buildInspectionReportHtml(insp, opts = {}) {
  const { aiSummary, orgName } = opts;
  const result = (insp.result || 'pending').toLowerCase();
  const checkItems = (typeof insp.check_items === 'string' ? JSON.parse(insp.check_items) : insp.check_items) || (insp.checkItems || {});
  const tyreData = (typeof insp.tyre_data === 'string' ? JSON.parse(insp.tyre_data) : insp.tyre_data) || (insp.tyreData || {});
  const brakeData = (typeof insp.brake_test_data === 'string' ? JSON.parse(insp.brake_test_data) : insp.brake_test_data) || (insp.brakeData || {});
  const defects = insp.defects || [];

  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Inspection Report — ${esc(insp.vehicle_reg)}</title></head><body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${C.text};font-size:13px;line-height:1.6;">`;
  html += `<table width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;margin:0 auto;">`;

  // ── Dark header ──
  html += `<tr><td style="background:${C.dark};padding:20px 28px;border-radius:8px 8px 0 0;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:16px;font-weight:700;color:#fff;letter-spacing:-0.5px;">HGV<span style="color:${C.orange};">Desk</span></td>
      <td style="text-align:right;font-size:11px;color:#8694a5;line-height:1.5;">${esc(insp.inspection_id || '')}<br>${esc(insp.inspection_type || 'T50')} &bull; ${fmtDate(insp.completed_at || insp.created_at)}</td>
    </tr></table>
  </td></tr>`;

  // ── Orange vehicle bar ──
  html += `<tr><td style="background:${C.orange};padding:16px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><div style="font-size:26px;font-weight:700;color:#fff;letter-spacing:1px;font-family:monospace;">${esc(insp.vehicle_reg)}</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:2px;">${esc(insp.customer_name || '')} ${insp.overall_mileage ? '&bull; ' + Number(insp.overall_mileage).toLocaleString() + ' miles' : ''}</div></td>
      <td style="text-align:right;vertical-align:middle;">${resultBadge(result)}</td>
    </tr></table>
  </td></tr>`;

  // ── Body ──
  html += `<tr><td style="background:${C.card};padding:24px 28px;">`;
  html += `<table width="100%" cellpadding="0" cellspacing="0">`;

  // AI Summary
  if (aiSummary) {
    html += `<tr><td colspan="4" style="padding-bottom:20px;">
      <div style="background:${C.dark};border-radius:6px;padding:16px 20px;border-left:4px solid ${C.orange};">
        <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${C.orange};margin-bottom:6px;">AI Inspection Summary</div>
        <div style="font-size:13px;line-height:1.6;color:#e0e6ec;">${esc(aiSummary)}</div>
      </div>
    </td></tr>`;
  }

  // Inspector info
  html += sectionTitle('Inspection Details');
  html += `<tr>
    <td style="padding:4px 0;font-size:12px;color:${C.muted};width:25%;">Inspector</td><td style="padding:4px 0;font-size:13px;width:25%;">${esc(insp.inspector_name || '—')}</td>
    <td style="padding:4px 0;font-size:12px;color:${C.muted};width:25%;">Status</td><td style="padding:4px 0;font-size:13px;width:25%;">${esc(insp.status || '—')}</td>
  </tr>`;
  if (insp.nil_defect) {
    html += `<tr><td colspan="4" style="padding:10px 0;"><div style="background:${C.passBg};border:1px solid #c8e0a8;border-radius:6px;padding:12px 16px;text-align:center;color:${C.passGreen};font-weight:700;font-size:14px;">NIL DEFECT — No defects found</div></td></tr>`;
  }

  // Check items (3-col grid via table)
  const checkEntries = Object.entries(checkItems);
  if (checkEntries.length) {
    html += sectionTitle(`Check Items (${checkEntries.length})`);
    for (let i = 0; i < checkEntries.length; i += 3) {
      html += '<tr>';
      for (let j = 0; j < 3; j++) {
        const entry = checkEntries[i + j];
        if (!entry) { html += '<td style="width:33%;"></td>'; continue; }
        const [name, state] = entry;
        const label = name.replace(/_/g, ' ');
        let badge;
        const st = (state || '').toLowerCase();
        if (st === 'pass') badge = `<span style="color:${C.passGreen};font-weight:700;font-size:10px;">PASS</span>`;
        else if (st === 'fail') badge = `<span style="color:${C.failRed};font-weight:700;font-size:10px;">FAIL</span>`;
        else badge = `<span style="color:${C.advAmber};font-weight:700;font-size:10px;">${esc(st.toUpperCase())}</span>`;
        html += `<td style="width:33%;padding:5px 8px 5px 0;"><div style="background:${C.bg};border-radius:4px;padding:6px 10px;display:flex;justify-content:space-between;"><span style="font-size:11px;color:${C.text};">${esc(label)}</span>${badge}</div></td>`;
      }
      html += '</tr>';
    }
  }

  // Brake test
  if (brakeData && (brakeData.sbe || brakeData.pbe || brakeData.axles)) {
    html += sectionTitle('Brake Test Results');
    const metrics = [
      { label: 'Service Brake', value: brakeData.sbe != null ? brakeData.sbe + '%' : '—' },
      { label: 'Park Brake', value: brakeData.pbe != null ? brakeData.pbe + '%' : '—' },
    ];
    // Calculate max imbalance from axles
    const axles = brakeData.axles || {};
    let maxImb = 0;
    for (const a of Object.values(axles)) {
      if (a && typeof a === 'object' && a.imb != null) maxImb = Math.max(maxImb, a.imb);
    }
    metrics.push({ label: 'Max Imbalance', value: maxImb + '%' });
    const allPass = Object.values(axles).every(a => a && a.pass);
    metrics.push({ label: 'Overall', value: allPass ? 'PASS' : 'FAIL' });

    html += '<tr>';
    for (const m of metrics) {
      const isPass = m.value === 'PASS';
      const isFail = m.value === 'FAIL';
      const vColor = isPass ? C.passGreen : isFail ? C.failRed : C.text;
      html += `<td style="width:25%;padding:4px;"><div style="background:${C.bg};border-radius:6px;padding:12px;text-align:center;">
        <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${C.label};margin-bottom:4px;">${esc(m.label)}</div>
        <div style="font-size:20px;font-weight:700;color:${vColor};">${esc(m.value)}</div>
      </div></td>`;
    }
    html += '</tr>';

    // Per-axle table
    if (Object.keys(axles).length) {
      html += `<tr><td colspan="4" style="padding:8px 0;"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:4px;overflow:hidden;">
        <tr style="background:${C.bg};"><th style="padding:6px 10px;font-size:10px;font-weight:700;text-align:left;color:${C.label};letter-spacing:1px;">AXLE</th><th style="padding:6px 10px;font-size:10px;font-weight:700;text-align:center;color:${C.label};">NS (kN)</th><th style="padding:6px 10px;font-size:10px;font-weight:700;text-align:center;color:${C.label};">OS (kN)</th><th style="padding:6px 10px;font-size:10px;font-weight:700;text-align:center;color:${C.label};">IMB %</th><th style="padding:6px 10px;font-size:10px;font-weight:700;text-align:center;color:${C.label};">RESULT</th></tr>`;
      for (const [name, a] of Object.entries(axles)) {
        const pr = a.pass ? `<span style="color:${C.passGreen};font-weight:700;">PASS</span>` : `<span style="color:${C.failRed};font-weight:700;">FAIL</span>`;
        html += `<tr style="border-top:1px solid ${C.border};"><td style="padding:6px 10px;font-size:12px;">${esc(name)}</td><td style="padding:6px 10px;font-size:12px;text-align:center;">${a.ns != null ? a.ns : '—'}</td><td style="padding:6px 10px;font-size:12px;text-align:center;">${a.os != null ? a.os : '—'}</td><td style="padding:6px 10px;font-size:12px;text-align:center;">${a.imb != null ? a.imb + '%' : '—'}</td><td style="padding:6px 10px;font-size:12px;text-align:center;">${pr}</td></tr>`;
      }
      html += '</table></td></tr>';
    }
  }

  // Tyre data
  const tyreEntries = Object.entries(tyreData);
  if (tyreEntries.length) {
    html += sectionTitle(`Tyre Data (${tyreEntries.length} positions)`);
    html += `<tr><td colspan="4" style="padding:4px 0;"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:4px;overflow:hidden;">
      <tr style="background:${C.bg};"><th style="padding:6px 10px;font-size:10px;font-weight:700;text-align:left;color:${C.label};letter-spacing:1px;">POSITION</th><th style="padding:6px 10px;font-size:10px;font-weight:700;text-align:center;color:${C.label};">DEPTH</th><th style="padding:6px 10px;font-size:10px;font-weight:700;text-align:center;color:${C.label};">EXPIRY</th><th style="padding:6px 10px;font-size:10px;font-weight:700;text-align:center;color:${C.label};">CONDITION</th></tr>`;
    for (const [pos, data] of tyreEntries) {
      const d = typeof data === 'object' ? data : { depth: data };
      html += `<tr style="border-top:1px solid ${C.border};"><td style="padding:6px 10px;font-size:12px;">${esc(pos)}</td><td style="padding:6px 10px;font-size:12px;text-align:center;">${d.depth || d.tread || '—'} mm</td><td style="padding:6px 10px;font-size:12px;text-align:center;">${esc(d.expiry || '—')}</td><td style="padding:6px 10px;font-size:12px;text-align:center;">${condBadge(d.condition)}</td></tr>`;
    }
    html += '</table></td></tr>';
  }

  // Defects
  if (defects.length) {
    html += sectionTitle(`Defects (${defects.length})`);
    for (const d of defects) {
      html += `<tr><td colspan="4" style="padding:6px 0;">
        <div style="border:1px solid ${d.resolved ? '#c8e0a8' : C.border};border-radius:6px;padding:14px 16px;${d.resolved ? 'border-left:4px solid ' + C.repairGreen + ';' : 'border-left:4px solid ' + C.failRed + ';'}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:13px;font-weight:600;">${esc(d.title || d.description || 'Defect')}</span>
            ${sevBadge(d.severity)}
          </div>
          ${d.description && d.description !== d.title ? '<div style="font-size:12px;color:' + C.muted + ';margin-bottom:6px;">' + esc(d.description) + '</div>' : ''}
          ${d.resolved ? '<div style="background:' + C.repairBg + ';border-radius:4px;padding:10px 12px;margin-top:8px;"><div style="font-size:10px;font-weight:700;letter-spacing:1px;color:' + C.repairGreen + ';margin-bottom:4px;">REPAIRED</div>' + (d.resolved_by ? '<div style="font-size:12px;color:' + C.text + ';">By: ' + esc(d.resolved_by) + '</div>' : '') + (d.resolution_notes ? '<div style="font-size:12px;color:' + C.text + ';">' + esc(d.resolution_notes) + '</div>' : '') + '</div>' : ''}
        </div>
      </td></tr>`;
    }
  }

  // Notes
  if (insp.notes) {
    html += sectionTitle('Inspector Notes');
    html += `<tr><td colspan="4" style="padding:6px 0;font-size:13px;line-height:1.6;color:${C.text};">${esc(insp.notes)}</td></tr>`;
  }

  // Sign-off row
  html += sectionTitle('Sign-Off');
  const signoff = [
    { label: 'Technician', value: insp.inspector_name || '—' },
    { label: 'Completed', value: fmtDateTime(insp.completed_at) },
    { label: 'Created', value: fmtDateTime(insp.created_at) },
    { label: 'Nil Defect', value: insp.nil_defect ? 'Yes' : 'No' },
  ];
  html += '<tr>';
  for (const s of signoff) {
    html += `<td style="width:25%;padding:4px;"><div style="background:${C.bg};border-radius:6px;padding:10px 12px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${C.label};margin-bottom:3px;">${esc(s.label)}</div>
      <div style="font-size:12px;font-weight:600;color:${C.text};">${esc(s.value)}</div>
    </div></td>`;
  }
  html += '</tr>';

  html += `</table></td></tr>`;

  // ── Footer ──
  html += `<tr><td style="background:${C.darkMid};padding:16px 28px;border-radius:0 0 8px 8px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:11px;color:#8694a5;">HGV<span style="color:${C.orange};">Desk</span> &bull; ${esc(orgName || 'HGVDesk')}</td>
      <td style="text-align:right;font-size:10px;color:#5a6a7d;">${esc(insp.inspection_id || '')} &bull; Generated ${fmtDateTime(new Date())}</td>
    </tr></table>
  </td></tr>`;

  html += `</table></body></html>`;
  return html;
}

// ══════════════════════════════════════════════
// INVOICE
// ══════════════════════════════════════════════

function buildInvoiceHtml(invoice, lines, opts = {}) {
  const { orgName } = opts;
  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoice ${esc(invoice.invoice_number)}</title></head><body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${C.text};font-size:13px;line-height:1.6;">`;
  html += `<table width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;margin:0 auto;">`;

  // Header
  html += `<tr><td style="background:${C.dark};padding:20px 28px;border-radius:8px 8px 0 0;">
    <table width="100%"><tr>
      <td style="font-size:16px;font-weight:700;color:#fff;">HGV<span style="color:${C.orange};">Desk</span></td>
      <td style="text-align:right;font-size:20px;font-weight:700;letter-spacing:1px;color:${C.orange};">INVOICE</td>
    </tr></table>
  </td></tr>`;

  // Orange bar
  html += `<tr><td style="background:${C.orange};padding:14px 28px;">
    <table width="100%"><tr>
      <td style="color:#fff;font-size:14px;font-weight:600;">${esc(invoice.invoice_number)}</td>
      <td style="color:rgba(255,255,255,0.85);font-size:12px;">${esc(invoice.customer_name || '')}</td>
      <td style="text-align:right;color:rgba(255,255,255,0.85);font-size:12px;">Issued: ${fmtDate(invoice.issue_date)}</td>
      <td style="text-align:right;color:#fff;font-size:12px;font-weight:600;">Due: ${fmtDate(invoice.due_date)}</td>
    </tr></table>
  </td></tr>`;

  // Body
  html += `<tr><td style="background:${C.card};padding:24px 28px;">`;
  html += `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:4px;overflow:hidden;">`;
  html += `<tr style="background:${C.bg};"><th style="padding:8px 12px;font-size:10px;font-weight:700;text-align:left;color:${C.label};letter-spacing:1px;">DESCRIPTION</th><th style="padding:8px 12px;font-size:10px;font-weight:700;text-align:center;color:${C.label};">QTY</th><th style="padding:8px 12px;font-size:10px;font-weight:700;text-align:right;color:${C.label};">UNIT PRICE</th><th style="padding:8px 12px;font-size:10px;font-weight:700;text-align:right;color:${C.label};">TOTAL</th></tr>`;
  for (let i = 0; i < (lines || []).length; i++) {
    const l = lines[i];
    const rowBg = i % 2 ? C.bg : C.card;
    html += `<tr style="background:${rowBg};border-top:1px solid ${C.border};"><td style="padding:8px 12px;font-size:12px;">${esc(l.description || l.name)}</td><td style="padding:8px 12px;font-size:12px;text-align:center;">${l.quantity || 1}</td><td style="padding:8px 12px;font-size:12px;text-align:right;">&pound;${Number(l.unit_price || 0).toFixed(2)}</td><td style="padding:8px 12px;font-size:12px;text-align:right;font-weight:600;">&pound;${Number(l.line_total || 0).toFixed(2)}</td></tr>`;
  }
  html += '</table>';

  // Totals
  html += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
    <tr><td></td><td style="width:200px;text-align:right;padding:4px 0;font-size:12px;color:${C.muted};">Subtotal</td><td style="width:100px;text-align:right;padding:4px 0;font-size:13px;">&pound;${Number(invoice.subtotal || 0).toFixed(2)}</td></tr>
    <tr><td></td><td style="text-align:right;padding:4px 0;font-size:12px;color:${C.muted};">VAT (20%)</td><td style="text-align:right;padding:4px 0;font-size:13px;">&pound;${Number(invoice.vat_amount || 0).toFixed(2)}</td></tr>
    <tr><td></td><td style="text-align:right;padding:8px 0 4px;font-size:14px;font-weight:700;border-top:2px solid ${C.dark};">Total</td><td style="text-align:right;padding:8px 0 4px;font-size:18px;font-weight:700;border-top:2px solid ${C.dark};">&pound;${Number(invoice.total || 0).toFixed(2)}</td></tr>
  </table>`;

  if (invoice.notes) {
    html += `<div style="margin-top:20px;padding:12px;background:${C.bg};border-radius:4px;font-size:12px;color:${C.muted};">${esc(invoice.notes)}</div>`;
  }

  html += `</td></tr>`;

  // Footer
  html += `<tr><td style="background:${C.darkMid};padding:16px 28px;border-radius:0 0 8px 8px;">
    <table width="100%"><tr>
      <td style="font-size:11px;color:#8694a5;">HGV<span style="color:${C.orange};">Desk</span> &bull; ${esc(orgName || 'HGVDesk')}</td>
      <td style="text-align:right;font-size:10px;color:#5a6a7d;">${esc(invoice.invoice_number)} &bull; Generated ${fmtDateTime(new Date())}</td>
    </tr></table>
  </td></tr>`;

  html += `</table></body></html>`;
  return html;
}

module.exports = { buildInspectionReportHtml, buildInvoiceHtml, C, esc, fmtDate, fmtDateTime, resultBadge, condBadge, sevBadge, sectionTitle };
