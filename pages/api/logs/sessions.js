// Open sessions and revocation. Monitoring whitelist only: seeing everyone's
// addresses and ending their sessions is an admin capability.
import { requireMonitor } from '../../../lib/auth.js';
import { listSessions, revokeSession } from '../../../lib/state.js';
import { forget, GATE_CACHE_MS } from '../../../lib/gate.js';

export default async function handler(req, res) {
  const session = await requireMonitor(req, res);
  if (!session) return;
  try {
    res.setHeader('cache-control', 'private, no-store');
    if (req.method === 'POST') {
      const sid = String(req.body?.sid || '').trim();
      if (!sid) return res.status(400).json({ error: 'sid required' });
      await revokeSession(sid, session.user.email);
      forget(sid);
      return res.status(200).json({ ok: true, sid, self: sid === session.sid, effectiveWithinMs: GATE_CACHE_MS });
    }
    const rows = await listSessions();
    res.status(200).json({ sessions: rows.map((r) => ({ ...r, current: r.sid === session.sid })), revokeLagMs: GATE_CACHE_MS });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
