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
import { ruleScan } from './sentiment.js';

// A conversation the player closed is not one waiting on a reply. Without
// this, a courteous sign-off reads as "player messaged, nobody replied"
// forever.
//
// Two shapes, because the strict one was not enough in practice. jp823's last
// message was "I'd appreciate it. Thank you", which closes the exchange just
// as plainly as a bare "thanks" and alerted anyway.
const PURE_ACK = /^\s*(thanks?|thank you|thx|ty|cheers|ok(ay)?|kk|got it|np|no worries|perfect|great|nice|appreciate it|will do|sounds good|\p{Emoji_Presentation}|[\u{1F44D}\u{1F64F}\u{2764}])[\s!.,)👍🙏❤️]*$/iu;
const GRATITUDE = /\b(thanks?|thank you|thx|cheers|appreciate(d| it| that)?)\b/i;

export function isAcknowledgement(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 80) return false;
  // A question is never a sign-off, whatever politeness surrounds it.
  if (/\?/.test(t)) return false;
  if (PURE_ACK.test(t)) return true;
  if (!GRATITUDE.test(t)) return false;
  // Gratitude wrapped around a complaint is still a complaint: "thanks but
  // where is my money" must not close the exchange. The sentiment rules
  // already know what a complaint looks like, so they arbitrate.
  return ruleScan([t]).score <= 0;
}

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
  quietDays = 7, unansweredHours = 12, expectedMembers = null, historyState = null,
} = {}) {
  const host = hostFor(chat);
  const lastAny = chat.lastMessageDate || chat.lastMessage?.date || null;
  const lastSenderId = chat.lastMessage?.sender?.id ?? null;

  const row = {
    chatId: chat.telegramId,
    uuid: chat.id,
    title: chat.title || chat.name || '',
    player: playerNameFromTitle(chat.title || chat.name || ''),
    host: host?.ownerName || host?.username || chat.connectedAccount?.username || null,
    hostAccount: host?.username || chat.connectedAccount?.username || null,
    hostEmail: host?.ownerEmail || null,
    hostActive: Boolean(host?.active),
    hostUnmapped: Boolean(host?.unmapped),
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
    // Three states, not two. "Not read yet" is a queue position and must never
    // be reported as "cannot be read", which is a permission fact.
    historyState: 'pending',   // pending | read | unavailable
    
    playerSeen: null,
    lastPlayerAck: null,
    leaveActionAt: null,
    leftAt: null,
    membersBelowNorm: null,
    // How long we take to answer. The VIP benchmark is a first response inside
    // five minutes, and the median of the pairs we can see is the honest
    // version of that: one slow night does not define a relationship.
    replyMedianMins: null,
    replySamples: 0,
    replyWorstMins: null,
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

    // Reply latency: every player message that a staff message answered, oldest
    // first. Only the first staff reply after a player's turn counts, so a host
    // sending four messages in a row is one response, not four.
    const chrono = [...ordered].reverse();
    const gaps = [];
    let openedAt = null;
    for (const m of chrono) {
      if (m.actionType) continue;
      if (playerMsg(m)) { if (openedAt == null) openedAt = ms(m.date); continue; }
      if (staffMsg(m) && openedAt != null) { gaps.push((ms(m.date) - openedAt) / 60000); openedAt = null; }
    }
    if (gaps.length) {
      const sorted = [...gaps].sort((a, b) => a - b);
      row.replyMedianMins = sorted[Math.floor(sorted.length / 2)];
      row.replyWorstMins = sorted[sorted.length - 1];
      row.replySamples = gaps.length;
    }
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

  row.historyState = row.historyRead ? 'read' : (historyState === 'unavailable' ? 'unavailable' : 'pending');

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
