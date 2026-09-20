// What counts as a player chat, and how the raw chat list becomes one row per
// Telegram group.
//
// The workspace holds about 3,500 chats. Most are not players: public
// community groups the affiliate account sits in, affiliate deal rooms,
// channels, bots and private chats between colleagues. Hosted players follow a
// naming convention, "<player> x Thrill.com" in various spellings, and sit in
// groups of under 25.

export const MAX_PLAYER_GROUP_MEMBERS = 25;
// Silent this long, the chat is time-barred: out of the worklist and off the
// alerts, kept in its own tab.
export const BARRED_DAYS = Number(process.env.TIME_BARRED_DAYS || 20);

// Deal rooms carry a Thrill token too, so the player pattern alone is not
// enough. These are checked first and win.
const NOT_A_PLAYER = [
  /\(aff[\s\-)]/i,        // (AFF) ID 80281 x BCGAME
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

export function playerNameFromTitle(title = '') {
  const t = String(title).trim();
  const after = t.match(/thrill(?:\.com?)?\s*x\s*(.+)$/i);
  if (after) return after[1].replace(/\s+vip$/i, '').trim();
  const before = t.match(/^(.+?)\s*x\s*thrill/i);
  if (before) return before[1].replace(/^streamer\s+/i, '').trim();
  return null;
}

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
    player: playerNameFromTitle(c.title || c.name || ''),
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
