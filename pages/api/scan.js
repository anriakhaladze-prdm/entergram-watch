// Runs a scan on demand, for a signed-in operator.
//
// The cron route authenticates with CRON_SECRET, which a browser cannot send,
// so without this there is no way to start a scan from the dashboard. Same
// work, different door: SSO instead of the bearer token.
import { runScan } from '../../lib/scan.js';
import { requireSession } from '../../lib/auth.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const session = await requireSession(req, res);
  if (!session) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const dryRun = req.query.dry === '1';
  const log = [];
  try {
    const result = await runScan({ dryRun, log: (m) => log.push(m) });
    return res.status(200).json({
      ok: true, dryRun, by: session.user?.email || null,
      total: result.total, hosted: result.hosted, counts: result.counts,
      read: result.read, denied: result.denied, posted: result.posted,
      seeded: result.seeded, ms: result.ms, log,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, log });
  }
}
