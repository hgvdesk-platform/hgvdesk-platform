/**
 * HGVDESK — AI ROUTES
 * Anthropic-powered helpers for the inspect/workshop UIs.
 */
const Anthropic = require('@anthropic-ai/sdk');

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

const DEFECT_SYSTEM_PROMPT = [
  'You are an expert UK HGV (Heavy Goods Vehicle) inspector writing defect descriptions',
  'for a DVSA-style vehicle inspection report. Your job is to take a zone, severity,',
  'and vehicle context and produce ONE concise, professional defect description in the',
  'style used on PMI / safety inspection sheets.',
  '',
  'Rules:',
  '- One sentence, 10-25 words. No preamble, no "here is", no quotes.',
  '- Use UK English and standard HGV inspection terminology (e.g. "play in", "excessive wear",',
  '  "perished", "seized", "insecure", "fluid leak", "corrosion", "misaligned").',
  '- Match severity: "advisory" = monitor / wear approaching limit; "critical" = unroadworthy / immediate action.',
  '- Reference the specific zone the inspector marked.',
  '- Do not invent measurements (mm, psi, etc.) — describe the condition, not numbers.',
  '- Output the description only. No labels, no markdown, no bullet points.',
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

function buildUserPrompt({ zone, severity, vehicleType, vehicleReg }) {
  const lines = [
    `Zone: ${zone || 'unspecified'}`,
    `Severity: ${severity || 'advisory'}`,
  ];
  if (vehicleType) lines.push(`Vehicle type: ${vehicleType}`);
  if (vehicleReg) lines.push(`Vehicle reg: ${vehicleReg}`);
  lines.push('', 'Write the defect description.');
  return lines.join('\n');
}

async function defectSuggestion(body) {
  if (!client) {
    throw { status: 503, message: 'AI assistant not configured (ANTHROPIC_API_KEY missing)' };
  }
  const { zone, severity, vehicleType, vehicleReg } = body || {};
  if (!zone) throw { status: 400, message: 'zone is required' };

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 256,
    system: [
      { type: 'text', text: DEFECT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      { role: 'user', content: buildUserPrompt({ zone, severity, vehicleType, vehicleReg }) },
    ],
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

function validateAndBuildQuery(parsed, orgId) {
  if (!parsed || typeof parsed !== 'object') throw { status: 502, message: 'AI returned invalid shape' };
  const entity = parsed.entity;
  const def = SEARCH_SCHEMA[entity];
  if (!def) throw { status: 400, message: `Unknown entity: ${entity}` };

  const filters = (parsed.filters && typeof parsed.filters === 'object') ? parsed.filters : {};
  const where = ['org_id = $1'];
  const params = [orgId];

  for (const [key, value] of Object.entries(filters)) {
    const cfg = def.filters[key];
    if (!cfg) continue; // silently drop unknown keys — never reach the DB
    if (value == null || value === '') continue;

    const column = cfg.column || key;
    if (cfg.type === 'enum' && !cfg.values.includes(String(value).toLowerCase())) continue;
    if (cfg.type === 'bool') {
      const b = (value === true || value === 'true' || value === 1);
      params.push(b);
      where.push(`${column} = $${params.length}`);
      continue;
    }
    if (cfg.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
      params.push(value);
      where.push(`${column} ${cfg.op} $${params.length}`);
      continue;
    }
    // string-based
    if (cfg.match === 'exact-upper') {
      params.push(String(value).toUpperCase().trim());
      where.push(`UPPER(REPLACE(${column}, ' ', '')) = REPLACE($${params.length}, ' ', '')`);
    } else if (cfg.match === 'ilike' || cfg.op === 'ilike-wrap') {
      params.push('%' + String(value).trim() + '%');
      where.push(`${column} ILIKE $${params.length}`);
    } else {
      params.push(String(value).trim());
      where.push(`${column} = $${params.length}`);
    }
  }

  const cols = def.columns.join(', ');
  const sql = `SELECT ${cols} FROM ${entity} WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 50`;
  return { sql, params, entity, columns: def.columns };
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

module.exports = { defectSuggestion, inspectionSummarySafe, maintenancePrediction, nlSearch };
