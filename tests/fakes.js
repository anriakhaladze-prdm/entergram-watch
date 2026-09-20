// Test doubles: an in-memory Upstash (the pipeline subset state.js uses), a
// scripted Entergram client, and a Slack that can be told to rate limit.

export function fakeUpstash() {
  const store = new Map();
  const lists = new Map();
  const hashes = new Map();
  const exec = (cmd) => {
    const [op, ...a] = cmd;
    switch (op) {
      case 'SET': {
        const [k, v, ...flags] = a;
        if (flags.includes('NX') && store.has(k)) return null;
        store.set(k, v); return 'OK';
      }
      case 'GET': return store.has(a[0]) ? store.get(a[0]) : null;
      case 'MGET': return a.map((k) => (store.has(k) ? store.get(k) : null));
      case 'DEL': { let n = 0; for (const k of a) { if (store.delete(k) || lists.delete(k) || hashes.delete(k)) n++; } return n; }
      case 'INCR': { const v = Number(store.get(a[0]) || 0) + 1; store.set(a[0], String(v)); return v; }
      case 'LPUSH': { const l = lists.get(a[0]) || []; l.unshift(...a.slice(1).reverse()); lists.set(a[0], l); return l.length; }
      case 'LTRIM': { const l = lists.get(a[0]) || []; lists.set(a[0], l.slice(Number(a[1]), Number(a[2]) + 1)); return 'OK'; }
      case 'LRANGE': { const l = lists.get(a[0]) || []; return l.slice(Number(a[1]), Number(a[2]) + 1); }
      case 'HSET': { const h = hashes.get(a[0]) || {}; h[a[1]] = a[2]; hashes.set(a[0], h); return 1; }
      case 'HGETALL': { const h = hashes.get(a[0]); return h ? Object.entries(h).flat() : []; }
      default: return { error: `unsupported ${op}` };
    }
  };
  const fetchImpl = async (url, init) => {
    if (!String(url).includes('/pipeline')) return { ok: false, status: 404, text: async () => 'not pipeline' };
    const cmds = JSON.parse(init.body);
    const out = cmds.map((c) => { const r = exec(c); return r && r.error ? r : { result: r }; });
    return { ok: true, status: 200, json: async () => out, text: async () => JSON.stringify(out) };
  };
  return { store, lists, hashes, fetchImpl, get: (k) => (store.has(k) ? JSON.parse(store.get(k)) : null) };
}

// chats: array of workspace chat entries. messages: chatId -> array of API
// messages (newest first not required). Records every call.
export function fakeEntergram({ chats = [], messages = {}, customFields = {}, groups = [], events = [] } = {}) {
  const calls = [];
  return {
    async events({ after = 0, limit = 500 } = {}) {
      calls.push(['events', after]);
      const items = events.filter((e) => e.cursor > after).slice(0, limit);
      const last = items.length ? items[items.length - 1].cursor : after;
      return { items, hasMore: events.some((e) => e.cursor > last), nextCursor: last };
    },
    calls,
    setChats(next) { chats = next; },
    setMessages(id, msgs) { messages[id] = msgs; },
    async workspaceChats(params = {}) {
      calls.push(['workspaceChats', params]);
      if (params.updated_since) {
        const since = new Date(params.updated_since).getTime();
        return chats.filter((c) => new Date(c.updatedAt || c.lastMessageDate).getTime() >= since);
      }
      return chats;
    },
    async messages(chatId) {
      calls.push(['messages', chatId]);
      const m = messages[chatId];
      if (m instanceof Error) throw m;
      return { items: m || [], hasMore: false };
    },
    async chatCustomFields(chatId) { calls.push(['customFields', chatId]); return { data: { values: customFields[chatId] || {} } }; },
    async request(path, { params } = {}) {
      calls.push(['request', path, params]);
      if (path === '/v1/groups') return { data: { items: groups, pagination: { hasMore: false } } };
      return { data: { items: [] } };
    },
  };
}

export function fakeSlack({ limitAfter = Infinity } = {}) {
  const posts = [];
  let n = 0;
  const post = async (text) => {
    n++;
    if (n > limitAfter) { const { RateLimited } = await import('../lib/slack.js'); throw new RateLimited(3); }
    posts.push(text);
    return { ok: true, ts: `${1000 + n}.000` };
  };
  return { posts, post, count: () => n };
}
