// Upstash KV over REST. Everything the scan remembers between ticks lives here:
// the book (every player chat's list-level metadata), one record of facts per
// chat, the alert records that make an alert fire once per episode, the
// snapshot the dashboard reads, the run log, the daily trend points, the alert
// log, the consecutive-failure counter and the scan lock.
//
// Keys are prefixed ew2. The ew: keys of the previous version are left alone
// and expire on their own.
const URL_ = () => process.env.KV_REST_API_URL;
const TOKEN = () => process.env.KV_REST_API_TOKEN;
export const kvConfigured = () => Boolean(URL_() && TOKEN());

async function pipeline(cmds) {
  if (!cmds.length) return [];
  if (!kvConfigured()) throw new Error('KV_REST_API_URL / KV_REST_API_TOKEN are not set');
  const res = await fetch(`${URL_()}/pipeline`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN()}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!res.ok) throw new Error(`KV pipeline failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const out = await res.json();
  return out.map((r, i) => {
    if (r && r.error) throw new Error(`KV ${cmds[i][0]} ${String(cmds[i][1] || '').slice(0, 40)}: ${r.error}`);
    return r?.result ?? null;
  });
}
const one = async (cmd) => (await pipeline([cmd]))[0];
const parse = (v) => { try { return v == null ? null : (typeof v === 'string' ? JSON.parse(v) : v); } catch { return null; } };

const K = {
  meta: 'ew2:meta',
  lock: 'ew2:lock',
  chat: (id) => `ew2:chat:${id}`,
  book: 'ew2:book',
  snap: 'ew2:snap',
  runs: 'ew2:runs',
  daily: 'ew2:daily',
  alerts: 'ew2:alerts',
  failures: 'ew2:failures',
  outage: 'ew2:outage',
  tally: 'ew2:tally',
};

/* ---- chunked values -------------------------------------------------------
   The book and the snapshot are one logical value each but well over what a
   single request should carry, so they are stored as a header plus N chunks
   and read back in one pipeline. */
async function putChunked(key, items, { chunk = 300, ttlSec = 7 * 86400, header = {} } = {}) {
  const n = Math.max(1, Math.ceil(items.length / chunk));
  const cmds = [['SET', `${key}:h`, JSON.stringify({ ...header, n, count: items.length }), 'EX', String(ttlSec)]];
  for (let i = 0; i < n; i++) cmds.push(['SET', `${key}:${i}`, JSON.stringify(items.slice(i * chunk, (i + 1) * chunk)), 'EX', String(ttlSec)]);
  await pipeline(cmds);
}
async function getChunked(key) {
  const h = parse(await one(['GET', `${key}:h`]));
  if (!h) return null;
  const parts = await pipeline(Array.from({ length: h.n }, (_, i) => ['GET', `${key}:${i}`]));
  const items = [];
  for (const p of parts) { const arr = parse(p); if (Array.isArray(arr)) items.push(...arr); }
  return { header: h, items };
}

/* ---- scan meta and lock -------------------------------------------------- */
export const getMeta = async () => parse(await one(['GET', K.meta])) || {};
export const putMeta = (m) => one(['SET', K.meta, JSON.stringify(m)]);

export async function acquireLock(runId, ttlSec = 280) {
  const r = await one(['SET', K.lock, runId, 'NX', 'EX', String(ttlSec)]);
  return r === 'OK';
}
export const releaseLock = () => one(['DEL', K.lock]);

/* ---- the book: list-level metadata for every player chat ------------------ */
export async function getBook() {
  const r = await getChunked(K.book);
  if (!r) return null;
  return { builtAt: r.header.builtAt, chats: r.items };
}
export const putBook = (chats, builtAt) => putChunked(K.book, chats, { chunk: 400, ttlSec: 30 * 86400, header: { builtAt } });

/* ---- per-chat state: facts, sentiment, alert records ---------------------- */
export async function getChatStates(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const res = await one(['MGET', ...slice.map((id) => K.chat(id))]);
    slice.forEach((id, j) => out.set(String(id), parse(res?.[j])));
  }
  return out;
}
export async function putChatStates(entries, { ttlDays = 400 } = {}) {
  const cmds = entries.map(([id, val]) => ['SET', K.chat(id), JSON.stringify(val), 'EX', String(ttlDays * 86400)]);
  for (let i = 0; i < cmds.length; i += 150) await pipeline(cmds.slice(i, i + 150));
}
export const putChatState = (id, val) => putChatStates([[id, val]]);

/* ---- snapshot ------------------------------------------------------------- */
export const putSnapshot = ({ rows, ...header }) => putChunked(K.snap, rows, { chunk: 250, ttlSec: 7 * 86400, header });
export async function getSnapshot() {
  const r = await getChunked(K.snap);
  if (!r) return null;
  const { n, count, ...header } = r.header;
  return { ...header, rows: r.items };
}

/* ---- logs ------------------------------------------------------------------ */
export const putRun = (entry) => pipeline([['LPUSH', K.runs, JSON.stringify(entry)], ['LTRIM', K.runs, '0', '299']]);
export async function getRuns(limit = 50) {
  const res = await one(['LRANGE', K.runs, '0', String(limit - 1)]);
  return (res || []).map(parse).filter(Boolean);
}

export const pushAlerts = (entries) => (entries.length
  ? pipeline([...entries.map((e) => ['LPUSH', K.alerts, JSON.stringify(e)]), ['LTRIM', K.alerts, '0', '499']])
  : Promise.resolve());
export async function getAlertLog(limit = 100) {
  const res = await one(['LRANGE', K.alerts, '0', String(limit - 1)]);
  return (res || []).map(parse).filter(Boolean);
}

// One point per day, kept for a year: the grain a trend is read at.
export async function putDaily(point) {
  const day = (point.at || new Date().toISOString()).slice(0, 10);
  await one(['HSET', K.daily, day, JSON.stringify({ ...point, day })]);
}
export async function getDaily() {
  const res = await one(['HGETALL', K.daily]);
  if (!res) return [];
  const out = [];
  if (Array.isArray(res)) { for (let i = 0; i < res.length; i += 2) { const v = parse(res[i + 1]); if (v) out.push(v); } }
  else if (typeof res === 'object') { for (const v of Object.values(res)) { const p = parse(v); if (p) out.push(p); } }
  return out.sort((a, b) => String(a.day).localeCompare(String(b.day)));
}

/* ---- failures ---------------------------------------------------------------
   Counted here rather than in function memory, which resets on every cold
   start and made the outage alert unreachable. */
export const incrFailures = async () => Number(await one(['INCR', K.failures]));
export const resetFailures = () => pipeline([['DEL', K.failures], ['DEL', K.outage]]);
export const getFailures = async () => Number((await one(['GET', K.failures])) || 0);
export const markOutagePosted = () => one(['SET', K.outage, new Date().toISOString(), 'EX', String(2 * 86400)]);
export const outagePosted = async () => Boolean(await one(['GET', K.outage]));

/* ---- learned staff tally ---------------------------------------------------- */
export const getTally = async () => parse(await one(['GET', K.tally])) || {};
export const putTally = (t) => one(['SET', K.tally, JSON.stringify(t)]);
