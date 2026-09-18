// Feeds the dashboard. Reads the stored snapshot rather than Entergram, so
// opening the page costs nothing and cannot rate-limit the scan.
//
// This is the only route that serves player data, so it is behind SSO. The
// page itself carries no data, the guard that matters is here.
import { getSnapshot } from '../../lib/state.js';
import { requireSession } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (!(await requireSession(req, res))) return;
  try {
    const snap = await getSnapshot();
    if (!snap) return res.status(503).json({ error: 'no snapshot yet, the first scan has not completed' });
    res.setHeader('cache-control', 'private, no-store');
    res.status(200).json(snap);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
