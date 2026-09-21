// Regression tests for the rules that decide whether a human gets pinged, and
// for the scan itself, run end to end against in-memory doubles.
import { isPlayerChat, playerNameFromTitle, excludeReason, dedupeChats, chatMeta, isInScope, SCOPE_ACCOUNTS } from '../lib/scope.js';
import { extractFacts, normalizeMessage, isAcknowledgement, departureTarget, departureIsPlayer, joinTarget } from '../lib/facts.js';
import { deriveRow, summarize } from '../lib/derive.js';
import { dueAlerts, orderAlerts, formatAlert, prettyTier } from '../lib/alerts.js';
import { identify, isStaffSender, ownerOfAccount, useLearnedStaff } from '../lib/team.js';
import { ruleScan, detectProvider, selectWindow, describeFlags } from '../lib/sentiment.js';
import { postSlack, postSequence, RateLimited } from '../lib/slack.js';
import { runScan, updateTally, learnedStaff } from '../lib/scan.js';
import * as kv from '../lib/state.js';
import { fakeUpstash, fakeEntergram, fakeSlack } from './fakes.js';
import { applyEvent, emptyEv, factsFromEvents, ingestEvents } from '../lib/events.js';
import { parseFilters, matchRow, activeCount, filterLabel, queueHref } from '../components/filters.js';
import { isMonitor, onDomain, describeUa, clientIp, parseEmails } from '../lib/access.js';
import { emailBlocked, emailAllowed, sessionRevoked, forget, __reset as resetGate } from '../lib/gate.js';
import { buildAuthOptions } from '../lib/auth.js';

