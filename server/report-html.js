/**
 * HGVDESK — World-class report HTML builder
 * Barlow typography, SVG badge logo, premium colour system.
 * Table-based layout for email client compatibility + Puppeteer PDF.
 */

const C = {
  dark: '#0d1f2d',
  darkMid: '#142636',
  orange: '#f55a00',
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

function esc(s) { return s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'}) : '—'; }
function fmtShort(d) { return d ? new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—'; }
function fmtDateTime(d) { if(!d) return '—'; const dt=new Date(d); return fmtShort(d)+' '+dt.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}); }
function fmtMoney(n) { return '£' + Number(n||0).toFixed(2); }

function badge(label, bg, color) {
  return `<span style="display:inline-block;padding:3px 10px;border-radius:3px;background:${bg};color:${color};font-family:'Barlow',sans-serif;font-size:10px;font-weight:600;letter-spacing:0.5px;line-height:1.4;">${label}</span>`;
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

const LBL = `font-family:'Barlow',sans-serif;font-size:10px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${C.label};`;
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

function docHeader(docType, docNum, dateStr) {
  return `<tr><td style="background:${C.dark};padding:20px 32px;border-radius:8px 8px 0 0;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;">${LOGO_SVG}</td>
      <td style="text-align:right;vertical-align:middle;">
        <div style="${LBL}color:${C.orange};margin-bottom:3px;">${esc(docType)}</div>
        <div style="font-family:'Barlow',sans-serif;font-size:11px;color:rgba(255,255,255,0.55);">${esc(docNum)} &bull; ${esc(dateStr)}</div>
      </td>
    </tr></table>
  </td></tr>`;
}

function vehicleBar(reg, subtitle, resultHtml) {
  return `<tr><td style="background:${C.orange};padding:16px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><div style="${HEAD_S}font-size:28px;color:#fff;letter-spacing:1px;">${esc(reg)}</div>
        <div style="font-family:'Barlow',sans-serif;font-size:12px;color:rgba(255,255,255,0.8);margin-top:2px;">${esc(subtitle)}</div></td>
      <td style="text-align:right;vertical-align:middle;">${resultHtml}</td>
    </tr></table>
  </td></tr>`;
}

function docFooter(docNum, orgName) {
  return `<tr><td style="background:${C.surface};padding:16px 32px;border-top:1px solid ${C.border};">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;">${LOGO_SVG_SM}<div style="font-family:'Barlow',sans-serif;font-size:10px;color:${C.muted};margin-top:2px;">hgvdesk.co.uk</div></td>
      <td style="text-align:center;font-family:'Barlow',sans-serif;font-size:10px;color:${C.muted};">${esc(docNum)} &bull; ${esc(orgName||'HGVDesk')}</td>
      <td style="text-align:right;font-family:'Barlow',sans-serif;font-size:10px;color:${C.muted};">Generated ${fmtDateTime(new Date())}</td>
    </tr></table>
  </td></tr>
  <tr><td style="height:3px;background:${C.orange};border-radius:0 0 8px 8px;"></td></tr>`;
}

// ══════════════════════════════════════════════
// INSPECTION REPORT
// ══════════════════════════════════════════════

function buildInspectionReportHtml(insp, opts={}) {
  const { aiSummary, orgName } = opts;
  const checks = (typeof insp.check_items==='string'?JSON.parse(insp.check_items):insp.check_items)||(insp.checkItems||{});
  const tyres = (typeof insp.tyre_data==='string'?JSON.parse(insp.tyre_data):insp.tyre_data)||(insp.tyreData||{});
  const brakes = (typeof insp.brake_test_data==='string'?JSON.parse(insp.brake_test_data):insp.brake_test_data)||(insp.brakeData||{});
  const defects = insp.defects||[];
  const result = (insp.result||'pending').toLowerCase();

  let h = '';
  h += wrap(700);
  h += docHeader('INSPECTION REPORT', insp.inspection_id||'', fmtDateTime(insp.completed_at||insp.created_at));

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

  // DVSA Checklist — 3 col grid with alternating rows
  const checkEntries = Object.entries(checks);
  if (checkEntries.length) {
    h += secTitle('DVSA Checklist (' + checkEntries.length + ' items)');
    for (let i=0; i<checkEntries.length; i+=3) {
      const rowBg = (Math.floor(i/3)%2) ? C.surface : C.card;
      h += `<tr style="background:${rowBg};">`;
      for (let j=0; j<3; j++) {
        const e = checkEntries[i+j];
        if (!e) { h += '<td style="width:33%;"></td>'; continue; }
        const [name, state] = e;
        const st = (state||'').toLowerCase();
        let b; if (st==='pass') b=badge('PASS',C.passBg,C.passGreen); else if (st==='fail') b=badge('FAIL',C.failBg,C.failRed); else b=badge(st.toUpperCase()||'—',C.advBg,C.advAmber);
        h += `<td style="width:33%;padding:6px 10px;"><div style="display:flex;justify-content:space-between;align-items:center;"><span style="font-family:'Barlow',sans-serif;font-size:11px;color:${C.text};">${esc(name.replace(/_/g,' '))}</span>${b}</div></td>`;
      }
      h += '</tr>';
    }
  }

  // Brake test — metric cards + per-axle table
  if (brakes && (brakes.sbe!=null || brakes.pbe!=null || brakes.axles)) {
    h += secTitle('Brake Test Results (Roller Brake Test)');
    const axles = brakes.axles||{};
    let maxImb=0; for (const a of Object.values(axles)) if (a&&a.imb!=null) maxImb=Math.max(maxImb,a.imb);
    const allPass = Object.values(axles).every(a=>a&&a.pass);

    h += '<tr>';
    h += metricBox('Service Brake', (brakes.sbe!=null?brakes.sbe+'%':'—'), {big:true, color: brakes.sbe>=50?C.passGreen:C.failRed});
    h += metricBox('Secondary', (brakes.secondary!=null?brakes.secondary+'%':'—'));
    h += metricBox('Park Brake', (brakes.pbe!=null?brakes.pbe+'%':'—'), {color: brakes.pbe>=16?C.passGreen:C.failRed});
    h += metricBox('Max Imbalance', maxImb+'%', {color: maxImb<=30?C.passGreen:C.failRed});
    h += '</tr>';

    // DVSA minimums note
    h += `<tr><td colspan="4" style="padding:6px 0 10px;"><div style="font-family:'Barlow',sans-serif;font-size:10px;color:${C.muted};">DVSA minimums: Service ≥50% · Secondary ≥25% · Park ≥16% · Axle imbalance ≤30%</div></td></tr>`;

    // Per-axle NS/OS table
    if (Object.keys(axles).length) {
      const th = `style="padding:8px 12px;${LBL}text-align:center;border-bottom:1px solid ${C.border};"`;
      h += `<tr><td colspan="4"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:6px;overflow:hidden;">`;
      h += `<tr style="background:${C.surface};"><th ${th} style="${LBL}text-align:left;padding:8px 12px;">Axle</th><th ${th}>NS (kN)</th><th ${th}>OS (kN)</th><th ${th}>Imbalance</th><th ${th}>Result</th></tr>`;
      let ri=0;
      for (const [name, a] of Object.entries(axles)) {
        const bg = ri%2 ? C.surface : C.card;
        const pr = a.pass ? badge('PASS',C.passBg,C.passGreen) : badge('FAIL',C.failBg,C.failRed);
        const imbColor = (a.imb!=null && a.imb>30) ? C.failRed : C.text;
        h += `<tr style="background:${bg};"><td style="padding:8px 12px;font-family:'Barlow',sans-serif;font-size:12px;font-weight:500;">${esc(name)}</td><td style="padding:8px 12px;text-align:center;font-family:'Barlow',sans-serif;font-size:13px;font-weight:600;">${a.ns!=null?a.ns:'—'}</td><td style="padding:8px 12px;text-align:center;font-family:'Barlow',sans-serif;font-size:13px;font-weight:600;">${a.os!=null?a.os:'—'}</td><td style="padding:8px 12px;text-align:center;font-family:'Barlow',sans-serif;font-size:12px;color:${imbColor};">${a.imb!=null?a.imb+'%':'—'}</td><td style="padding:8px 12px;text-align:center;">${pr}</td></tr>`;
        ri++;
      }
      h += '</table></td></tr>';
    }
  }

  // Tyre data table
  const tyreEntries = Object.entries(tyres);
  if (tyreEntries.length) {
    h += secTitle('Tyre Data (' + tyreEntries.length + ' positions)');
    const th = `style="padding:8px 12px;${LBL}border-bottom:1px solid ${C.border};"`;
    h += `<tr><td colspan="4"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:6px;overflow:hidden;">`;
    h += `<tr style="background:${C.surface};"><th ${th} style="${LBL}text-align:left;padding:8px 12px;">Position</th><th ${th} style="${LBL}text-align:center;">Depth (mm)</th><th ${th} style="${LBL}text-align:center;">Expiry</th><th ${th} style="${LBL}text-align:center;">Condition</th></tr>`;
    let ri=0;
    for (const [pos, data] of tyreEntries) {
      const d = typeof data==='object'?data:{depth:data};
      const depth = d.depth||d.tread||'—';
      const depthNum = parseFloat(depth);
      const depthColor = !isNaN(depthNum) && depthNum<1 ? C.failRed : (!isNaN(depthNum) && depthNum<3 ? C.advAmber : C.text);
      const bg = ri%2 ? C.surface : C.card;
      h += `<tr style="background:${bg};"><td style="padding:8px 12px;font-family:'Barlow',sans-serif;font-size:12px;font-weight:500;">${esc(pos)}</td><td style="padding:8px 12px;text-align:center;font-family:'Barlow',sans-serif;font-size:13px;font-weight:600;color:${depthColor};">${esc(String(depth))}</td><td style="padding:8px 12px;text-align:center;font-family:'Barlow',sans-serif;font-size:12px;color:${C.muted};">${esc(d.expiry||'—')}</td><td style="padding:8px 12px;text-align:center;">${condBadge(d.condition)}</td></tr>`;
      ri++;
    }
    h += `</table><div style="font-family:'Barlow',sans-serif;font-size:10px;color:${C.muted};margin-top:4px;">HGV legal minimum: 1mm across ¾ width. Advisory threshold: &lt;3mm.</div></td></tr>`;
  }

  // Defects
  if (defects.length) {
    h += secTitle('Defects & Advisories (' + defects.length + ')');
    for (const d of defects) {
      const borderColor = d.resolved ? C.repairGreen : (d.severity==='critical'?C.failRed:C.advAmber);
      h += `<tr><td colspan="4" style="padding:6px 0;">
        <div style="border:1px solid ${C.border};border-left:4px solid ${borderColor};border-radius:6px;overflow:hidden;">
          <div style="padding:14px 18px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="${HEAD_S}font-size:14px;color:${C.text};">${esc(d.title||d.description||'Defect')}</span>
              ${sevBadge(d.severity)}
            </div>
            ${d.description&&d.description!==d.title ? '<div style="font-family:\'Barlow\',sans-serif;font-size:12px;color:'+C.muted+';line-height:1.5;">'+esc(d.description)+'</div>' : ''}
          </div>
          ${d.resolved ? '<div style="background:'+C.repairBg+';padding:12px 18px;border-top:1px solid #c8e0a8;"><div style="'+LBL+'color:'+C.repairGreen+';margin-bottom:4px;">REPAIRED</div>'+(d.resolved_by?'<div style="font-family:\'Barlow\',sans-serif;font-size:12px;color:'+C.text+';">By: <strong>'+esc(d.resolved_by)+'</strong></div>':'')+(d.resolution_notes?'<div style="font-family:\'Barlow\',sans-serif;font-size:12px;color:'+C.text+';margin-top:2px;">'+esc(d.resolution_notes)+'</div>':'')+(d.resolved_at?'<div style="font-family:\'Barlow\',sans-serif;font-size:10px;color:'+C.muted+';margin-top:4px;">'+fmtDateTime(d.resolved_at)+'</div>':'')+'</div>' : ''}
        </div>
      </td></tr>`;
    }
  }

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
  h += docFooter(insp.inspection_id||'', orgName||'HGVDesk');
  h += '</table>';
  return pageShell('Inspection Report — '+(insp.vehicle_reg||''), h);
}

// ══════════════════════════════════════════════
// INVOICE
// ══════════════════════════════════════════════

function buildInvoiceHtml(invoice, lines, opts={}) {
  const { orgName } = opts;
  let h = '';
  h += wrap(700);
  h += docHeader('INVOICE', invoice.invoice_number||'', fmtShort(invoice.issue_date));

  // Orange bar
  const statusBadge = invoice.status==='paid' ? badge('PAID',C.passBg,C.passGreen) : badge((invoice.status||'DRAFT').toUpperCase(),C.advBg,C.advAmber);
  h += `<tr><td style="background:${C.orange};padding:16px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><div style="${HEAD_S}font-size:26px;color:#fff;">${esc(invoice.invoice_number)}</div><div style="font-family:'Barlow',sans-serif;font-size:12px;color:rgba(255,255,255,0.8);margin-top:2px;">${esc(invoice.customer_name||'')}</div></td>
      <td style="text-align:right;"><div style="font-family:'Barlow',sans-serif;font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">Due: ${fmtShort(invoice.due_date)}</div>${statusBadge}</td>
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

  // Line items table
  h += secTitleWide('Line Items');
  const th = `style="padding:10px 12px;${LBL}border-bottom:1px solid ${C.border};"`;
  h += `<tr><td colspan="10"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:6px;overflow:hidden;">`;
  h += `<tr style="background:${C.surface};"><th ${th} style="${LBL}text-align:left;padding:10px 12px;width:8%;">#</th><th ${th} style="${LBL}text-align:left;width:52%;">Description</th><th ${th} style="${LBL}text-align:center;width:10%;">Qty</th><th ${th} style="${LBL}text-align:right;width:15%;">Unit Price</th><th ${th} style="${LBL}text-align:right;width:15%;">Total</th></tr>`;
  for (let i=0; i<(lines||[]).length; i++) {
    const l = lines[i]; const bg = i%2 ? C.surface : C.card;
    h += `<tr style="background:${bg};"><td style="padding:10px 12px;font-family:'Barlow',sans-serif;font-size:12px;color:${C.muted};">${i+1}</td><td style="padding:10px 12px;font-family:'Barlow',sans-serif;font-size:13px;font-weight:500;">${esc(l.description||l.name)}</td><td style="padding:10px 12px;text-align:center;font-family:'Barlow',sans-serif;font-size:13px;">${l.quantity||1}</td><td style="padding:10px 12px;text-align:right;font-family:'Barlow',sans-serif;font-size:13px;">${fmtMoney(l.unit_price)}</td><td style="padding:10px 12px;text-align:right;font-family:'Barlow',sans-serif;font-size:13px;font-weight:600;">${fmtMoney(l.line_total)}</td></tr>`;
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
  h += secTitleWide('Payment Details');
  h += `<tr><td colspan="10"><div style="background:${C.surface};border:1px solid ${C.border};border-radius:6px;padding:16px;font-family:'Barlow',sans-serif;font-size:12px;line-height:1.8;color:${C.text};">
    Bank: <strong>Barclays Business</strong><br>Sort Code: <strong>20-45-45</strong><br>Account: <strong>73024689</strong><br>Reference: <strong>${esc(invoice.invoice_number)}</strong>
  </div></td></tr>`;

  // Terms
  h += `<tr><td colspan="10" style="padding:16px 0 0;font-family:'Barlow',sans-serif;font-size:10px;color:${C.muted};line-height:1.6;">Payment is due within 30 days of the invoice date. Late payments may incur interest at 8% above the Bank of England base rate under the Late Payment of Commercial Debts Act 1998. All amounts are in GBP.</td></tr>`;

  // Thank you
  h += `<tr><td colspan="10" style="padding:20px 0 0;text-align:center;"><div style="${HEAD_S}font-size:18px;color:${C.dark};">Thank you for your business</div><div style="font-family:'Barlow',sans-serif;font-size:12px;color:${C.muted};margin-top:4px;">hgvdesk.co.uk · hello@hgvdesk.co.uk</div></td></tr>`;

  h += '</table></td></tr>';
  h += docFooter(invoice.invoice_number||'', orgName||'HGVDesk');
  h += '</table>';
  return pageShell('Invoice — '+(invoice.invoice_number||''), h);
}

// ══════════════════════════════════════════════
// JOB SHEET
// ══════════════════════════════════════════════

function buildJobSheetHtml(job, opts={}) {
  const { inspection, parts, jobLines, orgName } = opts;
  let h = '';
  h += wrap(700);
  h += docHeader('WORKSHOP JOB SHEET', job.job_number||'', fmtDateTime(job.created_at));

  const statusBadge = job.status==='complete'||job.status==='invoiced' ? badge(job.status.toUpperCase(),C.passBg,C.passGreen) : badge((job.status||'PENDING').toUpperCase(),C.advBg,C.advAmber);
  h += vehicleBar(job.vehicle_reg||'', [job.customer_name, job.inspection_type].filter(Boolean).join(' · '), statusBadge);

  h += `<tr><td style="background:${C.card};padding:28px 32px;">`;
  h += `<table width="100%" cellpadding="0" cellspacing="0">`;

  // Job details
  h += secTitle('Job Details');
  h += '<tr>';
  h += metricBox('Job Number', job.job_number||'—');
  h += metricBox('Technician', job.technician_name||'Unassigned');
  h += metricBox('Priority', (job.priority||'normal').toUpperCase(), {color: job.priority==='urgent'?C.failRed:C.text});
  h += metricBox('Status', (job.status||'pending').toUpperCase());
  h += '</tr>';

  // Reported fault
  if (job.notes) {
    h += secTitle('Reported Fault');
    h += `<tr><td colspan="4" style="padding:10px 0;${BODY_S}">${esc(job.notes)}</td></tr>`;
  }

  // Parts table
  if (parts && parts.length) {
    h += secTitle('Parts Used (' + parts.length + ')');
    const th = `style="padding:8px 12px;${LBL}border-bottom:1px solid ${C.border};"`;
    h += `<tr><td colspan="4"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:6px;overflow:hidden;">`;
    h += `<tr style="background:${C.surface};"><th ${th} style="${LBL}text-align:left;padding:8px 12px;">Part</th><th ${th} style="${LBL}text-align:left;">Category</th><th ${th} style="${LBL}text-align:center;">Status</th><th ${th} style="${LBL}text-align:right;">Cost</th></tr>`;
    let partTotal = 0;
    for (let i=0; i<parts.length; i++) {
      const p=parts[i]; const bg=i%2?C.surface:C.card; const cost=Number(p.unit_cost||0)*Number(p.qty||1);
      partTotal += cost;
      h += `<tr style="background:${bg};"><td style="padding:8px 12px;font-family:'Barlow',sans-serif;font-size:12px;font-weight:500;">${esc(p.name)}</td><td style="padding:8px 12px;font-family:'Barlow',sans-serif;font-size:12px;color:${C.muted};">${esc(p.category||'')}</td><td style="padding:8px 12px;text-align:center;">${badge((p.status||'pending').toUpperCase(), p.status==='ready'?C.passBg:C.advBg, p.status==='ready'?C.passGreen:C.advAmber)}</td><td style="padding:8px 12px;text-align:right;font-family:'Barlow',sans-serif;font-size:12px;font-weight:600;">${cost>0?fmtMoney(cost):'—'}</td></tr>`;
    }
    h += `<tr style="background:${C.surface};border-top:2px solid ${C.dark};"><td colspan="3" style="padding:10px 12px;${HEAD_S}font-size:13px;">Parts Total</td><td style="padding:10px 12px;text-align:right;${HEAD_S}font-size:14px;">${partTotal>0?fmtMoney(partTotal):'—'}</td></tr>`;
    h += '</table></td></tr>';
  }

  // Sold hours / labour
  if (jobLines && jobLines.length) {
    h += secTitle('Labour / Sold Hours');
    const th = `style="padding:8px 12px;${LBL}border-bottom:1px solid ${C.border};"`;
    h += `<tr><td colspan="4"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:6px;overflow:hidden;">`;
    h += `<tr style="background:${C.surface};"><th ${th} style="${LBL}text-align:left;padding:8px 12px;">Description</th><th ${th} style="${LBL}text-align:center;">Qty</th><th ${th} style="${LBL}text-align:right;">Hours</th><th ${th} style="${LBL}text-align:right;">Total Hrs</th></tr>`;
    let totalHrs=0;
    for (let i=0; i<jobLines.length; i++) {
      const l=jobLines[i]; const bg=i%2?C.surface:C.card; const lineHrs=Number(l.sold_hours||0)*Number(l.quantity||1);
      totalHrs += lineHrs;
      h += `<tr style="background:${bg};"><td style="padding:8px 12px;font-family:'Barlow',sans-serif;font-size:12px;font-weight:500;">${esc(l.name||l.description)}</td><td style="padding:8px 12px;text-align:center;font-family:'Barlow',sans-serif;font-size:12px;">${Number(l.quantity||1).toFixed(1)}</td><td style="padding:8px 12px;text-align:right;font-family:'Barlow',sans-serif;font-size:12px;">${Number(l.sold_hours||0).toFixed(2)}</td><td style="padding:8px 12px;text-align:right;font-family:'Barlow',sans-serif;font-size:12px;font-weight:600;">${lineHrs.toFixed(2)}</td></tr>`;
    }
    h += `<tr style="background:${C.surface};border-top:2px solid ${C.dark};"><td colspan="3" style="padding:10px 12px;${HEAD_S}font-size:13px;">Total Labour</td><td style="padding:10px 12px;text-align:right;${HEAD_S}font-size:14px;">${totalHrs.toFixed(2)} hrs</td></tr>`;
    h += '</table></td></tr>';
  }

  // Linked inspection
  if (inspection) {
    h += secTitle('Linked Inspection — ' + (inspection.inspection_id||''));
    h += `<tr><td colspan="4" style="padding:8px 0;">`;
    // Embed a simplified version of the inspection data
    h += buildInspectionReportHtml(inspection, { orgName }).replace(/<!DOCTYPE[\s\S]*?<body[^>]*>/,'').replace(/<\/body[\s\S]*$/,'');
    h += `</td></tr>`;
  }

  // Technician sign-off
  h += secTitle('Technician Sign-Off');
  h += '<tr>';
  h += metricBox('Technician', job.technician_name||'—');
  h += metricBox('Date Received', fmtShort(job.created_at));
  h += metricBox('Completed', fmtDateTime(job.completed_at));
  h += metricBox('Hours Worked', (job.hours_worked||job.sold_hours||'—')+' hrs');
  h += '</tr>';

  h += '</table></td></tr>';
  h += docFooter(job.job_number||'', orgName||'HGVDesk');
  h += '</table>';
  return pageShell('Job Sheet — '+(job.vehicle_reg||''), h);
}

module.exports = {
  buildInspectionReportHtml,
  buildInvoiceHtml,
  buildJobSheetHtml,
  C, esc, fmtDate, fmtShort, fmtDateTime, fmtMoney,
  resultBadge, condBadge, sevBadge, badge,
  LOGO_SVG,
};
