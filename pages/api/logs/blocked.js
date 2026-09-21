// The dashboard-managed block-list. Monitoring whitelist only. Blocking an
// address also ends every session it holds; nobody on the whitelist can be
// blocked from here.
import { requireMonitor } from '../../../lib/auth.js';
import { listBlocked, blockEmail, unblockEmail, revokeSessionsOf } from '../../../lib/state.js';
import { forget, GATE_CACHE_MS } from '../../../lib/gate.js';
import { isMonitor, norm, BLOCKED_EMAILS, ALLOWED_DOMAIN } from '../../../lib/access.js';

export default async function handler(req, res) {
  const session = await requireMonitor(req, res);
  if (!session) return;
  try {
    res.setHeader('cache-control', 'private, no-store');
    if (req.method === 'POST' || req.method === 'DELETE') {
      const email = norm(req.body?.email);
      if (!email || !email.includes('@')) return res.status(400).json({ error: 'email required' });
      if (req.method === 'POST') {
        if (isMonitor(email)) return res.status(400).json({ error: 'monitoring accounts cannot be blocked' });
        await blockEmail(email, session.user.email);
        const ended = await revokeSessionsOf(email, session.user.email);
        forget(null, email);
        return res.status(200).json({ ok: true, email, sessionsEnded: ended, effectiveWithinMs: GATE_CACHE_MS });
      }
      await unblockEmail(email);
      forget(null, email);
      return res.status(200).json({ ok: true, email });
    }
    const managed = await listBlocked();
    res.status(200).json({ entries: managed, configured: BLOCKED_EMAILS, domain: ALLOWED_DOMAIN });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
