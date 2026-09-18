// The scan. One pass over every hosted player chat, history for as many as the
// budget allows, then alerts for anything that newly crossed a line.
//
// Cost control: the chat sweep is ~7 calls for 3548 chats. History is one call
// per chat and there are 1248 of them, so it is budgeted per run and skipped
// entirely for chats whose last message has not moved since we last read them,
// because nothing can have changed. Coverage therefore builds up over the
// first few hours and then stays current for the price of the chats that
// actually moved.
import { createClient } from './entergram.js';
import { isPlayerChat, hostFor, useRoster, READER_ACCOUNT_ID } from './scope.js';
import { buildRoster, rosterIndex } from './roster.js';
import { analyzeChat, ALERTABLE } from './analyze.js';
import { looksStaff } from './staff.js';
import { getChatStates, putChatStates, isSeeded, markSeeded, putSnapshot, putRunLog, putDaily, kvConfigured } from './state.js';
import { postSlack } from './slack.js';
import { formatAlert, formatSeedSummary } from './format.js';
import { ruleScan, scoreWithModel, mergeSentiment, detectProvider, NEGATIVE } from './sentiment.js';

const ESCALATION_TIERS = [7, 30, 90];
const tierFor = (days) => ESCALATION_TIERS.filter((t) => days >= t).pop() ?? null;

const looksStaffMsg = (m) => looksStaff(m.senderId, m.senderName) || m.isOut === true;

