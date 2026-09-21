// The dashboard-managed allow-list: who may sign in. Monitoring whitelist
// only. Several addresses can be added in one go; removing one also ends any
// session it holds. Whitelisted accounts are always in and cannot be removed.
import { requireMonitor } from '../../../lib/auth.js';
import { listAllowed, allowEmail, disallowEmail, revokeSessionsOf } from '../../../lib/state.js';
import { forget, GATE_CACHE_MS } from '../../../lib/gate.js';
import { isMonitor, norm, parseEmails, ALLOWED_EMAILS, MONITORING_EMAILS, ALLOWED_DOMAIN } from '../../../lib/access.js';

export default async function handler(req, res) {
  const session = await requireMonitor(req, res);
  if (!session) return;
  try {
    res.setHeader('cache-control', 'private, no-store');
    if (req.method === 'POST') {
      const emails = parseEmails(req.body?.emails ?? req.body?.email ?? '');
      if (!emails.length) return res.status(400).json({ error: 'no valid email' });
      for (const e of emails) { if (!isMonitor(e) && !ALLOWED_EMAILS.includes(e)) await allowEmail(e, session.user.email); forget(null, e); }
      return res.status(200).json({ ok: true, added: emails, effectiveWithinMs: GATE_CACHE_MS });
    }
    if (req.method === 'DELETE') {
      const email = norm(req.body?.email);
      if (!email) return res.status(400).json({ error: 'email required' });
      if (isMonitor(email)) return res.status(400).json({ error: 'monitoring accounts cannot be removed' });
      await disallowEmail(email);
      const ended = await revokeSessionsOf(email, session.user.email);
      forget(null, email);
      return res.status(200).json({ ok: true, email, sessionsEnded: ended, effectiveWithinMs: GATE_CACHE_MS });
    }
    res.status(200).json({ entries: await listAllowed(), monitors: MONITORING_EMAILS, configured: ALLOWED_EMAILS.filter((e) => !MONITORING_EMAILS.includes(e)), domain: ALLOWED_DOMAIN });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
