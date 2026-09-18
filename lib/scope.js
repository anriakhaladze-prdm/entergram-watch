// What counts as a player chat, and whose it is.
//
// The workspace holds 3548 chats. Most are not players: public community
// groups the affiliate account sits in (up to 5989 members), affiliate deal
// rooms like "(AFF) ID 80281 x BCGAME" and "Thrill <> Nbavipbox Partnership
// (85029)", channels and bots. Hosted players follow a naming convention,
// "<player> x Thrill.com" in various spellings, and sit in groups of under 25.
// That pairing matches 1248 chats and nothing else.
import hostsConfig from '../config/hosts.json' with { type: 'json' };

export const MAX_PLAYER_GROUP_MEMBERS = 25;
export const DORMANT_DAYS = 90;

export const READER_ACCOUNT_ID = hostsConfig.readerAccountId;

// The roster is derived per scan from /v1/groups and /v1/members. Until it is
// handed over, hostFor falls back to the accounts seen in the chat list, which
// is enough to classify but names an account rather than a person.
let HOST_BY_ACCOUNT = new Map(hostsConfig.hosts.map((h) => [h.accountId, h]));
export function useRoster(index) { if (index?.size) HOST_BY_ACCOUNT = index; }

// Deal rooms carry a Thrill token too, so the player pattern alone is not
// enough. These are checked first and win.
const NOT_A_PLAYER = [
  /\(aff[\s\-)]/i,        // (AFF) ID 80281 x BCGAME, (AFF-I) SpinAtaque x BCGame
  /partnership/i,         // Thrill <> Nbavipbox Partnership (85029)
  /<>/,                   // the partnership convention
  /\bsponsor/i,
];

export function isPlayerChat(chat) {
  if (!chat || chat.type !== 'group') return false;
  if ((chat.membersCount || 0) > MAX_PLAYER_GROUP_MEMBERS) return false;
  const title = chat.title || chat.name || '';
  if (NOT_A_PLAYER.some((re) => re.test(title))) return false;
  // Both orderings occur: "swish718 x Thrill.com" and "Thrill.com x Shrimpmoneyy VIP".
  return /\bx\s*thrill/i.test(title) || /\bthrill(?:\.com?)?\s*x\b/i.test(title);
}

export function hostFor(chat) {
  const a = chat?.connectedAccount;
  if (!a?.id) return null;
  const known = HOST_BY_ACCOUNT.get(a.id);
  if (known) return known;
  // An account nobody has mapped yet is still hosting somebody. Treating it as
  // active is the safe default: the alternative silently files a live host's
  // whole book under "unhosted" and nobody hears about those players again.
  return { accountId: a.id, username: a.username || null, ownerName: null, active: true, unmapped: true };
}

// A chat belonging to a host who no longer hosts is not a quiet player, it is
// a player nobody is assigned to. Different problem, different treatment: off
// the alerts, onto the dashboard as unhosted.
export function isHosted(chat) {
  return hostFor(chat)?.active === true;
}

export function playerNameFromTitle(title = '') {
  // "swish718 x Thrill.com", "Thrill.com x Shrimpmoneyy VIP", "Streamer 4nayz x Thrill"
  const t = String(title).trim();
  const after = t.match(/thrill(?:\.com?)?\s*x\s*(.+)$/i);
  if (after) return after[1].replace(/\s+vip$/i, '').trim();
  const before = t.match(/^(.+?)\s*x\s*thrill/i);
  if (before) return before[1].replace(/^streamer\s+/i, '').trim();
  return null;
}

export const hosts = hostsConfig.hosts;
