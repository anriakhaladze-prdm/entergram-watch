// The scan. Runs every few minutes and is built to finish every time.
//
// Two modes. A full sweep pulls the whole chat list, rebuilds the book of
// player chats and refreshes the invite links; it runs about once an hour. An
// incremental tick asks the API only for chats that changed since the last
// tick, merges them into the book, and reads history for those plus a slow
// rotation through the rest so no chat's facts go stale for long.
//
// Order of operations is what keeps Slack quiet: state for an alert is saved
// the moment that alert is posted, posts are paced, the number per run is
// capped, and persistence happens whatever else went wrong. A failure is
// counted in KV and announced after a few in a row.
import { createClient } from './entergram.js';
import { isPlayerChat, isInScope, excludeReason, dedupeChats, chatMeta } from './scope.js';
import { extractFacts, normalizeMessage } from './facts.js';
import { deriveRow, summarize } from './derive.js';
import { READER_ACCOUNT_ID, useLearnedStaff, identify, isSharedSender, isBot, isThirdParty, looksStaffName } from './team.js';
import * as kv from './state.js';
import { postSlack, slackConfigured, RateLimited } from './slack.js';
import { dueAlerts, orderAlerts, formatAlert, formatOverflow, formatSeedSummary, urgentEnabled, maxAlertsPerRun } from './alerts.js';
import { ruleScan, scoreWithModel, mergeSentiment, detectProvider, NEGATIVE } from './sentiment.js';
import { ingestEvents, factsFromEvents } from './events.js';

const ms = (d) => (d ? new Date(d).getTime() : 0);
const sleep = (t) => new Promise((r) => setTimeout(r, t));
const MIN = 60000;

export const LEARN_MIN_CHATS = Number(process.env.STAFF_MIN_CHATS || 6);
// How many left-out chats the Logs page keeps. Enough to judge the rule by.
const EXCLUDED_MAX = Number(process.env.EXCLUDED_MAX || 300);
// How far the membership set may fall in one sweep before the drop is refused.
const SCOPE_SHRINK_FLOOR = Number(process.env.SCOPE_SHRINK_FLOOR || 0.9);

// Distinct player groups per unidentified sender. A player is in one group; a
// member of staff whose ids are not in the team table is in many.
export function updateTally(tally, chatId, messages) {
  const seen = new Set();
  for (const m of messages) {
    const id = m.senderId;
    if (!id || m.actionType || isBot(id) || isThirdParty(id) || isSharedSender(id) || identify(id, m.senderName)) continue;
    const e = tally[id] || (tally[id] = { n: 0, names: [], chats: [], last: null });
    if (m.senderName && !e.names.includes(m.senderName) && e.names.length < 3) e.names.push(String(m.senderName).slice(0, 40));
    if (!e.last || String(m.date) > e.last) e.last = String(m.date);
    if (seen.has(id)) continue;
    seen.add(id);
    if (e.chats.length < 12 && !e.chats.includes(chatId)) e.chats.push(chatId);
    e.n = Math.max(e.n, e.chats.length);
  }
  return tally;
}
export function learnedStaff(tally) {
  const out = new Map();
  for (const [id, e] of Object.entries(tally || {})) {
    if (e.n >= LEARN_MIN_CHATS || (e.names || []).some(looksStaffName)) out.set(String(id), e.names?.[0] || `sender ${id}`);
  }
  return out;
}

