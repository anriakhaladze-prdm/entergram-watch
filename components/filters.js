// The queue's filter vocabulary, shared with every chart and tile that drills
// into it. A filter is a URL query, so any view of the book is a link.
import { ACTIONABLE, STATE } from '../lib/states.js';

// Days since we last spoke, bucketed the way the outreach conversation is had:
// today, this week, last week, this month, this quarter, longer, unknown.
export const SILENCE_BUCKETS = [
  { key: 's0',  label: 'today',   lo: 0,  hi: 1 },
  { key: 's1',  label: '1-3d',    lo: 1,  hi: 4 },
  { key: 's4',  label: '4-7d',    lo: 4,  hi: 7 },
  { key: 's7',  label: '7-14d',   lo: 7,  hi: 14 },
  { key: 's14', label: '14-20d',  lo: 14, hi: 20 },
  { key: 's20', label: '20d+',    lo: 20, hi: Infinity },
  { key: 'sx',  label: 'unknown', lo: null, hi: null },
];
export const REPLY_BUCKETS = [
  { key: 'r5',    label: 'under 5m', lo: 0,    hi: 5 },
  { key: 'r30',   label: '5-30m',    lo: 5,    hi: 30 },
  { key: 'r120',  label: '30m-2h',   lo: 30,   hi: 120 },
  { key: 'r720',  label: '2-12h',    lo: 120,  hi: 720 },
  { key: 'r1440', label: '12-24h',   lo: 720,  hi: 1440 },
  { key: 'rmax',  label: 'over 24h', lo: 1440, hi: Infinity },
];

export const silenceBucket = (row) => {
  const d = row.noContactDays;
  if (d == null) return 'sx';
  return SILENCE_BUCKETS.find((b) => b.lo != null && d >= b.lo && d < b.hi)?.key || 'sx';
};
export const replyBucket = (row) => {
  const m = row.reply?.medianMins;
  if (m == null) return null;
  return REPLY_BUCKETS.find((b) => m >= b.lo && m < b.hi)?.key || null;
};

// f=: states and a few derived sets.
export const SETS = {
  all: { label: 'All', test: () => true },
  actionable: { label: 'Needs action', test: (r) => r.actionable },
  hosted: { label: 'Hosted', test: (r) => !r.flags.left },
  contacted: { label: 'Contacted in 7d', test: (r) => r.flags.contacted7d },
  no_contact_any: { label: 'No contact 7d+ (all)', test: (r) => r.flags.no_contact && !r.flags.left },
  events: { label: 'Timing from the event stream', test: (r) => r.history === 'events' },
  unread: { label: 'History not read', test: (r) => r.history !== 'read' },
  unavailable: { label: 'History not readable', test: (r) => r.history === 'unavailable' },
  alerted: { label: 'Alerted', test: (r) => Boolean(r.alerts?.no_contact && !r.alerts.no_contact.seeded) || Boolean(r.alerts?.urgent && !r.alerts.urgent.seeded) },
};

// The queue's tabs. Groups is every chat the player is still in; left ones
// are kept out of it and out of every count on it.
export const TABS = [
  { key: 'active', label: 'Groups', test: (r) => !r.flags.left, states: ['waiting', 'unhappy', 'no_contact', 'ignored', 'ok'] },
  { key: 'left', label: 'Left group', test: (r) => r.flags.left, states: [] },
];
export const TAB = Object.fromEntries(TABS.map((t) => [t.key, t]));
export const tabOf = (row) => TABS.find((t) => t.test(row))?.key || 'active';

// How a chat's timing was established, as the filter names it.
export const HISTORY = [
  { key: 'read', label: 'Readable' },
  { key: 'events', label: 'Event stream' },
  { key: 'unavailable', label: 'Last message only' },
  { key: 'pending', label: 'Queued' },
];

// Each group is a list. Within a group any checked value matches; across
// groups every group has to match. Empty means the group is not filtering.
export const GROUPS = ['mood', 'silence', 'reply', 'history', 'tier'];

export function parseFilters(query = {}) {
  const list = (v) => (v == null || v === '' ? [] : [...new Set(String(v).split(',').filter(Boolean))]);
  return {
    tab: TAB[query.tab] ? String(query.tab) : null,
    f: list(query.f),
    mood: list(query.mood),
    silence: list(query.silence),
    reply: list(query.reply),
    history: list(query.history),
    tier: list(query.tier),
    alerted: query.alerted === '1' ? true : null,
    q: query.q ? String(query.q) : '',
    chat: query.chat ? String(query.chat) : null,
  };
}

export const moodOf = (row) => row.sentiment?.label || 'neutral';
export const tierOf = (row) => row.tier || 'none';

export function matchRow(row, fl) {
  if (fl.tab && !TAB[fl.tab].test(row)) return false;
  if (fl.f.length) {
    const hit = fl.f.some((k) => (SETS[k] ? SETS[k].test(row) : STATE[k] ? row.state === k : false));
    if (!hit) return false;
  }
  if (fl.mood.length && !fl.mood.includes(moodOf(row))) return false;
  if (fl.silence.length && !fl.silence.includes(silenceBucket(row))) return false;
  if (fl.reply.length && !fl.reply.includes(replyBucket(row))) return false;
  if (fl.history.length && !fl.history.includes(row.history)) return false;
  if (fl.tier.length && !fl.tier.includes(tierOf(row))) return false;
  if (fl.alerted && !SETS.alerted.test(row)) return false;
  if (fl.q) {
    const t = fl.q.trim().toLowerCase();
    if (t && !(row.player || '').toLowerCase().includes(t) && !(row.title || '').toLowerCase().includes(t) && !(row.playerUsername || '').toLowerCase().includes(t) && !String(row.chatId).includes(t)) return false;
  }
  return true;
}

// How many choices are ticked. The "all" sentinel on f is the absence of a
// state filter, so it does not count.
export const activeCount = (fl, f = fl.f) => f.filter((k) => k !== 'all').length + GROUPS.reduce((n, g) => n + fl[g].length, 0) + (fl.alerted ? 1 : 0);

export function filterLabel(fl) {
  const parts = [];
  for (const k of fl.f) if (k !== 'all') parts.push(SETS[k]?.label || STATE[k]?.label || k);
  if (fl.mood.length) parts.push(`mood ${fl.mood.map((m) => m.replace('_', ' ')).join('/')}`);
  if (fl.silence.length) parts.push(`we last spoke ${fl.silence.map((s) => SILENCE_BUCKETS.find((b) => b.key === s)?.label || s).join('/')}`);
  if (fl.reply.length) parts.push(`first reply ${fl.reply.map((r) => REPLY_BUCKETS.find((b) => b.key === r)?.label || r).join('/')}`);
  if (fl.history.length) parts.push(`history ${fl.history.map((h) => HISTORY.find((x) => x.key === h)?.label.toLowerCase() || h).join('/')}`);
  if (fl.tier.length) parts.push(`tier ${fl.tier.map((t) => t.replace(/_/g, ' ')).join('/')}`);
  if (fl.alerted) parts.push('alerted');
  return parts.join(' · ');
}

export const queueHref = (params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) q.set(k, Array.isArray(v) ? v.join(',') : String(v));
  const s = q.toString();
  return `/queue${s ? `?${s}` : ''}`;
};

export { ACTIONABLE };
