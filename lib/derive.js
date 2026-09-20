// From facts and the clock to the row the dashboard and the alerts read.
//
// Two views of a chat feed this, in descending order of confidence:
//   facts   what the last history read established, reused until the chat's
//           last message moves, because nothing can have changed before then
//   meta    the workspace chat list alone. It carries the last message and
//           its sender, so "who spoke last" is still answerable for every
//           chat, which matters because history is only readable for the
//           groups the reader account belongs to.
import { identify, isStaffSender, ownerOfAccount, isSharedAccount, SHARED } from './team.js';
import { DORMANT_DAYS } from './scope.js';
import { ACTIONABLE } from './states.js';

const ms = (d) => (d ? new Date(d).getTime() : null);
const daysSince = (d, now) => (d ? (now - ms(d)) / 86400000 : null);
const hoursSince = (d, now) => (d ? (now - ms(d)) / 3600000 : null);
export const humanAge = (days) => (days == null ? 'unknown' : days < 2 ? `${Math.max(1, Math.round(days * 24))}h` : `${Math.round(days)}d`);

export const NEGATIVE = new Set(['negative', 'at_risk']);

// Host for a chat whose history has never been read: the owner of a personal
// connected account, or nobody in particular for the shared one.
export function hostFromAccounts(accounts = []) {
  for (const a of accounts) {
    const person = ownerOfAccount(a);
    if (person) return { name: person.name, email: person.email, hosting: person.hosting, source: 'account owner', reason: person.reason || null };
  }
  if (accounts.some(isSharedAccount)) return { name: SHARED[0]?.displayName || 'VIP Ops', email: null, hosting: true, source: 'shared account', unattributed: true };
  if (accounts.length) return { name: accounts[0], email: null, hosting: true, source: 'account', unattributed: true };
  return null;
}

