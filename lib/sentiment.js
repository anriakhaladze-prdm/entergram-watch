// Sentiment, in two passes.
//
// Pass 1 is rules. It runs on every chat we have text for, costs nothing, and
// catches the things that are unambiguous in this business: withdrawal
// complaints, scam accusations, a competitor being named, an explicit goodbye.
// Rules alone are the fallback when no model key is configured.
//
// Pass 2 is a model, and only for chats whose player has said something new
// since we last scored them. Tone, sarcasm and politely-worded churn are the
// cases rules cannot reach.
//
// The provider is chosen by whichever key is present, so moving from OpenAI to
// Anthropic later is an env change and nothing else. Message text is passed to
// the model and then dropped: only the label and a one-line reason are stored,
// so player conversations never land in KV or the snapshot.

export const LABELS = ['positive', 'neutral', 'negative', 'at_risk'];

// --- pass 1, rules --------------------------------------------------------
const RULES = [
  { key: 'withdrawal', weight: 3, re: /\b(withdraw\w*|payout|cash\s?out)\b.{0,40}\b(stuck|pending|delay\w*|late|not (yet )?(received|arrived)|still waiting|never)\b/i },
  { key: 'withdrawal', weight: 3, re: /\b(where('| i)s|wheres)\b.{0,20}\b(my )?(money|funds|withdrawal|payout)\b/i },
  { key: 'scam', weight: 4, re: /\b(scam\w*|rigged|stealing|thieves|fraud\w*|cheat\w*)\b/i },
  { key: 'leaving', weight: 4, re: /\b((i\s?am|i'?m|im)\s+(done|out|leaving)|never (playing|depositing) again|close my account|self.?exclude)\b/i },
  // A rival being named is ambiguous on its own: "moving to stake" and "losing
  // a lot there, I want to come back" are opposite meanings with the same
  // keyword. Weighted so it needs corroboration, and left to the model to read
  // in context.
  { key: 'competitor', weight: 1, re: /\b(stake|roobet|rollbit|shuffle|bc\.?game|winna|gamdom|duelbits)\b/i },
  { key: 'leaving', weight: 2, re: /\b(mov(ing|ed)|switch(ing|ed)|going|went)\s+(over\s+)?to\b/i },
  { key: 'bonus', weight: 2, re: /\b(bonus|lossback|rakeback|reward)\b.{0,30}\b(never|missing|not (credited|received)|where)\b/i },
  { key: 'frustration', weight: 2, re: /\b(unacceptable|ridiculous|terrible|worst|disgust\w*|angry|furious|fed up)\b/i },
  { key: 'ignored', weight: 2, re: /\b(no (one|body) (is )?(replying|responding|answering)|still no (reply|answer|response)|hello\?+)\b/i },
  { key: 'happy', weight: -2, re: /\b(thank you|thanks|appreciate|love (it|this|you guys)|legend|awesome|great service)\b/i },
];

export function ruleScan(texts = []) {
  const flags = new Map();
  let score = 0;
  for (const t of texts) {
    if (!t) continue;
    for (const r of RULES) {
      if (r.re.test(t)) {
        if (!flags.has(r.key)) { flags.set(r.key, r.weight); score += r.weight; }
      }
    }
  }
  const label = score >= 4 ? 'at_risk' : score >= 2 ? 'negative' : score <= -2 ? 'positive' : 'neutral';
  return { label, score, flags: [...flags.keys()], source: 'rules' };
}

// --- pass 2, model --------------------------------------------------------
const SYSTEM = [
  'You score the mood of a VIP casino player in a private Telegram chat with their host.',
  'You are given the player\'s own recent messages only, newest first. Staff messages are excluded, so never score our tone: a host declining a bonus is not the player being unhappy.',
  'Return one of: positive, neutral, negative, at_risk.',
  'at_risk means the player is signalling they may stop playing or has lost trust:',
  'unresolved withdrawal or payout problems, accusations of rigging or scamming,',
  'naming a competitor they are moving to, or an explicit goodbye.',
  'negative is displeasure without that finality. neutral is transactional chat.',
  'positive is warmth or satisfaction.',
  'Reply with JSON only: {"results":[{"id":"<id>","label":"<label>","reason":"<max 12 words>"}]}',
].join(' ');

export function detectProvider(env = process.env) {
  const forced = env.SENTIMENT_PROVIDER;
  if (forced === 'none') return null;
  if (forced === 'anthropic' || (!forced && env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY)) {
    return env.ANTHROPIC_API_KEY ? 'anthropic' : null;
  }
  if (forced === 'openai' || env.OPENAI_API_KEY) return env.OPENAI_API_KEY ? 'openai' : null;
  return env.ANTHROPIC_API_KEY ? 'anthropic' : null;
}

const buildPrompt = (items) => items
  .map((i) => `id: ${i.id}\nmessages:\n${i.texts.slice(0, 12).map((t) => `- ${String(t).slice(0, 280)}`).join('\n')}`)
  .join('\n\n');

async function callOpenAI(items, env) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: buildPrompt(items) }],
    }),
  });
  if (!res.ok) throw new Error(`openai HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  return JSON.parse(body.choices?.[0]?.message?.content || '{"results":[]}');
}

async function callAnthropic(items, env) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest',
      max_tokens: 1024,
      temperature: 0,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(items) }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const text = (body.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(json || '{"results":[]}');
}

// items: [{ id, texts: [] }]. Returns Map id -> { label, reason, source }.
export async function scoreWithModel(items, { env = process.env, batchSize = 8 } = {}) {
  const provider = detectProvider(env);
  const out = new Map();
  if (!provider || !items.length) return out;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    try {
      const parsed = provider === 'openai' ? await callOpenAI(batch, env) : await callAnthropic(batch, env);
      for (const r of parsed.results || []) {
        if (!r?.id || !LABELS.includes(r.label)) continue;
        out.set(String(r.id), { label: r.label, reason: String(r.reason || '').slice(0, 90), source: provider });
      }
    } catch (e) {
      // A model outage must never hold up an alert. The rules verdict stands.
      console.error(`[sentiment] ${provider} batch failed: ${e.message}`);
    }
  }
  return out;
}

// Merge: the model wins when it answered, rules fill the gaps, and the rule
// flags are kept either way because they say WHY in business terms.
export function mergeSentiment(rules, model) {
  if (!model) return rules;
  return { label: model.label, reason: model.reason, flags: rules.flags, ruleScore: rules.score, source: model.source };
}

export const NEGATIVE = new Set(['negative', 'at_risk']);
