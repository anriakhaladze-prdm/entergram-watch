// From facts and the clock to the row the dashboard and the alerts read.
//
// Three sources feed this, in descending order of confidence:
//   facts    what the last history read established, reused until the chat's
//            last message moves, because nothing can have changed before then
//   evFacts  the same timing facts from the workspace event stream, for groups
//            whose text cannot be read
//   meta     the workspace chat list alone, which still says who spoke last
//
// Nobody owns a chat: the team answers whoever is on shift, so there is no host
// here, only the staff who have replied.
import { identify, isStaffSender, isThirdParty } from './team.js';
import { BARRED_DAYS } from './scope.js';
import { ACTIONABLE } from './states.js';

const ms = (d) => (d ? new Date(d).getTime() : null);
const daysSince = (d, now) => (d ? (now - ms(d)) / 86400000 : null);
const hoursSince = (d, now) => (d ? (now - ms(d)) / 3600000 : null);
export const humanAge = (days) => (days == null ? 'unknown' : days < 2 ? `${Math.max(1, Math.round(days * 24))}h` : `${Math.round(days)}d`);

export const NEGATIVE = new Set(['negative', 'at_risk']);
export const UNHAPPY_MAX_AGE_DAYS = Number(process.env.UNHAPPY_MAX_AGE_DAYS || 7);

