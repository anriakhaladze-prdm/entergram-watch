// Who is staff, and which staff member hosts a player.
//
// The connected account a chat is filed under says almost nothing here:
// @Thrill_VIP_Ops is one Telegram account that most of the team posts from, so
// identity is resolved on the sender of each message. Three passes, most
// reliable first: Telegram user id, exact display name, then the
// "<name> | Thrill ..." convention on the leading word.
//
// Whatever cannot be resolved is reported as unidentified rather than guessed.
import team from '../config/team.json' with { type: 'json' };

const BY_TG = new Map();
const BY_USERNAME = new Map();
const BY_SENDER_NAME = new Map();
const BY_FIRST_WORD = new Map();
const BY_ACCOUNT = new Map();

export const MEMBERS = team.members.map((m) => ({
  name: m.name,
  email: m.email || null,
  hosting: m.hosting !== false,
  reason: m.reason || null,
  telegramUserIds: (m.telegramUserIds || []).map(String),
  accounts: m.accounts || [],
}));

for (const m of team.members) {
  const person = MEMBERS.find((p) => p.name === m.name);
  for (const id of m.telegramUserIds || []) BY_TG.set(String(id), person);
  for (const u of m.telegramUsernames || []) BY_USERNAME.set(String(u).toLowerCase().replace(/^@/, ''), person);
  for (const n of m.senderNames || []) BY_SENDER_NAME.set(String(n).trim().toLowerCase(), person);
  for (const a of m.accounts || []) BY_ACCOUNT.set(String(a).toLowerCase(), person);
  BY_FIRST_WORD.set(String(m.name).split(/\s+/)[0].toLowerCase(), person);
}

// The shared account is staff, but it is nobody in particular.
export const SHARED = (team.sharedAccounts || []).map((a) => ({
  username: a.username, telegramUserId: String(a.telegramUserId || ''), displayName: a.displayName || a.username,
}));
const SHARED_TG = new Set(SHARED.map((a) => a.telegramUserId).filter(Boolean));
const SHARED_USERNAMES = new Set(SHARED.map((a) => String(a.username).toLowerCase()));
export const isSharedSender = (id) => id != null && SHARED_TG.has(String(id));
export const isSharedAccount = (username) => Boolean(username) && SHARED_USERNAMES.has(String(username).toLowerCase());

const BOT_IDS = new Set((team.bots || []).map((b) => String(b.telegramUserId)));
export const isBot = (id) => id != null && BOT_IDS.has(String(id));

export const READER_ACCOUNT_ID = process.env.ENTERGRAM_READER_ACCOUNT_ID || team.readerAccountId;

// "Kyle | Thrill VIP", "High Priest - Thrill.com". The separator is required so
// a player who calls themselves thrillseeker does not match.
const STAFF_NAME = /[|\-–—]\s*thrill/i;
export const looksStaffName = (name) => Boolean(name && STAFF_NAME.test(String(name)));

export function identify(telegramUserId, senderName) {
  if (telegramUserId != null && BY_TG.has(String(telegramUserId))) return BY_TG.get(String(telegramUserId));
  const name = String(senderName || '').trim();
  if (!name) return null;
  const low = name.toLowerCase();
  if (BY_SENDER_NAME.has(low)) return BY_SENDER_NAME.get(low);
  if (looksStaffName(name)) {
    const first = name.match(/^([a-z]+)\b/i)?.[1]?.toLowerCase();
    if (first && BY_FIRST_WORD.has(first)) return BY_FIRST_WORD.get(first);
  }
  return null;
}

export const identifyUsername = (username) => (username ? BY_USERNAME.get(String(username).toLowerCase().replace(/^@/, '')) || null : null);

// The person behind a connected account, for chats whose history cannot be
// read. Only personal accounts resolve; the shared account is nobody.
export const ownerOfAccount = (username) => (username && !isSharedAccount(username) ? BY_ACCOUNT.get(String(username).toLowerCase()) || null : null);

// Learned staff: senders seen across many separate player groups. Each player
// group holds one player, so a sender who appears in six of them is a member of
// staff whose ids are not in the table yet. Supplied per scan from the tally.
let LEARNED = new Map();
export function useLearnedStaff(entries) { LEARNED = entries instanceof Map ? entries : new Map(entries || []); }
export const learnedName = (id) => LEARNED.get(String(id)) || null;

// Is this sender on our side of the conversation?
export function isStaffSender(id, name) {
  if (id == null && !name) return false;
  if (isSharedSender(id)) return true;
  if (identify(id, name)) return true;
  if (looksStaffName(name)) return true;
  if (id != null && LEARNED.has(String(id))) return true;
  return false;
}

export const isPlayerSender = (id, name) => id != null && !isBot(id) && !isStaffSender(id, name);

export function staffLabel(id, name) {
  const p = identify(id, name);
  if (p) return p.name;
  if (isSharedSender(id)) return SHARED.find((a) => a.telegramUserId === String(id))?.displayName || 'VIP Ops';
  return learnedName(id) || name || (id != null ? `sender ${id}` : null);
}

export const hostingMembers = MEMBERS.filter((m) => m.hosting);
export const teamNote = team.note;
