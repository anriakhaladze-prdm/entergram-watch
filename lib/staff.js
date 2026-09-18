import staffConfig from '../config/staff.json' with { type: 'json' };
import { identify } from './team.js';

export const STAFF_IDS = new Set(staffConfig.staff.map((s) => String(s.telegramUserId)));
export const BOT_IDS = new Set((staffConfig.bots || []).map((s) => String(s.telegramUserId)));
export const STAFF_BY_ID = new Map(staffConfig.staff.map((s) => [String(s.telegramUserId), s]));

export const isStaff = (id) => id != null && STAFF_IDS.has(String(id));

// Second line of defence for staff whose id is not in the roster yet, for
// example a new host. Every host's Telegram display name follows the same
// convention: "Kyle | Thrill VIP", "Mikey | Thrill Affiliate", "High Priest -
// Thrill.com". The separator is required, so a player calling themselves
// something like thrillseeker does not match.
const STAFF_NAME = /[|\-\u2013\u2014]\s*thrill/i;
export const isStaffName = (name) => Boolean(name && STAFF_NAME.test(name));
export const looksStaff = (id, name) => isStaff(id) || isStaffName(name);
export const isBot = (id) => id != null && BOT_IDS.has(String(id));
// Anyone who is neither staff nor a service account is the player side of the
// conversation. Treating unknown senders as players is the safe default: it
// can delay an alert, never invent one.
export const isPlayerSide = (id) => id != null && !isStaff(id) && !isBot(id);

export const staffName = (id) => STAFF_BY_ID.get(String(id))?.name || null;
export const staffList = staffConfig.staff;

/* ---------------------------------------------------------------------------
   The learned registry.

   Group membership and the contact book are both empty in this workspace, so
   there is no endpoint that says "these Telegram accounts are staff". What
   there is, is shape: a player appears in exactly one player chat, a host
   appears in dozens. Counting distinct chats per sender separates them without
   anybody maintaining a list, and it keeps working when a host joins.

   The tally persists between runs, so it strengthens as coverage grows rather
   than being re-derived from whatever sample a single run happened to read.
   --------------------------------------------------------------------------- */
export const STAFF_MIN_CHATS = Number(process.env.STAFF_MIN_CHATS || 5);

export function updateTally(tally, chatId, messages) {
  const seenHere = new Set();
  for (const m of messages) {
    const id = m.senderId ? String(m.senderId) : null;
    if (!id || m.actionType) continue;
    const e = tally[id] || (tally[id] = { n: 0, m: 0, names: [], last: null, seen: [] });
    e.m++;
    if (m.senderName && e.names.length < 4 && !e.names.includes(m.senderName)) e.names.push(String(m.senderName).slice(0, 40));
    if (!e.last || String(m.date) > e.last) e.last = String(m.date);
    if (seenHere.has(id)) continue;
    seenHere.add(id);
    // Distinct chats, counted once each however many runs read the chat. The
    // id list is dropped once the sender is unambiguously staff, so the tally
    // does not grow without bound for someone in 600 chats.
    if (e.n >= STAFF_MIN_CHATS * 2) { e.n++; continue; }
    if (!e.seen.includes(chatId)) { e.seen.push(chatId); e.n = e.seen.length; }
  }
  return tally;
}

export function learnedStaff(tally = {}) {
  const out = new Set();
  for (const [id, e] of Object.entries(tally)) {
    if (e.n >= STAFF_MIN_CHATS || (e.names || []).some(isStaffName)) out.add(String(id));
  }
  return out;
}

export function learnedNames(tally = {}) {
  const out = new Map();
  for (const [id, e] of Object.entries(tally)) if (e.names?.length) out.set(String(id), e.names[0]);
  return out;
}

// The registry is additive to the static seed, never a replacement: the two
// connected accounts and the six hosts derived at build time stay staff even
// if a run reads nothing.
let LEARNED = new Set();
let LEARNED_NAMES = new Map();
export function useLearnedStaff(ids, names) {
  LEARNED = ids instanceof Set ? ids : new Set(ids || []);
  LEARNED_NAMES = names instanceof Map ? names : new Map();
}
// A sender is staff if the team table knows them, if the static seed lists
// them, if their display name follows the convention, or if the learned
// registry has seen them across enough separate player chats.
export const isKnownStaff = (id, name) => Boolean(identify(id, name)) || looksStaff(id, name) || (id != null && LEARNED.has(String(id)));
export const knownStaffName = (id) => staffName(id) || LEARNED_NAMES.get(String(id)) || null;
