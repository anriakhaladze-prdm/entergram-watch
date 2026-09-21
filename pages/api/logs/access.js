// The sign-in log: every admitted sign-in and every refused attempt by a
// blocked address. Monitoring whitelist only.
import { requireMonitor } from '../../../lib/auth.js';
import { getSignIns } from '../../../lib/state.js';

export default async function handler(req, res) {
  if (!(await requireMonitor(req, res))) return;
  try {
    res.setHeader('cache-control', 'private, no-store');
    res.status(200).json({ entries: await getSignIns(300) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
