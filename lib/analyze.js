// Turns a chat into the row the alerts and the dashboard both read from.
//
// Three input paths, in descending order of confidence:
//   messages  a fresh history read. Gives both timestamps and the service
//             messages that prove somebody left.
//   cached    what a previous history read found, reused when the chat's last
//             message has not moved since, because nothing can have changed.
//   neither   the workspace chat list alone. It carries lastMessage.sender.id,
//             so "who spoke last" is still answerable for every chat, which
//             matters because history is only readable for the chats the
//             reader account belongs to.
import { isStaff, isBot, isStaffName, looksStaff, staffName } from './staff.js';
import { hostFor, playerNameFromTitle, DORMANT_DAYS } from './scope.js';

// A conversation that ends with the player saying thanks is closed, not
// waiting on a reply. Without this, a courteous sign-off 88 days ago reads as
// "player messaged, nobody replied" forever.
const ACK = /^\s*(thanks?|thank you|thx|ty|cheers|ok(ay)?|kk|got it|np|no worries|perfect|great|nice|appreciate it|will do|sounds good|\p{Emoji_Presentation}|[\u{1F44D}\u{1F64F}\u{2764}])[\s!.,)👍🙏❤️]*$/iu;
export const isAcknowledgement = (text) => Boolean(text) && String(text).trim().length <= 40 && ACK.test(String(text).trim());

export const LEAVE_ACTIONS = new Set(['chatDeleteUser']);
export const JOIN_ACTIONS = new Set(['chatAddUser', 'chatJoinedByLink']);
export const ALERTABLE = new Set(['at_risk', 'quiet', 'waiting_on_us', 'outreach_ignored', 'player_left']);

const ms = (d) => (d ? new Date(d).getTime() : null);
const daysSince = (d, now) => (d ? (now - ms(d)) / 86400000 : null);
const hoursSince = (d, now) => (d ? (now - ms(d)) / 3600000 : null);
// Hours past a couple of days stop being readable: "870h ago" is 36 days.
export const humanAge = (days) => (days == null ? 'unknown' : days < 2 ? `${Math.max(1, Math.round(days * 24))}h` : `${Math.round(days)}d`);

