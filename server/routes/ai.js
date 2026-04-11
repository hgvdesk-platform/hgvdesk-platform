/**
 * HGVDESK — AI ROUTES
 * Anthropic-powered helpers for the inspect/workshop UIs.
 */
const Anthropic = require('@anthropic-ai/sdk');

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

const SYSTEM_PROMPT = [
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
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      { role: 'user', content: buildUserPrompt({ zone, severity, vehicleType, vehicleReg }) },
    ],
  });

  const text = (message.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();

  return {
    suggestion: text,
    model: message.model,
    usage: message.usage,
  };
}

module.exports = { defectSuggestion };
