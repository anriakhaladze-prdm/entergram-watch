// Timing for every chat, from the workspace event stream.
//
// Message history can only be read for groups the reader account belongs to.
// The event stream has no such limit: every message in the workspace appears
// in it, once per connected account that can see the group, with the chat,
// the sender's Telegram id, the time and the direction, and no text. That is
// enough to know who spoke last, how long we took to answer and who does the
// talking, for the groups the reader account cannot see.
//
// The stream is followed by cursor. Duplicates across accounts collapse on
// (chat, time, sender): message ids differ per account, times do not. Only
// events for chats in the book are kept, and only the last few dozen turns per
// chat, which is all the facts need.
import { isStaffSender, isBot, isThirdParty, identify, isSharedSender, staffLabel } from './team.js';

const ms = (d) => (d ? new Date(d).getTime() : 0);
export const MAX_TURNS = 80;

export function applyEvent(ev, item) {
  const key = `${item.occurredAt}|${item.senderId ?? ''}`;
  if (ev.seen.includes(key)) return false;
  if (isThirdParty(item.senderId)) return false;
  const staff = item.isOut === true || isStaffSender(item.senderId, item.senderName);
  if (!staff && isBot(item.senderId)) return false;
  ev.seen.push(key);
  if (ev.seen.length > MAX_TURNS * 2) ev.seen.splice(0, ev.seen.length - MAX_TURNS * 2);
  ev.turns.push({ t: item.occurredAt, s: staff ? 'staff' : 'player', id: item.senderId != null ? String(item.senderId) : null, n: item.senderName || null });
  ev.turns.sort((a, b) => ms(a.t) - ms(b.t));
  if (ev.turns.length > MAX_TURNS) ev.turns.splice(0, ev.turns.length - MAX_TURNS);
  ev.lastEventAt = item.occurredAt > (ev.lastEventAt || '') ? item.occurredAt : ev.lastEventAt;
  return true;
}

export const emptyEv = () => ({ turns: [], seen: [], lastEventAt: null });

// Walks the stream from the stored cursor, at most `pageBudget` pages per call.
// Returns the new cursor, whether the stream is caught up, and the chats whose
// turns changed. A first call with no cursor starts `backfillDays` back.
export async function ingestEvents(api, { cursor = 0, backfillDays = 10, pageBudget = 25, bookIds, states, now = Date.now(), log = () => {} } = {}) {
  let after = Number(cursor) || 0;
  const touched = new Set();
  let pages = 0, seen = 0, kept = 0, hasMore = true;
  const sinceIso = after ? undefined : new Date(now - backfillDays * 86400000).toISOString();
  while (pages < pageBudget) {
    // The time bound only positions the very first page; after that the
    // cursor alone drives the walk.
    const res = await api.events({ after, limit: 500, updatedSince: after ? undefined : sinceIso });
    pages++;
    for (const item of res.items) {
      seen++;
      if (item.type && item.type !== 'message.created') continue;
      const chatId = item.chatId != null ? String(item.chatId) : null;
      if (!chatId || !bookIds.has(chatId)) continue;
      const st = states.get(chatId) || {};
      const ev = st.ev || emptyEv();
      if (applyEvent(ev, item)) { st.ev = ev; states.set(chatId, st); touched.add(chatId); kept++; }
    }
    hasMore = Boolean(res.hasMore);
    const next = Number(res.nextCursor);
    if (!res.items.length || !Number.isFinite(next) || next <= after) { hasMore = false; break; }
    after = next;
    if (!hasMore) break;
  }
  log(`events: ${pages} page${pages === 1 ? '' : 's'}, ${seen} events, ${kept} turns kept across ${touched.size} chats${hasMore ? ', more to fetch' : ', caught up'}${sinceIso ? ` (backfill from ${sinceIso.slice(0, 10)})` : ''}`);
  return { cursor: after, caughtUp: !hasMore, touched, pages, seen, kept };
}

// Facts from turns alone: everything extractFacts establishes except what
// needs text (acknowledgements, departures, sentiment).
export function factsFromEvents(ev) {
  const turns = ev?.turns || [];
  if (!turns.length) return null;
  const lastPlayer = [...turns].reverse().find((t) => t.s === 'player');
  const lastStaff = [...turns].reverse().find((t) => t.s === 'staff');
  const speakers = new Map();
  for (const t of turns) {
    if (t.s !== 'staff' || !t.id) continue;
    const e = speakers.get(t.id) || { id: t.id, msgs: 0, last: null, name: staffLabel(t.id, t.n), person: identify(t.id, t.n), shared: isSharedSender(t.id) };
    e.msgs++;
    if (!e.last || ms(t.t) > ms(e.last)) e.last = t.t;
    speakers.set(t.id, e);
  }
  const ranked = [...speakers.values()].sort((a, b) => (b.msgs - a.msgs) || (ms(b.last) - ms(a.last)));
  const gaps = [];
  let openedAt = null;
  for (const t of turns) {
    if (t.s === 'player') { if (openedAt == null) openedAt = ms(t.t); continue; }
    if (t.s === 'staff' && openedAt != null) { gaps.push((ms(t.t) - openedAt) / 60000); openedAt = null; }
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  return {
    source: 'events',
    msgCount: turns.length,
    oldestAt: turns[0].t,
    newestAt: turns[turns.length - 1].t,
    lastPlayerAt: lastPlayer?.t || null,
    lastStaffAt: lastStaff?.t || null,
    lastStaffBy: lastStaff ? staffLabel(lastStaff.id, lastStaff.n) : null,
    playerSeen: Boolean(lastPlayer),
    playerSenders: [...new Set(turns.filter((t) => t.s === 'player' && t.id).map((t) => t.id))],
    lastPlayerAck: null,
    playerLeftAt: null,
    staffChurn: [],
    staffSpeakers: ranked.slice(0, 6).map((s) => ({ id: s.id, name: s.name, msgs: s.msgs, last: s.last })),
    unknownStaffNames: [],
    reply: gaps.length ? {
      medianMins: Math.round(sorted[Math.floor(sorted.length / 2)]),
      p90Mins: Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]),
      worstMins: Math.round(sorted[sorted.length - 1]), samples: gaps.length,
    } : null,
  };
}
