/**
 * HGVDESK — AI ROUTES
 * Anthropic-powered helpers for the inspect/workshop UIs.
 */
const Anthropic = require('@anthropic-ai/sdk');

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

const DEFECT_SYSTEM_PROMPT = [
  'You are an experienced HGV workshop technician writing defect notes on a DVSA',
  'inspection sheet. Write exactly like a real tech would — short, blunt, practical.',
  '',
  'Rules:',
  '- One sentence, 8-20 words max. Direct and specific.',
  '- Sound like a mechanic, not a report generator. Plain language, no filler.',
  '- Good: "Nearside front disc worn below min thickness - replace before next shift"',
  '- Good: "OS rear brake chamber leaking air - needs immediate swap"',
  '- Good: "Steering box play excessive - MOT fail, book in ASAP"',
  '- Bad: "The brake disc exhibits significant wear patterns that may compromise safety"',
  '- Bad: "Upon inspection, the steering mechanism demonstrates notable deterioration"',
  '- Use short UK HGV terms: NS/OS, play, perished, scored, leaking, seized, worn,',
  '  cracked, corroded, missing, loose, rubbing, split. No flowery words.',
  '- Advisory = "monitor", "getting close", "keep an eye on", "check at next PMI".',
  '- Critical = "replace now", "off road until fixed", "immediate", "MOT fail".',
  '- Reference the zone the inspector marked.',
  '- No measurements unless they are in the input.',
  '- Output the description only. No labels, no markdown, no quotes.',
].join('\n');

const SUMMARY_SYSTEM_PROMPT = [
  'You are a UK HGV inspection assistant writing short, plain-English summaries of',
  'completed vehicle safety inspections. Your summary goes at the top of an emailed',
  'inspection report sent to a fleet operator or customer.',
  '',
  'Rules:',
  '- Exactly 2-3 sentences. No preamble, no "here is", no markdown, no quotes.',
  '- Sentence 1: state the overall result (pass / advisory / fail) and the vehicle reg.',
  '- Sentence 2: note defect counts and any critical items by name if present.',
  '- Sentence 3 (optional): recommended action — "safe to operate", "rectify before next',
  '  shift", "remove from service immediately", etc. — matched to severity.',
  '- Plain British English. No jargon unless the defect list uses it.',
  '- Do not invent defects or measurements not present in the input.',
  '- If the inspection result is null/pending, say so honestly — do not guess.',
].join('\n');

function buildUserPrompt({ zone, severity, vehicleType, vehicleReg, partialText }) {
  const typeDesc = vehicleType === 'T60' ? 'T60 trailer' : vehicleType === 'T50' ? 'T50 rigid/artic tractor unit' : (vehicleType || 'HGV');
  const lines = [
    `Zone marked by inspector: ${zone || 'unspecified'}`,
    `Severity: ${severity === 'critical' ? 'CRITICAL DEFECT — immediate action required' : 'ADVISORY — monitor/schedule repair'}`,
    `Vehicle type: ${typeDesc}`,
  ];
  if (vehicleReg) lines.push(`Vehicle reg: ${vehicleReg}`);
  if (partialText) lines.push(`Inspector's partial notes: ${partialText}`);
  lines.push('', 'Write the defect description for this zone and severity.');
  return lines.join('\n');
}

async function defectSuggestion(body) {
  if (!client) {
    throw { status: 503, message: 'AI assistant not configured (ANTHROPIC_API_KEY missing)' };
  }
  const { zone, severity, vehicleType, vehicleReg, partialText } = body || {};
  if (!zone) throw { status: 400, message: 'zone is required' };

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 256,
    system: [
      { type: 'text', text: DEFECT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      { role: 'user', content: buildUserPrompt({ zone, severity, vehicleType, vehicleReg, partialText }) },
    ],
  });

  return { suggestion: extractText(message), model: message.model, usage: message.usage };
}

// ── Repair description (Feature: AI repair note matching the defect) ────

const REPAIR_SYSTEM_PROMPT = [
  'You are an HGV workshop technician writing a repair note for a defect that has',
  'just been fixed. The repair note goes on the inspection sheet next to the defect.',
  '',
  'Rules:',
  '- One sentence, 8-20 words. Same blunt technician style as the defect.',
  '- Confirm what was done: "replaced", "fitted new", "adjusted", "retorqued",',
  '  "welded and tested", "reconditioned", "repaired leak", etc.',
  '- End with a confirmation: "within spec", "tested OK", "torqued to spec",',
  '  "road tested", "no further issues".',
  '- Match the zone/component from the defect — if defect says "NS front disc"',
  '  the repair says "NS front disc replaced..." not "brake disc repaired".',
  '- No preamble, no quotes, no markdown. Just the repair note.',
].join('\n');

