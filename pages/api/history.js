// Daily counts for the overview's trend. Written once per day by the scan,
// which is the grain a trend is read at; the per-run log is kept separately
// for debugging a specific tick.
import { getDaily, getRuns } from '../../lib/state.js';
import { requireSession } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (!(await requireSession(req, res))) return;
  try {
    const [daily, runs] = await Promise.all([getDaily(), getRuns(20)]);
    res.setHeader('cache-control', 'private, no-store');
    res.status(200).json({ daily, runs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
