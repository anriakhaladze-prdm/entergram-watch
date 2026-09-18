import { humanAge as d } from './analyze.js';

// Alert text. One message per player, because a host acts on one player at a
// time and a digest of forty names gets skimmed and dropped.
const DOT = { at_risk: '🔴', waiting_on_us: '🟠', quiet: '🟡', outreach_ignored: '🟤', player_left: '⚪' };
const HEAD = {
  at_risk: 'Player unhappy',
  waiting_on_us: 'Unanswered',
  quiet: 'Gone quiet',
  outreach_ignored: 'Not responding to outreach',
  player_left: 'Left the group',
};


export function formatAlert(row, { tier = null, playerUsername = null } = {}) {
  const lines = [];
  const who = playerUsername || row.player || row.title;
  lines.push(`${DOT[row.state] || '•'} *${HEAD[row.state] || row.state}* · ${who}${tier ? ` · ${tier}` : ''}`);
  lines.push(`Host: ${row.host || 'unassigned'}   Chat: ${row.title}`);

  if (row.state === 'player_left') {
    lines.push(`No player left in the group. ${row.membersCount} members, last activity ${d(row.quietDays)} ago.`);
  } else {
    const parts = [];
    if (row.lastPlayerAt) parts.push(`player last spoke ${d(row.playerQuietDays)} ago`);
    else if (row.historyRead) parts.push('no player message on record');
    if (row.lastStaffAt) parts.push(`we last spoke ${d(row.staffQuietDays)} ago`);
    lines.push(parts.join(', ') || `silent ${d(row.quietDays)}`);
  }
  const s = row.sentiment;
  if (s && s.label && s.label !== 'neutral') {
    const why = s.reason || (s.flags?.length ? s.flags.join(', ') : null);
    lines.push(`Sentiment: ${s.label}${why ? ` (${why})` : ''} · read from the player's messages only`);
    if (s.quote) lines.push(`> ${s.quote.replace(/\s+/g, ' ')}`);
  }
  if (row.historyState === 'unavailable') {
    lines.push('_Message history is not readable for this chat, so these figures come from the last message only._');
  }
  return lines.join('\n');
}

export function formatSeedSummary(counts, total) {
  return [
    `*Entergram outreach watch is live.* Watching ${total} hosted player chats.`,
    'Baseline seeded, so the existing backlog is not being posted here. It is all on the dashboard.',
    '',
    `Waiting on us: ${counts.waiting_on_us || 0}`,
    `Gone quiet: ${counts.quiet || 0}`,
    `Not responding to outreach: ${counts.outreach_ignored || 0}`,
    `Player left the group: ${counts.player_left || 0}`,
    `Unhosted (Byron's old chats): ${counts.unhosted || 0}`,
    `Dormant 90d+: ${counts.dormant || 0}`,
    '',
    'From here you only get a message when a player newly crosses one of these.',
  ].join('\n');
}

export function formatOutage(consecutive, lastGood) {
  return [
    `🚨 *Entergram outreach watch is not running.* ${consecutive} consecutive failed scans.`,
    `Last good scan: ${lastGood || 'unknown'}.`,
    'Quiet players are NOT being detected right now.',
  ].join('\n');
}