async function repairSuggestion(body) {
  if (!client) throw { status: 503, message: 'AI assistant not configured' };
  const { defectDescription, zone, severity } = body || {};
  if (!defectDescription) throw { status: 400, message: 'defectDescription is required' };

  const prompt = [
    `Original defect: ${defectDescription}`,
    zone ? `Zone: ${zone}` : '',
    severity ? `Severity: ${severity}` : '',
    '', 'Write the repair note.',
  ].filter(Boolean).join('\n');

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 150,
    system: [{ type: 'text', text: REPAIR_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
  });

  return { suggestion: extractText(message), model: message.model, usage: message.usage };
}

function extractText(message) {
  return (message.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();
}

// ── Inspection report summary (Feature 1) ───────────────────────────

function buildSummaryPrompt({ vehicleReg, inspectionType, result, inspectorName, defects, nilDefect, notes }) {
  const lines = [
    `Vehicle: ${vehicleReg || 'unknown'}`,
    `Inspection type: ${inspectionType || 'standard'}`,
    `Result: ${result || 'pending'}`,
    `Inspector: ${inspectorName || 'unknown'}`,
    `Nil defect: ${nilDefect ? 'yes' : 'no'}`,
  ];
  const list = Array.isArray(defects) ? defects : [];
  if (list.length === 0) {
    lines.push('Defects: none recorded');
  } else {
    lines.push(`Defects (${list.length} total):`);
    for (const d of list) {
      const sev = (d.severity || 'advisory').toUpperCase();
      const title = d.title || d.description || 'unnamed defect';
      const status = d.resolved ? ' [rectified]' : '';
      lines.push(`- [${sev}] ${title}${status}`);
    }
  }
  if (notes) lines.push(`Inspector notes: ${notes}`);
  lines.push('', 'Write the 2-3 sentence summary.');
  return lines.join('\n');
}

// Never throws — callers use this inline with email sending and we don't
// want a flaky AI call to block a report. Returns { summary: '' } on failure.
async function inspectionSummarySafe(payload) {
  if (!client) return { summary: '' };
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 220,
      system: [
        { type: 'text', text: SUMMARY_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        { role: 'user', content: buildSummaryPrompt(payload) },
      ],
    });
    return { summary: extractText(message), model: message.model, usage: message.usage };
  } catch (e) {
    console.error('[AI] inspectionSummary failed:', e.message || e);
    return { summary: '' };
  }
}

// ── Predictive maintenance (Feature 2) ──────────────────────────────

const PREDICTION_SYSTEM_PROMPT = [
  'You are a UK HGV fleet maintenance analyst. Your job is to look at a vehicle\'s',
  'recent inspection history and predict what is most likely to need attention at',
  'the next PMI / safety inspection. The output goes to a workshop manager planning',
  'the next service.',
  '',
  'Rules:',
  '- Respond in 3-5 short bullet lines, each starting with "• ".',
  '- Each bullet: one specific area to watch, with one-line reasoning from the history.',
  '- Prioritise items that have recurred, escalated in severity, or progressed from',
  '  advisory toward fail across inspections.',
  '- If fewer than 2 inspections are available, say so honestly in one line and give',
  '  at most 1-2 generic watch points for the vehicle type.',
  '- Plain British English. HGV terminology OK (PMI, LOLER, roller brake test, tread',
  '  depth, brake chamber, air leak, etc.) when the input uses it.',
  '- Do not invent defects that are not in the inspection history.',
  '- No preamble, no markdown headings, no "based on the data". Start with the bullets.',
].join('\n');