export async function runScan({
  api = createClient(),
  now = Date.now(),
  mode = 'auto',
  dryRun = false,
  log = () => {},
  quietDays = Number(process.env.QUIET_DAYS || 7),
  unansweredHours = Number(process.env.UNANSWERED_HOURS || 12),
  fullEveryMin = Number(process.env.FULL_SWEEP_MINUTES || 60),
  budgetFull = Number(process.env.HISTORY_BUDGET_FULL || 150),
  budgetIncremental = Number(process.env.HISTORY_BUDGET || 80),
  softDeadlineMs = Number(process.env.SCAN_SOFT_DEADLINE_MS || 200000),
  eventPages = Number(process.env.EVENTS_PAGES_PER_TICK || 25),
  eventBackfillDays = Number(process.env.EVENTS_BACKFILL_DAYS || 10),
  alertGapMs = 1100,
  post = postSlack,
} = {}) {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const iso = new Date(now).toISOString();
  // The scan's own clock: `now` plus time spent, so every timestamp written
  // this run is consistent with the one the rows were derived against.
  const clock = () => new Date(now + elapsed()).toISOString();
  const runId = `${iso}-${Math.random().toString(36).slice(2, 8)}`;
  const persist = kv.kvConfigured() && !dryRun;
  const opts = { now, quietDays, unansweredHours };

  if (persist && !(await kv.acquireLock(runId))) {
    log('another scan holds the lock, skipping this tick');
    return { skipped: 'locked', ms: elapsed() };
  }

  try {
    const meta = kv.kvConfigured() ? await kv.getMeta() : {};
    const prevBook = kv.kvConfigured() ? await kv.getBook() : null;
    const full = mode === 'full' || !prevBook || !meta.lastFullAt || now - ms(meta.lastFullAt) >= fullEveryMin * MIN;

    // --- the book ----------------------------------------------------------
    let bookChats, changedIds = new Set(), sweptChats = 0, excluded = null;
    // The set the shared account belongs to, from the last groups sweep. The
    // account on the chat row is the fallback, and covers private chats.
    let scopeIds = new Set(meta.scopeIds || []);
    const inScope = (c) => scopeIds.has(String(c.telegramId ?? c.chatId)) || isInScope(c);
    if (full) {
      const items = await api.workspaceChats();
      const deduped = dedupeChats(items);
      sweptChats = deduped.length;
      // Everything in the workspace that did not make the book, and why: what
      // the shared account can see but is not a player chat, and what looks
      // like a player chat but sits under somebody else's account. Newest
      // first, so the ones worth arguing about are at the top.
      const why = (c) => (inScope(c) ? excludeReason(c) : 'not in the shared account');
      excluded = deduped.filter((c) => (inScope(c) ? !isPlayerChat(c) : isPlayerChat(c)))
        .map((c) => ({ chatId: String(c.telegramId), title: c.title || c.name || '', type: c.type || null, members: c.membersCount ?? null, lastMessageAt: c.lastMessageDate || null, accounts: c.accounts || [], reason: why(c) }))
        .sort((a, b) => String(b.lastMessageAt || '').localeCompare(String(a.lastMessageAt || '')))
        .slice(0, EXCLUDED_MAX);
      const groups = await groupSweep(api, log);
      const links = groups.links;
      // Membership when the sweep answered in full, the account on the row
      // otherwise, so a failed call narrows nothing. Private chats are never in
      // the groups endpoint, so the account check always carries those.
      //
      // Most player groups reach the workspace chat feed filed under whichever
      // connected account synced them first, not under the shared account, so
      // this set is the only thing keeping them in the book. A partial sweep
      // would drop them all at once, which is why an incomplete one is merged
      // rather than adopted, and a sudden collapse is refused outright.
      if (groups.ok && groups.complete) {
        const prevSize = scopeIds.size;
        if (prevSize && groups.ids.size < prevSize * SCOPE_SHRINK_FLOOR) {
          log(`groups: scope would fall from ${prevSize} to ${groups.ids.size}, keeping the union and leaving the old scope in place`);
          scopeIds = new Set([...scopeIds, ...groups.ids]);
        } else {
          scopeIds = groups.ids;
        }
      } else if (groups.ok) {
        scopeIds = new Set([...scopeIds, ...groups.ids]);
        log(`groups: incomplete sweep, ${groups.ids.size} ids merged into the ${scopeIds.size} already known`);
      }
      const prevById = new Map((prevBook?.chats || []).map((c) => [c.chatId, c]));
      bookChats = deduped.filter((c) => isPlayerChat(c) && inScope(c)).map((c) => {
        const m = chatMeta(c);
        m.inviteLink = links.get(m.chatId) || prevById.get(m.chatId)?.inviteLink || m.inviteLink || null;
        return m;
      });
      // The workspace chat feed does not always carry every chat the account is
      // in. A chat that was in the book, is still in the shared account and
      // simply did not appear this sweep is kept on its last known facts rather
      // than dropped, and counted so the omission is visible.
      const seen = new Set(bookChats.map((c) => c.chatId));
      let carried = 0;
      for (const p of prevBook?.chats || []) {
        if (seen.has(p.chatId) || !scopeIds.has(p.chatId)) continue;
        bookChats.push({ ...p, inviteLink: links.get(p.chatId) || p.inviteLink || null });
        carried++;
      }
      // And a group the feed has never carried at all, so was never in the book
      // to be carried. Membership plus a player title is enough to book it; its
      // timing facts arrive on the first history read, which is what the
      // never-read chats at the front of the read queue are for.
      let seeded = 0;
      for (const [id, g] of groups.rows) {
        if (seen.has(id) || !scopeIds.has(id) || !isPlayerChat(g)) continue;
        bookChats.push(chatMeta({ ...g, accounts: [] }));
        seen.add(id);
        changedIds.add(id);
        seeded++;
      }
      for (const c of bookChats) { const p = prevById.get(c.chatId); if (!p || p.lastMessageAt !== c.lastMessageAt) changedIds.add(c.chatId); }
      log(`full sweep: ${items.length} entries, ${sweptChats} distinct chats, ${scopeIds.size} in the shared account, ${bookChats.length} player chats${carried ? ` (${carried} carried, absent from the feed)` : ''}${seeded ? ` (${seeded} booked from membership, never in the feed)` : ''}, ${excluded.length} left out, ${links.size} invite links`);
    } else {
      const since = new Date(ms(meta.lastTickAt || iso) - 10 * MIN).toISOString();
      const items = await api.workspaceChats({ updated_since: since });
      const deduped = dedupeChats(items);
      const byId = new Map(prevBook.chats.map((c) => [c.chatId, c]));
      let added = 0;
      for (const c of deduped.filter(isPlayerChat)) {
        const m = chatMeta(c);
        const p = byId.get(m.chatId);
        // A changed entry may arrive filed under any account, so scope is
        // judged on membership first and then on every account known to hold
        // the chat.
        if (!scopeIds.has(m.chatId) && !isInScope({ accounts: [...(p?.accounts || []), ...m.accounts] })) continue;
        if (!p) added++;
        if (!p || p.lastMessageAt !== m.lastMessageAt) changedIds.add(m.chatId);
        byId.set(m.chatId, { ...m, inviteLink: m.inviteLink || p?.inviteLink || null, accounts: [...new Set([...(p?.accounts || []), ...m.accounts])] });
      }
      bookChats = [...byId.values()];
      log(`incremental: ${deduped.length} chats changed since ${since.slice(11, 16)}Z, ${changedIds.size} player chats moved, ${added} new`);
    }
    const ids = bookChats.map((c) => c.chatId);
    const bookById = new Map(bookChats.map((c) => [c.chatId, c]));

    // --- prior state and the learned staff registry -------------------------
    const prior = kv.kvConfigured() ? await kv.getChatStates(ids) : new Map();
    const tally = kv.kvConfigured() ? await kv.getTally() : {};
    useLearnedStaff(learnedStaff(tally));

    const next = new Map();              // chatId -> new state to persist

    // --- the event stream ----------------------------------------------------
    // Who spoke when, for every chat in the book, readable or not. Followed by
    // cursor a few pages per tick; the first run starts a backfill.
    let events = { cursor: meta.eventsCursor || 0, caughtUp: Boolean(meta.eventsCaughtUp), touched: new Set(), pages: 0 };
    if (eventPages > 0) {
      try {
        const bookIds = new Set(ids);
        const states = new Map();
        events = await ingestEvents(api, { cursor: meta.eventsCursor || 0, backfillDays: eventBackfillDays, pageBudget: eventPages, bookIds, states, now, log });
        for (const [chatId, patch] of states) {
          const st = { ...(prior.get(chatId) || {}), ...(next.get(chatId) || {}), ev: patch.ev, lastMessageAt: (next.get(chatId) || prior.get(chatId))?.lastMessageAt ?? bookById.get(chatId)?.lastMessageAt ?? null };
          next.set(chatId, st);
        }
      } catch (e) {
        log(`events: ${e.message}`);
        events = { cursor: meta.eventsCursor || 0, caughtUp: Boolean(meta.eventsCaughtUp), touched: new Set(), pages: 0 };
      }
    }

    // --- which chats get a history read ------------------------------------
    // Moved chats first, never-read chats among them first of all, then the
    // rotation: whatever was read longest ago. A group the reader account
    // cannot see is retried once a day, or as soon as it moves.
    const DAY = 86400000;
    const rotationMs = Number(process.env.ROTATION_HOURS || 6) * 3600000;
    const candidates = bookChats.map((c) => {
      const st = prior.get(c.chatId) || null;
      const moved = !st?.historyAt || changedIds.has(c.chatId) || st.lastMessageAt !== c.lastMessageAt;
      const staleness = st?.historyAt ? now - ms(st.historyAt) : Infinity;
      const recentlyUnavailable = st?.historyUnavailable && staleness < DAY && !changedIds.has(c.chatId);
      // A chat that has not moved is re-read only once its facts are a few
      // hours old, so a quiet tick costs nothing beyond the chats that changed.
      const due = moved || staleness >= rotationMs;
      return { c, st, moved, neverRead: !st?.historyAt, skip: recentlyUnavailable || !due, staleness };
    }).filter((x) => !x.skip);
    candidates.sort((a, b) => (b.moved - a.moved) || (b.neverRead - a.neverRead) || (b.staleness - a.staleness));
    const budget = full ? budgetFull : budgetIncremental;
    const toRead = candidates.slice(0, budget);

    const texts = new Map();             // chatId -> { playerTexts, quote }
    let read = 0, unavailable = 0, cfReads = 0, deadlineHit = false;
    for (const { c, st } of toRead) {
      if (elapsed() > softDeadlineMs) { deadlineHit = true; break; }
      const base = { ...(next.get(c.chatId) || st || {}), lastMessageAt: c.lastMessageAt };
      try {
        const r = await api.messages(c.chatId, READER_ACCOUNT_ID, { limit: 100 });
        if (r.items.length) {
          const msgs = r.items.map(normalizeMessage);
          updateTally(tally, c.chatId, msgs);
          const { facts, window, playerTexts, playerQuote } = extractFacts(msgs, { player: c.player, now });
          Object.assign(base, { facts, historyAt: clock(), historyUnavailable: false });
          texts.set(c.chatId, { window, playerTexts, quote: playerQuote, facts });
          read++;
        } else {
          Object.assign(base, { historyAt: clock(), historyUnavailable: true });
          unavailable++;
        }
      } catch (e) {
        Object.assign(base, { historyAt: clock(), historyUnavailable: true, historyError: String(e.message).slice(0, 120) });
        unavailable++;
      }
      // Custom fields are independent of message-history access and refresh daily.
      if (!base.customAt || now - ms(base.customAt) > DAY) {
        try {
          const cf = await api.chatCustomFields(c.chatId);
          const v = cf?.data?.values || cf?.values || {};
          base.custom = {
            playerUsername: v.player_username || null,
            tier: v.tier || null,
            accountStatus: v.account_status || null,
            selfExcludedUntil: v.self_excluded_until || null,
            favouriteGames: v.favourite_games || null,
            favouriteProviders: Array.isArray(v.favourite_providers) ? v.favourite_providers : [],
            typicalBetUsd: v.typical_bet_usd ?? null,
            signupDate: v.signup_date || null,
            sportsbook: Boolean(v.sportsbook),
            originals: Boolean(v.originals),
            slots: Boolean(v.slots),
            liveCasino: Boolean(v.live_casino),
          };
          base.customAt = clock();
          cfReads++;
        } catch { /* decoration only */ }
      }
      next.set(c.chatId, base);
      await sleep(60);
    }
    useLearnedStaff(learnedStaff(tally));
    log(`history: ${read} read, ${unavailable} unavailable, ${toRead.length} attempted of ${candidates.length} due (${candidates.filter((x) => x.moved).length} moved), ${cfReads} custom-field reads${deadlineHit ? ', stopped at the time budget' : ''}`);

    // --- sentiment ----------------------------------------------------------
    // Rules on every chat with fresh player text, read from the exchange around
    // the player's last message. The model reads the same exchange for chats
    // whose player has said something new, and catches up on chats that only
    // ever got the rules, changed chats first.
    const provider = detectProvider();
    const modelCandidates = [];
    for (const [chatId, t] of texts) {
      const st = next.get(chatId);
      if (!t.playerTexts.length) continue;
      const stored = prior.get(chatId)?.sentiment;
      const unchanged = stored && stored.lastPlayerAt === t.facts.lastPlayerAt;
      if (unchanged && stored.source !== 'rules') { st.sentiment = stored; continue; }
      const rules = ruleScan(t.playerTexts);
      st.sentiment = unchanged ? stored : { ...rules, quote: t.quote, lastPlayerAt: t.facts.lastPlayerAt, scoredAt: clock() };
      modelCandidates.push({ id: chatId, window: t.window, rules, st, quote: t.quote, lastPlayerAt: t.facts.lastPlayerAt, changed: !unchanged });
    }
    if (provider && modelCandidates.length && elapsed() < softDeadlineMs) {
      const budgetS = Number(process.env.SENTIMENT_BUDGET || 40);
      const ordered = modelCandidates
        .sort((a, b) => (b.changed - a.changed) || (NEGATIVE.has(b.rules.label) - NEGATIVE.has(a.rules.label)))
        .slice(0, budgetS);
      const scored = await scoreWithModel(ordered.map(({ id, window }) => ({ id, window })));
      for (const c of ordered) {
        const m = scored.get(String(c.id));
        if (m) c.st.sentiment = { ...mergeSentiment(c.rules, m), quote: m.evidence || c.quote, lastPlayerAt: c.lastPlayerAt, scoredAt: clock() };
      }
      log(`sentiment: ${provider}, ${ordered.length} scored by the model (${modelCandidates.filter((c) => c.changed).length} changed, ${modelCandidates.filter((c) => !c.changed).length} catching up)`);
    } else if (modelCandidates.length) {
      log(`sentiment: rules only for ${modelCandidates.length} chats${provider ? '' : ' (no model key configured)'}`);
    }

    // --- derive -------------------------------------------------------------
    // Chats without readable text get their facts from the event stream. Kept
    // fresh on every tick their turns changed, and for chats whose text facts
    // exist the stream is not needed.
    const stateOf = (id) => next.get(id) || prior.get(id) || null;
    for (const c of bookChats) {
      const st = stateOf(c.chatId);
      if (!st?.ev?.turns?.length) continue;
      if (st.facts && !st.historyUnavailable) { if (st.evFacts) { const u = { ...st }; delete u.evFacts; next.set(c.chatId, u); } continue; }
      if (events.touched.has(c.chatId) || !st.evFacts) next.set(c.chatId, { ...st, evFacts: factsFromEvents(st.ev) });
    }
    const rows = bookChats.map((c) => deriveRow(c, stateOf(c.chatId), opts));
    const summary = summarize(rows);
    // Staff-shaped senders the team table does not know, for the hosts page.
    summary.unidentified = [...learnedStaff(tally).entries()]
      .map(([id, name]) => ({ id, name, chats: tally[id]?.n || 0 }))
      .sort((a, b) => b.chats - a.chats).slice(0, 20);
    summary.excludedCount = excluded ? excluded.length : null;
    log(`states: ${Object.entries(summary.counts).map(([k, v]) => `${k}=${v}`).join('  ')}`);

    // --- alerts -------------------------------------------------------------
    const seeded = Boolean(meta.seededAt);
    const urgent = urgentEnabled();
    const due = [];
    for (const r of rows) {
      const st = stateOf(r.chatId) || {};
      for (const d of dueAlerts(r, st.alerts || {}, { now, urgent, quietDays })) due.push({ ...d, row: r });
    }
    const alertLog = [];
    let posted = 0, overflow = 0, alertError = null;
    // Saved immediately when an alert has actually gone out, so a crash later
    // in the run can never cause it to be sent twice.
    const record = async (chatId, kind, extra, { persistNow = true } = {}) => {
      const st = { ...(stateOf(chatId) || { lastMessageAt: bookById.get(chatId)?.lastMessageAt || null }) };
      st.alerts = { ...(st.alerts || {}), [kind]: { at: iso, ...extra } };
      next.set(chatId, st);
      if (persist && persistNow) await kv.putChatState(chatId, st);
    };

    if (!seeded) {
      // First run: every hosted chat gets a seed record. A silence that was
      // already over the line stays on the dashboard; only silences that cross
      // the line from here on post. Posting a backlog of hundreds would bury
      // the live signal for good.
      let seededN = 0;
      for (const r of rows) {
        if (r.flags.left) continue;
        await record(r.chatId, 'no_contact', { seeded: true }, { persistNow: false });
        if (r.sentiment?.label === 'at_risk') await record(r.chatId, 'urgent', { seeded: true }, { persistNow: false });
        seededN++;
      }
      if (!dryRun && slackConfigured()) { try { await post(formatSeedSummary(summary)); } catch (e) { log(`seed summary not posted: ${e.message}`); } }
      log(`cold start: ${seededN} chats seeded, ${due.length} already over a line kept off Slack`);
    } else if (due.length) {
      const ordered = orderAlerts(due);
      const cap = maxAlertsPerRun();
      const batch = ordered.slice(0, cap);
      overflow = ordered.length - batch.length;
      for (const d of batch) {
        if (elapsed() > softDeadlineMs + 40000) { alertError = 'time budget'; break; }
        const text = formatAlert(d.kind, d.row);
        if (!dryRun) {
          try {
            const r = slackConfigured() ? await post(text) : { ts: null };
            await record(d.row.chatId, d.kind, { ts: r.ts || null });
            alertLog.push({ at: clock(), kind: d.kind, chatId: d.row.chatId, player: d.row.player, ts: r.ts || null, text });
            posted++;
            await sleep(alertGapMs);
          } catch (e) {
            alertError = e instanceof RateLimited ? 'slack rate limit, remaining alerts held for the next tick' : e.message;
            log(`alert posting stopped: ${e.message}`);
            break;
          }
        } else {
          posted++;
          alertLog.push({ at: clock(), kind: d.kind, chatId: d.row.chatId, player: d.row.player, dryRun: true, text });
        }
      }
      if (!dryRun && !alertError && overflow > 0 && slackConfigured()) { try { await post(formatOverflow(overflow)); } catch { /* next tick */ } }
      log(`alerts: ${due.length} due, ${posted} posted${overflow ? `, ${overflow} held for later ticks` : ''}${alertError ? `, stopped: ${alertError}` : ''}${dryRun ? ' (dry run, nothing sent)' : ''}`);
    } else {
      log('alerts: nothing due');
    }

    // --- persist ------------------------------------------------------------
    const tookMs = elapsed();
    const run = {
      at: iso, ms: tookMs, mode: full ? 'full' : 'incremental', ok: true,
      chats: bookChats.length, swept: sweptChats || null, changed: changedIds.size, read, unavailable, posted, due: due.length, overflow,
      eventPages: events.pages || 0, eventChats: events.touched?.size || 0, eventsCaughtUp: Boolean(events.caughtUp),
      alertError, counts: summary.counts, actionable: summary.actionable, noContact7d: summary.noContact7d, waiting: summary.waiting, unhappy: summary.unhappy,
    };
    if (persist) {
      await kv.putChatStates([...next.entries()]);
      await kv.putBook(bookChats, full ? iso : (prevBook?.builtAt || iso));
      await kv.putSnapshot({ generatedAt: iso, mode: run.mode, summary, run, rows });
      await kv.putTally(tally);
      await kv.pushAlerts(alertLog);
      await kv.putRun(run);
      await kv.putDaily({ at: iso, ...pick(summary, ['hosted', 'actionable', 'noContact7d', 'waiting', 'unhappy', 'ignored', 'contacted7d', 'contactKnown', 'replyMedianMins']), counts: summary.counts });
      await kv.putMeta({ ...meta, lastTickAt: iso, lastFullAt: full ? iso : meta.lastFullAt, seededAt: meta.seededAt || (!seeded ? iso : null), lastGoodAt: iso, eventsCursor: events.cursor || meta.eventsCursor || 0, eventsCaughtUp: Boolean(events.caughtUp), scopeIds: [...scopeIds] });
      if (excluded) await kv.putExcluded(excluded);
    }
    return { ok: true, mode: run.mode, summary, read, unavailable, posted, due: due.length, overflow, seeded, alertError, rows, ms: elapsed() };
  } finally {
    if (persist) { try { await kv.releaseLock(); } catch { /* the TTL frees it */ } }
  }
}

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

