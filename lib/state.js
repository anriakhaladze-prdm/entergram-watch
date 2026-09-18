// Upstash KV over REST. Holds three things: the per-chat record that makes
// alerts fire once rather than every tick, the seeded flag that stops the
// first run dumping the whole backlog into Slack, and the snapshot the
// dashboard reads so the page never hits the Entergram API itself.
const URL_ = () => process.env.KV_REST_API_URL;
const TOKEN = () => process.env.KV_REST_API_TOKEN;
export const kvConfigured = () => Boolean(URL_() && TOKEN());

async function cmd(parts) {
  if (!kvConfigured()) throw new Error('KV_REST_API_URL / KV_REST_API_TOKEN are not set');
  const res = await fetch(`${URL_()}/${parts.map(encodeURIComponent).join('/')}`, {
    headers: { authorization: `Bearer ${TOKEN()}` },
  });
  if (!res.ok) throw new Error(`KV ${parts[0]} failed: HTTP ${res.status}`);
  return (await res.json())?.result ?? null;
}

async function pipeline(cmds) {
  if (!cmds.length) return [];
  const res = await fetch(`${URL_()}/pipeline`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN()}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!res.ok) throw new Error(`KV pipeline failed: HTTP ${res.status}`);
  return (await res.json()).map((r) => r?.result ?? null);
}

const CHAT = (id) => `ew:chat:${id}`;
const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };

export async function getChatStates(ids) {
  if (!ids.length) return new Map();
  const out = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const res = await pipeline(slice.map((id) => ['GET', CHAT(id)]));
    slice.forEach((id, j) => out.set(id, parse(res[j])));
  }
  return out;
}

export async function putChatStates(entries, { ttlDays = 400 } = {}) {
  const cmds = entries.map(([id, val]) => ['SET', CHAT(id), JSON.stringify(val), 'EX', String(ttlDays * 86400)]);
  for (let i = 0; i < cmds.length; i += 200) await pipeline(cmds.slice(i, i + 200));
}

export const isSeeded = async () => Boolean(await cmd(['get', 'ew:seeded']));
export const markSeeded = () => pipeline([['SET', 'ew:seeded', new Date().toISOString()]]);

export const putTally = (t) => pipeline([['SET', 'ew:staff-tally', JSON.stringify(t)]]);
export const getTally = async () => parse(await cmd(['get', 'ew:staff-tally']));

export const putSnapshot = (snap) => pipeline([['SET', 'ew:snapshot', JSON.stringify(snap), 'EX', String(7 * 86400)]]);
export const getSnapshot = async () => parse(await cmd(['get', 'ew:snapshot']));

export const putRunLog = (entry) => pipeline([['LPUSH', 'ew:runs', JSON.stringify(entry)], ['LTRIM', 'ew:runs', '0', '199']]);

// One row per day, kept for a year. The run log is every tick, which is the
// wrong grain for a trend: 144 points a day of the same number is noise, and
// it falls out of the 200-entry window in a day and a half.
export async function putDaily(entry) {
  const day = (entry.at || new Date().toISOString()).slice(0, 10);
  await pipeline([['HSET', 'ew:daily', day, JSON.stringify({ ...entry, day })]]);
}
export async function getDaily() {
  const res = await cmd(['hgetall', 'ew:daily']);
  if (!res) return [];
  const out = [];
  if (Array.isArray(res)) {
    for (let i = 0; i < res.length; i += 2) { const v = parse(res[i + 1]); if (v) out.push(v); }
  } else if (typeof res === 'object') {
    for (const v of Object.values(res)) { const p = typeof v === 'string' ? parse(v) : v; if (p) out.push(p); }
  }
  return out.sort((a, b) => String(a.day).localeCompare(String(b.day)));
}

export async function getRuns(limit = 40) {
  const res = await cmd(['lrange', 'ew:runs', '0', String(limit - 1)]);
  return (res || []).map((v) => parse(v)).filter(Boolean);
}