function buildPredictionPrompt({ vehicleReg, inspections }) {
  const lines = [`Vehicle: ${vehicleReg}`, `Inspections available: ${inspections.length}`, ''];
  for (const insp of inspections) {
    const date = insp.created_at ? new Date(insp.created_at).toISOString().slice(0, 10) : 'unknown-date';
    const result = (insp.result || 'pending').toUpperCase();
    lines.push(`── ${date} — ${insp.inspection_type || 'T50'} — result ${result} — mileage ${insp.overall_mileage || 'n/a'}`);
    const defs = insp.defects || [];
    if (defs.length === 0) {
      lines.push('   (no defects recorded)');
    } else {
      for (const d of defs) {
        const sev = (d.severity || 'advisory').toUpperCase();
        const resolved = d.resolved ? ' [rectified]' : '';
        lines.push(`   • [${sev}] ${d.title || d.description || 'unnamed'}${resolved}`);
      }
    }
  }
  lines.push('', 'Write the prediction.');
  return lines.join('\n');
}

async function maintenancePrediction({ vehicleReg, inspections }) {
  if (!client) {
    throw { status: 503, message: 'AI assistant not configured (ANTHROPIC_API_KEY missing)' };
  }
  if (!vehicleReg) throw { status: 400, message: 'vehicleReg is required' };
  if (!Array.isArray(inspections)) throw { status: 400, message: 'inspections must be an array' };

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 400,
    system: [
      { type: 'text', text: PREDICTION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      { role: 'user', content: buildPredictionPrompt({ vehicleReg, inspections }) },
    ],
  });

  return {
    prediction: extractText(message),
    inspectionsAnalysed: inspections.length,
    model: message.model,
    usage: message.usage,
  };
}

// ── Natural-language search (Feature 3) ─────────────────────────────
//
// Security model: the LLM is NEVER given the ability to emit raw SQL.
// It chooses an entity from a fixed list and a set of filter keys from
// a per-entity allowlist. The server then translates the validated
// JSON into a parameterized query.

const SEARCH_SCHEMA = {
  inspections: {
    label: 'inspections — safety inspection records',
    columns: ['id', 'inspection_id', 'vehicle_reg', 'inspection_type', 'inspector_name', 'status', 'result', 'overall_mileage', 'nil_defect', 'created_at'],
    filters: {
      result: { type: 'enum', values: ['pass', 'fail', 'advisory', 'pending'] },
      status: { type: 'string' },
      vehicle_reg: { type: 'string', match: 'exact-upper' },
      inspection_type: { type: 'string' },
      inspector_name: { type: 'string', match: 'ilike' },
      created_after: { type: 'date', column: 'created_at', op: '>=' },
      created_before: { type: 'date', column: 'created_at', op: '<=' },
      nil_defect: { type: 'bool' },
    },
  },
  jobs: {
    label: 'jobs — workshop jobs',
    columns: ['id', 'job_number', 'vehicle_reg', 'inspection_type', 'customer_name', 'technician_name', 'priority', 'status', 'created_at'],
    filters: {
      status: { type: 'string' },
      priority: { type: 'enum', values: ['urgent', 'high', 'normal', 'low'] },
      vehicle_reg: { type: 'string', match: 'exact-upper' },
      customer_name: { type: 'string', match: 'ilike' },
      technician_name: { type: 'string', match: 'ilike' },
      inspection_type: { type: 'string' },
      created_after: { type: 'date', column: 'created_at', op: '>=' },
      created_before: { type: 'date', column: 'created_at', op: '<=' },
    },
  },
  defects: {
    label: 'defects — items raised on inspections',
    columns: ['id', 'inspection_id', 'vehicle_reg', 'title', 'category', 'severity', 'resolved', 'created_at'],
    filters: {
      severity: { type: 'enum', values: ['critical', 'major', 'advisory'] },
      resolved: { type: 'bool' },
      vehicle_reg: { type: 'string', match: 'exact-upper' },
      category: { type: 'string', match: 'ilike' },
      title_contains: { type: 'string', column: 'title', op: 'ilike-wrap' },
      created_after: { type: 'date', column: 'created_at', op: '>=' },
      created_before: { type: 'date', column: 'created_at', op: '<=' },
    },
  },
  parts: {
    label: 'parts — parts queue items',
    columns: ['id', 'part_id', 'vehicle_reg', 'name', 'category', 'priority', 'status', 'created_at'],
    filters: {
      status: { type: 'string' },
      priority: { type: 'enum', values: ['urgent', 'high', 'normal', 'low'] },
      vehicle_reg: { type: 'string', match: 'exact-upper' },
      category: { type: 'string', match: 'ilike' },
      name_contains: { type: 'string', column: 'name', op: 'ilike-wrap' },
      created_after: { type: 'date', column: 'created_at', op: '>=' },
      created_before: { type: 'date', column: 'created_at', op: '<=' },
    },
  },
};