// The groups the shared account is actually a member of, plus Telegram's own
// link to each where Entergram has it. Full sweeps only: the endpoint pages
// through the workspace.
//
// Membership is the scope, and it has to come from here rather than from the
// chat list. The chat list carries one row per connected account, and which
// account owns a row is an accident of who synced it first, so a group the
// shared account sits in can arrive filed under somebody else entirely. Asking
// /v1/groups for the reader account's own membership answers the question the
// team actually asks: is this in our Entergram.
async function groupSweep(api, log, { accountId = READER_ACCOUNT_ID, pageSize = 200, maxPages = 25 } = {}) {
  const links = new Map();
  const ids = new Set();
  // The group's own description of itself, so a chat the workspace feed never
  // carries can still be booked from membership alone.
  const rows = new Map();
  // A sweep that stopped early is worse than no sweep at all: the scope it
  // returns looks valid and silently drops every chat it did not reach. So
  // completion is tracked separately from "some ids came back", and the caller
  // only replaces the scope with a sweep that walked the whole list.
  let complete = false;
  let total = null;
  try {
    for (let page = 0; page < maxPages; page++) {
      const res = await api.request('/v1/groups', { params: { limit: pageSize, offset: page * pageSize, account_id: accountId || undefined } });
      const items = res?.data?.items || [];
      for (const g of items) {
        const id = g.telegramChatId ?? g.groupId ?? g.telegramId;
        if (id == null) continue;
        ids.add(String(id));
        if (g.inviteLink) links.set(String(id), g.inviteLink);
        rows.set(String(id), {
          telegramId: String(id),
          title: g.displayName || g.title || g.name || '',
          type: g.chatType || 'group',
          membersCount: g.memberCount ?? g.participantCount ?? null,
          inviteLink: g.inviteLink || null,
        });
      }
      const pg = res?.data?.pagination;
      if (total == null && Number.isFinite(pg?.total)) total = pg.total;
      if (!pg?.hasMore || !items.length) { complete = true; break; }
    }
    // The endpoint reports how many groups the account is in. If fewer came
    // back than that, pages were lost whatever the pagination said.
    if (complete && total != null && ids.size < total) {
      log(`groups: ${ids.size} of ${total} returned, treating the sweep as incomplete`);
      complete = false;
    }
  } catch (e) { log(`groups: ${e.message}`); }
  return { links, ids, rows, ok: ids.size > 0, complete, total };
}
