// Slack posting, paced. chat.postMessage allows roughly one message per second
// per channel. Posting faster than that is what took the previous version
// down: the rate limit threw, the run aborted before its state was saved, and
// the next tick posted the same alerts again.
//
// One post at a time, a pause between posts, and a single honoured Retry-After
// on a rate limit. A second rate limit in the same run raises RateLimited so
// the caller stops posting and leaves the rest for the next tick.
const API = 'https://slack.com/api/chat.postMessage';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RateLimited extends Error {
  constructor(retryAfter) { super(`slack: ratelimited (retry after ${retryAfter}s)`); this.name = 'RateLimited'; this.retryAfter = retryAfter; }
}

export function slackConfigured(env = process.env) { return Boolean(env.SLACK_BOT_TOKEN && env.SLACK_CHANNEL_ID); }

export async function postSlack(text, {
  channel = process.env.SLACK_CHANNEL_ID, token = process.env.SLACK_BOT_TOKEN,
  threadTs = null, fetchImpl = globalThis.fetch, maxRetryAfterSec = 20,
} = {}) {
  if (!token || !channel) throw new Error('SLACK_BOT_TOKEN / SLACK_CHANNEL_ID are not set');
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetchImpl(API, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel, text, thread_ts: threadTs || undefined, unfurl_links: false, unfurl_media: false }),
    });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    const limited = res.status === 429 || body?.error === 'ratelimited';
    if (limited) {
      const retryAfter = Number(res.headers?.get?.('retry-after')) || 2;
      if (attempt === 1 && retryAfter <= maxRetryAfterSec) { await sleep(retryAfter * 1000 + 250); continue; }
      throw new RateLimited(retryAfter);
    }
    if (!res.ok || !body?.ok) throw new Error(`slack: ${body?.error || `HTTP ${res.status}`}`);
    return { ok: true, ts: body.ts };
  }
  throw new RateLimited(0);
}

// Posts in order with a pause between messages. Stops at the first failure and
// reports how far it got, so the caller can persist exactly what was sent.
export async function postSequence(texts, { gapMs = 1100, post = postSlack } = {}) {
  const sent = [];
  let error = null;
  for (let i = 0; i < texts.length; i++) {
    try {
      const r = await post(texts[i]);
      sent.push({ index: i, ts: r.ts });
    } catch (e) { error = e; break; }
    if (i < texts.length - 1) await sleep(gapMs);
  }
  return { sent, error };
}
