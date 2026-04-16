/**
 * HGVDESK — World-class report HTML builder
 * Barlow typography, SVG badge logo, premium colour system.
 * Table-based layout for email client compatibility + Puppeteer PDF.
 */

const C = {
  dark: '#0a1929',
  darkMid: '#0f2030',
  orange: '#ff5500',
  orangeLight: '#ff7a2e',
  surface: '#f8f8f8',
  card: '#ffffff',
  border: '#e8e8e8',
  text: '#1a1a1a',
  muted: '#6b7280',
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

const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">`;

const LOGO_SVG = `<svg width="120" height="28" viewBox="0 0 120 28" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="2" width="42" height="24" rx="4" fill="${C.orange}"/>
  <text x="7" y="19" font-family="Barlow Condensed,sans-serif" font-weight="700" font-size="14" fill="#fff">HGV</text>
  <line x1="31" y1="6" x2="31" y2="22" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>
  <text x="34" y="18.5" font-family="Barlow Condensed,sans-serif" font-weight="600" font-size="10" fill="rgba(255,255,255,0.9)">▶</text>
  <text x="48" y="19" font-family="Barlow Condensed,sans-serif" font-weight="700" font-size="16" fill="#fff" letter-spacing="0.5">HGVDesk</text>
</svg>`;

const LOGO_SVG_SM = `<svg width="80" height="20" viewBox="0 0 120 28" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="2" width="42" height="24" rx="4" fill="${C.orange}"/>
  <text x="7" y="19" font-family="Barlow Condensed,sans-serif" font-weight="700" font-size="14" fill="#fff">HGV</text>
  <text x="48" y="19" font-family="Barlow Condensed,sans-serif" font-weight="700" font-size="16" fill="${C.muted}" letter-spacing="0.5">HGVDesk</text>
</svg>`;

function esc(s) { return s == null ? '' : String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }

// Map internal tyre key (t0_0) to human-readable position name
const TYRE_AXLES_T50 = [
  { label: 'Steer', pos: ['Steer NS', 'Steer OS'] },
  { label: 'Drive 1', pos: ['Drive 1 NS Outer', 'Drive 1 NS Inner', 'Drive 1 OS Inner', 'Drive 1 OS Outer'] },
  { label: 'Drive 2', pos: ['Drive 2 NS Outer', 'Drive 2 NS Inner', 'Drive 2 OS Inner', 'Drive 2 OS Outer'] },
];
const TYRE_AXLES_T60 = [
  { label: 'Trailer Axle 1', pos: ['Axle 1 NS', 'Axle 1 OS'] },
  { label: 'Trailer Axle 2', pos: ['Axle 2 NS', 'Axle 2 OS'] },
  { label: 'Trailer Axle 3', pos: ['Axle 3 NS', 'Axle 3 OS'] },
];
function tyrePositionName(key, inspectionType) {
  const m = /^t(\d+)_(\d+)$/.exec(key);
  if (!m) return key;
  const axles = inspectionType === 'T60' ? TYRE_AXLES_T60 : TYRE_AXLES_T50;
  const axle = axles[Number.parseInt(m[1])];
  if (!axle) return key;
  return axle.pos[Number.parseInt(m[2])] || key;
}
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'}) : '—'; }
function fmtShort(d) { return d ? new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—'; }
function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return fmtShort(d) + ' ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function fmtMoney(n) { return '£' + Number(n||0).toFixed(2); }

function badge(label, bg, color) {
  return `<span style="display:inline-block;padding:3px 10px;border-radius:3px;background:${bg};color:${color};border:1px solid ${color};font-family:'Barlow',sans-serif;font-size:10px;font-weight:600;letter-spacing:0.5px;line-height:1.4;">${label}</span>`;
}
function resultBadge(r) {
  const v = (r||'pending').toLowerCase();
  if (v==='pass') return badge('PASS',C.passBg,C.passGreen);
  if (v==='advisory') return badge('ADVISORY',C.advBg,C.advAmber);
  if (v==='fail') return badge('FAIL',C.failBg,C.failRed);
  return badge('PENDING','#eee','#666');
}
function condBadge(c) {
  const v=(c||'ok').toLowerCase();
  if (v==='ok') return badge('OK',C.passBg,C.passGreen);
  if (v==='adv') return badge('ADV',C.advBg,C.advAmber);
  return badge('DEF',C.failBg,C.failRed);
}
function sevBadge(s) {
  return (s||'advisory').toLowerCase()==='critical' ? badge('CRITICAL',C.failBg,C.failRed) : badge('ADVISORY',C.advBg,C.advAmber);
}

const LBL = `font-family:'Barlow',sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${C.label};`;
const SEC_TITLE = `padding:20px 0 8px;border-bottom:1px solid ${C.border};margin-bottom:0;`;
const BODY_S = `font-family:'Barlow',sans-serif;font-size:13px;line-height:1.6;color:${C.text};`;
const HEAD_S = `font-family:'Barlow Condensed',sans-serif;font-weight:700;letter-spacing:-0.5px;`;

function wrap(maxW) { return `<table width="100%" cellpadding="0" cellspacing="0" style="max-width:${maxW}px;margin:0 auto;">`; }
function secTitle(t) { return `<tr><td style="${SEC_TITLE}"><div style="${LBL}color:${C.orange};">${esc(t)}</div></td></tr>`; }
function secTitleWide(t) { return `<tr><td colspan="10" style="${SEC_TITLE}"><div style="${LBL}color:${C.orange};">${esc(t)}</div></td></tr>`; }
function metricBox(label, value, opts={}) {
  const vStyle = opts.color ? `color:${opts.color};` : '';
  return `<td style="width:25%;padding:4px;"><div style="background:${C.surface};border:1px solid ${C.border};border-radius:6px;padding:12px 14px;text-align:center;"><div style="${LBL}margin-bottom:4px;">${esc(label)}</div><div style="${HEAD_S}font-size:${opts.big?'22':'16'}px;${vStyle}">${esc(value)}</div></div></td>`;
}

function pageShell(title, bodyHtml) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>${FONTS}<style>*{margin:0;padding:0;box-sizing:border-box;}body{background:${C.surface};${BODY_S}}@media print{body{background:#fff;}.no-print{display:none!important;}}</style></head><body style="padding:20px 0;">${bodyHtml}</body></html>`;
}

// ══════════════════════════════════════════════
// HEADER + FOOTER (shared across all docs)
// ══════════════════════════════════════════════

function logoHtml(logoDark) {
  if (logoDark) return `<img src="${esc(logoDark)}" style="max-height:48px;width:auto;" alt="">`;
  return LOGO_SVG;
}
function logoHtmlSm(logoLight) {
  if (logoLight) return `<img src="${esc(logoLight)}" style="max-height:28px;width:auto;" alt="">`;
  return LOGO_SVG_SM;
}

function docHeader(docType, docNum, dateStr, opts={}) {
  return `<tr><td style="background:${C.dark};padding:20px 32px;border-radius:8px 8px 0 0;border-bottom:1px solid ${C.orange};">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;">${logoHtml(opts.logoDark)}</td>
      <td style="text-align:right;vertical-align:middle;">
        <div style="${LBL}color:${C.orange};margin-bottom:3px;">${esc(docType)}</div>
        <div style="font-family:'Barlow',sans-serif;font-size:11px;color:rgba(255,255,255,0.55);">${esc(docNum)} &bull; ${esc(dateStr)}</div>
      </td>
    </tr></table>
  </td></tr>`;
}

function vehicleBar(reg, subtitle, resultHtml) {
  return `<tr><td style="background:${C.orange};padding:16px 32px;border-bottom:1px solid #cc4400;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><div style="${HEAD_S}font-size:28px;color:#fff;letter-spacing:1px;">${esc(reg)}</div>
        <div style="font-family:'Barlow',sans-serif;font-size:12px;color:rgba(255,255,255,0.8);margin-top:2px;">${esc(subtitle)}</div></td>
      <td style="text-align:right;vertical-align:middle;"><span style="border:1.5px solid #fff;border-radius:5px;display:inline-block;">${resultHtml}</span></td>
    </tr></table>
  </td></tr>`;
}

function docFooter(docNum, orgName, opts={}) {
  return `<tr><td style="background:${C.surface};padding:16px 32px;border-top:1px solid ${C.border};">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;">${logoHtmlSm(opts.logoLight)}<div style="font-family:'Barlow',sans-serif;font-size:10px;color:${C.muted};margin-top:2px;">hgvdesk.co.uk</div></td>
      <td style="text-align:center;font-family:'Barlow',sans-serif;font-size:10px;color:${C.muted};">${esc(docNum)} &bull; ${esc(orgName||'HGVDesk')}</td>
      <td style="text-align:right;font-family:'Barlow',sans-serif;font-size:10px;color:${C.muted};">Generated ${fmtDateTime(new Date())}</td>
    </tr></table>
  </td></tr>
  <tr><td style="height:4px;background:${C.orange};border-radius:0 0 8px 8px;"></td></tr>`;
}

// ══════════════════════════════════════════════
// INSPECTION REPORT
// ══════════════════════════════════════════════

function hasTyreData(d) {
  if (!d || typeof d !== 'object') return false;
  const depth = Number.parseFloat(d.depth || d.tread || 0);
  const hasDepth = !Number.isNaN(depth) && depth > 0;
  const hasExpiry = !!(d.expiry && d.expiry.trim());
  const hasCond = d.condition && d.condition !== 'ok';
  return hasDepth || hasExpiry || hasCond;
}

function tyreCard(posName, d) {
  const depth = d.depth || d.tread || '—';
  const depthNum = Number.parseFloat(depth);
  const isValid = !Number.isNaN(depthNum);
  let depthColor = C.text;
  if (isValid && depthNum < 1) depthColor = C.failRed;
  else if (isValid && depthNum < 3) depthColor = C.advAmber;
  return `<td style="padding:4px;"><div style="background:${C.surface};border:1px solid ${C.border};border-radius:6px;padding:10px 12px;text-align:center;">
    <div style="${LBL}color:${C.orange};margin-bottom:6px;font-size:9px;">${esc(posName)}</div>
    <div style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:20px;color:${depthColor};">${esc(String(depth))}<span style="font-size:11px;font-weight:400;color:${C.muted};"> mm</span></div>
    <div style="font-family:'Barlow',sans-serif;font-size:11px;color:${C.muted};margin:4px 0;">${esc(d.expiry || '—')}</div>
    ${condBadge(d.condition)}
  </div></td>`;
}

const NO_TYRE_MSG = `<tr><td colspan="4" style="padding:10px 0;${BODY_S}color:${C.muted};font-style:italic;">No tyre data recorded.</td></tr>`;

function groupTyresByAxle(tyres) {
  const grouped = {};
  for (const [key, data] of Object.entries(tyres)) {
    const d = typeof data === 'object' ? data : { depth: data };
    if (!hasTyreData(d)) continue;
    const m = /^t(\d+)_(\d+)$/.exec(key);
    if (!m) continue;
    const ai = Number.parseInt(m[1]);
    if (!grouped[ai]) grouped[ai] = [];
    grouped[ai].push({ key, posIdx: Number.parseInt(m[2]), data: d });
  }
  return grouped;
}

function renderTyreAxleRow(axleDef, positions) {
  let h = `<tr><td colspan="4" style="padding:12px 0 4px;"><div style="${LBL}color:${C.muted};font-size:9px;">${esc(axleDef.label.toUpperCase())}</div></td></tr>`;
  h += '<tr>';
  for (const p of positions) h += tyreCard(axleDef.pos[p.posIdx] || p.key, p.data);
  for (let pad = positions.length; pad < 4; pad++) h += '<td></td>';
  h += '</tr>';
  return h;
}

function buildTyreSection(tyres, inspectionType) {
  if (!tyres || typeof tyres !== 'object' || !Object.keys(tyres).length) return NO_TYRE_MSG;
  const tyreAxles = inspectionType === 'T60' ? TYRE_AXLES_T60 : TYRE_AXLES_T50;
  const grouped = groupTyresByAxle(tyres);
  const axleKeys = Object.keys(grouped).map(Number).sort((a, b) => a - b);
  if (!axleKeys.length) return NO_TYRE_MSG;
  let h = secTitle('Tyre Data');
  for (const ai of axleKeys) {
    if (!tyreAxles[ai]) continue;
    h += renderTyreAxleRow(tyreAxles[ai], grouped[ai].sort((a, b) => a.posIdx - b.posIdx));
  }
  h += `<tr><td colspan="4" style="padding:6px 0;"><div style="font-family:'Barlow',sans-serif;font-size:10px;color:${C.muted};">HGV legal minimum: 1mm across ¾ width. Advisory threshold: &lt;3mm.</div></td></tr>`;
  return h;
}

function buildChecklistSection(checks) {
  const entries = Object.entries(checks);
  if (!entries.length) return '';
  let h = secTitle('DVSA Checklist (' + entries.length + ' items)');
  for (let i = 0; i < entries.length; i += 3) {
    const rowBg = (Math.floor(i/3)%2) ? C.surface : C.card;
    h += `<tr style="background:${rowBg};">`;
    for (let j = 0; j < 3; j++) {
      const e = entries[i+j];
      if (!e) { h += '<td style="width:33%;"></td>'; continue; }
      const [name, state] = e;
      const st = (state||'').toLowerCase();
      let b; if (st==='pass') b=badge('PASS',C.passBg,C.passGreen); else if (st==='fail') b=badge('FAIL',C.failBg,C.failRed); else b=badge(st.toUpperCase()||'—',C.advBg,C.advAmber);
      h += `<td style="width:33%;padding:6px 10px;"><div style="display:flex;justify-content:space-between;align-items:center;"><span style="font-family:'Barlow',sans-serif;font-size:11px;color:${C.text};">${esc(name.replaceAll('_',' '))}</span>${b}</div></td>`;
    }
    h += '</tr>';
  }
  return h;
}

function brakeEffColor(val, min) { return val >= min ? C.passGreen : C.failRed; }
function brakeEffMetric(label, val, min, opts) {
  return metricBox(label, val != null ? val + '%' : '—', { ...opts, color: brakeEffColor(val, min) });
}

function buildBrakeAxleRow(name, a, rowIdx) {
  const bg = rowIdx % 2 ? C.surface : C.card;
  const pr = a.pass ? badge('PASS', C.passBg, C.passGreen) : badge('FAIL', C.failBg, C.failRed);
  const imbColor = (a.imb != null && a.imb > 30) ? C.failRed : C.text;
  const td = (content, extra = '') => `<td style="padding:8px 12px;font-family:'Barlow',sans-serif;${extra}">${content}</td>`;
  return `<tr style="background:${bg};">${td(esc(name), 'font-size:12px;font-weight:500;')}${td(a.ns != null ? a.ns : '—', 'text-align:center;font-size:13px;font-weight:600;')}${td(a.os != null ? a.os : '—', 'text-align:center;font-size:13px;font-weight:600;')}${td(a.imb != null ? a.imb + '%' : '—', 'text-align:center;font-size:12px;color:' + imbColor + ';')}${td(pr, 'text-align:center;')}</tr>`;
}

function buildBrakeSection(brakes) {
  if (!brakes || (brakes.sbe == null && brakes.pbe == null && !brakes.axles)) return '';
  let h = secTitle('Brake Test Results (Roller Brake Test)');
  const axles = brakes.axles || {};
  let maxImb = 0;
  for (const a of Object.values(axles)) if (a && a.imb != null) maxImb = Math.max(maxImb, a.imb);

  h += '<tr>';
  h += brakeEffMetric('Service Brake', brakes.sbe, 50, { big: true });
  if (brakes.sbe2 != null && !Number.isNaN(brakes.sbe2)) h += brakeEffMetric('Secondary', brakes.sbe2, 50);
  h += brakeEffMetric('Park Brake', brakes.pbe, 16);
  h += metricBox('Max Imbalance', maxImb + '%', { color: maxImb <= 30 ? C.passGreen : C.failRed });
  h += '</tr>';
  h += `<tr><td colspan="4" style="padding:6px 0 10px;"><div style="font-family:'Barlow',sans-serif;font-size:10px;color:${C.muted};">DVSA minimums: Service ≥50% · Secondary ≥50% · Park ≥16% · Axle imbalance ≤30%</div></td></tr>`;

  if (Object.keys(axles).length) {
    const th = `style="padding:8px 12px;${LBL}text-align:center;border-bottom:1px solid ${C.border};"`;
    h += `<tr><td colspan="4"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:6px;overflow:hidden;">`;
    h += `<tr style="background:${C.surface};"><th ${th} style="${LBL}text-align:left;padding:8px 12px;">Axle</th><th ${th}>NS (kN)</th><th ${th}>OS (kN)</th><th ${th}>Imbalance</th><th ${th}>Result</th></tr>`;
    let ri = 0;
    for (const [name, a] of Object.entries(axles)) { h += buildBrakeAxleRow(name, a, ri++); }
    h += '</table></td></tr>';
  }
  return h;
}

function buildPhotoHtml(url, caption) {
  if (!url) return '';
  return `<div style="margin-top:8px;"><div style="${LBL}color:${C.muted};margin-bottom:4px;">${esc(caption)}</div><img src="${url}" style="max-width:200px;max-height:150px;border-radius:6px;border:1px solid ${C.border};object-fit:cover;" alt="${esc(caption)}"></div>`;
}

function buildRectifiedBlock(d) {
  let h = `<div style="background:${C.repairBg};padding:12px 18px;border-top:1px solid #c8e0a8;">`;
  h += `<div style="${LBL}color:${C.repairGreen};margin-bottom:4px;">RECTIFIED</div>`;
  if (d.resolved_by) h += `<div style="font-family:'Barlow',sans-serif;font-size:12px;color:${C.text};">By: <strong>${esc(d.resolved_by)}</strong></div>`;
  if (d.resolution_notes) h += `<div style="font-family:'Barlow',sans-serif;font-size:12px;color:${C.text};margin-top:4px;line-height:1.5;background:#fff;padding:8px 12px;border-radius:4px;border:1px solid #c8e0a8;">${esc(d.resolution_notes)}</div>`;
  h += buildPhotoHtml(d.repair_photo_url, 'Repair Evidence');
  if (d.resolved_at) h += `<div style="font-family:'Barlow',sans-serif;font-size:10px;color:${C.muted};margin-top:6px;">${fmtDateTime(d.resolved_at)}</div>`;
  h += '</div>';
  return h;
}

function buildDefectCard(d) {
  const borderColor = d.resolved ? C.repairGreen : (d.severity==='critical'?C.failRed:C.advAmber);
  let body = `<div style="padding:14px 18px;">`;
  body += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">`;
  body += `<span style="${HEAD_S}font-size:14px;color:${C.text};">${esc(d.title||d.description||'Defect')}</span>`;
  body += sevBadge(d.severity);
  body += `</div>`;
  if (d.description && d.description !== d.title) {
    body += `<div style="font-family:'Barlow',sans-serif;font-size:12px;color:${C.muted};line-height:1.5;">${esc(d.description)}</div>`;
  }
  body += buildPhotoHtml(d.photo_url, 'Defect Photo');
  body += `</div>`;
  if (d.resolved) body += buildRectifiedBlock(d);
  return `<tr><td colspan="4" style="padding:6px 0;"><div style="border:1px solid ${C.border};border-left:4px solid ${borderColor};border-radius:6px;overflow:hidden;">${body}</div></td></tr>`;
}

function buildDefectsSection(defects) {
  if (!defects.length) return '';
  const rectified = defects.filter(d => d.resolved);
  const outstanding = defects.filter(d => !d.resolved);
  const total = defects.length;

  let h = secTitle('Defects Found (' + total + ' total, ' + rectified.length + ' rectified)');

  // All defects with full audit trail
  for (const d of defects) h += buildDefectCard(d);

  // Outstanding summary
  if (outstanding.length > 0) {
    h += `<tr><td colspan="4" style="padding:12px 0 4px;"><div style="background:${C.failBg};border:1px solid ${C.failRed};border-radius:6px;padding:12px 16px;"><div style="${LBL}color:${C.failRed};margin-bottom:4px;">OUTSTANDING DEFECTS (${outstanding.length})</div><div style="font-family:'Barlow',sans-serif;font-size:12px;color:${C.failRed};">${outstanding.map(d => esc(d.title||d.description)).join('; ')}</div></div></td></tr>`;
  } else {
    h += `<tr><td colspan="4" style="padding:12px 0 4px;"><div style="background:${C.passBg};border:1px solid #c8e0a8;border-radius:6px;padding:12px 16px;text-align:center;"><div style="${LBL}color:${C.passGreen};margin-bottom:2px;">ALL DEFECTS RECTIFIED</div><div style="font-family:'Barlow',sans-serif;font-size:12px;color:${C.passGreen};">All ${total} defect(s) rectified prior to vehicle entering service</div></div></td></tr>`;
  }

  return h;
}

function buildInspectionReportHtml(insp, opts={}) {
  const { aiSummary, orgName, logoLight, logoDark } = opts;
  const checks = (typeof insp.check_items==='string'?JSON.parse(insp.check_items):insp.check_items)||(insp.checkItems||{});
  const tyres = (typeof insp.tyre_data==='string'?JSON.parse(insp.tyre_data):insp.tyre_data)||(insp.tyreData||{});
  const brakes = (typeof insp.brake_test_data==='string'?JSON.parse(insp.brake_test_data):insp.brake_test_data)||(insp.brakeData||{});
  const defects = insp.defects||[];
  const result = (insp.result||'pending').toLowerCase();

  let h = '';
  h += wrap(700);
  h += docHeader('INSPECTION REPORT', insp.inspection_id||'', fmtDateTime(insp.completed_at||insp.created_at), {logoDark});

  // Vehicle bar
  const sub = [insp.customer_name, insp.inspection_type, insp.overall_mileage ? Number(insp.overall_mileage).toLocaleString()+' mi' : ''].filter(Boolean).join(' · ');
  h += vehicleBar(insp.vehicle_reg||'', sub, resultBadge(result));

  // Body
  h += `<tr><td style="background:${C.card};padding:28px 32px;">`;
  h += `<table width="100%" cellpadding="0" cellspacing="0">`;

  // AI Summary
  if (aiSummary) {
    h += `<tr><td style="padding-bottom:20px;">
      <div style="background:${C.dark};border-radius:6px;padding:18px 22px;border-left:4px solid ${C.orange};">
        <div style="${LBL}color:${C.orange};margin-bottom:6px;">AI Inspection Summary</div>
        <div style="font-family:'Barlow',sans-serif;font-size:13px;line-height:1.65;color:#dce3eb;">${esc(aiSummary)}</div>
      </div>
    </td></tr>`;
  }

  // Inspector details — 4 metric boxes
  h += secTitle('Inspector Details');
  h += '<tr>';
  h += metricBox('Inspector', insp.inspector_name||'—');
  h += metricBox('Completed', fmtDateTime(insp.completed_at));
  h += metricBox('Type', insp.inspection_type||'T50');
  h += metricBox('Nil Defect', insp.nil_defect?'Yes':'No');
  h += '</tr>';

  // Nil defect banner
  if (insp.nil_defect) {
    h += `<tr><td colspan="4" style="padding:12px 0;"><div style="background:${C.passBg};border:1px solid #c8e0a8;border-radius:6px;padding:14px 18px;text-align:center;${HEAD_S}font-size:15px;color:${C.passGreen};">NIL DEFECT — No defects found during this inspection</div></td></tr>`;
  }

  h += buildChecklistSection(checks);
  h += buildBrakeSection(brakes);
  h += buildTyreSection(tyres, insp.inspection_type);
  h += buildDefectsSection(defects);

  // Notes
  if (insp.notes) {
    h += secTitle('Inspector Notes');
    h += `<tr><td colspan="4" style="padding:10px 0;${BODY_S}">${esc(insp.notes)}</td></tr>`;
  }

  // Sign-off row
  h += secTitle('Sign-Off');
  h += '<tr>';
  h += metricBox('Technician', insp.inspector_name||'—');
  h += metricBox('Completed', fmtDateTime(insp.completed_at));
  h += metricBox('Created', fmtShort(insp.created_at));
  h += metricBox('Status', (insp.status||'—').toUpperCase());
  h += '</tr>';

  // DVSA compliance
  h += `<tr><td colspan="4" style="padding:16px 0 0;"><div style="background:${C.surface};border:1px solid ${C.border};border-radius:6px;padding:12px 16px;font-family:'Barlow',sans-serif;font-size:10px;color:${C.muted};line-height:1.6;">This inspection has been carried out in accordance with DVSA Guide to Maintaining Roadworthiness. All check items follow the DVSA HGV Inspection Manual categories. Brake test results recorded per axle using roller brake test equipment. Tyre depths measured at central ¾ width. Defect severity classified per DVSA prohibition criteria. This report is a legal record of vehicle condition at the time of inspection.</div></td></tr>`;

  h += '</table></td></tr>';
  h += docFooter(insp.inspection_id||'', orgName||'HGVDesk', {logoLight});
  h += '</table>';
  return pageShell('Inspection Report — '+(insp.vehicle_reg||''), h);
}

// ══════════════════════════════════════════════
// INVOICE
// ══════════════════════════════════════════════

function cleanDesc(s) { return (s || '').replace(/\s*\(PRT-\w+\)/g, '').replace(/\s*PRT-\w+/g, ''); }

function buildInvoiceHtml(invoice, lines, opts={}) {
  const { orgName, orgSettings } = opts;
  const os = orgSettings || {};
  let h = '';
  h += wrap(700);

  // Clean white header
  h += `<tr><td style="background:#fff;padding:24px 32px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:top;"><div style="${HEAD_S}font-size:18px;color:${C.text};">${esc(os.company_name || orgName || 'HGVDesk')}</div>
        <div style="font-family:'Barlow',sans-serif;font-size:11px;color:#999;margin-top:3px;white-space:pre-line;">${esc(os.company_address || '')}</div>
        ${os.vat_number ? '<div style="font-family:\'Barlow\',sans-serif;font-size:11px;color:#999;margin-top:2px;">VAT: '+esc(os.vat_number)+'</div>' : ''}
      </td>
      <td style="text-align:right;vertical-align:top;"><div style="font-family:'Barlow',sans-serif;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#bbb;">Invoice</div>
        <div style="${HEAD_S}font-size:22px;color:${C.text};margin-top:2px;">${esc(invoice.invoice_number)}</div></td>
    </tr></table>
  </td></tr>`;

  // Light grey band
  const statusBadge = invoice.status==='paid' ? badge('PAID',C.passBg,C.passGreen) : badge((invoice.status||'DRAFT').toUpperCase(),C.advBg,C.advAmber);
  h += `<tr><td style="background:#f7f7f7;padding:14px 32px;border-top:1px solid #eee;border-bottom:1px solid #eee;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-family:'Barlow',sans-serif;font-size:13px;"><strong>${esc(invoice.customer_name||'')}</strong>${invoice.customer_email ? ' · <span style="color:#888;">'+esc(invoice.customer_email)+'</span>' : ''}</td>
      <td style="text-align:right;font-family:'Barlow',sans-serif;font-size:12px;color:#888;">Due: <strong style="color:${C.text};">${fmtShort(invoice.due_date)}</strong> ${statusBadge}</td>
    </tr></table>
  </td></tr>`;

  h += `<tr><td style="background:${C.card};padding:28px 32px;">`;
  h += `<table width="100%" cellpadding="0" cellspacing="0">`;

  // Bill To + Invoice Details
  h += '<tr><td style="width:50%;vertical-align:top;padding-right:16px;"><div style="background:'+C.surface+';border:1px solid '+C.border+';border-radius:6px;padding:16px;">';
  h += '<div style="'+LBL+'color:'+C.orange+';margin-bottom:8px;">Bill To</div>';
  h += '<div style="'+HEAD_S+'font-size:16px;color:'+C.text+';">'+esc(invoice.customer_name||'—')+'</div>';
  if (invoice.customer_email) h += '<div style="font-family:\'Barlow\',sans-serif;font-size:12px;color:'+C.muted+';margin-top:2px;">'+esc(invoice.customer_email)+'</div>';
  h += '</div></td>';
  h += '<td style="width:50%;vertical-align:top;"><div style="background:'+C.surface+';border:1px solid '+C.border+';border-radius:6px;padding:16px;">';
  h += '<div style="'+LBL+'color:'+C.orange+';margin-bottom:8px;">Invoice Details</div>';
  h += `<div style="font-family:'Barlow',sans-serif;font-size:12px;line-height:2;color:${C.text};">Invoice: <strong>${esc(invoice.invoice_number)}</strong><br>Issued: ${fmtShort(invoice.issue_date)}<br>Due: ${fmtShort(invoice.due_date)}<br>Terms: 30 days net</div>`;
  h += '</div></td></tr>';

  // Vehicle section (if from a job)
  if (invoice.vehicle_reg) {
    h += `<tr><td colspan="10" style="padding:12px 0;"><div style="background:${C.surface};border:1px solid ${C.border};border-radius:6px;padding:14px 18px;display:flex;align-items:center;gap:20px;">
      <div><div style="${LBL}color:${C.orange};margin-bottom:4px;">Vehicle</div><div style="font-family:monospace;${HEAD_S}font-size:22px;color:${C.text};letter-spacing:1px;">${esc(invoice.vehicle_reg)}</div></div>
      ${invoice.job_id ? '<div><div style="'+LBL+'color:'+C.muted+';margin-bottom:4px;">Job Reference</div><div style="font-family:\'Barlow\',sans-serif;font-size:13px;color:'+C.text+';">Job #'+esc(String(invoice.job_id))+'</div></div>' : ''}
      <div><div style="${LBL}color:${C.muted};margin-bottom:4px;">Date of Work</div><div style="font-family:'Barlow',sans-serif;font-size:13px;color:${C.text};">${fmtShort(invoice.issue_date)}</div></div>
    </div></td></tr>`;
  }

  // Line items table
  h += secTitleWide('Line Items');
  const th = `style="padding:10px 12px;${LBL}border-bottom:1px solid ${C.border};"`;
  h += `<tr><td colspan="10"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:6px;overflow:hidden;">`;
  h += `<tr style="background:${C.surface};"><th ${th} style="${LBL}text-align:left;padding:10px 12px;width:8%;">#</th><th ${th} style="${LBL}text-align:left;width:52%;">Description</th><th ${th} style="${LBL}text-align:center;width:10%;">Qty</th><th ${th} style="${LBL}text-align:right;width:15%;">Unit Price</th><th ${th} style="${LBL}text-align:right;width:15%;">Total</th></tr>`;
  for (let i=0; i<(lines||[]).length; i++) {
    const l = lines[i]; const bg = i%2 ? C.surface : C.card;
    h += `<tr style="background:${bg};"><td style="padding:10px 12px;font-family:'Barlow',sans-serif;font-size:12px;color:${C.muted};">${i+1}</td><td style="padding:10px 12px;font-family:'Barlow',sans-serif;font-size:13px;font-weight:500;">${esc(cleanDesc(l.description||l.name))}</td><td style="padding:10px 12px;text-align:center;font-family:'Barlow',sans-serif;font-size:13px;">${l.quantity||1}</td><td style="padding:10px 12px;text-align:right;font-family:'Barlow',sans-serif;font-size:13px;">${fmtMoney(l.unit_price)}</td><td style="padding:10px 12px;text-align:right;font-family:'Barlow',sans-serif;font-size:13px;font-weight:600;">${fmtMoney(l.line_total)}</td></tr>`;
  }
  h += '</table></td></tr>';

  // Totals
  const totalStyle = `font-family:'Barlow',sans-serif;text-align:right;padding:4px 0;`;
  h += `<tr><td colspan="10"><table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
    <tr><td></td><td style="${totalStyle}font-size:12px;color:${C.muted};width:120px;">Subtotal</td><td style="${totalStyle}font-size:13px;width:100px;">${fmtMoney(invoice.subtotal)}</td></tr>
    <tr><td></td><td style="${totalStyle}font-size:12px;color:${C.muted};">VAT (20%)</td><td style="${totalStyle}font-size:13px;">${fmtMoney(invoice.vat_amount)}</td></tr>
    <tr><td></td><td style="${totalStyle}font-size:15px;font-weight:700;padding-top:10px;border-top:2px solid ${C.dark};">Total Due</td><td style="${totalStyle}font-size:22px;font-weight:700;color:${C.orange};padding-top:10px;border-top:2px solid ${C.dark};">${fmtMoney(invoice.total)}</td></tr>
  </table></td></tr>`;

  // Payment details
  h += `<tr><td colspan="10" style="padding:24px 0 0;border-top:1px solid #eee;font-family:'Barlow',sans-serif;font-size:12px;color:#888;line-height:1.8;">
    <strong style="color:${C.text};">Payment Details</strong><br>
    Bank: <strong>${esc(os.bank_name || 'Not set')}</strong> · Sort Code: <strong>${esc(os.sort_code || '—')}</strong> · Account: <strong>${esc(os.account_number || '—')}</strong><br>
    Reference: <strong>${esc(invoice.invoice_number)}</strong>
  </td></tr>`;

  h += `<tr><td colspan="10" style="padding:16px 0 0;font-family:'Barlow',sans-serif;font-size:10px;color:#bbb;line-height:1.6;">${esc(os.invoice_footer || 'Payment is due within 30 days of the invoice date.')}</td></tr>`;

  h += `<tr><td colspan="10" style="padding:20px 0 0;text-align:center;border-top:1px solid #eee;"><div style="font-family:'Barlow',sans-serif;font-size:11px;color:#bbb;margin-top:8px;">Thank you for your business · ${esc(os.company_email || 'hello@hgvdesk.co.uk')}</div></td></tr>`;

  h += '</table></td></tr>';
  h += docFooter(invoice.invoice_number||'', orgName||'HGVDesk', {logoLight: opts.logoLight});
  h += '</table>';
  return pageShell('Invoice — '+(invoice.invoice_number||''), h);
}

// ══════════════════════════════════════════════
// JOB SHEET
// ══════════════════════════════════════════════

function buildPartsTable(parts) {
  const th = `style="padding:8px 12px;${LBL}border-bottom:1px solid ${C.border};"`;
  let h = secTitle('Parts Used (' + parts.length + ')');
  h += `<tr><td colspan="4"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:6px;overflow:hidden;">`;
  h += `<tr style="background:${C.surface};"><th ${th} style="${LBL}text-align:left;padding:8px 12px;">Part</th><th ${th} style="${LBL}text-align:left;">Category</th><th ${th} style="${LBL}text-align:center;">Status</th><th ${th} style="${LBL}text-align:right;">Cost</th></tr>`;
  let partTotal = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]; const bg = i % 2 ? C.surface : C.card;
    const cost = Number(p.unit_cost || 0) * Number(p.qty || 1);
    partTotal += cost;
    const sBadge = badge((p.status || 'pending').toUpperCase(), p.status === 'ready' ? C.passBg : C.advBg, p.status === 'ready' ? C.passGreen : C.advAmber);
    h += `<tr style="background:${bg};"><td style="padding:8px 12px;font-family:'Barlow',sans-serif;font-size:12px;font-weight:500;">${esc(p.name)}</td><td style="padding:8px 12px;font-family:'Barlow',sans-serif;font-size:12px;color:${C.muted};">${esc(p.category || '')}</td><td style="padding:8px 12px;text-align:center;">${sBadge}</td><td style="padding:8px 12px;text-align:right;font-family:'Barlow',sans-serif;font-size:12px;font-weight:600;">${cost > 0 ? fmtMoney(cost) : '—'}</td></tr>`;
  }
  h += `<tr style="background:${C.surface};border-top:2px solid ${C.dark};"><td colspan="3" style="padding:10px 12px;${HEAD_S}font-size:13px;">Parts Total</td><td style="padding:10px 12px;text-align:right;${HEAD_S}font-size:14px;">${partTotal > 0 ? fmtMoney(partTotal) : '—'}</td></tr>`;
  h += '</table></td></tr>';
  return h;
}

function buildLabourTable(jobLines) {
  const th = `style="padding:8px 12px;${LBL}border-bottom:1px solid ${C.border};"`;
  let h = secTitle('Labour / Sold Hours');
  h += `<tr><td colspan="4"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:6px;overflow:hidden;">`;
  h += `<tr style="background:${C.surface};"><th ${th} style="${LBL}text-align:left;padding:8px 12px;">Description</th><th ${th} style="${LBL}text-align:center;">Qty</th><th ${th} style="${LBL}text-align:right;">Hours</th><th ${th} style="${LBL}text-align:right;">Total Hrs</th></tr>`;
  let totalHrs = 0;
  for (let i = 0; i < jobLines.length; i++) {
    const l = jobLines[i]; const bg = i % 2 ? C.surface : C.card;
    const lineHrs = Number(l.sold_hours || 0) * Number(l.quantity || 1);
    totalHrs += lineHrs;
    h += `<tr style="background:${bg};"><td style="padding:8px 12px;font-family:'Barlow',sans-serif;font-size:12px;font-weight:500;">${esc(l.name || l.description)}</td><td style="padding:8px 12px;text-align:center;font-family:'Barlow',sans-serif;font-size:12px;">${Number(l.quantity || 1).toFixed(1)}</td><td style="padding:8px 12px;text-align:right;font-family:'Barlow',sans-serif;font-size:12px;">${Number(l.sold_hours || 0).toFixed(2)}</td><td style="padding:8px 12px;text-align:right;font-family:'Barlow',sans-serif;font-size:12px;font-weight:600;">${lineHrs.toFixed(2)}</td></tr>`;
  }
  h += `<tr style="background:${C.surface};border-top:2px solid ${C.dark};"><td colspan="3" style="padding:10px 12px;${HEAD_S}font-size:13px;">Total Labour</td><td style="padding:10px 12px;text-align:right;${HEAD_S}font-size:14px;">${totalHrs.toFixed(2)} hrs</td></tr>`;
  h += '</table></td></tr>';
  return h;
}

function jobSheetSectionTitle(title) {
  return `<tr><td colspan="4" style="padding:18px 0 6px;font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;border-bottom:1px solid #e5e7eb;">${esc(title)}</td></tr>`;
}

function jobSheetMetric(label, value, extra) {
  return `<td style="padding:10px 0;vertical-align:top;"><div style="font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:#9ca3af;margin-bottom:3px;">${esc(label)}</div><div style="font-size:13px;font-weight:600;color:${extra || '#111827'};">${esc(value)}</div></td>`;
}

function jobSheetPartsRows(parts) {
  const thS = 'padding:8px 12px;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:#9ca3af;border-bottom:1px solid #e5e7eb;';
  let h = `<tr><td colspan="4"><table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;">`;
  h += `<tr><th style="${thS}text-align:left;">#</th><th style="${thS}text-align:left;">Part</th><th style="${thS}text-align:left;">Category</th><th style="${thS}text-align:center;">Status</th><th style="${thS}text-align:right;">Cost</th></tr>`;
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const cost = Number(p.unit_cost || 0) * Number(p.qty || 1);
    total += cost;
    const statusColor = p.status === 'ready' ? '#059669' : '#d97706';
    h += `<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:8px 12px;font-size:12px;color:#9ca3af;">${i + 1}</td><td style="padding:8px 12px;font-size:13px;color:#111827;">${esc(p.name)}</td><td style="padding:8px 12px;font-size:12px;color:#6b7280;">${esc(p.category || '')}</td><td style="padding:8px 12px;text-align:center;font-size:11px;font-weight:600;color:${statusColor};">${(p.status || 'pending').toUpperCase()}</td><td style="padding:8px 12px;text-align:right;font-size:13px;font-weight:600;">${cost > 0 ? fmtMoney(cost) : '—'}</td></tr>`;
  }
  h += `<tr><td colspan="4" style="padding:10px 12px;text-align:right;font-size:12px;color:#6b7280;">Parts Total</td><td style="padding:10px 12px;text-align:right;font-size:14px;font-weight:700;color:#111827;border-top:2px solid #111827;">${total > 0 ? fmtMoney(total) : '—'}</td></tr>`;
  h += '</table></td></tr>';
  return { html: h, total };
}

