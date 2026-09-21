// The per-request half of access control: is this session revoked, is this
// address blocked. Both answers come from the store through a short
// in-instance cache, so a revoke or a block lands within GATE_CACHE_MS on every
// instance without a store round trip on each request. A store failure fails
// open: a token still expires on its own within eight hours, and locking the
// whole team out over a KV blip would be the worse outcome.
import { isSessionRevoked, isEmailBlocked, touchSession, kvConfigured } from './state.js';
import { isStaticallyBlocked } from './access.js';

export const GATE_CACHE_MS = Number(process.env.GATE_CACHE_MS || 30000);
const TOUCH_MS = Number(process.env.SESSION_TOUCH_MS || 5 * 60000);

const revoked = new Map();   // sid -> { v, at }
const blocked = new Map();   // email -> { v, at }
const touched = new Map();   // sid -> at

async function cached(map, key, fetcher) {
  const hit = map.get(key), now = Date.now();
  if (hit && now - hit.at < GATE_CACHE_MS) return hit.v;
  let v = false;
  try { v = await fetcher(); } catch { v = false; }
  map.set(key, { v, at: now });
  return v;
}

export const sessionRevoked = (sid) => (sid && kvConfigured() ? cached(revoked, sid, () => isSessionRevoked(sid)) : Promise.resolve(false));
export async function emailBlocked(email) {
  if (!email) return false;
  if (isStaticallyBlocked(email)) return true;
  if (!kvConfigured()) return false;
  return cached(blocked, String(email).toLowerCase(), () => isEmailBlocked(email));
}
export function forget(sid, email) {
  if (sid) { revoked.delete(sid); touched.delete(sid); }
  if (email) blocked.delete(String(email).toLowerCase());
}
// Throttled, never allowed to throw: lastSeen is cosmetic.
export function noteActivity(sid) {
  if (!sid || !kvConfigured()) return;
  const now = Date.now();
  if (now - (touched.get(sid) || 0) < TOUCH_MS) return;
  touched.set(sid, now);
  touchSession(sid, now).catch(() => {});
}
export const __reset = () => { revoked.clear(); blocked.clear(); touched.clear(); };
