// What counts as a player chat, and how the raw chat list becomes one row per
// Telegram group.
//
// The workspace holds thousands of chats. Most are not players: public
// community groups the affiliate account sits in, affiliate deal rooms,
// channels, bots and private chats between colleagues. Players follow a
// naming convention, "<player> x Thrill.com" in various spellings, and sit in
// groups of under 25.

import team from '../config/team.json' with { type: 'json' };
import { identify, looksStaffName } from './team.js';

export const MAX_PLAYER_GROUP_MEMBERS = 25;

// Only groups the team's shared account sits in are in scope: that is the set
// the team sees in Entergram. The workspace list also carries every group any
// member's personal account was ever in, most of them long dead.
export const SCOPE_ACCOUNTS = new Set(
  String(process.env.SCOPE_ACCOUNTS || (team.sharedAccounts || []).map((a) => a.username).join(','))
    .split(',').map((a) => a.trim().toLowerCase().replace(/^@/, '')).filter(Boolean),
);
export const isInScope = (chat) => !SCOPE_ACCOUNTS.size || (chat?.accounts || []).some((a) => SCOPE_ACCOUNTS.has(String(a).toLowerCase()));

// Deal rooms carry a Thrill token too, so the player pattern alone is not
// enough. These are checked first and win.
const NOT_A_PLAYER = [
  /\(aff[\s\-)]/i,        // (AFF) ID 80281 x BCGAME
  /partnership/i,         // Thrill <> Nbavipbox Partnership (85029)
  /<>/,                   // the partnership convention
  /\bsponsor/i,
];
// Private chats that are not a player talking to us.
const NOT_A_PLAYER_DM = [/^telegram$/i, /entergram/i];

const SEP = '[x|\\-–—/]';
const THRILL = 'thri(?:ll|\\.com)';   // "Thrill", "Thrill.com" and the "thri.com" typo
// Player groups follow "<player> x Thrill.com" in several spellings: the
// separator is x, -, | or /, either side, and a few carry no separator at all
// ("Eco27 thrill / VIp group"). Whatever the spelling, the title has to name
// a player next to the Thrill token.
const clean = (name) => String(name || '').replace(/^streamer\s+/i, '').replace(/\s+vip$/i, '').replace(/[\s|\-–—/]+$/, '').replace(/^[\s|\-–—/]+/, '').trim();
export function playerNameFromTitle(title = '') {
  const t = String(title).trim();
  let m = t.match(new RegExp(`^(.*?)\\s*${SEP}\\s*${THRILL}`, 'i'));        // "<player> x Thrill.com", "<player> - Thrill", "<player> | Thrill VIP"
  if (m && clean(m[1])) return clean(m[1]);
  m = t.match(/^(.+?)\s+thrill\b/i);                                          // "Eco27 thrill / VIp group / HighPriest"
  if (m && clean(m[1]) && !/^thrill/i.test(t)) return clean(m[1]);
  m = t.match(new RegExp(`${THRILL}(?:\\.com?)?\\s*${SEP}\\s*(.+)$`, 'i'));  // "Thrill.com x <player> VIP"
  if (m && clean(m[1])) return clean(m[1]);
  return null;
}

// Why a chat is not a player chat, or null when it is. Groups: a Thrill title
// that names a player, small, not a deal room. Private chats with the shared
// account: a player writing to us directly, unless the other side is staff, a
// bot or the vendor.
export function excludeReason(chat) {
  if (!chat) return 'empty';
  const title = chat.title || chat.name || '';
  if (chat.type === 'private') {
    if (NOT_A_PLAYER_DM.some((re) => re.test(title))) return 'service chat';
    if (looksStaffName(title) || identify(null, title)) return 'staff chat';
    return null;
  }
  if (chat.type !== 'group') return `${chat.type || 'unknown'} chat`;
  if ((chat.membersCount || 0) > MAX_PLAYER_GROUP_MEMBERS) return `${chat.membersCount} members`;
  if (NOT_A_PLAYER.some((re) => re.test(title))) return 'deal room';
  if (!playerNameFromTitle(title)) return 'no player in the title';
  return null;
}
export const isPlayerChat = (chat) => excludeReason(chat) === null;

const ms = (d) => (d ? new Date(d).getTime() : 0);

// The workspace chat list carries one entry per connected account that knows
// a group, so the same Telegram group can appear two or three times with
// different workspace ids. Collapsed here onto the Telegram id, which is the
// only identity the alerts, the history reads and the dashboard use. The
// accounts that know the chat are kept: they say which account can read it.
export function dedupeChats(items = []) {
  const byId = new Map();
  for (const c of items) {
    const id = c?.telegramId != null ? String(c.telegramId) : null;
    if (!id) continue;
    const acct = c.connectedAccount?.username || null;
    const cur = byId.get(id);
    if (!cur) {
      byId.set(id, { ...c, telegramId: id, accounts: acct ? [acct] : [], accountIds: c.connectedAccount?.id ? [c.connectedAccount.id] : [] });
      continue;
    }
    if (acct && !cur.accounts.includes(acct)) cur.accounts.push(acct);
    if (c.connectedAccount?.id && !cur.accountIds.includes(c.connectedAccount.id)) cur.accountIds.push(c.connectedAccount.id);
    if (!cur.title && c.title) cur.title = c.title;
    if ((c.membersCount || 0) > (cur.membersCount || 0)) cur.membersCount = c.membersCount;
    if (ms(c.lastMessageDate) > ms(cur.lastMessageDate)) {
      cur.lastMessageDate = c.lastMessageDate;
      cur.lastMessage = c.lastMessage;
      cur.connectedAccount = c.connectedAccount;
    }
    if (!cur.inviteLink && c.inviteLink) cur.inviteLink = c.inviteLink;
  }
  return [...byId.values()];
}

// The slice of a chat that the book keeps between scans. Everything the
// dashboard shows about a chat that did not come from its message history.
export function chatMeta(c) {
  const sender = c.lastMessage?.sender || null;
  return {
    chatId: String(c.telegramId),
    uuid: c.id || null,
    title: c.title || c.name || '',
    player: c.type === 'private' ? clean(c.title || c.name || '') || null : playerNameFromTitle(c.title || c.name || ''),
    membersCount: c.membersCount ?? null,
    lastMessageAt: c.lastMessageDate || c.lastMessage?.date || null,
    lastSenderId: sender?.id != null ? String(sender.id) : null,
    lastSenderName: sender?.displayName || sender?.name || null,
    lastIsOut: c.lastMessage?.isOut === true,
    accounts: c.accounts || (c.connectedAccount?.username ? [c.connectedAccount.username] : []),
    inviteLink: c.inviteLink || null,
    seenAt: new Date().toISOString(),
  };
}