export function deriveRow(meta, state, { now = Date.now(), quietDays = 7, unansweredHours = 12 } = {}) {
  const f = state?.facts || null;
  const historyRead = Boolean(f);
  const lastAny = meta.lastMessageAt || null;

  // Who spoke last, and when each side last spoke.
  let lastPlayerAt = null, lastStaffAt = null, spokeLast = null, lastStaffBy = null, ack = null;
  if (historyRead) {
    lastPlayerAt = f.lastPlayerAt; lastStaffAt = f.lastStaffAt; lastStaffBy = f.lastStaffBy; ack = f.lastPlayerAck;
    // The chat list can be newer than the last history read: a message that
    // arrived since is attributed from its sender and pulls the right side up.
    if (lastAny && ms(lastAny) > Math.max(ms(lastPlayerAt) || 0, ms(lastStaffAt) || 0)) {
      const staff = meta.lastIsOut || isStaffSender(meta.lastSenderId, meta.lastSenderName);
      if (staff) lastStaffAt = lastAny; else { lastPlayerAt = lastAny; ack = null; }
    }
  } else if (meta.lastSenderId != null || meta.lastIsOut) {
    const staff = meta.lastIsOut || isStaffSender(meta.lastSenderId, meta.lastSenderName);
    if (staff) { lastStaffAt = lastAny; lastStaffBy = identify(meta.lastSenderId, meta.lastSenderName)?.name || meta.lastSenderName || null; }
    else lastPlayerAt = lastAny;
  }
  if (lastPlayerAt && lastStaffAt) spokeLast = ms(lastStaffAt) >= ms(lastPlayerAt) ? 'staff' : 'player';
  else if (lastStaffAt) spokeLast = 'staff';
  else if (lastPlayerAt) spokeLast = 'player';

  const host = (historyRead && f.host) || hostFromAccounts(meta.accounts) || null;
  const hostActive = host ? host.hosting !== false : true;

  const quiet = daysSince(lastAny, now);
  const playerQuiet = daysSince(lastPlayerAt, now);
  const staffQuiet = daysSince(lastStaffAt, now);
  // How long since we last spoke, as far as can be known. With history this
  // is exact, or at least the age of the oldest message read when we never
  // appear in it. Without history, a last message from the player leaves it
  // open, but a chat with no message at all for N days has certainly had none
  // from us for N days.
  let noContactDays;
  if (historyRead) noContactDays = staffQuiet ?? daysSince(f.oldestAt, now);
  else if (spokeLast === 'player' && quiet != null && quiet < quietDays) noContactDays = null;
  else noContactDays = staffQuiet ?? quiet;

  const left = historyRead && (Boolean(f.playerLeftAt) || (f.playerSeen === false && f.msgCount >= 20));
  const leftAt = left ? (f.playerLeftAt || f.newestAt || lastAny) : null;
  const sentiment = state?.sentiment || null;
  const unhappy = Boolean(sentiment && NEGATIVE.has(sentiment.label));

  const flags = {
    left,
    unhosted: !hostActive,
    dormant: quiet != null && quiet >= DORMANT_DAYS,
    waiting: spokeLast === 'player' && ack !== true && (hoursSince(lastPlayerAt, now) ?? 0) >= unansweredHours,
    no_contact: noContactDays != null && noContactDays >= quietDays,
    ignored: spokeLast === 'staff' && playerQuiet != null && playerQuiet >= quietDays && staffQuiet != null && staffQuiet < quietDays,
    unhappy,
    contacted7d: staffQuiet != null && staffQuiet < 7,
  };

  // Display precedence: one state per row, the most actionable one. The flags
  // above stay independent so a figure like "no contact 7d+" counts every
  // chat it is true for, whatever state the row shows.
  let stateKey = 'ok';
  const signals = [];
  if (flags.left) { stateKey = 'left'; signals.push(f.playerLeftAt ? 'the player left the group' : 'no message from the player anywhere in the readable history'); }
  else if (flags.unhosted) { stateKey = 'unhosted'; signals.push(host?.reason || `${host?.name || 'host'} no longer hosting`); }
  else if (flags.dormant) { stateKey = 'dormant'; signals.push(`silent ${Math.round(quiet)} days`); }
  else if (flags.waiting) { stateKey = 'waiting'; signals.push(`player wrote ${humanAge(playerQuiet)} ago, no reply${staffQuiet != null ? `, we last spoke ${humanAge(staffQuiet)} ago` : ''}`); }
  else if (flags.unhappy) { stateKey = 'unhappy'; signals.push(sentiment.reason || `sentiment ${sentiment.label}`); }
  else if (flags.no_contact) { stateKey = 'no_contact'; signals.push(`nothing from us for ${Math.round(noContactDays)} days${ack ? ', last exchange closed out by the player' : ''}${!historyRead ? ', from the last message only' : ''}`); }
  else if (flags.ignored) { stateKey = 'ignored'; signals.push(`we reached out ${humanAge(staffQuiet)} ago, player silent ${humanAge(playerQuiet)}`); }
  else if (!historyRead && spokeLast === 'player' && quiet != null && quiet < quietDays) { signals.push('player spoke last, history not readable so our reply cannot be seen'); }
  if (historyRead && f.staffChurn?.length) signals.push(`staff change: ${f.staffChurn.slice(0, 2).join(', ')} removed`);
  if (flags.unhappy && stateKey !== 'unhappy') signals.push(sentiment.reason || `sentiment ${sentiment.label}`);

  return {
    chatId: meta.chatId,
    uuid: meta.uuid || null,
    title: meta.title,
    player: meta.player || meta.title,
    playerUsername: state?.custom?.playerUsername || null,
    tier: state?.custom?.tier || null,
    host: host?.name || null,
    hostEmail: host?.email || null,
    hostSource: host?.source || 'unknown',
    hostShare: host?.share ?? null,
    hostOthers: host?.others ?? 0,
    hostUnattributed: Boolean(host?.unattributed || host?.unidentified),
    hostActive,
    accounts: meta.accounts || [],
    membersCount: meta.membersCount ?? null,
    inviteLink: meta.inviteLink || null,
    lastMessageAt: lastAny,
    lastPlayerAt, lastStaffAt, lastStaffBy, spokeLast, ack,
    quietDays: quiet, playerQuietDays: playerQuiet, staffQuietDays: staffQuiet, noContactDays,
    history: historyRead ? 'read' : (state?.historyUnavailable ? 'unavailable' : 'pending'),
    historyAt: state?.historyAt || null,
    leftAt,
    reply: historyRead ? f.reply : null,
    staffSpeakers: historyRead ? f.staffSpeakers : [],
    sentiment,
    state: stateKey,
    actionable: ACTIONABLE.includes(stateKey),
    flags,
    signals,
    alerts: state?.alerts || {},
  };
}

// Aggregates for the overview and the hosts page. Shared with the browser via
// the snapshot, so the same figures appear on every page.
export function summarize(rows) {
  const hosted = rows.filter((r) => !r.flags.left && !r.flags.unhosted);
  const known = hosted.filter((r) => r.staffQuietDays != null);
  const replies = hosted.map((r) => r.reply?.medianMins).filter((v) => v != null);
  const sorted = [...replies].sort((a, b) => a - b);
  const counts = {};
  for (const r of rows) counts[r.state] = (counts[r.state] || 0) + 1;
  const waiting = hosted.filter((r) => r.flags.waiting);
  return {
    total: rows.length,
    hosted: hosted.length,
    counts,
    actionable: hosted.filter((r) => r.actionable).length,
    contacted7d: hosted.filter((r) => r.flags.contacted7d).length,
    contactKnown: known.length,
    noContact7d: hosted.filter((r) => r.flags.no_contact && !r.flags.dormant).length,
    waiting: waiting.length,
    waitingOldestDays: waiting.length ? Math.max(...waiting.map((r) => r.playerQuietDays || 0)) : null,
    unhappy: hosted.filter((r) => r.flags.unhappy).length,
    ignored: hosted.filter((r) => r.flags.ignored).length,
    dormant: hosted.filter((r) => r.flags.dormant).length,
    left: rows.filter((r) => r.flags.left).length,
    unhosted: rows.filter((r) => r.flags.unhosted).length,
    historyRead: rows.filter((r) => r.history === 'read').length,
    historyUnavailable: rows.filter((r) => r.history === 'unavailable').length,
    historyPending: rows.filter((r) => r.history === 'pending').length,
    replyMedianMins: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    replyP90Mins: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] : null,
    replyMeasured: sorted.length,
  };
}