function modeOf(nums) {
  const m = new Map();
  for (const n of nums) if (n != null) m.set(n, (m.get(n) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export async function runScan({
  api = createClient(),
  now = Date.now(),
  quietDays = Number(process.env.QUIET_DAYS || 7),
  unansweredHours = Number(process.env.UNANSWERED_HOURS || 12),
  // 250 reads at roughly 300ms each is about 75 seconds, inside the 300s
  // function limit, and covers 1248 chats in five runs rather than nine.
  historyBudget = Number(process.env.HISTORY_BUDGET || 250),
  dryRun = false,
  log = console.log,
} = {}) {
  const started = Date.now();

  // Who owns which account, derived from the API rather than a file in the
  // repo, so a new host is picked up without a deploy.
  let roster = null;
  try {
    roster = await buildRoster(api);
    useRoster(rosterIndex(roster));
    const mapped = roster.accounts.filter((a) => a.ownerName).length;
    log(`roster: ${roster.accounts.length} connected accounts, ${mapped} mapped to a person, ${roster.members.length} workspace members`);
  } catch (e) {
    log(`roster: could not build (${e.message}), falling back to the accounts named on the chats`);
  }

  const chats = await api.workspaceChats();
  const players = chats.filter(isPlayerChat);
  const hosted = players.filter((c) => hostFor(c)?.active === true);
  const expectedMembers = modeOf(hosted.map((c) => c.membersCount));
  log(`swept ${chats.length} chats, ${players.length} player chats, ${hosted.length} hosted, member norm ${expectedMembers}`);

  const ids = players.map((c) => c.telegramId);
  const prior = kvConfigured() ? await getChatStates(ids) : new Map();

  // Who gets a history read this run.
  //
  // A chat that has not moved since it was last read cannot have changed, so
  // it is skipped and its stored timestamps are reused. Of the rest, the ones
  // that a first pass says are ALREADY over a threshold go first, because
  // those are the chats about to be alerted on and an alert must never be
  // raised on the weaker view: without message text the acknowledgement rule
  // cannot run, and a player who signed off with "thanks" reads as one who is
  // waiting for a reply. That was a real false positive, not a hypothetical.
  const firstPass = new Map(
    hosted.map((c) => [c.telegramId, analyzeChat(c, { now, quietDays, unansweredHours, expectedMembers })]),
  );
  const needsHistory = hosted
    .map((c) => {
      const st = prior.get(c.telegramId);
      const moved = !st?.historyAt || st.lastMessageAt !== (c.lastMessageDate || null);
      const neverRead = !st?.historyAt;
      const wouldAlert = ALERTABLE.has(firstPass.get(c.telegramId)?.state);
      return {
        chat: c, moved, neverRead, wouldAlert,
        staleness: st?.historyAt ? now - new Date(st.historyAt).getTime() : Infinity,
      };
    })
    .filter((x) => x.moved || x.neverRead)
    .sort((a, b) => (b.wouldAlert - a.wouldAlert) || (b.staleness - a.staleness))
    .slice(0, historyBudget);

  const history = new Map();
  const unavailable = new Set();
  let read = 0, denied = 0;
  for (const { chat } of needsHistory) {
    try {
      const r = await api.messages(chat.telegramId, READER_ACCOUNT_ID, { limit: 100 });
      if (r.items.length) {
        // `text` is held in memory for the sentiment pass and never persisted:
        // only the resulting label and reason reach KV or the snapshot.
        history.set(chat.telegramId, r.items.map((m) => ({
          date: m.date, isOut: m.isOut, actionType: m.actionType || null,
          senderId: m.sender?.id || null, senderName: m.sender?.name || null,
          text: m.text ? String(m.text).slice(0, 400) : '',
        })));
        read++;
      } else { denied++; unavailable.add(chat.telegramId); }
    } catch { denied++; unavailable.add(chat.telegramId); }
    await new Promise((r) => setTimeout(r, 80));
  }
  log(`history: ${read} read, ${denied} unavailable, ${needsHistory.length} attempted of ${hosted.length} hosted`);

  // Analyze. Where no fresh history was read, fall back to what we stored last
  // time rather than dropping to the weaker view.
  const links = roster?.links || {};
  const rows = [];
  for (const chat of players) {
    const st = prior.get(chat.telegramId);
    const msgs = history.get(chat.telegramId) || null;
    const unchanged = st?.historyAt && st.lastMessageAt === (chat.lastMessageDate || null);
    rows.push(analyzeChat(chat, {
      messages: msgs,
      cached: !msgs && unchanged ? st : null,
      now, quietDays, unansweredHours, expectedMembers,
      historyState: unavailable.has(chat.telegramId) || st?.historyUnavailable ? 'unavailable' : 'pending',
    }));
    const row = rows[rows.length - 1];
    row.inviteLink = links[String(chat.telegramId)] || null;
  }

  // --- sentiment ----------------------------------------------------------
  // Rules run on everything we have fresh text for. The model only sees chats
  // whose player has said something new since we last scored them, so a quiet
  // week costs nothing.
  const provider = detectProvider();
  const candidates = [];
  for (const r of rows) {
    const msgs = history.get(r.chatId);
    if (!msgs) { r.sentiment = prior.get(r.chatId)?.sentiment || null; continue; }
    const texts = msgs.filter((m) => !m.actionType && m.text && !looksStaffMsg(m)).map((m) => m.text);
    if (!texts.length) { r.sentiment = prior.get(r.chatId)?.sentiment || null; continue; }
    const stored = prior.get(r.chatId)?.sentiment;
    if (stored && stored.lastPlayerAt === r.lastPlayerAt) { r.sentiment = stored; continue; }
    const rules = ruleScan(texts);
    r.sentiment = { ...rules, lastPlayerAt: r.lastPlayerAt, scoredAt: new Date(now).toISOString() };
    candidates.push({ id: r.chatId, texts, row: r, rules });
  }

  if (provider && candidates.length) {
    const budget = Number(process.env.SENTIMENT_BUDGET || 40);
    // Anything the rules already flagged, and anything already alertable, goes
    // to the model first: those are the rows a human will read today.
    const ordered = candidates.sort((a, b) =>
      (NEGATIVE.has(b.rules.label) - NEGATIVE.has(a.rules.label)) ||
      (ALERTABLE.has(b.row.state) - ALERTABLE.has(a.row.state)) ||
      ((b.row.quietDays ?? 0) - (a.row.quietDays ?? 0))).slice(0, budget);
    const scored = await scoreWithModel(ordered.map(({ id, texts }) => ({ id, texts })));
    for (const c of ordered) {
      const m = scored.get(String(c.id));
      if (m) c.row.sentiment = { ...mergeSentiment(c.rules, m), lastPlayerAt: c.row.lastPlayerAt, scoredAt: new Date(now).toISOString() };
    }
    log(`sentiment: ${provider}, ${ordered.length} scored of ${candidates.length} changed`);
  } else if (candidates.length) {
    log(`sentiment: rules only, ${candidates.length} rescored (no model key configured)`);
  }

  // An unhappy player who is otherwise in contact would never surface on
  // silence alone, so a negative read promotes an ok row to its own state.
  for (const r of rows) {
    if (r.state === 'ok' && r.hostActive && r.sentiment && NEGATIVE.has(r.sentiment.label)) {
      r.state = 'at_risk';
      r.signals.push(r.sentiment.reason || `player sentiment ${r.sentiment.label}${r.sentiment.flags?.length ? ` (${r.sentiment.flags.join(', ')})` : ''}`);
    }
  }

  const counts = {};
  for (const r of rows) counts[r.state] = (counts[r.state] || 0) + 1;
  log(`states: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  ')}`);

  // --- alerts -------------------------------------------------------------
  const seeded = kvConfigured() ? await isSeeded() : true;
  const toAlert = [];
  let heldForHistory = 0;
  for (const r of rows) {
    if (!ALERTABLE.has(r.state) || !r.hostActive) continue;
    // Never alert on the last-message-only view. It carries no text, so the
    // acknowledgement rule cannot run and "player said thanks" is
    // indistinguishable from "player asked a question and got nothing".
    // The chat stays in the queue and alerts on the run that reads it.
    if (r.historyState === 'pending') { heldForHistory++; continue; }
    const st = prior.get(r.chatId) || {};
    const tier = tierFor(r.quietDays ?? 0);
    const fresh = st.alertedState !== r.state || (tier != null && tier !== st.alertedTier);
    if (fresh) toAlert.push({ row: r, tier });
  }

  let posted = 0;
  if (!seeded) {
    log(`cold start: ${toAlert.length} chats already over a threshold, seeding instead of posting`);
    if (!dryRun) {
      await postSlack(formatSeedSummary(counts, hosted.length));
      await markSeeded();
    }
  } else {
    for (const { row, tier } of toAlert) {
      let meta = {};
      try {
        const cf = await api.chatCustomFields(row.chatId);
        meta = { playerUsername: cf?.data?.values?.player_username || null, tier: cf?.data?.values?.tier || null };
      } catch { /* custom fields are decoration, never a reason to hold an alert */ }
      if (!dryRun) await postSlack(formatAlert(row, meta));
      posted++;
    }
    log(`alerts: ${posted} posted${dryRun ? ' (dry run, nothing sent)' : ''}${heldForHistory ? `, ${heldForHistory} held until their history is read` : ''}`);
  }

  // --- persist ------------------------------------------------------------
  if (kvConfigured() && !dryRun) {
    const alerted = new Map(toAlert.map(({ row, tier }) => [row.chatId, tier]));
    await putChatStates(rows.map((r) => [r.chatId, {
      lastMessageAt: r.lastMessageAt, membersCount: r.membersCount,
      lastPlayerAt: r.lastPlayerAt, lastStaffAt: r.lastStaffAt, playerSeen: r.playerSeen,
      lastPlayerAck: r.lastPlayerAck,
      sentiment: r.sentiment || null,
      leaveActionAt: r.leaveActionAt || null,
      historyAt: history.has(r.chatId) ? new Date(now).toISOString() : (prior.get(r.chatId)?.historyAt || null),
      historyUnavailable: unavailable.has(r.chatId) ? true : (prior.get(r.chatId)?.historyUnavailable || false),
      alertedState: seeded && alerted.has(r.chatId) ? r.state : (prior.get(r.chatId)?.alertedState ?? (seeded ? null : r.state)),
      alertedTier: seeded && alerted.has(r.chatId) ? alerted.get(r.chatId) : (prior.get(r.chatId)?.alertedTier ?? (seeded ? null : tierFor(r.quietDays ?? 0))),
    }]));
    await putSnapshot({ generatedAt: new Date(now).toISOString(), counts, expectedMembers, rows, roster });
    const entry = { at: new Date(now).toISOString(), ms: Date.now() - started, chats: players.length, read, denied, posted, counts };
    await putRunLog(entry);
    await putDaily(entry);
  }

  return {
    total: players.length, hosted: hosted.length, counts, read, denied, posted, seeded, rows,
    heldForHistory, pending: rows.filter((r) => r.historyState === 'pending').length,
    ms: Date.now() - started,
  };
}