const NEGATIVE_LABELS = new Set(['negative', 'at_risk']);
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; } catch (e) { fail++; console.error(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') || e.message}`); } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, m = '') => { if (!v) throw new Error(`${m} expected truthy, got ${JSON.stringify(v)}`); };

const NOW = Date.parse('2026-09-21T00:00:00Z');
const ago = (days) => new Date(NOW - days * 86400000).toISOString();
const COLTON = '8268223773', KYLE = '7973277038', PRIEST = '8120203444', SHARED = '8797108490', PLAYER = '1352398121', ANDY = '5278034304';

const chat = (over = {}) => ({
  id: 'uuid-1', telegramId: '-5000000001', title: 'testplayer x Thrill.com', type: 'group', membersCount: 8,
  connectedAccount: { id: 'acct-vipops', username: 'Thrill_VIP_Ops' },
  lastMessageDate: ago(1), lastMessage: { date: ago(1), isOut: false, sender: { id: PLAYER, displayName: null } }, ...over,
});
const msg = (days, senderId, over = {}) => normalizeMessage({ id: Math.floor(Math.random() * 1e6), date: ago(days), isOut: false, sender: { id: senderId, name: senderId === COLTON ? 'Colton | Thrill VIP' : senderId === PLAYER ? '#' : null }, text: 'hello there friend', ...over });
const derive = (c, facts, extra = {}) => deriveRow(chatMeta({ ...c, accounts: [c.connectedAccount.username] }), facts ? { facts, ...extra } : (Object.keys(extra).length ? extra : null), { now: NOW, quietDays: 7, unansweredHours: 12 });
const factsOf = (msgs, player = 'testplayer') => extractFacts(msgs, { player, now: NOW }).facts;

// --- scope -------------------------------------------------------------------
await t('player chats are recognised in both title orderings', () => {
  eq(isPlayerChat(chat({ title: 'swish718 x Thrill.com' })), true);
  eq(isPlayerChat(chat({ title: 'Thrill.com x Shrimpmoneyy VIP' })), true);
});
await t('only groups the shared account sits in are in scope', () => {
  ok(SCOPE_ACCOUNTS.has('thrill_vip_ops'), 'the shared account from the team table');
  const items = [
    chat({ id: 'a', telegramId: '-1', connectedAccount: { id: 'x', username: 'byronthrill' } }),
    chat({ id: 'b', telegramId: '-2', connectedAccount: { id: 'x', username: 'byronthrill' } }),
    chat({ id: 'c', telegramId: '-2', connectedAccount: { id: 'v', username: 'Thrill_VIP_Ops' } }),
  ];
  const d = dedupeChats(items);
  eq(d.filter(isInScope).map((c) => c.telegramId).join(), '-2', 'a group only a personal account knows is not in Entergram for the team');
  eq(isInScope({ accounts: ['thrill_vip_ops'] }), true, 'case does not matter');
});
await t('affiliate and partnership rooms and big communities are not player chats', () => {
  eq(isPlayerChat(chat({ title: '(AFF) ID 80281 x BCGAME' })), false);
  eq(isPlayerChat(chat({ title: 'Thrill <> Nbavipbox Partnership (85029)' })), false);
  eq(isPlayerChat(chat({ title: 'BetBodya x Thrill', membersCount: 5989 })), false);
});
await t('player name is extracted from every spelling the groups use', () => {
  eq(playerNameFromTitle('swish718 x Thrill.com'), 'swish718'); eq(playerNameFromTitle('Thrill.com x Shrimpmoneyy VIP'), 'Shrimpmoneyy');
  eq(playerNameFromTitle('doineedaname | Thrill VIP'), 'doineedaname'); eq(playerNameFromTitle('Foldpisty - Thrill'), 'Foldpisty');
  eq(playerNameFromTitle('WhyRUgey- Thrill.com'), 'WhyRUgey'); eq(playerNameFromTitle('Hartigan420 x thri.com'), 'Hartigan420');
  eq(playerNameFromTitle('Eco27 thrill / VIp group / HighPriest'), 'Eco27'); eq(playerNameFromTitle('streamer Bob x Thrill'), 'Bob');
  eq(playerNameFromTitle('Thrill Community Chat'), null); eq(playerNameFromTitle('Vip host test'), null);
});
await t('a player writing to the shared account directly is a chat; service, vendor and staff chats are not', () => {
  eq(excludeReason({ type: 'private', title: 'Icesol' }), null);
  eq(excludeReason({ type: 'private', title: 'Telegram' }), 'service chat');
  eq(excludeReason({ type: 'private', title: 'Denis | entergram.com Entergram' }), 'service chat');
  eq(excludeReason({ type: 'private', title: 'Andy | Thrill FK' }), 'staff chat');
  eq(excludeReason({ type: 'group', title: 'VIP Support Test', membersCount: 4 }), 'no player in the title');
  eq(excludeReason({ type: 'group', title: 'BetBodya x Thrill', membersCount: 5989 }), '5989 members');
  eq(chatMeta({ telegramId: '-1', type: 'private', title: 'Icesol', connectedAccount: { username: 'Thrill_VIP_Ops' } }).player, 'Icesol');
});
await t('the same Telegram group listed under two accounts collapses to one chat with both accounts', () => {
  const a = chat({ id: 'u1', connectedAccount: { id: 'a1', username: 'Thrill_VIP_Ops' }, lastMessageDate: ago(2) });
  const b = chat({ id: 'u2', connectedAccount: { id: 'a2', username: 'mikeythrillaffiliate' }, lastMessageDate: ago(1), lastMessage: { date: ago(1), isOut: false, sender: { id: COLTON } } });
  const d = dedupeChats([a, b]);
  eq(d.length, 1);
  eq(d[0].accounts.join(','), 'Thrill_VIP_Ops,mikeythrillaffiliate');
  eq(d[0].lastMessageDate, ago(1), 'newest last message wins');
  eq(d[0].lastMessage.sender.id, COLTON);
});

// --- team -------------------------------------------------------------------
await t('senders resolve by id, by exact name and by the naming convention', () => {
  eq(identify(COLTON).name, 'Colton');
  eq(identify(PRIEST).name, 'Rayne Davis', 'High Priest is Rayne');
  eq(identify(null, 'High Priest - Thrill.com').name, 'Rayne Davis');
  eq(identify('999', 'Carter | Thrill VIP').name, 'Carter');
  eq(identify('999', 'Newhost | Thrill VIP'), null, 'convention without a matching member is unidentified');
  eq(isStaffSender('999', 'Newhost | Thrill VIP'), true, 'but still staff');
  eq(isStaffSender(SHARED), true, 'the shared account is staff');
  eq(isStaffSender(PLAYER, '#'), false);
  eq(isStaffSender('42', 'thrillseeker99'), false, 'a player with thrill in their name is not staff');
});
await t('account owners resolve for personal accounts only', () => {
  eq(ownerOfAccount('ColtonThrill').name, 'Colton');
  eq(ownerOfAccount('byronthrill').hosting, false);
  eq(ownerOfAccount('Thrill_VIP_Ops'), null);
});
await t('a learned sender counts as staff for the run', () => {
  useLearnedStaff(new Map([['777', 'Somebody | Thrill']]));
  eq(isStaffSender('777'), true);
  useLearnedStaff(new Map());
  eq(isStaffSender('777'), false);
});
await t('tally learns staff from spread across groups, never a player from one group', () => {
  const tally = {};
  for (let i = 0; i < 7; i++) updateTally(tally, `-${i}`, [msg(1, '555', { senderName: 'Unknown Person' }), msg(1, `${9000 + i}`, { senderName: '#' })]);
  const learned = learnedStaff(tally);
  eq(learned.has('555'), true);
  eq(learned.has('9000'), false);
  eq(learned.has(COLTON), false, 'known members are not tallied');
});
await t('a listed third party is neither side: not learned as staff, not the player, not a turn', () => {
  const MIGUEL = '7025314348';
  useLearnedStaff(new Map([[MIGUEL, 'Miguel - Zee VIP']]));
  eq(isStaffSender(MIGUEL, 'Miguel - Zee VIP'), false, 'the learned tally cannot claim him');
  useLearnedStaff(new Map());
  const tally = {};
  for (let i = 0; i < 7; i++) updateTally(tally, `-${i}`, [msg(1, MIGUEL, { senderName: 'Miguel - Zee VIP' })]);
  eq(learnedStaff(tally).has(MIGUEL), false); eq(Object.keys(tally).length, 0, 'not tallied at all');
  const f = factsOf([msg(0.5, MIGUEL, { senderName: 'Miguel - Zee VIP', text: 'my withdrawal is stuck' }), msg(2, COLTON), msg(3, PLAYER)]);
  eq(f.lastPlayerAt, ago(3), 'his message is not the player speaking'); eq(f.lastStaffAt, ago(2), 'nor us');
  const row = derive(chat({ lastMessageDate: ago(0.5), lastMessage: { date: ago(0.5), isOut: false, sender: { id: MIGUEL } } }), f);
  eq(row.spokeLast, 'staff', 'a newer list entry from him attributes to nobody');
  const ev = emptyEv();
  eq(applyEvent(ev, { chatId: '-1', occurredAt: ago(1), senderId: MIGUEL, senderName: 'Miguel - Zee VIP', isOut: false }), false);
  eq(ev.turns.length, 0);
});

// --- facts -----------------------------------------------------------------
await t('who spoke last is decided by sender identity, never isOut', () => {
  const f = factsOf([msg(1, COLTON, { isOut: false }), msg(2, PLAYER)]);
  eq(f.lastStaffAt, ago(1)); eq(f.lastPlayerAt, ago(2)); eq(f.lastStaffBy, 'Colton');
});
await t('staff who replied are listed by message count, whoever they are', () => {
  const f = factsOf([msg(1, KYLE, { senderName: 'Kyle | Thrill VIP' }), msg(2, COLTON), msg(3, COLTON), msg(4, PLAYER), msg(5, SHARED, { senderName: 'VIP Ops' })]);
  eq(f.staffSpeakers.map((x) => `${x.name}:${x.msgs}`).join(' '), 'Colton:2 Kyle:1 VIP Ops:1');
  ok(!('host' in f), 'no host is claimed');
});
await t('a former host is still staff, and an old chat of theirs is simply no contact', () => {
  const f = factsOf([msg(400, '31337', { senderName: 'Byron Thrill' }), msg(401, PLAYER)]);
  eq(f.lastStaffBy, 'Byron Petzer'); eq(f.staffSpeakers[0].name, 'Byron Petzer');
  eq(derive(chat({ lastMessageDate: ago(400) }), f).state, 'no_contact');
});
await t('a group opened for a player who never arrived is not joined, not a quiet player', () => {
  eq(joinTarget('Carter | Thrill VIP added you to this channel'), null, 'the reader being added is not the player arriving');
  eq(joinTarget('sKo added TWIXA'), 'TWIXA'); eq(joinTarget('lopper joined the group'), 'lopper');
  const svc = (days, type, text) => normalizeMessage({ id: Math.random(), date: ago(days), isOut: false, sender: { id: ANDY, name: 'Andy | Thrill' }, actionType: type, text });
  const opened = [
    msg(53, ANDY, { senderName: 'Andy | Thrill', text: 'Hey lopper - I have gone ahead and set up your 24/7 hosting group.' }),
    svc(53, 'chatEditPhoto', 'Andy | Thrill updated group photo'),
    svc(53, 'chatCreate', 'Andy | Thrill created the group "lopper x Thrill.com"'),
  ];
  const f = factsOf(opened, 'lopper');
  eq(Boolean(f.createdAt), true); eq(f.playerSeen, false); eq(f.playerJoinedAt, null);
  const r = derive(chat({ title: 'lopper x Thrill.com', lastMessageDate: ago(53), lastMessage: { date: ago(53), isOut: false, sender: { id: ANDY } } }), f);
  eq(r.state, 'not_joined'); eq(r.flags.not_joined, true);
  eq(r.signals[0], 'group opened 53d ago, the player never arrived');
  eq(dueAlerts(r, {}, { now: NOW }).length, 0, 'nobody to chase');
  // Once they arrive it is an ordinary chat again, silent or not.
  const joined = factsOf([svc(40, 'chatAddUser', 'Andy | Thrill added lopper'), ...opened], 'lopper');
  eq(derive(chat({ lastMessageDate: ago(40) }), joined).flags.not_joined, false, 'added, so they are here');
  const spoke = factsOf([msg(2, PLAYER, { text: 'hey' }), ...opened], 'lopper');
  eq(derive(chat({ lastMessageDate: ago(2) }), spoke).flags.not_joined, false);
  // Without the creation message the history may be partial, so silence proves nothing.
  eq(derive(chat({ lastMessageDate: ago(53) }), factsOf([opened[0]], 'lopper')).flags.not_joined, false, 'no creation seen, no claim made');
});
await t('acknowledgements close an exchange, questions and complaints do not', () => {
  eq(isAcknowledgement('thanks!'), true); eq(isAcknowledgement("I'd appreciate it. Thank you"), true); eq(isAcknowledgement('gg'), true);
  eq(isAcknowledgement('thanks but where is my money'), false); eq(isAcknowledgement('can you check?'), false); eq(isAcknowledgement('yo'), false);
});
await t('departures are attributed by the named target, a host being removed is not the player leaving', () => {
  eq(departureTarget('Kyle | Thrill VIP removed Andre'), 'Andre');
  eq(departureIsPlayer('Andre', { player: 'luvboobs', staffNames: [] }), false);
  eq(departureIsPlayer('Luvboobs', { player: 'luvboobs', staffNames: [] }), true);
  const f = factsOf([msg(1, COLTON), normalizeMessage({ date: ago(1.5), actionType: 'chatDeleteUser', text: 'Kyle | Thrill VIP removed Andre', sender: { id: KYLE } }), msg(2, PLAYER)], 'luvboobs');
  eq(f.playerLeftAt, null); eq(f.staffChurn[0], 'Andre');
  const g = factsOf([msg(1, COLTON), normalizeMessage({ date: ago(1.5), actionType: 'chatDeleteUser', text: 'Luvboobs left the group', sender: { id: PLAYER } }), msg(2, PLAYER)], 'luvboobs');
  eq(g.playerLeftAt, ago(1.5));
});
await t('reply latency counts the first staff reply after a player turn', () => {
  const f = factsOf([msg(1, COLTON), msg(1.01, COLTON), msg(1.02, PLAYER), msg(3, COLTON), msg(3.5, PLAYER)]);
  eq(f.reply.samples, 2);
  eq(f.reply.medianMins, Math.round(0.5 * 1440));
});

// --- derive -------------------------------------------------------------------
await t('a player message with no reply is waiting', () => {
  const r = derive(chat({ lastMessageDate: ago(2) }), factsOf([msg(2, PLAYER), msg(5, COLTON)]));
  eq(r.state, 'waiting'); eq(r.flags.waiting, true); eq(Math.round(r.playerQuietDays), 2); eq(Math.round(r.staffQuietDays), 5);
});
await t('nothing from us for a week is no_contact even when the player closed the last exchange', () => {
  const r = derive(chat({ lastMessageDate: ago(8) }), factsOf([msg(8, PLAYER, { text: 'thanks!' }), msg(9, COLTON)]));
  eq(r.state, 'no_contact'); eq(r.flags.no_contact, true); eq(r.flags.waiting, false); eq(r.ack, true);
});
await t('a waiting player we have not spoken to in a week carries both flags, display is waiting', () => {
  const r = derive(chat({ lastMessageDate: ago(2) }), factsOf([msg(2, PLAYER), msg(10, COLTON)]));
  eq(r.state, 'waiting'); eq(r.flags.no_contact, true);
});
await t('we posting into a silent player is ignored, and counts as contacted', () => {
  const r = derive(chat({ lastMessageDate: ago(2), lastMessage: { date: ago(2), sender: { id: COLTON } } }), factsOf([msg(2, COLTON), msg(40, PLAYER)]));
  eq(r.state, 'ignored'); eq(r.flags.contacted7d, true); eq(r.flags.no_contact, false);
});
await t('a long silence stays no_contact however old, there is no time bar', () => {
  const r = derive(chat({ lastMessageDate: ago(25) }), factsOf([msg(25, COLTON), msg(26, PLAYER)]));
  eq(r.state, 'no_contact'); eq(r.flags.no_contact, true); ok(!('barred' in r.flags));
  const old = derive(chat({ lastMessageDate: ago(400) }), factsOf([msg(400, COLTON), msg(401, PLAYER)]));
  eq(old.state, 'no_contact'); eq(Math.round(old.noContactDays), 400);
});
await t('without history, a last message from staff dates our silence exactly', () => {
  const r = derive(chat({ lastMessageDate: ago(9), lastMessage: { date: ago(9), isOut: false, sender: { id: COLTON } } }), null);
  eq(r.history, 'pending'); eq(r.spokeLast, 'staff'); eq(Math.round(r.noContactDays), 9); eq(r.state, 'no_contact');
});
await t('without history, a recent player message leaves our silence unknown, an old one bounds it', () => {
  const recent = derive(chat({ lastMessageDate: ago(2) }), null);
  eq(recent.noContactDays, null); eq(recent.flags.no_contact, false); eq(recent.state, 'waiting');
  const old = derive(chat({ lastMessageDate: ago(20) }), null);
  eq(Math.round(old.noContactDays), 20); eq(old.flags.no_contact, true);
});
await t('a message newer than the last history read is attributed from the chat list', () => {
  const f = factsOf([msg(9, COLTON), msg(10, PLAYER)]);
  const r = derive(chat({ lastMessageDate: ago(1), lastMessage: { date: ago(1), isOut: false, sender: { id: COLTON } } }), f);
  eq(r.lastStaffAt, ago(1)); eq(r.state, 'ignored', 'we posted a day ago into a player silent ten days'); eq(r.flags.contacted7d, true); eq(r.flags.no_contact, false);
});
await t('an unread chat under a former host account with no activity is an ordinary row, not a special case', () => {
  const b = derive(chat({ connectedAccount: { id: 'y', username: 'byronthrill' }, lastMessageDate: ago(400) }), null);
  eq(b.flags.no_contact, true); eq(b.state, 'waiting', 'the player spoke last and nobody answered'); ok(!('barred' in b.flags));
});
await t('negative sentiment promotes an otherwise fine row to unhappy', () => {
  const r = derive(chat(), factsOf([msg(0.2, COLTON), msg(0.5, PLAYER)]), { sentiment: { label: 'at_risk', reason: 'withdrawal stuck, moving to Stake' } });
  eq(r.state, 'unhappy'); eq(r.flags.unhappy, true);
});
await t('summary counts active players and coverage', () => {
  const rows = [
    derive(chat({ telegramId: '-1' }), factsOf([msg(1, COLTON), msg(2, PLAYER)])),
    derive(chat({ telegramId: '-2', lastMessageDate: ago(8) }), factsOf([msg(8, PLAYER, { text: 'ok' }), msg(9, COLTON)])),
    derive(chat({ telegramId: '-3', connectedAccount: { id: 'y', username: 'byronthrill' }, lastMessageDate: ago(400) }), null),
  ];
  const s = summarize(rows);
  eq(s.total, 3); eq(s.hosted, 3); eq(s.active, 3); eq(s.noContact7d, 2); eq(s.contacted7d, 1); eq(s.contactKnown, 2);
});

// --- alert policy --------------------------------------------------------------
await t('no_contact fires once per silence and re-arms only after we speak', () => {
  const r = derive(chat({ lastMessageDate: ago(8) }), factsOf([msg(8, COLTON), msg(9, PLAYER)]));
  eq(dueAlerts(r, {}, { now: NOW }).map((d) => d.kind).join(), 'no_contact');
  eq(dueAlerts(r, { no_contact: { at: ago(0.5) } }, { now: NOW }).length, 0, 'already alerted in this silence');
  eq(dueAlerts(r, { no_contact: { at: ago(0.5), seeded: true } }, { now: NOW }).length, 0, 'seeded while already over the line, stays off Slack');
  eq(dueAlerts(r, { no_contact: { at: ago(3), seeded: true } }, { now: NOW }).length, 1, 'seeded five days into the silence, crossing came after the seed');
  eq(dueAlerts(r, { no_contact: { at: ago(9) } }, { now: NOW }).length, 1, 'we spoke after the last alert, new silence');
  const unread = derive(chat({ lastMessageDate: ago(2) }), null);
  eq(dueAlerts(unread, { no_contact: { at: ago(1), seeded: true } }, { now: NOW }).length, 0, 'unknown silence never fires off a seed');
});
await t('a silence first seen well past the line is dashboard-only, and one conversation posts at most once a day', () => {
  const late = derive(chat({ lastMessageDate: ago(15) }), factsOf([msg(15, COLTON), msg(16, PLAYER)]));
  eq(dueAlerts(late, {}, { now: NOW }).length, 0, 'crossed eight days ago');
  const fresh = derive(chat({ lastMessageDate: ago(7.5) }), factsOf([msg(7.5, COLTON), msg(8, PLAYER)]));
  eq(dueAlerts(fresh, {}, { now: NOW }).length, 1);
  eq(dueAlerts(fresh, { urgent: { at: ago(0.3) } }, { now: NOW }).length, 0, 'an alert of another kind seven hours ago blocks it');
  eq(dueAlerts(fresh, { urgent: { at: ago(1.2) } }, { now: NOW }).length, 1, 'a day later it may post');
  const oldSignal = derive(chat({ lastMessageDate: ago(3) }), factsOf([msg(3, PLAYER), msg(3.5, COLTON)]), { sentiment: { label: 'at_risk', lastPlayerAt: ago(3) } });
  eq(dueAlerts(oldSignal, {}, { now: NOW }).length, 0, 'a churn signal from three days ago is history');
});
await t('unhappy needs a recent player message behind it', () => {
  const stale = derive(chat({ lastMessageDate: ago(12) }), factsOf([msg(12, PLAYER), msg(13, COLTON)]), { sentiment: { label: 'negative', lastPlayerAt: ago(12) } });
  eq(stale.flags.unhappy, false); eq(stale.state, 'waiting');
  const current = derive(chat({ lastMessageDate: ago(1) }), factsOf([msg(1, PLAYER), msg(1.1, COLTON)]), { sentiment: { label: 'negative', lastPlayerAt: ago(1) } });
  eq(current.flags.unhappy, true);
});
await t('no alert for a silence that crossed the line long ago', () => {
  eq(dueAlerts(derive(chat({ lastMessageDate: ago(25) }), factsOf([msg(25, COLTON), msg(26, PLAYER)])), {}, { now: NOW }).length, 0);
  eq(dueAlerts(derive(chat({ connectedAccount: { id: 'y', username: 'byronthrill' }, lastMessageDate: ago(20) }), null), {}, { now: NOW }).length, 0);
});
await t('waiting on its own never alerts', () => {
  const r = derive(chat({ lastMessageDate: ago(2) }), factsOf([msg(2, PLAYER), msg(3, COLTON)]));
  eq(dueAlerts(r, {}, { now: NOW }).length, 0);
});
await t('urgent fires on an unanswered at_risk once, and again only for a newer message a week later', () => {
  const answered = derive(chat(), factsOf([msg(0.2, COLTON), msg(0.5, PLAYER)]), { sentiment: { label: 'at_risk', lastPlayerAt: ago(0.5) } });
  eq(dueAlerts(answered, {}, { now: NOW }).length, 0, 'a host already replied, dashboard only');
  const r = derive(chat({ lastMessageDate: ago(0.2) }), factsOf([msg(0.2, PLAYER), msg(0.5, COLTON)]), { sentiment: { label: 'at_risk', lastPlayerAt: ago(0.2) } });
  eq(dueAlerts(r, {}, { now: NOW }).map((d) => d.kind).join(), 'urgent');
  eq(dueAlerts(r, { urgent: { at: ago(2) } }, { now: NOW }).length, 0);
  eq(dueAlerts(r, { urgent: { at: ago(9) } }, { now: NOW }).length, 1);
  eq(dueAlerts(r, {}, { now: NOW, urgent: false }).length, 0, 'switched off');
});
await t('ordering puts urgent first, then the freshest silences', () => {
  const a = { kind: 'no_contact', row: { noContactDays: 30 } }, b = { kind: 'urgent', row: {} }, c = { kind: 'no_contact', row: { noContactDays: 7.1 } };
  eq(orderAlerts([a, b, c]).map((x) => x.row.noContactDays ?? 'u').join(','), 'u,7.1,30');
});
await t('alert text names the player, both silences and the dashboard link, and no host', () => {
  const r = derive(chat({ lastMessageDate: ago(8) }), factsOf([msg(8, COLTON), msg(9, PLAYER)]), { custom: { tier: 'diamond_1' } });
  const text = formatAlert('no_contact', r, { env: { DASHBOARD_URL: 'https://x.test/' } });
  ok(text.includes('7 days without contact'), text); ok(text.includes('testplayer'), text); ok(text.includes('Diamond I'), text);
  ok(!text.includes('Host'), text); ok(text.includes('we last spoke 8d ago (Colton)'), text); ok(text.includes('player last spoke 9d ago'), text);
  ok(text.includes('https://x.test/queue?chat=-5000000001'), text);
  eq(prettyTier('emerald_3'), 'Emerald III');
});

// --- sentiment ---------------------------------------------------------------------
await t('rules flag the unambiguous cases and stay neutral otherwise', () => {
  eq(ruleScan(['my withdrawal has been pending for 3 days']).label, 'negative');
  eq(ruleScan(['this is a scam, im done']).label, 'at_risk');
  eq(ruleScan(['thanks legend, appreciate it']).label, 'positive');
  eq(ruleScan(['can I get a reload']).label, 'neutral');
  eq(detectProvider({}), null); eq(detectProvider({ OPENAI_API_KEY: 'k' }), 'openai'); eq(detectProvider({ ANTHROPIC_API_KEY: 'k' }), 'anthropic');
});
await t('a complaint in the last message is never cancelled by earlier thanks', () => {
  // newest first: the player left after this
  const r = ruleScan(['taking all my money', 'thanks bro', 'thank you legend', 'appreciate it']);
  ok(r.label === 'negative' || r.label === 'at_risk', `got ${r.label}`);
  ok(r.flags.includes('money_taken'), r.flags.join());
  eq(ruleScan(['ok thanks', 'where is my withdrawal', 'hey']).label, 'neutral', 'an old complaint that was closed out with thanks is neutral');
  eq(ruleScan(['leave me alone', 'stop messaging me']).label, 'at_risk');
});
await t('the sentiment window is the exchange around the last player message', () => {
  const at = (min) => new Date(NOW - min * 60000).toISOString();
  const msgs = [
    { date: at(3000), side: 'player', text: 'thanks for last week' },
    { date: at(2990), side: 'staff', text: 'anytime' },
    { date: at(70), side: 'player', text: 'hey any reload' },
    { date: at(55), side: 'staff', text: 'nothing available right now' },
    { date: at(50), side: 'player', text: 'seriously?' },
    { date: at(48), side: 'staff', text: 'sorry bro' },
    { date: at(40), side: 'player', text: 'taking all my money' },
    { date: at(20), side: 'staff', text: 'let me see what I can do' },
  ];
  const w = selectWindow(msgs);
  eq(w[0].text, 'hey any reload', 'starts within the hour before the last player message');
  eq(w[w.length - 1].text, 'taking all my money', 'ends at the last player message, host lines after it are not evidence');
  eq(w.filter((m) => m.side === 'staff').length, 2, 'host lines inside the window stay as context');
  const few = selectWindow([{ date: at(9000), side: 'player', text: 'a' }, { date: at(8000), side: 'player', text: 'b' }, { date: at(10), side: 'player', text: 'c' }]);
  eq(few.length, 3, 'never fewer than the last three player messages');
});
await t('facts carry the window and the quote is the last thing the player said', () => {
  const { facts, window, playerTexts, playerQuote } = extractFacts([
    msg(20, PLAYER, { text: 'thanks legend' }), msg(19.99, COLTON, { text: 'anytime' }),
    msg(0.05, PLAYER, { text: 'you keep taking all my money' }), msg(0.04, COLTON, { text: 'sorry to hear' }),
  ], { player: 'testplayer', now: NOW });
  eq(playerQuote, 'you keep taking all my money'); eq(playerTexts[0], 'you keep taking all my money');
  eq(window[window.length - 1].side, 'player');
  ok(NEGATIVE_LABELS.has(ruleScan(playerTexts).label));
  ok(facts.lastPlayerAt);
});

// --- slack pacing ---------------------------------------------------------------
await t('postSlack honours one Retry-After and raises RateLimited on the second', async () => {
  let calls = 0;
  const limited = { ok: false, status: 429, headers: { get: () => '0' }, json: async () => ({ ok: false, error: 'ratelimited' }) };
  const fine = { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true, ts: '1.2' }) };
  const r = await postSlack('x', { channel: 'c', token: 't', fetchImpl: async () => (++calls === 1 ? limited : fine) });
  eq(r.ts, '1.2'); eq(calls, 2);
  calls = 0;
  let err = null;
  try { await postSlack('x', { channel: 'c', token: 't', fetchImpl: async () => limited }); } catch (e) { err = e; }
  ok(err instanceof RateLimited, 'RateLimited raised');
});
await t('postSequence stops at the first failure and reports what was sent', async () => {
  const slack = fakeSlack({ limitAfter: 2 });
  const r = await postSequence(['a', 'b', 'c'], { gapMs: 0, post: slack.post });
  eq(r.sent.length, 2); ok(r.error instanceof RateLimited);
});

