// Vercel cron entry point. Refuses to run unauthenticated: this endpoint reads
// player conversations and posts to Slack, so an open route is worse than a
// broken cron.
import { runScan } from '../../../lib/scan.js';
import { kvConfigured, putRunLog } from '../../../lib/state.js';
import { postSlack } from '../../../lib/slack.js';
import { formatOutage } from '../../../lib/format.js';

export const config = { maxDuration: 300 };

let consecutiveFailures = 0;
let lastGood = null;

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (!secret || auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });

  const dryRun = req.query.dry === '1';
  const lines = [];
  try {
    const result = await runScan({ dryRun, log: (m) => lines.push(m) });
    consecutiveFailures = 0;
    lastGood = new Date().toISOString();
    return res.status(200).json({ ok: true, dryRun, ...result, rows: undefined, log: lines });
  } catch (e) {
    consecutiveFailures++;
    // A failed scan is not an empty queue. Zero rows from a broken API looks
    // exactly like nobody having gone quiet, so failures are announced.
    const threshold = Number(process.env.OUTAGE_ALERT_AFTER_FAILURES || 5);
    if (consecutiveFailures === threshold) {
      try { await postSlack(formatOutage(consecutiveFailures, lastGood)); } catch { /* nothing left to do */ }
    }
    if (kvConfigured()) {
      try { await putRunLog({ at: new Date().toISOString(), error: e.message, consecutiveFailures }); } catch { /* best effort */ }
    }
    return res.status(500).json({ ok: false, error: e.message, consecutiveFailures, log: lines });
  }
}