export function analyzeChat(chat, {
  messages = null, cached = null, now = Date.now(),
  quietDays = 7, unansweredHours = 12, expectedMembers = null,
} = {}) {
  const host = hostFor(chat);
  const lastAny = chat.lastMessageDate || chat.lastMessage?.date || null;
  const lastSenderId = chat.lastMessage?.sender?.id ?? null;

  const row = {
    chatId: chat.telegramId,
    uuid: chat.id,
    title: chat.title || chat.name || '',
    player: playerNameFromTitle(chat.title || chat.name || ''),
    host: host?.username || chat.connectedAccount?.username || null,
    hostActive: Boolean(host?.active),
    membersCount: chat.membersCount ?? null,
    unreadCount: chat.unreadCount ?? null,
    lastMessageAt: lastAny,
    quietDays: daysSince(lastAny, now),
    lastPlayerAt: null,
    lastStaffAt: null,
    playerQuietDays: null,
    staffQuietDays: null,
    spokeLast: null,
    spokeLastName: null,
    historyRead: false,
    fromCache: false,
    playerSeen: null,
    lastPlayerAck: null,
    leaveActionAt: null,
    leftAt: null,
    membersBelowNorm: null,
    signals: [],
    state: 'ok',
  };

  if (lastSenderId != null) {
    row.spokeLast = looksStaff(lastSenderId, chat.lastMessage?.sender?.displayName) ? 'staff' : 'player';
    row.spokeLastName = staffName(lastSenderId);
    if (row.spokeLast === 'staff') row.lastStaffAt = lastAny;
    else row.lastPlayerAt = lastAny;
  }

  if (Array.isArray(messages) && messages.length) {
    const ordered = [...messages].sort((a, b) => ms(b.date) - ms(a.date));
    const staffMsg = (m) => !m.actionType && (looksStaff(m.senderId, m.senderName) || m.isOut === true);
    const playerMsg = (m) => !m.actionType && m.senderId && !looksStaff(m.senderId, m.senderName) && !isBot(m.senderId);
    const lastPlayerMsg = ordered.find(playerMsg);
    const lastStaffMsg = ordered.find(staffMsg);
    row.unknownStaffNames = [...new Set(ordered.filter((m) => !isStaff(m.senderId) && isStaffName(m.senderName)).map((m) => `${m.senderId}:${m.senderName}`))];
    row.historyRead = true;
    row.lastPlayerAt = lastPlayerMsg?.date || null;
    row.lastStaffAt = lastStaffMsg?.date || null;
    row.playerSeen = Boolean(lastPlayerMsg);
    row.lastPlayerAck = lastPlayerMsg?.text != null ? isAcknowledgement(lastPlayerMsg.text) : null;
    row.spokeLastName = lastStaffMsg ? (staffName(lastStaffMsg.senderId) || lastStaffMsg.senderName || null) : null;
    const leave = ordered.find((m) => LEAVE_ACTIONS.has(m.actionType) && (!row.lastPlayerAt || ms(m.date) >= ms(row.lastPlayerAt)));
    row.leaveActionAt = leave?.date || null;
  } else if (cached) {
    row.historyRead = true;
    row.fromCache = true;
    row.lastPlayerAt = cached.lastPlayerAt ?? null;
    row.lastStaffAt = cached.lastStaffAt ?? null;
    row.playerSeen = cached.playerSeen ?? null;
    row.lastPlayerAck = cached.lastPlayerAck ?? null;
    row.leaveActionAt = cached.leaveActionAt ?? null;
  }

  if (row.historyRead) {
    if (row.lastPlayerAt && row.lastStaffAt) row.spokeLast = ms(row.lastStaffAt) > ms(row.lastPlayerAt) ? 'staff' : 'player';
    else if (row.lastStaffAt) row.spokeLast = 'staff';
    else if (row.lastPlayerAt) row.spokeLast = 'player';
  }

  row.playerQuietDays = daysSince(row.lastPlayerAt, now);
  row.staffQuietDays = daysSince(row.lastStaffAt, now);

  // The API exposes actionType but not who the action was performed on, so a
  // chatDeleteUser alone cannot separate the player leaving from a host being
  // rotated off the group. Member count corroborates: these groups hold a
  // stable staff set plus one player, so one below the norm is the player.
  row.membersBelowNorm = expectedMembers != null && row.membersCount != null ? row.membersCount <= expectedMembers - 1 : null;
  const leaveEvidence = Boolean(row.leaveActionAt) || (row.historyRead && row.playerSeen === false);
  if (leaveEvidence && row.membersBelowNorm !== false) row.leftAt = row.leaveActionAt || row.lastMessageAt;

  // Precedence: a chat can satisfy several of these, and only the most
  // actionable one should drive an alert.
  const quiet = row.quietDays;
  if (!row.hostActive) {
    row.state = 'unhosted';
    row.signals.push('host no longer hosting');
  } else if (row.leftAt) {
    row.state = 'player_left';
    row.signals.push(row.leaveActionAt ? 'left the group' : 'no player message on record');
    if (row.membersBelowNorm) row.signals.push(`${row.membersCount} members, one below the norm of ${expectedMembers}`);
  } else if (leaveEvidence) {
    row.signals.push('possible leave, member count does not corroborate');
  }

  if (row.state === 'ok') {
    if (quiet != null && quiet >= DORMANT_DAYS) {
      row.state = 'dormant';
      row.signals.push(`silent ${Math.round(quiet)} days`);
    } else if (row.spokeLast === 'player' && row.lastPlayerAck !== true && (hoursSince(row.lastPlayerAt || row.lastMessageAt, now) ?? 0) >= unansweredHours) {
      row.state = 'waiting_on_us';
      row.signals.push(`player messaged ${humanAge(daysSince(row.lastPlayerAt || row.lastMessageAt, now))} ago with no reply`);
    } else if (quiet != null && quiet >= quietDays) {
      row.state = 'quiet';
      row.signals.push(`no contact either way for ${Math.round(quiet)} days${row.lastPlayerAck ? ', last exchange closed out' : ''}`);
    } else if (row.playerQuietDays != null && row.playerQuietDays >= quietDays && row.spokeLast === 'staff') {
      row.state = 'outreach_ignored';
      row.signals.push(`host reached out ${humanAge(row.staffQuietDays)} ago, player silent ${humanAge(row.playerQuietDays)}`);
    }
  }

  return row;
}
