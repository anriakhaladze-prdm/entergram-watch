// Everything in the workspace that did not make the book, with the reason the
// last full sweep gave. Monitoring whitelist only: it names chats.
import { requireMonitor } from '../../../lib/auth.js';
import { getExcluded } from '../../../lib/state.js';

export default async function handler(req, res) {
  if (!(await requireMonitor(req, res))) return;
  try {
    res.setHeader('cache-control', 'private, no-store');
    res.status(200).json({ entries: await getExcluded() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