// --- the event stream --------------------------------------------------------------
const evt = (chatId, minAgo, senderId, over = {}) => ({ type: 'message.created', connectedAccountId: 'acct-x', chatId, messageId: String(Math.floor(Math.random() * 1e6)), occurredAt: new Date(NOW - minAgo * 60000).toISOString(), direction: 'incoming', isOut: false, senderId, senderName: null, ...over });
await t('the same message seen by twelve accounts is one turn', () => {
  const ev = emptyEv();
  const at = new Date(NOW - 60000).toISOString();
  for (let i = 0; i < 12; i++) applyEvent(ev, { occurredAt: at, senderId: PLAYER, isOut: false, connectedAccountId: `a${i}`, messageId: String(1000 + i) });
  eq(ev.turns.length, 1); eq(ev.turns[0].s, 'player');
  applyEvent(ev, { occurredAt: new Date(NOW - 30000).toISOString(), senderId: COLTON, isOut: false });
  applyEvent(ev, { occurredAt: new Date(NOW - 20000).toISOString(), senderId: '424242', isOut: true, connectedAccountId: 'colton-acct' });
  eq(ev.turns.length, 3); eq(ev.turns[1].s, 'staff', 'known staff id'); eq(ev.turns[2].s, 'staff', 'isOut from any account is ours');
});
await t('facts from the stream give timing, who replied and reply times, and never text-based facts', () => {
  const ev = emptyEv();
  for (const e of [evt('-1', 300, PLAYER), evt('-1', 290, COLTON), evt('-1', 289, COLTON), evt('-1', 100, PLAYER), evt('-1', 95, KYLE), evt('-1', 10, PLAYER)]) applyEvent(ev, e);
  const f = factsFromEvents(ev);
  eq(f.source, 'events'); eq(f.staffSpeakers.map((x) => x.name).join(','), 'Colton,Kyle'); eq(f.reply.samples, 2); eq(f.reply.medianMins, 10);
  eq(f.lastPlayerAt, new Date(NOW - 10 * 60000).toISOString()); eq(f.lastPlayerAck, null); eq(f.playerLeftAt, null);
  const row = deriveRow(chatMeta({ ...chat({ lastMessageDate: new Date(NOW - 10 * 60000).toISOString(), lastMessage: { date: new Date(NOW - 10 * 60000).toISOString(), sender: { id: PLAYER } } }), accounts: ['ColtonThrill'] }), { evFacts: f, historyUnavailable: true }, { now: NOW });
  eq(row.history, 'events'); eq(row.lastStaffBy, 'Kyle'); eq(row.spokeLast, 'player'); eq(row.flags.left, false); eq(row.reply.samples, 2);
});
await t('ingestEvents follows the cursor, keeps only book chats, and reports when caught up', async () => {
  const pages = [
    { items: [evt('-1', 50, PLAYER, { cursor: 1 }), evt('-999', 49, PLAYER, { cursor: 2 }), evt('-1', 48, COLTON, { cursor: 3 })], nextCursor: 3, hasMore: true },
    { items: [evt('-2', 40, PLAYER, { cursor: 4 })], nextCursor: 4, hasMore: false },
  ];
  const calls = [];
  const api = { events: async (p) => { calls.push(p); return pages.shift() || { items: [], nextCursor: p.after, hasMore: false }; } };
  const states = new Map();
  const r = await ingestEvents(api, { cursor: 0, backfillDays: 10, pageBudget: 5, bookIds: new Set(['-1', '-2']), states, now: NOW });
  eq(r.cursor, 4); eq(r.caughtUp, true); eq(r.touched.size, 2); eq(states.get('-1').ev.turns.length, 2); eq(states.has('-999'), false);
  ok(calls[0].updatedSince, 'first call starts the backfill'); eq(calls[1].updatedSince, undefined, 'later pages follow the cursor');
});

