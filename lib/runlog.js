// Wraps a scan so that failure is visible. A failed scan is not an empty
// queue: zero rows from a broken API looks exactly like nobody having gone
// quiet, so consecutive failures are counted in KV (function memory resets on
// every cold start) and announced once they pass the threshold, and recovery
// is announced once.
import * as kv from './state.js';
import { postSlack, slackConfigured } from './slack.js';
import { formatOutage, formatRecovered } from './alerts.js';

export async function finishRun(run, { dryRun = false, threshold = Number(process.env.OUTAGE_ALERT_AFTER_FAILURES || 3) } = {}) {
  const at = new Date().toISOString();
  try {
    const result = await run();
    if (result?.skipped) return { ok: true, skipped: result.skipped, at, ms: result.ms };
    if (kv.kvConfigured() && !dryRun) {
      const failures = await kv.getFailures();
      if (failures > 0) {
        const hadOutage = await kv.outagePosted();
        await kv.resetFailures();
        if (hadOutage && slackConfigured()) { try { await postSlack(formatRecovered(failures)); } catch { /* best effort */ } }
      }
    }
    const { rows, ...rest } = result;
    return { ok: true, at, ...rest, rowCount: rows?.length ?? null };
  } catch (e) {
    const error = String(e?.message || e).slice(0, 300);
    let consecutive = null;
    if (kv.kvConfigured() && !dryRun) {
      try {
        consecutive = await kv.incrFailures();
        await kv.putRun({ at, ok: false, error, consecutiveFailures: consecutive });
        if (consecutive >= threshold && !(await kv.outagePosted()) && slackConfigured()) {
          const meta = await kv.getMeta();
          try { await postSlack(formatOutage(consecutive, meta.lastGoodAt, error)); await kv.markOutagePosted(); } catch { /* nothing left to do */ }
        }
      } catch { /* KV itself may be what is down */ }
    }
    return { ok: false, at, error, consecutiveFailures: consecutive };
  }
}