export function deriveRow(meta, state, { now = Date.now(), quietDays = 7, unansweredHours = 12 } = {}) {
  const f = state?.facts || state?.evFacts || null;
  const historyRead = Boolean(f);
  const fromText = f?.source !== 'events';
  const lastAny = meta.lastMessageAt || null;

  // Who spoke last, and when each side last spoke.
  let lastPlayerAt = null, lastStaffAt = null, spokeLast = null, lastStaffBy = null, ack = null;
  if (historyRead) {
    lastPlayerAt = f.lastPlayerAt; lastStaffAt = f.lastStaffAt; lastStaffBy = f.lastStaffBy; ack = f.lastPlayerAck;
    // The chat list can be newer than the last read: a message that arrived
    // since is attributed from its sender and pulls the right side up.
    if (lastAny && ms(lastAny) > Math.max(ms(lastPlayerAt) || 0, ms(lastStaffAt) || 0) && !isThirdParty(meta.lastSenderId)) {
      const staff = meta.lastIsOut || isStaffSender(meta.lastSenderId, meta.lastSenderName);
      if (staff) lastStaffAt = lastAny; else { lastPlayerAt = lastAny; ack = null; }
    }
  } else if ((meta.lastSenderId != null || meta.lastIsOut) && !isThirdParty(meta.lastSenderId)) {
    const staff = meta.lastIsOut || isStaffSender(meta.lastSenderId, meta.lastSenderName);
    if (staff) { lastStaffAt = lastAny; lastStaffBy = identify(meta.lastSenderId, meta.lastSenderName)?.name || meta.lastSenderName || null; }
    else lastPlayerAt = lastAny;
  }
  if (lastPlayerAt && lastStaffAt) spokeLast = ms(lastStaffAt) >= ms(lastPlayerAt) ? 'staff' : 'player';
  else if (lastStaffAt) spokeLast = 'staff';
  else if (lastPlayerAt) spokeLast = 'player';

  const quiet = daysSince(lastAny, now);
  const playerQuiet = daysSince(lastPlayerAt, now);
  const staffQuiet = daysSince(lastStaffAt, now);
  // How long since we last spoke, as far as can be known. With facts this is
  // exact, or at least the age of the oldest turn read when we never appear.
  // Without them, a last message from the player leaves it open, but a chat
  // with no message at all for N days has certainly had none from us for N.
  let noContactDays;
  if (historyRead) noContactDays = staffQuiet ?? daysSince(f.oldestAt, now);
  else if (spokeLast === 'player' && quiet != null && quiet < quietDays) noContactDays = null;
  else noContactDays = staffQuiet ?? quiet;

  const left = historyRead && fromText && (Boolean(f.playerLeftAt) || (f.playerSeen === false && f.msgCount >= 20));
  const leftAt = left ? (f.playerLeftAt || f.newestAt || lastAny) : null;
  const sentiment = state?.sentiment || null;
  // Unhappy is a current state, so it needs a recent player message behind it.
  const sentimentAge = daysSince(sentiment?.lastPlayerAt || lastPlayerAt, now);
  const unhappy = Boolean(sentiment && NEGATIVE.has(sentiment.label) && (sentimentAge == null || sentimentAge <= UNHAPPY_MAX_AGE_DAYS));

  const flags = {
    left,
    barred: quiet != null && quiet >= BARRED_DAYS,
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
  if (flags.left) { stateKey = 'left'; signals.push(f.playerLeftAt ? 'the player left the group' : 'no message from the player'); }
  else if (flags.barred) { stateKey = 'barred'; signals.push(`no message either way for ${Math.round(quiet)} days`); }
  else if (flags.waiting) { stateKey = 'waiting'; signals.push(`player wrote ${humanAge(playerQuiet)} ago, no reply${staffQuiet != null ? `, we last spoke ${humanAge(staffQuiet)} ago` : ''}`); }
  else if (flags.unhappy) { stateKey = 'unhappy'; signals.push(sentiment.reason || (sentiment.label === 'at_risk' ? 'at risk' : 'unhappy')); }
  else if (flags.no_contact) { stateKey = 'no_contact'; signals.push(`nothing from us for ${Math.round(noContactDays)} days${ack ? ', last exchange closed by the player' : ''}`); }
  else if (flags.ignored) { stateKey = 'ignored'; signals.push(`we reached out ${humanAge(staffQuiet)} ago, player silent ${humanAge(playerQuiet)}`); }
  else if (!historyRead && spokeLast === 'player' && quiet != null && quiet < quietDays) { signals.push(`player spoke last, ${humanAge(playerQuiet)} ago`); }
  if (historyRead && f.staffChurn?.length) signals.push(`staff change: ${f.staffChurn.slice(0, 2).join(', ')} removed`);
  if (flags.unhappy && stateKey !== 'unhappy') signals.push(sentiment.reason || (sentiment.label === 'at_risk' ? 'at risk' : 'unhappy'));

  return {
    chatId: meta.chatId,
    uuid: meta.uuid || null,
    title: meta.title,
    player: meta.player || meta.title,
    playerUsername: state?.custom?.playerUsername || null,
    tier: state?.custom?.tier || null,
    accounts: meta.accounts || [],
    membersCount: meta.membersCount ?? null,
    inviteLink: meta.inviteLink || null,
    lastMessageAt: lastAny,
    lastPlayerAt, lastStaffAt, lastStaffBy, spokeLast, ack,
    quietDays: quiet, playerQuietDays: playerQuiet, staffQuietDays: staffQuiet, noContactDays,
    history: historyRead ? (fromText ? 'read' : 'events') : (state?.historyUnavailable ? 'unavailable' : 'pending'),
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

// Aggregates for the overview. hosted: the player is still in the group.
// active: hosted and not time-barred, the set every working figure is over.
export function summarize(rows) {
  const hosted = rows.filter((r) => !r.flags.left);
  const active = hosted.filter((r) => !r.flags.barred);
  const known = active.filter((r) => r.staffQuietDays != null);
  const replies = active.map((r) => r.reply?.medianMins).filter((v) => v != null);
  const sorted = [...replies].sort((a, b) => a - b);
  const counts = {};
  for (const r of rows) counts[r.state] = (counts[r.state] || 0) + 1;
  const waiting = active.filter((r) => r.flags.waiting);
  return {
    total: rows.length,
    hosted: hosted.length,
    active: active.length,
    counts,
    actionable: active.filter((r) => r.actionable).length,
    contacted7d: active.filter((r) => r.flags.contacted7d).length,
    contactKnown: known.length,
    noContact7d: active.filter((r) => r.flags.no_contact).length,
    waiting: waiting.length,
    waitingOldestDays: waiting.length ? Math.max(...waiting.map((r) => r.playerQuietDays || 0)) : null,
    unhappy: active.filter((r) => r.flags.unhappy).length,
    ignored: active.filter((r) => r.flags.ignored).length,
    barred: hosted.filter((r) => r.flags.barred).length,
    left: rows.filter((r) => r.flags.left).length,
    historyRead: rows.filter((r) => r.history === 'read').length,
    historyEvents: rows.filter((r) => r.history === 'events').length,
    historyUnavailable: rows.filter((r) => r.history === 'unavailable').length,
    historyPending: rows.filter((r) => r.history === 'pending').length,
    replyMedianMins: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    replyP90Mins: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] : null,
    replyMeasured: sorted.length,
  };
}
