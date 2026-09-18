// Unauthenticated liveness only. Anything that describes the workspace or its
// players needs a session, because this URL is guessable.
import { kvConfigured, getSnapshot } from '../../lib/state.js';
import { requireSession } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.query.deep !== '1') return res.status(200).json({ ok: true });
  if (!(await requireSession(req, res))) return;
  const env = {
    entergramKey: Boolean(process.env.ENTERGRAM_API_KEY),
    slack: Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID),
    cronSecret: Boolean(process.env.CRON_SECRET),
    kv: kvConfigured(),
    sso: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.NEXTAUTH_SECRET),
  };
  let snapshot = null;
  try {
    const s = await getSnapshot();
    snapshot = s ? { generatedAt: s.generatedAt, counts: s.counts, rows: s.rows?.length } : null;
  } catch { /* kv down */ }
  res.status(200).json({ ok: Object.values(env).every(Boolean), env, snapshot });
}