// --- the scan, end to end --------------------------------------------------------
const useKv = () => {
  const up = fakeUpstash();
  process.env.KV_REST_API_URL = 'https://kv.test'; process.env.KV_REST_API_TOKEN = 'tok';
  process.env.SLACK_BOT_TOKEN = 'xoxb'; process.env.SLACK_CHANNEL_ID = 'C1'; process.env.SENTIMENT_PROVIDER = 'none';
  process.env.DASHBOARD_URL = 'https://dash.test';
  globalThis.fetch = up.fetchImpl;
  return up;
};
const workspace = () => {
  const chats = [];
  const mk = (i, over = {}) => ({
    id: `u${i}`, telegramId: `-50000000${String(i).padStart(2, '0')}`, title: `player${i} x Thrill.com`, type: 'group', membersCount: 8,
    connectedAccount: { id: 'acct-vipops', username: 'Thrill_VIP_Ops' },
    lastMessageDate: ago(1), updatedAt: ago(1), lastMessage: { date: ago(1), isOut: false, sender: { id: PLAYER } }, ...over,
  });
  // 1..3 fine, 4..6 already past a week with no word from us, 7 silent for months, 8 an affiliate room, 9 duplicate of 5 under another account
  for (let i = 1; i <= 3; i++) chats.push(mk(i, { lastMessageDate: ago(0.5), updatedAt: ago(0.5), lastMessage: { date: ago(0.5), sender: { id: COLTON } } }));
  for (let i = 4; i <= 6; i++) chats.push(mk(i, { lastMessageDate: ago(10), updatedAt: ago(10), lastMessage: { date: ago(10), sender: { id: COLTON } } }));
  chats.push(mk(7, { lastMessageDate: ago(200), updatedAt: ago(200), lastMessage: { date: ago(200), sender: { id: COLTON } } }));
  chats.push(mk(8, { title: '(AFF) ID 80281 x BCGAME' }));
  chats.push({ ...mk(5, { lastMessageDate: ago(10), updatedAt: ago(10), lastMessage: { date: ago(10), sender: { id: COLTON } } }), id: 'u9', connectedAccount: { id: 'acct-colton', username: 'ColtonThrill' } });
  const messages = {};
  for (const c of chats) {
    const d = (c.lastMessageDate && (NOW - new Date(c.lastMessageDate)) / 86400000) || 1;
    messages[c.telegramId] = [{ id: 2, date: ago(d), isOut: false, sender: { id: COLTON, name: 'Colton | Thrill VIP' }, text: 'checking in' }, { id: 1, date: ago(d + 1), isOut: false, sender: { id: PLAYER, name: '#' }, text: 'hey' }];
  }
  return { chats, messages };
};