function buildJobSheetHtml(job, opts={}) {
  const { inspection, parts, jobLines, orgName, orgSettings } = opts;
  const os = orgSettings || {};
  const F = "font-family:'Helvetica Neue',Arial,sans-serif;";
  const displayReg = (job.vehicle_reg || '') + (job.trailer_id ? ' / ' + job.trailer_id : '');
  const statusText = (job.status || 'pending').toUpperCase();
  const statusColor = (job.status === 'complete' || job.status === 'invoiced') ? '#059669' : '#d97706';

  let h = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Job Sheet — ${esc(displayReg)}</title>
<style>@page{size:A4;margin:15mm;}body{${F}font-size:13px;color:#111827;margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}</style></head><body>
<div style="max-width:700px;margin:0 auto;padding:20px;">`;

  // Header
  h += `<table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:top;"><div style="${F}font-size:18px;font-weight:700;color:#111827;">${esc(os.company_name || orgName || 'HGVDesk')}</div><div style="${F}font-size:11px;color:#9ca3af;margin-top:2px;">hgvdesk.co.uk</div></td>
    <td style="text-align:right;vertical-align:top;"><div style="${F}font-size:10px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#9ca3af;">Workshop Job Sheet</div><div style="${F}font-size:16px;font-weight:700;color:#111827;margin-top:2px;">${esc(job.job_number || '')}</div><div style="${F}font-size:11px;color:#9ca3af;margin-top:2px;">${fmtDateTime(job.created_at)}</div></td>
  </tr></table>`;
  h += `<div style="border-top:2px solid #111827;margin:12px 0 20px;"></div>`;

  // Vehicle + Customer
  h += `<table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="width:50%;vertical-align:top;padding-right:12px;"><div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;">
      <div style="${F}font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;margin-bottom:6px;">Vehicle</div>
      <div style="${F}font-size:20px;font-weight:700;color:#111827;font-family:monospace;letter-spacing:1px;">${esc(displayReg)}</div>
      <div style="${F}font-size:12px;color:#6b7280;margin-top:4px;">${esc(job.inspection_type || 'T50')}${job.trailer_id ? ' · Trailer: ' + esc(job.trailer_id) : ''}</div>
    </div></td>
    <td style="width:50%;vertical-align:top;"><div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;">
      <div style="${F}font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;margin-bottom:6px;">Customer</div>
      <div style="${F}font-size:15px;font-weight:700;color:#111827;">${esc(job.customer_name || '—')}</div>
    </div></td>
  </tr></table>`;

  // Job Details
  h += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">`;
  h += jobSheetSectionTitle('Job Details');
  h += '<tr>';
  h += jobSheetMetric('Job Number', job.job_number || '—');
  h += jobSheetMetric('Technician', job.technician_name || 'Unassigned');
  h += jobSheetMetric('Priority', (job.priority || 'normal').toUpperCase(), job.priority === 'urgent' ? '#dc2626' : '#111827');
  h += jobSheetMetric('Status', statusText, statusColor);
  h += '</tr>';

  // Reported fault
  if (job.notes) {
    h += jobSheetSectionTitle('Reported Fault');
    h += `<tr><td colspan="4" style="padding:10px 0;${F}font-size:13px;color:#374151;line-height:1.6;">${esc(job.notes)}</td></tr>`;
  }

  // Parts
  let partsTotal = 0;
  if (parts && parts.length) {
    h += jobSheetSectionTitle('Parts Used (' + parts.length + ')');
    const pr = jobSheetPartsRows(parts);
    h += pr.html;
    partsTotal = pr.total;
  }

  // Labour
  let labourTotal = 0;
  if (jobLines && jobLines.length) {
    h += jobSheetSectionTitle('Labour / Sold Hours');
    const thS = 'padding:8px 12px;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:#9ca3af;border-bottom:1px solid #e5e7eb;';
    h += `<tr><td colspan="4"><table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;">`;
    h += `<tr><th style="${thS}text-align:left;">Description</th><th style="${thS}text-align:center;">Qty</th><th style="${thS}text-align:right;">Hours</th><th style="${thS}text-align:right;">Total</th></tr>`;
    let totalHrs = 0;
    for (const l of jobLines) {
      const hrs = Number(l.sold_hours || 0) * Number(l.quantity || 1);
      totalHrs += hrs;
      h += `<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:8px 12px;font-size:13px;">${esc(l.name || l.description)}</td><td style="padding:8px 12px;text-align:center;font-size:12px;">${Number(l.quantity || 1).toFixed(1)}</td><td style="padding:8px 12px;text-align:right;font-size:12px;">${Number(l.sold_hours || 0).toFixed(2)}</td><td style="padding:8px 12px;text-align:right;font-size:13px;font-weight:600;">${hrs.toFixed(2)}</td></tr>`;
    }
    h += `<tr><td colspan="3" style="padding:10px 12px;text-align:right;font-size:12px;color:#6b7280;">Total Hours</td><td style="padding:10px 12px;text-align:right;font-size:14px;font-weight:700;border-top:2px solid #111827;">${totalHrs.toFixed(2)} hrs</td></tr>`;
    h += '</table></td></tr>';
    labourTotal = totalHrs * 65;
  }

  // Cost summary
  const soldHrs = Number.parseFloat(job.sold_hours || 0);
  if (partsTotal > 0 || labourTotal > 0 || soldHrs > 0) {
    const labour = labourTotal > 0 ? labourTotal : soldHrs * 65;
    const subtotal = partsTotal + labour;
    const vat = Math.round(subtotal * 0.2 * 100) / 100;
    const total = subtotal + vat;
    h += `<tr><td colspan="4"><table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
      <tr><td></td><td style="text-align:right;padding:4px 12px;font-size:12px;color:#6b7280;width:120px;">Parts</td><td style="text-align:right;padding:4px 0;font-size:13px;width:90px;">${fmtMoney(partsTotal)}</td></tr>
      <tr><td></td><td style="text-align:right;padding:4px 12px;font-size:12px;color:#6b7280;">Labour</td><td style="text-align:right;padding:4px 0;font-size:13px;">${fmtMoney(labour)}</td></tr>
      <tr><td></td><td style="text-align:right;padding:4px 12px;font-size:12px;color:#6b7280;">Subtotal</td><td style="text-align:right;padding:4px 0;font-size:13px;">${fmtMoney(subtotal)}</td></tr>
      <tr><td></td><td style="text-align:right;padding:4px 12px;font-size:12px;color:#6b7280;">VAT (20%)</td><td style="text-align:right;padding:4px 0;font-size:13px;">${fmtMoney(vat)}</td></tr>
      <tr><td></td><td style="text-align:right;padding:10px 12px 4px;font-size:14px;font-weight:700;border-top:2px solid #111827;">Total</td><td style="text-align:right;padding:10px 0 4px;font-size:18px;font-weight:700;border-top:2px solid #111827;">${fmtMoney(total)}</td></tr>
    </table></td></tr>`;
  }

  // Sign-off
  h += jobSheetSectionTitle('Technician Sign-Off');
  h += '<tr>';
  h += jobSheetMetric('Technician', job.technician_name || '—');
  h += jobSheetMetric('Date Received', fmtShort(job.created_at));
  h += jobSheetMetric('Completed', fmtDateTime(job.completed_at));
  h += jobSheetMetric('Hours', (job.hours_worked || job.sold_hours || '—') + ' hrs');
  h += '</tr>';

  // Signature lines
  h += `<tr><td colspan="4" style="padding:30px 0 10px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="width:50%;padding-right:20px;"><div style="font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:#9ca3af;margin-bottom:8px;">Technician Signature</div><div style="border-bottom:1px solid #d1d5db;height:30px;"></div><div style="font-size:10px;color:#9ca3af;margin-top:4px;">Date: _______________</div></td>
      <td style="width:50%;"><div style="font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:#9ca3af;margin-bottom:8px;">Customer Signature</div><div style="border-bottom:1px solid #d1d5db;height:30px;"></div><div style="font-size:10px;color:#9ca3af;margin-top:4px;">Date: _______________</div></td></tr>
    </table>
  </td></tr>`;

  // Footer
  h += `<tr><td colspan="4" style="padding:20px 0 0;border-top:1px solid #e5e7eb;text-align:center;">
    <div style="${F}font-size:10px;color:#9ca3af;line-height:1.6;">This job sheet is prepared in accordance with DVSA roadworthiness standards. All data is recorded as completed by the assigned technician.</div>
    <div style="${F}font-size:10px;color:#d1d5db;margin-top:8px;">${esc(os.company_name || orgName || 'HGVDesk')} · hgvdesk.co.uk</div>
  </td></tr>`;

  h += '</table></div></body></html>';
  return h;
}

module.exports = {
  buildInspectionReportHtml,
  buildInvoiceHtml,
  buildJobSheetHtml,
  C, esc, fmtDate, fmtShort, fmtDateTime, fmtMoney,
  resultBadge, condBadge, sevBadge, badge,
  LOGO_SVG,
};
