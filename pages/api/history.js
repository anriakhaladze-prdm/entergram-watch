// Daily trend points, the run log and the alert log. Everything the Activity
// page and the overview's trend need, in one call.
import { getDaily, getRuns, getAlertLog, getFailures, getMeta } from '../../lib/state.js';
import { requireSession } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (!(await requireSession(req, res))) return;
  try {
    const [daily, runs, alerts, failures, meta] = await Promise.all([getDaily(), getRuns(60), getAlertLog(200), getFailures(), getMeta()]);
    res.setHeader('cache-control', 'private, no-store');
    res.status(200).json({ daily, runs, alerts, failures, meta });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