await t('first run seeds the backlog silently, builds the book once per group, and posts one summary', async () => {
  const up = useKv();
  const { chats, messages } = workspace();
  const api = fakeEntergram({ chats, messages });
  const slack = fakeSlack();
  const r = await runScan({ api, now: NOW, log: () => {}, post: slack.post, alertGapMs: 0 });
  eq(r.ok, true); eq(r.mode, 'full');
  eq(r.summary.total, 7, 'seven distinct player chats, affiliate room and duplicate excluded');
  eq(r.summary.noContact7d, 4); eq(r.posted, 0); eq(r.due, 0, 'ten days in is late news, dashboard only');
  eq(slack.posts.length, 1); ok(slack.posts[0].includes('restarted'), slack.posts[0]);
  const meta = up.get('ew2:meta'); ok(meta.seededAt, 'seeded'); ok(meta.lastFullAt);
  const book = await kv.getBook(); eq(book.chats.length, 7);
  const s5 = up.get('ew2:chat:-5000000005'); ok(s5.alerts.no_contact.seeded, 'seeded record');
  ok(s5.facts, 'history read'); eq(s5.facts.staffSpeakers[0].name, 'Colton');
  const snap = await kv.getSnapshot(); eq(snap.rows.length, 7); eq(snap.summary.hosted, 7);
});

