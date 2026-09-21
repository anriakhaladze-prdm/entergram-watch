// Alert policy and wording.
//
// Slack carries one thing: a hosted player who has had nothing from us for
// seven days, once per silence. A silence ends when we speak, so the same
// player can alert again only after we have spoken and then gone quiet for
// another seven days. A narrow second lane posts once when a player's own
// messages signal churn. Everything else is the dashboard's job.
import { ALERT_KINDS } from './states.js';
import { humanAge } from './derive.js';

const ms = (d) => (d ? new Date(d).getTime() : 0);
const DAY = 86400000;

export const urgentEnabled = (env = process.env) => String(env.URGENT_ALERTS ?? 'on').toLowerCase() !== 'off';
export const maxAlertsPerRun = (env = process.env) => Number(env.MAX_ALERTS_PER_RUN || 15);
export const alertPolicy = (env = process.env) => ({
  // One alert per conversation per this many hours, whatever the kind.
  cooldownHours: Number(env.ALERT_COOLDOWN_HOURS || 24),
  // A silence posts only if it crossed the line within this many days, so a
  // chat first read at day 15 is dashboard-only rather than late news.
  maxLateDays: Number(env.ALERT_MAX_LATE_DAYS || 2),
  // A churn signal posts only if the player's message is this recent.
  urgentMaxAgeHours: Number(env.URGENT_MAX_AGE_HOURS || 24),
});

// Which alerts a row is due right now, given what has already been sent.
//
// Two kinds of record. One written when an alert was posted: the same player
// is due again only once we have spoken after that post and gone quiet again.
// One written at the seed, when the watch (re)started: that silence counts
// only if it began less than seven days before the seed, so a backlog that
// was already over the line never posts, and a silence that crosses the line
// after the seed does.
export function dueAlerts(row, records = {}, { now = Date.now(), urgent = true, quietDays = 7, policy = alertPolicy() } = {}) {
  const due = [];
  if (row.flags.left) return due;

  // One alert per conversation per day. Seed records do not count: nothing
  // was posted for them.
  const lastPosted = Math.max(0, ...Object.values(records).filter((r) => r && !r.seeded).map((r) => ms(r.at)));
  if (lastPosted && now - lastPosted < policy.cooldownHours * 3600000) return due;

  // Only a silence that crossed the line recently is news.
  if (row.flags.no_contact && !row.flags.barred && row.noContactDays <= quietDays + policy.maxLateDays) {
    const rec = records.no_contact;
    let rearmed;
    if (!rec) rearmed = true;
    else if (rec.seeded) rearmed = Boolean(row.lastStaffAt) && ms(row.lastStaffAt) + quietDays * DAY > ms(rec.at);
    else rearmed = Boolean(row.lastStaffAt) && ms(row.lastStaffAt) > ms(rec.at);
    if (rearmed) due.push({ kind: 'no_contact' });
  }

  // A recent churn signal that nobody has answered yet. Once we have replied
  // the case is being handled, and an old one is history, not news.
  const signalAt = ms(row.sentiment?.lastPlayerAt || row.lastPlayerAt);
  const recent = signalAt && now - signalAt <= policy.urgentMaxAgeHours * 3600000;
  if (urgent && recent && row.sentiment?.label === 'at_risk' && row.spokeLast === 'player') {
    const rec = records.urgent;
    const fresh = rec ? signalAt > ms(rec.at) : true;
    if (!rec || (fresh && now - ms(rec.at) > 7 * DAY)) due.push({ kind: 'urgent' });
  }
  return due;
}

// Urgent first, then the silences that crossed most recently: those are the
// ones a host can still do something about today.
export function orderAlerts(items) {
  const rank = { urgent: 0, no_contact: 1 };
  return [...items].sort((a, b) => (rank[a.kind] - rank[b.kind]) || ((a.row.noContactDays ?? 0) - (b.row.noContactDays ?? 0)));
}

const link = (url, label) => (url ? `<${url}|${label}>` : label);
const dashboardUrl = (env = process.env) => (env.DASHBOARD_URL || env.NEXTAUTH_URL || '').replace(/\/+$/, '');

export function formatAlert(kind, row, { env = process.env } = {}) {
  const k = ALERT_KINDS[kind];
  const who = row.playerUsername || row.player || row.title;
  const base = dashboardUrl(env);
  const lines = [];
  lines.push(`${k.dot} *${k.label}* · ${who}${row.tier ? ` · ${prettyTier(row.tier)}` : ''}`);
  const bits = [];
  if (kind === 'no_contact') {
    bits.push(row.lastStaffAt ? `we last spoke ${humanAge(row.staffQuietDays)} ago${row.lastStaffBy ? ` (${row.lastStaffBy})` : ''}` : `nothing from us in the ${row.history === 'read' ? 'readable history' : 'last message'}`);
    if (row.lastPlayerAt) bits.push(`player last spoke ${humanAge(row.playerQuietDays)} ago`);
  } else {
    bits.push(row.sentiment?.reason || 'player signalling churn');
    if (row.lastPlayerAt) bits.push(`player last spoke ${humanAge(row.playerQuietDays)} ago`);
    if (row.lastStaffAt) bits.push(`we last spoke ${humanAge(row.staffQuietDays)} ago`);
  }
  lines.push(bits.join(' · '));
  if (kind === 'urgent' && row.sentiment?.quote) lines.push(`> ${String(row.sentiment.quote).replace(/\s+/g, ' ')}`);
  const links = [];
  if (base) links.push(link(`${base}/queue?chat=${encodeURIComponent(row.chatId)}`, 'Open in dashboard'));
  if (row.inviteLink) links.push(link(row.inviteLink, 'Open in Telegram'));
  if (row.history !== 'read') links.push('_history not readable for this group, figures from the last message only_');
  if (links.length) lines.push(links.join(' · '));
  return lines.join('\n');
}

export const prettyTier = (t) => String(t || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(\d)\b/g, (d) => ['', 'I', 'II', 'III', 'IV', 'V'][Number(d)] || d);

export function formatOverflow(n, { env = process.env } = {}) {
  const base = dashboardUrl(env);
  return `${n} more player${n === 1 ? '' : 's'} crossed seven days without contact this run. ${base ? link(`${base}/queue?f=no_contact`, 'They are on the dashboard') : 'They are on the dashboard'} and will post here over the next ticks.`;
}

export function formatSeedSummary(summary, { env = process.env } = {}) {
  const base = dashboardUrl(env);
  return [
    `*Entergram watch restarted.* Watching ${summary.hosted} hosted player chats.`,
    `${summary.noContact7d} are already past seven days without contact and ${summary.waiting} are waiting on a reply. That backlog is ${base ? link(`${base}/queue`, 'on the dashboard') : 'on the dashboard'}, not here.`,
    'From now on a player posts here once when they cross seven days without contact from us, and again only after we have spoken and gone quiet again.',
  ].join('\n');
}

export function formatOutage(consecutive, lastGoodAt, lastError) {
  return [
    `🚨 *Entergram watch is failing.* ${consecutive} consecutive scans have not completed.`,
    `Last good scan: ${lastGoodAt ? new Date(lastGoodAt).toUTCString() : 'unknown'}. Last error: ${lastError || 'unknown'}.`,
    'Quiet players are not being detected until this is fixed.',
  ].join('\n');
}

export const formatRecovered = (failures) => `✅ *Entergram watch is running again* after ${failures} failed scan${failures === 1 ? '' : 's'}.`;
