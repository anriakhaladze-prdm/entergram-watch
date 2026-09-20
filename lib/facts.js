// Facts about a conversation, extracted from its message history.
//
// Facts are what a history read establishes and what gets persisted between
// scans: who spoke last and when, whether the player closed the exchange,
// whether the player has left, who hosts the player, how fast we answer. They
// carry no message text. The state a chat is in (waiting, no contact, and so
// on) is derived from facts and the clock in derive.js, so it never has to be
// re-read from the API to be recomputed.
import { identify, isStaffSender, isPlayerSender, isSharedSender, isBot, staffLabel, looksStaffName } from './team.js';
import { ruleScan, selectWindow } from './sentiment.js';

const ms = (d) => (d ? new Date(d).getTime() : 0);

// A conversation the player closed is not one waiting on a reply. Without
// this, a courteous sign-off reads as "player messaged, nobody replied"
// forever. Two shapes: a bare acknowledgement, and gratitude that is not
// wrapped around a complaint.
const PURE_ACK = /^\s*(thanks?|thank you|thank u|thx|ty|tysm|cheers|ok(ay)?|kk|got it|np|no worries|perfect|great|nice|appreciate it|will do|sounds good|gg|lol|haha+|lmao|yep|yeah|yes|\p{Emoji_Presentation}|[\u{1F44D}\u{1F64F}\u{2764}])[\s!.,)👍🙏❤️]*$/iu;
const GRATITUDE = /\b(thanks?|thank you|thx|cheers|appreciate(d| it| that)?)\b/i;

export function isAcknowledgement(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 80) return false;
  if (/\?/.test(t)) return false;
  if (PURE_ACK.test(t)) return true;
  if (!GRATITUDE.test(t)) return false;
  // "thanks but where is my money" must not close the exchange.
  return ruleScan([t]).score <= 0;
}

/* Who actually left. A chatDeleteUser says somebody was removed, not who, and
   hosts are added and removed from these groups constantly. The service text
   names the target ("Kyle | Thrill VIP removed Andre", "Someone left the
   group"), so it is read, and a departure only counts when the person who
   left is the player. */
export const LEAVE_ACTIONS = new Set(['chatDeleteUser']);
const REMOVED_BY = /^(?<actor>.+?)\s+removed\s+(?<target>.+?)\s*$/i;
const LEFT_SELF = /^(?<target>.+?)\s+left the (?:group|chat)\s*$/i;

export function departureTarget(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const m = REMOVED_BY.exec(t) || LEFT_SELF.exec(t);
  return m?.groups?.target?.trim() || null;
}

export function departureIsPlayer(target, { player, staffNames = [] }) {
  if (!target) return false;
  const t = target.toLowerCase();
  if (looksStaffName(target) || identify(null, target)) return false;
  if (staffNames.some((n) => n && n.toLowerCase() === t)) return false;
  if (player && (t.includes(String(player).toLowerCase()) || String(player).toLowerCase().includes(t))) return true;
  return false;
}

// One shape for a message whatever endpoint it came from.
export function normalizeMessage(m) {
  return {
    id: m.id ?? null,
    date: m.date,
    isOut: m.isOut === true,
    actionType: m.actionType || m.action?.type || null,
    senderId: m.sender?.id != null ? String(m.sender.id) : (m.senderId != null ? String(m.senderId) : null),
    senderName: m.sender?.name || m.sender?.displayName || m.senderName || null,
    text: m.text ? String(m.text) : '',
  };
}

const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
const percentile = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : null);