await t('second run is incremental, touches only changed chats, and alerts nothing that was seeded', async () => {
  useKv();
  const { chats, messages } = workspace();
  const api = fakeEntergram({ chats, messages });
  const slack = fakeSlack();
  await runScan({ api, now: NOW, log: () => {}, post: slack.post, alertGapMs: 0 });
  api.calls.length = 0;
  const r = await runScan({ api, now: NOW + 5 * 60000, log: () => {}, post: slack.post, alertGapMs: 0 });
  eq(r.mode, 'incremental'); eq(r.posted, 0); eq(r.due, 0);
  ok(api.calls.some((c) => c[0] === 'workspaceChats' && c[1].updated_since), 'used updated_since');
  eq(api.calls.filter((c) => c[0] === 'messages').length, 0, 'nothing moved, nothing re-read within the rotation window');
  eq(slack.posts.length, 1, 'no new posts');
});

await t('a player crossing seven days after the seed alerts exactly once, then re-arms only after we speak', async () => {
  const up = useKv();
  const { chats, messages } = workspace();
  const api = fakeEntergram({ chats, messages });
  const slack = fakeSlack();
  await runScan({ api, now: NOW, log: () => {}, post: slack.post, alertGapMs: 0 });
  // player1: we spoke 12h ago at seed time. Eight days later nobody has spoken.
  let now = NOW + 8 * 86400000;
  let r = await runScan({ api, now, mode: 'full', log: () => {}, post: slack.post, alertGapMs: 0 });
  eq(r.due, 3, 'players 1 to 3 crossed'); eq(r.posted, 3);
  eq(slack.posts.length, 4);
  ok(slack.posts[1].includes('7 days without contact'), slack.posts[1]); ok(slack.posts[1].includes('we last spoke'), slack.posts[1]);
  const rec = up.get('ew2:chat:-5000000001').alerts.no_contact; ok(rec.at && !rec.seeded, 'recorded as posted');
  // Next tick: same silence, nothing new.
  r = await runScan({ api, now: now + 5 * 60000, mode: 'full', log: () => {}, post: slack.post, alertGapMs: 0 });
  eq(r.posted, 0); eq(slack.posts.length, 4);
  // We speak on day 9, then go quiet again until day 17: one more alert, once.
  const c1 = api.calls && chats.find((c) => c.telegramId === '-5000000001');
  const spokeAt = new Date(now + 86400000).toISOString();
  c1.lastMessageDate = spokeAt; c1.updatedAt = spokeAt; c1.lastMessage = { date: spokeAt, isOut: false, sender: { id: COLTON } };
  api.setMessages('-5000000001', [{ id: 3, date: spokeAt, isOut: false, sender: { id: COLTON, name: 'Colton | Thrill VIP' }, text: 'hello again' }, ...messages['-5000000001']]);
  r = await runScan({ api, now: now + 2 * 86400000, mode: 'full', log: () => {}, post: slack.post, alertGapMs: 0 });
  eq(r.posted, 0, 'in contact again');
  r = await runScan({ api, now: now + 9 * 86400000, mode: 'full', log: () => {}, post: slack.post, alertGapMs: 0 });
  eq(r.posted, 1, 'second silence, one alert'); eq(slack.posts.length, 5);
  r = await runScan({ api, now: now + 9 * 86400000 + 5 * 60000, mode: 'full', log: () => {}, post: slack.post, alertGapMs: 0 });
  eq(r.posted, 0); eq(slack.posts.length, 5);
});

await t('a Slack rate limit stops posting, keeps what was sent, and the rest goes out next tick without duplicates', async () => {
  const up = useKv();
  const { chats, messages } = workspace();
  const api = fakeEntergram({ chats, messages });
  const seedSlack = fakeSlack();
  await runScan({ api, now: NOW, log: () => {}, post: seedSlack.post, alertGapMs: 0 });
  const slack = fakeSlack({ limitAfter: 1 });
  const now = NOW + 8 * 86400000;
  let r = await runScan({ api, now, mode: 'full', log: () => {}, post: slack.post, alertGapMs: 0 });
  eq(r.ok, true, 'the run completes despite the rate limit'); eq(r.posted, 1); ok(r.alertError, 'error reported');
  ok(up.get('ew2:meta').lastGoodAt, 'state persisted after the rate limit');
  const snap = await kv.getSnapshot(); ok(snap && snap.generatedAt, 'snapshot written');
  const slack2 = fakeSlack();
  r = await runScan({ api, now: now + 5 * 60000, mode: 'full', log: () => {}, post: slack2.post, alertGapMs: 0 });
  eq(r.posted, 2, 'the two held alerts post now');
  const all = [...slack.posts, ...slack2.posts];
  eq(new Set(all.map((p) => p.split('\n')[0])).size, 3, 'three distinct players, no repeats');
});

