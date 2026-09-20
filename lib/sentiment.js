// Sentiment, read from the end of the conversation.
//
// What matters is how the player felt when they last spoke. So the window is
// the exchange around the player's last message: everything in the hour before
// it, and never fewer than the player's last three messages. Older history is
// ignored; a thank-you from last week says nothing about a complaint today.
//
// Two passes. Rules run on every chat with fresh text, recency weighted so the
// newest message dominates, and a negative in the last message can never be
// cancelled by an earlier positive. A model then reads the exchange in order,
// with the host's lines marked as context only, and judges the player's mood
// at the end of it. Message text is passed to the model and dropped: only the
// label, a one-line reason and the line the verdict rests on are stored.
//
// The provider is whichever key is present, so switching from OpenAI to
// Anthropic is an env change and nothing else.

export const LABELS = ['positive', 'neutral', 'negative', 'at_risk'];
export const NEGATIVE = new Set(['negative', 'at_risk']);

const ms = (d) => (d ? new Date(d).getTime() : 0);

/* --- the window ------------------------------------------------------------ */
export function selectWindow(messages, {
  minutes = Number(process.env.SENTIMENT_WINDOW_MINUTES || 60),
  minPlayer = Number(process.env.SENTIMENT_MIN_MESSAGES || 3),
  maxTotal = 16,
} = {}) {
  // messages: normalized, any order, with side 'player' | 'staff' already set.
  const chrono = [...messages].filter((m) => !m.actionType && m.text).sort((a, b) => ms(a.date) - ms(b.date));
  const lastPlayerIdx = chrono.map((m) => m.side).lastIndexOf('player');
  if (lastPlayerIdx < 0) return [];
  const end = ms(chrono[lastPlayerIdx].date);
  const from = end - minutes * 60000;
  let start = lastPlayerIdx;
  let players = 0;
  for (let i = lastPlayerIdx; i >= 0; i--) {
    const inHour = ms(chrono[i].date) >= from;
    if (!inHour && players >= minPlayer) break;
    start = i;
    if (chrono[i].side === 'player') players++;
  }
  // Anything the host said after the player's last message is not evidence of
  // the player's mood, so the window ends at that message.
  return chrono.slice(Math.max(start, lastPlayerIdx + 1 - maxTotal), lastPlayerIdx + 1).slice(-maxTotal);
}

