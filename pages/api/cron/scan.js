// Vercel cron entry point. Refuses to run unauthenticated: this endpoint reads
// player conversations and posts to Slack, so an open route is worse than a
// broken cron.
import { runScan } from '../../../lib/scan.js';
import { finishRun } from '../../../lib/runlog.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (!secret || auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });

  const dryRun = req.query.dry === '1';
  const mode = req.query.mode === 'full' ? 'full' : 'auto';
  const lines = [];
  const outcome = await finishRun(() => runScan({ dryRun, mode, log: (m) => lines.push(m) }), { dryRun });
  const status = outcome.ok ? 200 : 500;
  return res.status(status).json({ ...outcome, rows: undefined, log: lines });
}