await t('the per-run cap holds the overflow and posts one line about it', async () => {
  useKv();
  process.env.MAX_ALERTS_PER_RUN = '2';
  const { chats, messages } = workspace();
  const api = fakeEntergram({ chats, messages });
  const slack = fakeSlack();
  await runScan({ api, now: NOW, log: () => {}, post: slack.post, alertGapMs: 0 });
  const r = await runScan({ api, now: NOW + 8 * 86400000, mode: 'full', log: () => {}, post: slack.post, alertGapMs: 0 });
  eq(r.posted, 2); eq(r.overflow, 1);
  ok(slack.posts.at(-1).includes('1 more player'), slack.posts.at(-1));
  delete process.env.MAX_ALERTS_PER_RUN;
});

await t('an unreadable group gets its timing from the event stream and is classified from it', async () => {
  const up = useKv();
  const { chats, messages } = workspace();
  messages['-5000000002'] = [];   // reader account not in this group
  const T = (minAgo) => new Date(NOW - minAgo * 60000).toISOString();
  const events = [
    { cursor: 1, type: 'message.created', chatId: '-5000000002', occurredAt: T(3 * 1440), senderId: PLAYER, isOut: false, connectedAccountId: 'colton' },
    { cursor: 2, type: 'message.created', chatId: '-5000000002', occurredAt: T(3 * 1440 - 4), senderId: COLTON, isOut: true, connectedAccountId: 'colton' },
    { cursor: 3, type: 'message.created', chatId: '-5000000002', occurredAt: T(3 * 1440 - 4), senderId: COLTON, isOut: false, connectedAccountId: 'other' },
    { cursor: 4, type: 'message.created', chatId: '-5000000002', occurredAt: T(30), senderId: PLAYER, isOut: false, connectedAccountId: 'colton' },
    { cursor: 5, type: 'message.created', chatId: '-77', occurredAt: T(20), senderId: PLAYER, isOut: false, connectedAccountId: 'colton' },
  ];
  const c2 = chats.find((c) => c.telegramId === '-5000000002');
  c2.lastMessageDate = T(30); c2.updatedAt = T(30); c2.lastMessage = { date: T(30), isOut: false, sender: { id: PLAYER } };
  const api = fakeEntergram({ chats, messages, events });
  const slack = fakeSlack();
  const r = await runScan({ api, now: NOW, log: () => {}, post: slack.post, alertGapMs: 0 });
  const row = r.rows.find((x) => x.chatId === '-5000000002');
  eq(row.history, 'events'); eq(row.lastStaffBy, 'Colton');
  eq(row.lastStaffAt, T(3 * 1440 - 4)); eq(row.spokeLast, 'player'); eq(row.reply.samples, 1); eq(row.reply.medianMins, 4);
  eq(row.flags.waiting, false, 'thirty minutes is not waiting yet'); eq(row.flags.contacted7d, true);
  const st = up.get('ew2:chat:-5000000002'); eq(st.ev.turns.length, 3, 'twelve copies collapse, one turn per message'); ok(st.evFacts);
  ok(up.get('ew2:meta').eventsCursor === 5 && up.get('ew2:meta').eventsCaughtUp === true, 'cursor persisted');
  // next tick: nothing new in the stream, evFacts untouched, no re-fetch of old pages
  api.calls.length = 0;
  await runScan({ api, now: NOW + 5 * 60000, log: () => {}, post: slack.post, alertGapMs: 0 });
  eq(api.calls.filter((c) => c[0] === 'events').length, 1); eq(api.calls.find((c) => c[0] === 'events')[1], 5, 'resumes from the stored cursor');
});

await t('scope is the shared account\'s own group membership, whatever account the chat row arrived under', async () => {
  const up = useKv();
  const { chats, messages } = workspace();
  // Two extra groups, both filed under a personal account: one the shared
  // account is a member of, one it is not.
  const mine = { id: 'ux', telegramId: '-5000000090', title: 'inscope x Thrill.com', type: 'group', membersCount: 8, connectedAccount: { id: 'acct-byron', username: 'byronthrill' }, lastMessageDate: ago(1), updatedAt: ago(1), lastMessage: { date: ago(1), isOut: false, sender: { id: PLAYER } } };
  const theirs = { ...mine, id: 'uy', telegramId: '-5000000091', title: 'outofscope x Thrill.com' };
  messages['-5000000090'] = [{ id: 1, date: ago(1), isOut: false, sender: { id: COLTON, name: 'Colton | Thrill VIP' }, text: 'hi' }];
  messages['-5000000091'] = [{ id: 1, date: ago(1), isOut: false, sender: { id: COLTON, name: 'Colton | Thrill VIP' }, text: 'hi' }];
  const groups = [...chats, mine].map((c) => ({ telegramChatId: c.telegramId, inviteLink: null }));
  const api = fakeEntergram({ chats: [...chats, mine, theirs], messages, groups });
  const r = await runScan({ api, now: NOW, log: () => {}, post: fakeSlack().post, alertGapMs: 0 });
  const ids = (await kv.getBook()).chats.map((c) => c.chatId);
  eq(ids.includes('-5000000090'), true, 'in the membership set, so in the book even under another account');
  eq(ids.includes('-5000000091'), false, 'not in the membership set and not under the shared account');
  eq(up.get('ew2:meta').scopeIds.length, new Set(groups.map((g) => g.telegramChatId)).size, 'the membership set is kept for the incremental ticks');
  // Everything left out is accounted for, with the reason.
  const left = Object.fromEntries((await kv.getExcluded()).map((e) => [e.chatId, e.reason]));
  eq(left['-5000000091'], 'not in the shared account');
  eq(left['-5000000008'], 'deal room', 'the affiliate room the shared account is in');
  ok(r.ok);
});

await t('a group the chat feed never carries is booked from membership alone', async () => {
  useKv();
  const { chats, messages } = workspace();
  // In the shared account's group list, absent from the workspace chat feed.
  const groups = [
    ...chats.map((c) => ({ telegramChatId: c.telegramId, inviteLink: null })),
    { telegramChatId: '-4811530403', displayName: 'facai x Thrill.com', chatType: 'group', memberCount: 9, inviteLink: null },
    { telegramChatId: '-4811530404', displayName: 'Vip host test', chatType: 'group', memberCount: 2, inviteLink: null },
  ];
  messages['-4811530403'] = [{ id: 1, date: ago(1), isOut: false, sender: { id: COLTON, name: 'Colton | Thrill VIP' }, text: 'hi' }];
  const api = fakeEntergram({ chats, messages, groups });
  const r = await runScan({ api, now: NOW, log: () => {}, post: fakeSlack().post, alertGapMs: 0 });
  const book = await kv.getBook();
  const row = book.chats.find((c) => c.chatId === '-4811530403');
  ok(row, 'booked even though the feed never mentioned it');
  eq(row.player, 'facai', 'the player is read from the group title');
  eq(book.chats.some((c) => c.chatId === '-4811530404'), false, 'a group with no player in the title is still left out');
  ok(r.ok);
});

await t('a concurrent run is skipped while the lock is held', async () => {
  const up = useKv();
  up.store.set('ew2:lock', 'someone-else');
  const r = await runScan({ api: fakeEntergram(), now: NOW, log: () => {} });
  eq(r.skipped, 'locked');
});