function buildSearchSystemPrompt() {
  const lines = [
    'You translate a user\'s natural-language fleet question into a structured',
    'search filter. You do NOT write SQL. You pick one entity and zero or more',
    'filter keys, and a backend translates your JSON into a parameterised query.',
    '',
    'Entities and their allowed filter keys:',
  ];
  for (const [entity, def] of Object.entries(SEARCH_SCHEMA)) {
    lines.push('', `== ${entity} (${def.label}) ==`);
    for (const [key, cfg] of Object.entries(def.filters)) {
      let desc = `  ${key}: ${cfg.type}`;
      if (cfg.values) desc += ` — one of ${cfg.values.join('/')}`;
      if (cfg.match === 'ilike' || cfg.op === 'ilike-wrap') desc += ' — partial match';
      lines.push(desc);
    }
  }
  lines.push(
    '',
    'Response format: return ONLY a JSON object, nothing else. No markdown, no',
    'backticks, no prose. The object has exactly these keys:',
    '{',
    '  "entity": "inspections" | "jobs" | "defects" | "parts",',
    '  "filters": { ...zero or more filter keys from the entity allowlist... },',
    '  "reasoning": "one sentence explaining the interpretation"',
    '}',
    '',
    'Date filters (created_after / created_before) must be ISO YYYY-MM-DD.',
    'Relative date resolution: "today" = current date, "this month" =',
    'created_after: first day of current month. "last 7 days" =',
    'created_after: current date minus 7 days. "last month" = both',
    'created_after: first day of last month AND created_before: last day of',
    'last month.',
    '',
    'If the question cannot be mapped to a whitelisted entity/filter, still',
    'return valid JSON with entity: "inspections", filters: {}, and put an',
    'explanation in reasoning. The user sees reasoning; they do not see raw',
    'filter output.',
  );
  return lines.join('\n');
}

const SEARCH_SYSTEM_PROMPT = buildSearchSystemPrompt();

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function nlSearchInterpret({ query }) {
  if (!client) throw { status: 503, message: 'AI assistant not configured (ANTHROPIC_API_KEY missing)' };
  if (!query || !query.trim()) throw { status: 400, message: 'query is required' };

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 400,
    system: [
      { type: 'text', text: SEARCH_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      { role: 'user', content: `Today's date is ${todayIso()}.\n\nUser question: ${query.trim()}` },
    ],
  });

  const raw = extractText(message);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // Try to extract the first {...} block if the model wrapped it.
    const braceMatch = raw.match(/\{[\s\S]*\}/);
    if (!braceMatch) throw { status: 502, message: 'AI returned unparseable JSON: ' + raw.slice(0, 200) };
    parsed = JSON.parse(braceMatch[0]);
  }
  return { parsed, model: message.model, usage: message.usage };
}

// Returns { clause, param } for a single validated filter, or null if the
// value should be silently dropped. Each helper below handles exactly one
// filter type so validateAndBuildQuery can stay a thin dispatcher.

function boolFragment(column, value) {
  const b = (value === true || value === 'true' || value === 1);
  return { clause: `${column} = $PH`, param: b };
}

function dateFragment(column, op, value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return { clause: `${column} ${op} $PH`, param: value };
}

function stringFragment(column, cfg, value) {
  if (cfg.match === 'exact-upper') {
    return {
      clause: `UPPER(REPLACE(${column}, ' ', '')) = REPLACE($PH, ' ', '')`,
      param: String(value).toUpperCase().trim(),
    };
  }
  if (cfg.match === 'ilike' || cfg.op === 'ilike-wrap') {
    return { clause: `${column} ILIKE $PH`, param: '%' + String(value).trim() + '%' };
  }
  return { clause: `${column} = $PH`, param: String(value).trim() };
}

function fragmentFor(column, cfg, value) {
  if (cfg.type === 'enum') {
    if (!cfg.values.includes(String(value).toLowerCase())) return null;
    return { clause: `${column} = $PH`, param: String(value).toLowerCase() };
  }
  if (cfg.type === 'bool') return boolFragment(column, value);
  if (cfg.type === 'date') return dateFragment(column, cfg.op, value);
  return stringFragment(column, cfg, value);
}