// messages: normalized, any order. Returns facts plus, separately, the
// player's recent texts for the sentiment pass. The texts are never persisted.
export function extractFacts(messages, { player = null, now = Date.now() } = {}) {
  const ordered = [...messages].sort((a, b) => ms(b.date) - ms(a.date));   // newest first
  const isStaff = (m) => !m.actionType && (m.isOut || isStaffSender(m.senderId, m.senderName));
  const isPlayer = (m) => !m.actionType && !m.isOut && isPlayerSender(m.senderId, m.senderName);

  const lastPlayer = ordered.find(isPlayer);
  const lastStaff = ordered.find(isStaff);

  const speakers = new Map();
  const unknownStaffNames = new Set();
  for (const m of ordered) {
    if (!isStaff(m) || !m.senderId) continue;
    const e = speakers.get(m.senderId) || {
      id: m.senderId, msgs: 0, last: null, name: staffLabel(m.senderId, m.senderName),
      person: identify(m.senderId, m.senderName), shared: isSharedSender(m.senderId),
    };
    e.msgs++;
    if (!e.last || ms(m.date) > ms(e.last)) e.last = m.date;
    speakers.set(m.senderId, e);
    if (!e.person && !e.shared) unknownStaffNames.add(`${m.senderId}:${m.senderName || ''}`);
  }
  const ranked = [...speakers.values()].sort((a, b) => (b.msgs - a.msgs) || (ms(b.last) - ms(a.last)));

  const staffNames = ordered.filter(isStaff).map((m) => m.senderName).filter(Boolean);
  const leaves = ordered.filter((m) => LEAVE_ACTIONS.has(m.actionType));
  const playerLeave = leaves.find((m) => departureIsPlayer(departureTarget(m.text), { player, staffNames }));

  // Reply latency: the first staff message after a player's turn, oldest first,
  // so a host sending four messages in a row is one response. A bare thank-you
  // from the player does not open a turn: nobody owes a reply to "thanks".
  const chrono = [...ordered].reverse();
  const gaps = [];
  let openedAt = null;
  for (const m of chrono) {
    if (m.actionType) continue;
    if (isPlayer(m)) { if (openedAt == null && !isAcknowledgement(m.text)) openedAt = ms(m.date); continue; }
    if (isStaff(m) && openedAt != null) { gaps.push((ms(m.date) - openedAt) / 60000); openedAt = null; }
  }

  const playerSenders = [...new Set(ordered.filter(isPlayer).map((m) => m.senderId).filter(Boolean))];
  // The exchange around the player's last message, for the sentiment pass.
  // Held in memory for this run only.
  const sided = ordered.filter((m) => !m.actionType).map((m) => ({ date: m.date, text: m.text, side: isStaff(m) ? 'staff' : isPlayer(m) ? 'player' : 'other' })).filter((m) => m.side !== 'other');
  const window = selectWindow(sided);
  const windowPlayer = window.filter((m) => m.side === 'player');

  const facts = {
    source: 'history',
    msgCount: ordered.length,
    oldestAt: ordered[ordered.length - 1]?.date || null,
    newestAt: ordered[0]?.date || null,
    lastPlayerAt: lastPlayer?.date || null,
    lastStaffAt: lastStaff?.date || null,
    lastStaffBy: lastStaff ? staffLabel(lastStaff.senderId, lastStaff.senderName) : null,
    playerSeen: Boolean(lastPlayer),
    playerSenders,
    playerName: lastPlayer?.senderName || null,
    lastPlayerAck: lastPlayer ? isAcknowledgement(lastPlayer.text) : null,
    playerLeftAt: playerLeave?.date || null,
    staffChurn: leaves.filter((m) => m !== playerLeave).map((m) => departureTarget(m.text)).filter(Boolean).slice(0, 4),
    staffSpeakers: ranked.slice(0, 6).map((s) => ({ id: s.id, name: s.name, msgs: s.msgs, last: s.last })),
    unknownStaffNames: [...unknownStaffNames].slice(0, 6),
    reply: gaps.length ? {
      medianMins: Math.round(median(gaps)), p90Mins: Math.round(percentile(gaps, 0.9)),
      worstMins: Math.round(Math.max(...gaps)), samples: gaps.length,
    } : null,
  };
  const playerTexts = [...windowPlayer].reverse().map((m) => m.text.slice(0, 400));   // newest first
  const playerQuote = (windowPlayer[windowPlayer.length - 1]?.text || '').slice(0, 140);
  return { facts, window: window.map((m) => ({ side: m.side, text: m.text.slice(0, 400), date: m.date })), playerTexts, playerQuote };
}

export { isBot };