await t('an unreadable group is marked unavailable, still classified from the list, and not retried for a day', async () => {
  const up = useKv();
  const { chats, messages } = workspace();
  messages['-5000000004'] = [];
  const api = fakeEntergram({ chats, messages });
  const slack = fakeSlack();
  await runScan({ api, now: NOW, log: () => {}, post: slack.post, alertGapMs: 0 });
  const st = up.get('ew2:chat:-5000000004'); eq(st.historyUnavailable, true); ok(!st.facts);
  const snap = await kv.getSnapshot();
  const row = snap.rows.find((x) => x.chatId === '-5000000004');
  eq(row.history, 'unavailable'); eq(row.state, 'no_contact');
  api.calls.length = 0;
  await runScan({ api, now: NOW + 60 * 60000, mode: 'full', log: () => {}, post: slack.post, alertGapMs: 0 });
  eq(api.calls.filter((c) => c[0] === 'messages' && c[1] === '-5000000004').length, 0, 'not retried within a day');
});

await t('a rule-based verdict carries a plain reason, and the row signal uses it', () => {
  const r = ruleScan(['this site is taking all my money, im done']);
  eq(r.label, 'at_risk'); eq(r.reason, 'Talking about leaving, says the site is taking all their money');
  eq(ruleScan(['thanks so much']).reason, null, 'a positive verdict has no complaint to describe');
  eq(describeFlags(['competitor', 'withdrawal']), 'Withdrawal not received, mentions a rival');
  const row = derive(chat({ lastMessageDate: ago(0.5), lastMessage: { date: ago(0.5), sender: { id: PLAYER } } }), factsOf([msg(0.5, PLAYER, { text: 'this site is taking all my money, im done' }), msg(1, COLTON)]), { sentiment: { ...r, lastPlayerAt: ago(0.5) } });
  eq(row.state, 'unhappy'); eq(row.signals[0], r.reason);
});

// --- queue filters -----------------------------------------------------------
await t('a filter group is a list: any ticked value matches, groups combine', () => {
  const fl = parseFilters({ mood: 'at_risk,negative', silence: 's0', reply: '' });
  eq(fl.mood.join(), 'at_risk,negative'); eq(fl.silence.join(), 's0'); eq(fl.reply.length, 0);
  const row = (over = {}) => ({ state: 'ok', flags: {}, sentiment: { label: 'negative' }, noContactDays: 0.5, reply: { medianMins: 3 }, history: 'read', tier: 'gold', alerts: {}, ...over });
  eq(matchRow(row(), fl), true, 'negative mood, spoke today');
  eq(matchRow(row({ sentiment: { label: 'positive' } }), fl), false, 'mood outside the list');
  eq(matchRow(row({ noContactDays: 5 }), fl), false, 'other group fails');
  eq(matchRow(row({ sentiment: null }), parseFilters({ mood: 'neutral' })), true, 'no sentiment reads as neutral');
  eq(matchRow(row({ tier: null }), parseFilters({ tier: 'none' })), true, 'no tier reads as none');
  eq(matchRow(row({ reply: null }), parseFilters({ reply: 'r5' })), false, 'no reply data never matches a reply bucket');
});
await t('the filter count and label ignore the all sentinel and read every group', () => {
  const fl = parseFilters({ f: 'all', mood: 'at_risk', history: 'events,read', alerted: '1' });
  eq(activeCount(fl), 4);
  eq(activeCount(parseFilters({}), ['actionable']), 1, 'the default state filter counts');
  eq(filterLabel(fl), 'mood at risk · history event stream/readable · alerted');
  eq(queueHref({ mood: ['at_risk', 'negative'], f: [] }), '/queue?mood=at_risk%2Cnegative');
});

// --- access ------------------------------------------------------------------
await t('the monitoring whitelist is the two named accounts, the domain admits the rest', () => {
  eq(isMonitor('anri.akhaladze@paradym.io'), true); eq(isMonitor('Shane.Austin@paradym.io'), true); eq(isMonitor('kyle@paradym.io'), false);
  eq(onDomain('kyle@paradym.io'), true); eq(onDomain('kyle@gmail.com'), false);
  eq(describeUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0'), 'Edge on Windows');
  eq(clientIp({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }), '1.2.3.4');
});
await t('access is an allow-list: the whitelist is in, everyone else needs adding, a block or a revoke ends the session on the next read', async () => {
  useKv(); resetGate();
  const opts = buildAuthOptions({ ip: '1.2.3.4', device: 'Edge on Windows' });
  const token = { email: 'kyle@paradym.io', name: 'Kyle', sid: 'sid-1' };
  eq(await opts.callbacks.signIn({ profile: { email: 'kyle@paradym.io', name: 'Kyle' } }), '/auth/denied?reason=access', 'on the domain but not on the list');
  eq(await opts.callbacks.session({ session: { user: {} }, token }), null, 'an existing session of an unlisted address ends too');
  eq(await opts.callbacks.signIn({ profile: { email: 'anri.akhaladze@paradym.io' } }), true, 'the whitelist is always in');
  eq(parseEmails('Kyle@paradym.io, patrick@paradym.io\nkyle@paradym.io not-an-email').join(), 'kyle@paradym.io,patrick@paradym.io');
  await kv.allowEmail('kyle@paradym.io', 'anri.akhaladze@paradym.io'); forget(null, 'kyle@paradym.io');
  eq(await emailAllowed('kyle@paradym.io'), true);
  eq(await opts.callbacks.signIn({ profile: { email: 'kyle@paradym.io', name: 'Kyle' } }), true);
  const s1 = await opts.callbacks.session({ session: { user: {} }, token });
  eq(s1.user.email, 'kyle@paradym.io'); eq(s1.monitor, false); eq(s1.sid, 'sid-1');
  const s2 = await opts.callbacks.session({ session: { user: {} }, token: { ...token, email: 'anri.akhaladze@paradym.io' } });
  eq(s2.monitor, true);
  await kv.blockEmail('kyle@paradym.io', 'anri.akhaladze@paradym.io'); forget(null, 'kyle@paradym.io');
  eq(await emailBlocked('kyle@paradym.io'), true);
  eq(await opts.callbacks.session({ session: { user: {} }, token }), null, 'blocked address reads as signed out');
  eq(await opts.callbacks.signIn({ profile: { email: 'kyle@paradym.io', name: 'Kyle' } }), '/auth/denied?reason=blocked');
  const log = await kv.getSignIns(); eq(log[0].denied, true); eq(log[0].reason, 'blocked'); eq(log[0].ip, '1.2.3.4');
  eq(log[log.length - 1].reason, 'access', 'the first refusal was for not being on the list');
  await kv.unblockEmail('kyle@paradym.io'); forget(null, 'kyle@paradym.io');
  eq(await emailBlocked('kyle@paradym.io'), false);
  await kv.putSession({ sid: 'sid-1', email: 'kyle@paradym.io', createdAt: Date.now(), ip: '1.2.3.4', device: 'Edge on Windows' });
  await kv.putSession({ sid: 'sid-old', email: 'kyle@paradym.io', createdAt: Date.now() - 10 * 3600000 });
  eq((await kv.listSessions()).map((r) => r.sid).join(), 'sid-1', 'an expired token is no session');
  await kv.revokeSession('sid-1', 'anri.akhaladze@paradym.io'); forget('sid-1');
  eq(await sessionRevoked('sid-1'), true);
  eq(await opts.callbacks.session({ session: { user: {} }, token }), null, 'revoked session reads as signed out');
  eq((await kv.listSessions()).length, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