function validateAndBuildQuery(parsed, orgId) {
  if (!parsed || typeof parsed !== 'object') throw { status: 502, message: 'AI returned invalid shape' };
  const def = SEARCH_SCHEMA[parsed.entity];
  if (!def) throw { status: 400, message: `Unknown entity: ${parsed.entity}` };

  const filters = (parsed.filters && typeof parsed.filters === 'object') ? parsed.filters : {};
  const where = ['org_id = $1'];
  const params = [orgId];

  for (const [key, value] of Object.entries(filters)) {
    const cfg = def.filters[key];
    if (!cfg || value == null || value === '') continue; // unknown key or empty → drop
    const frag = fragmentFor(cfg.column || key, cfg, value);
    if (!frag) continue;
    params.push(frag.param);
    where.push(frag.clause.replace('$PH', '$' + params.length));
  }

  const cols = def.columns.join(', ');
  const sql = `SELECT ${cols} FROM ${parsed.entity} WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 50`;
  return { sql, params, entity: parsed.entity, columns: def.columns };
}

async function nlSearch({ query, caller }) {
  const orgId = caller.id || caller.org_id;
  const { parsed, model, usage } = await nlSearchInterpret({ query });
  const { sql, params, entity, columns } = validateAndBuildQuery(parsed, orgId);
  const db = require('../db');
  const rows = await db.queryAll(sql, params);
  return {
    entity,
    filters: parsed.filters || {},
    reasoning: parsed.reasoning || null,
    rows,
    rowCount: rows.length,
    columns,
    model,
    usage,
  };
}

// ── Arthur — HGV Technical Assistant ──────────────────────────────────

