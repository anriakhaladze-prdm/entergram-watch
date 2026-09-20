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
  { key: 's14', label: '14-30d',  lo: 14, hi: 30 },
  { key: 's30', label: '30-90d',  lo: 30, hi: 90 },
  { key: 's90', label: '90d+',    lo: 90, hi: Infinity },
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
  hosted: { label: 'Hosted', test: (r) => !r.flags.left && !r.flags.unhosted },
  contacted: { label: 'Contacted in 7d', test: (r) => r.flags.contacted7d },
  no_contact_any: { label: 'No contact 7d+ (all)', test: (r) => r.flags.no_contact && !r.flags.left && !r.flags.unhosted },
  events: { label: 'Timing from the event stream', test: (r) => r.history === 'events' },
  unread: { label: 'History not read', test: (r) => r.history !== 'read' },
  unavailable: { label: 'History not readable', test: (r) => r.history === 'unavailable' },
  unattributed: { label: 'Host unattributed', test: (r) => r.hostUnattributed && !r.flags.left && !r.flags.unhosted },
  alerted: { label: 'Alerted', test: (r) => Boolean(r.alerts?.no_contact && !r.alerts.no_contact.seeded) || Boolean(r.alerts?.urgent && !r.alerts.urgent.seeded) },
};

// The queue's tabs. Active is the worklist; time-barred and gone (left or
// unhosted) are kept out of it and out of every count on it.
export const TABS = [
  { key: 'active', label: 'Active', test: (r) => !r.flags.barred && !r.flags.left && !r.flags.unhosted, states: ['waiting', 'unhappy', 'no_contact', 'ignored', 'ok'] },
  { key: 'barred', label: 'Time-barred', test: (r) => r.flags.barred && !r.flags.left && !r.flags.unhosted, states: [] },
  { key: 'gone', label: 'Left and unhosted', test: (r) => r.flags.left || r.flags.unhosted, states: ['left', 'unhosted'] },
];
export const TAB = Object.fromEntries(TABS.map((t) => [t.key, t]));
export const tabOf = (row) => TABS.find((t) => t.test(row))?.key || 'active';

export function parseFilters(query = {}) {
  const list = (v) => (v == null || v === '' ? [] : String(v).split(',').filter(Boolean));
  return {
    tab: TAB[query.tab] ? String(query.tab) : null,
    f: list(query.f),
    host: query.host ? String(query.host) : null,
    mood: query.mood ? String(query.mood) : null,
    silence: query.silence ? String(query.silence) : null,
    reply: query.reply ? String(query.reply) : null,
    q: query.q ? String(query.q) : '',
    chat: query.chat ? String(query.chat) : null,
  };
}

export function matchRow(row, fl) {
  if (fl.tab && !TAB[fl.tab].test(row)) return false;
  if (fl.f.length) {
    const hit = fl.f.some((k) => (SETS[k] ? SETS[k].test(row) : STATE[k] ? row.state === k : false));
    if (!hit) return false;
  }
  if (fl.host && (row.host || 'unattributed') !== fl.host) return false;
  if (fl.mood && (row.sentiment?.label || 'neutral') !== fl.mood) return false;
  if (fl.silence && silenceBucket(row) !== fl.silence) return false;
  if (fl.reply && replyBucket(row) !== fl.reply) return false;
  if (fl.q) {
    const t = fl.q.trim().toLowerCase();
    if (t && !(row.player || '').toLowerCase().includes(t) && !(row.title || '').toLowerCase().includes(t) && !(row.playerUsername || '').toLowerCase().includes(t) && !String(row.chatId).includes(t)) return false;
  }
  return true;
}

export function filterLabel(fl) {
  const parts = [];
  for (const k of fl.f) parts.push(SETS[k]?.label || STATE[k]?.label || k);
  if (fl.host) parts.push(`host ${fl.host}`);
  if (fl.mood) parts.push(`mood ${fl.mood.replace('_', ' ')}`);
  if (fl.silence) parts.push(`we last spoke ${SILENCE_BUCKETS.find((b) => b.key === fl.silence)?.label || fl.silence}`);
  if (fl.reply) parts.push(`first reply ${REPLY_BUCKETS.find((b) => b.key === fl.reply)?.label || fl.reply}`);
  return parts.join(' · ');
}

export const queueHref = (params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) q.set(k, Array.isArray(v) ? v.join(',') : String(v));
  const s = q.toString();
  return `/queue${s ? `?${s}` : ''}`;
};

export { ACTIONABLE };
