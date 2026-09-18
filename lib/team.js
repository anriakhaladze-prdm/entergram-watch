// Turning a Telegram sender into a person.
//
// The obvious approach, "whose connected account is this chat filed under", is
// worthless here: @Thrill_VIP_Ops is shared by 11 of the 12 members, so nearly
// every chat is filed under the same account whoever actually hosts it. What
// distinguishes people is the display name their messages carry inside the
// group, so identity is resolved on the sender.
//
// Three passes, most reliable first:
//   1. Telegram user id, from config/team.json. Exact.
//   2. Display name, exactly as listed for that member. Exact.
//   3. The "<name> | Thrill ..." convention, matched on the leading word, which
//      picks up a member who has not had their ids filled in yet.
// Anything staff-shaped that still does not resolve is reported as
// unidentified rather than quietly attributed to the wrong person.
import team from '../config/team.json' with { type: 'json' };

const BY_TG = new Map();
const BY_SENDER_NAME = new Map();
const BY_FIRST_WORD = new Map();

for (const m of team.members) {
  const person = {
    name: m.name, email: m.email, role: m.role,
    hosting: m.hosting !== false,
    reason: m.reason || null,
  };
  for (const id of m.telegramUserIds || []) BY_TG.set(String(id), person);
  for (const n of m.senderNames || []) BY_SENDER_NAME.set(n.toLowerCase(), person);
  BY_FIRST_WORD.set(String(m.name).split(/\s+/)[0].toLowerCase(), person);
}

export const SHARED_ACCOUNTS = new Set((team.sharedAccounts || []).map((a) => a.toLowerCase()));
export const isSharedAccount = (username) => Boolean(username) && SHARED_ACCOUNTS.has(String(username).toLowerCase());

export function identify(telegramUserId, senderName) {
  if (telegramUserId && BY_TG.has(String(telegramUserId))) return BY_TG.get(String(telegramUserId));
  const name = (senderName || '').trim();
  if (!name) return null;
  if (BY_SENDER_NAME.has(name.toLowerCase())) return BY_SENDER_NAME.get(name.toLowerCase());
  // "Carter | Thrill VIP" -> carter. Only accepted when the name carries the
  // staff convention, so a player called Carter is not mistaken for one.
  const m = name.match(/^([a-z]+)\s*[|\-–]/i);
  if (m && BY_FIRST_WORD.has(m[1].toLowerCase())) return BY_FIRST_WORD.get(m[1].toLowerCase());
  return null;
}

export const teamMembers = team.members;
export const unresolvedSenders = team.unresolved || [];
export const hostingMembers = team.members.filter((m) => m.hosting !== false);