const ARTHUR_SYSTEM_PROMPT = [
  'You are Arthur, a virtual HGV workshop technician with 50 years of hands-on',
  'experience in the UK commercial vehicle industry. You work for HGVDesk, a',
  'workshop management platform. Technicians ask you questions while working on',
  'vehicles in the workshop.',
  '',
  'YOUR CHARACTER:',
  '- Straight-talking, no-nonsense workshop veteran',
  '- Direct, practical advice — like a senior tech mentoring a junior',
  '- Use UK HGV terminology: NS/OS, nearside/offside, MOT, PMI, DVSA, O-licence',
  '- Short paragraphs. Numbered steps for procedures. No waffle.',
  '- Always mention safety warnings with ⚠️ where relevant',
  '- Reference DVSA standards (GV262, Guide to Maintaining Roadworthiness) where applicable',
  '- If you don\'t know something specific, say so — don\'t guess torque specs',
  '',
  'YOUR KNOWLEDGE:',
  '',
  '— DVSA STANDARDS —',
  'GV262 Guide to Maintaining Roadworthiness. Inspection intervals: PMI at least',
  'every 6-8 weeks for 6+ wheel rigids, every 10-13 weeks for trailers. Annual test',
  'T50 (motor vehicle) and T60 (trailer). Prohibition categories: Dangerous (S mark,',
  'immediate), Major (delayed), Minor (advisory). DVSA can prohibit at roadside.',
  '',
  '— BRAKE SYSTEMS —',
  'Service brake minimum efficiency: 50% (motor vehicle), 45% (trailer).',
  'Secondary brake: 25% motor vehicle. Parking brake: 16%.',
  'Maximum axle imbalance: 30%. Roller brake test procedure. EBS/ABS diagnostics.',
  'Foundation brakes: S-cam, wedge, disc. Air system: compressor, governor (cut-in',
  '6.9bar, cut-out 8.1bar typical), reservoirs, gladhands. Brake adjustment.',
  'Bleeding procedure after caliper/chamber replacement.',
  '',
  '— TYRES —',
  'HGV legal minimum: 1mm across ¾ of breadth, visible tread around entire',
  'circumference. Steer axle advisory at 3mm. Mixing radial/cross-ply illegal on',
  'same axle. Speed ratings must match. Tyre age: check DOT code, 10 years max.',
  'Fitting: torque wheel nuts to manufacturer spec (typically 550-650 Nm for',
  '10-stud ISO, always check). Re-torque after 50 miles.',
  '',
  '— WHEEL BEARINGS & HUBS —',
  'Taper roller bearing preload: typically 0.001-0.003" endplay. Adjustment',
  'procedure: tighten to 200 Nm while rotating, back off, retighten to 50 Nm,',
  'back off ¼ turn, fit lock nut. Hub seal replacement. Hub oil vs grease.',
  'Check for play: jack wheel, rock at 12/6 and 3/9 positions.',
  '',
  '— SUSPENSION —',
  'Air suspension: bags, height valves, levelling valves, air lines. Leak test',
  'with soapy water. Ride height measurement. Leaf springs: check for cracks,',
  'shifted leaves, broken centre bolt, worn bushes. U-bolt torque.',
  'Shock absorbers: bounce test, visual leak check.',
  '',
  '— STEERING —',
  'Maximum free play at steering wheel: HGV = 75mm diameter movement before',
  'wheels respond. Check: drag link, track rod ends, steering box, power',
  'steering pump, hoses. Ball joint inspection. King pin wear check with',
  'dial gauge (max 3mm typically). Power steering fluid level.',
  '',
  '— COUPLING (FIFTH WHEEL / TRAILER) —',
  'Fifth wheel: check jaw wear, locking mechanism, mounting bolts, grease.',
  'Kingpin: measure with go/no-go gauge. 2" kingpin reject at 1.960".',
  '3.5" kingpin reject at 3.460". Safety catch must engage. Rubbing plate',
  'thickness. Turntable: check for cracks, bolt security, wear.',
  '',
  '— LIGHTS & ELECTRICS —',
  'All lights must work: headlamps, sides, tails, brakes, indicators, reverse,',
  'hazards, marker, rear fog, number plate. Suzi cable condition. 24V system.',
  'ABS/EBS warning lamp check. Tachograph: digital — 2 year calibration;',
  'analogue — 6 year calibration. Seals must be intact.',
  '',
  '— ENGINE BASICS —',
  'Oil level check (hot/cold markings). Coolant level and condition (test with',
  'refractometer, -25°C minimum). Belt tension and condition. Fuel system:',
  'check for leaks at injectors, supply lines, filter housings. AdBlue system.',
  'DPF regeneration issues. Exhaust smoke: white=coolant, blue=oil, black=fuel.',
  '',
  '— T50 vs T60 —',
  'T50: Motor vehicle annual test. Covers everything above — engine, cab,',
  'steering, brakes, suspension, wheels, lights, exhaust, coupling.',
  'T60: Trailer annual test. No engine/cab/steering items. Covers body, brakes,',
  'suspension, wheels, lights, coupling (kingpin), landing legs, curtains/doors,',
  'electrical connections (suzi), load security, reflectors, mudguards.',
  '',
  '— COMMON TORQUE SETTINGS (approximate — always verify for specific make) —',
  'Wheel nuts 10-stud ISO: 550-650 Nm. U-bolts: 350-500 Nm.',
  'Fifth wheel bolts: 270-340 Nm. Brake chamber bolts: 50-65 Nm.',
  'Always use calibrated torque wrench. Re-torque wheels after 50 miles.',
  '',
  'RESPONSE FORMAT:',
  '- Use short paragraphs and numbered steps',
  '- Bold key terms with **term** for emphasis',
  '- Start safety warnings with ⚠️',
  '- If giving a procedure, number the steps clearly',
  '- Keep answers practical and actionable',
  '- If the user gives vehicle context, reference it specifically',
].join('\n');

async function technicalAssistant(body) {
  if (!client) throw { status: 503, message: 'AI assistant not configured' };
  const { message, history, context } = body || {};
  if (!message) throw { status: 400, message: 'message is required' };

  const messages = [];

  if (history && Array.isArray(history)) {
    for (const h of history.slice(-10)) {
      messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content });
    }
  }

  let userMsg = message;
  if (context) {
    const ctx = [];
    if (context.vehicleReg) ctx.push('Vehicle: ' + context.vehicleReg);
    if (context.inspectionType) ctx.push('Inspection type: ' + context.inspectionType);
    if (context.defects && context.defects.length) {
      ctx.push('Active defects: ' + context.defects.map(d => d.zone + ' — ' + d.description + ' (' + d.severity + ')').join('; '));
    }
    if (ctx.length && messages.length === 0) {
      userMsg = '[Context: ' + ctx.join(', ') + ']\n\n' + message;
    }
  }

  messages.push({ role: 'user', content: userMsg });

  const resp = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: [{ type: 'text', text: ARTHUR_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages,
  });

  return { reply: extractText(resp), model: resp.model, usage: resp.usage };
}

module.exports = { defectSuggestion, repairSuggestion, inspectionSummarySafe, maintenancePrediction, nlSearch, technicalAssistant };
