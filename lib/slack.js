// Slack posting. Severity is carried by the emoji on line one, no attachment
// colour bars: an attachment indents the whole message and renders badly on
// mobile, which is where these get read.
const API = 'https://slack.com/api/chat.postMessage';

export async function postSlack(text, { channel = process.env.SLACK_CHANNEL_ID, token = process.env.SLACK_BOT_TOKEN, threadTs = null } = {}) {
  if (!token || !channel) throw new Error('SLACK_BOT_TOKEN / SLACK_CHANNEL_ID are not set');
  const res = await fetch(API, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel, text, thread_ts: threadTs || undefined, unfurl_links: false, unfurl_media: false }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`slack: ${body.error}`);
  return { ok: true, ts: body.ts };
}
