// Runs a scan on demand for a signed-in operator. Same work as the cron,
// different door: SSO instead of the bearer token.
import { runScan } from '../../lib/scan.js';
import { finishRun } from '../../lib/runlog.js';
import { requireSession } from '../../lib/auth.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const session = await requireSession(req, res);
  if (!session) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const dryRun = req.query.dry === '1';
  const mode = req.query.mode === 'full' ? 'full' : 'auto';
  const log = [];
  const outcome = await finishRun(() => runScan({ dryRun, mode, log: (m) => log.push(m) }), { dryRun });
  return res.status(outcome.ok ? 200 : 500).json({ ...outcome, by: session.user?.email || null, log });
}
