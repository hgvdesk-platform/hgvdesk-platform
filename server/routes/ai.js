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

module.exports = { defectSuggestion, inspectionSummarySafe };