/* --- pass 1, rules ----------------------------------------------------------- */
const RULES = [
  { key: 'withdrawal', weight: 3, re: /\b(withdraw\w*|payout|cash\s?out)\b.{0,40}\b(stuck|pending|delay\w*|late|not (yet )?(received|arrived)|still waiting|never)\b/i },
  { key: 'withdrawal', weight: 3, re: /\b(where('| i)s|wheres)\b.{0,20}\b(my )?(money|funds|withdrawal|payout)\b/i },
  { key: 'scam', weight: 4, re: /\b(scam\w*|rigged|stealing|steal|thieves|thief|robbed|robbing|fraud\w*|cheat\w*)\b/i },
  { key: 'money_taken', weight: 3, re: /\b(tak(e|es|ing|en)|took)\b.{0,12}\b(all )?(my|our) (money|cash|funds|balance)\b/i },
  { key: 'money_taken', weight: 3, re: /\b(lost|losing|lose)\b.{0,12}\b(everything|it all|all my (money|cash))\b/i },
  { key: 'losing', weight: 2, re: /\b(never win|keep losing|always lose|cant win|can't win|impossible to win)\b/i },
  { key: 'leaving', weight: 4, re: /\b((i\s?am|i'?m|im)\s+(done|out|leaving|quitting)|never (playing|depositing) again|close my account|delete my account|self.?exclude|i quit|good\s?bye)\b/i },
  { key: 'leaving', weight: 3, re: /\b(stop (messaging|texting|contacting) me|leave me alone|remove me|unsubscribe)\b/i },
  { key: 'competitor', weight: 1, re: /\b(stake|roobet|rollbit|shuffle|bc\.?game|winna|gamdom|duelbits)\b/i },
  { key: 'leaving', weight: 2, re: /\b(mov(ing|ed)|switch(ing|ed)|going|went)\s+(over\s+)?to\b/i },
  { key: 'bonus', weight: 2, re: /\b(bonus|lossback|rakeback|reward|reload)\b.{0,30}\b(never|missing|not (credited|received)|where|nothing)\b/i },
  { key: 'frustration', weight: 2, re: /\b(unacceptable|ridiculous|terrible|worst|disgust\w*|angry|furious|fed up|pissed|joke|bullshit|bs)\b/i },
  { key: 'ignored', weight: 2, re: /\b(no (one|body) (is )?(replying|responding|answering)|still no (reply|answer|response)|hello\?+|anyone (here|there)\?)\b/i },
  { key: 'happy', weight: -2, re: /\b(thank you|thanks|thx|appreciate|love (it|this|you guys)|legend|awesome|great service|you('re| are) the best)\b/i },
];
const DECAY = [1, 0.8, 0.65, 0.5, 0.4, 0.3, 0.25, 0.2];

// texts: the player's messages in the window, newest first.
export function ruleScan(texts = []) {
  const flags = new Set();
  let neg = 0, pos = 0, lastNegative = false;
  texts.forEach((t, i) => {
    if (!t) return;
    const w = DECAY[Math.min(i, DECAY.length - 1)];
    for (const r of RULES) {
      if (!r.re.test(t)) continue;
      flags.add(r.key);
      if (r.weight < 0) pos += -r.weight * w;
      else { neg += r.weight * w; if (i === 0) lastNegative = true; }
    }
  });
  // A complaint in the newest message stands whatever came before it.
  const score = lastNegative ? neg : neg - pos;
  const label = score >= 4 ? 'at_risk' : score >= 2 ? 'negative' : (score <= -2 && neg === 0) ? 'positive' : 'neutral';
  return { label, score: Math.round(score * 10) / 10, flags: [...flags], source: 'rules' };
}

/* --- pass 2, model ----------------------------------------------------------- */
const SYSTEM = [
  'You judge the mood of a VIP casino player at the END of a short exchange with their host, in a private Telegram group.',
  'Each exchange is given in order, oldest first. Lines marked host are context only: never score our tone, a host declining a bonus is not the player being unhappy.',
  'Weigh the player\'s most recent lines most heavily. Sarcasm counts as what it means: "thanks for taking all my money" is negative.',
  'Return one of: positive, neutral, negative, at_risk.',
  'at_risk: the player signals they may stop playing or has lost trust: unresolved withdrawal or payout problems, accusations of rigging, scamming or theft, saying we take their money, naming a competitor they are moving to, an explicit goodbye, asking to be left alone, or leaving the group.',
  'negative: displeasure or frustration without that finality. neutral: transactional or casual chat. positive: warmth or satisfaction.',
  'Reply with JSON only: {"results":[{"id":"<id>","label":"<label>","reason":"<max 12 words>","evidence":"<the player line the verdict rests on, verbatim, max 120 chars>"}]}',
].join(' ');

export function detectProvider(env = process.env) {
  const forced = env.SENTIMENT_PROVIDER;
  if (forced === 'none') return null;
  if (forced === 'anthropic' || (!forced && env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY)) return env.ANTHROPIC_API_KEY ? 'anthropic' : null;
  if (forced === 'openai' || env.OPENAI_API_KEY) return env.OPENAI_API_KEY ? 'openai' : null;
  return env.ANTHROPIC_API_KEY ? 'anthropic' : null;
}

// items: [{ id, window: [{ side, text }] }] oldest first.
const buildPrompt = (items) => items
  .map((i) => `id: ${i.id}\n${i.window.map((m) => `${m.side === 'staff' ? 'host' : 'player'}: ${String(m.text).replace(/\s+/g, ' ').slice(0, 280)}`).join('\n')}`)
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
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest',
      max_tokens: 1500,
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

// Returns Map id -> { label, reason, evidence, source }.
export async function scoreWithModel(items, { env = process.env, batchSize = 6 } = {}) {
  const provider = detectProvider(env);
  const out = new Map();
  if (!provider || !items.length) return out;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    try {
      const parsed = provider === 'openai' ? await callOpenAI(batch, env) : await callAnthropic(batch, env);
      for (const r of parsed.results || []) {
        if (!r?.id || !LABELS.includes(r.label)) continue;
        out.set(String(r.id), { label: r.label, reason: String(r.reason || '').slice(0, 90), evidence: String(r.evidence || '').slice(0, 140), source: provider });
      }
    } catch (e) {
      // A model outage must never hold up a scan. The rules verdict stands.
      console.error(`[sentiment] ${provider} batch failed: ${e.message}`);
    }
  }
  return out;
}

// The model wins when it answered; the rule flags are kept because they say
// why in business terms.
export function mergeSentiment(rules, model) {
  if (!model) return rules;
  return { label: model.label, reason: model.reason, evidence: model.evidence || null, flags: rules.flags, ruleScore: rules.score, source: model.source };
}
