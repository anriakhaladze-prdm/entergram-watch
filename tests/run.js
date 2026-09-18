// Regression tests for the rules that decide whether a human gets pinged.
import { analyzeChat } from '../lib/analyze.js';
import { isPlayerChat, playerNameFromTitle } from '../lib/scope.js';
import { formatAlert } from '../lib/format.js';
import { ruleScan, mergeSentiment, detectProvider } from '../lib/sentiment.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL ${name}\n     ${e.message}`); } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const NOW = Date.parse('2026-09-18T12:00:00Z');
const ago = (days) => new Date(NOW - days * 86400000).toISOString();
const STAFF = '8268223773';   // Colton
const PLAYER = '1352398121';
const chat = (over = {}) => ({
  id: 'uuid', telegramId: '-5000000001', title: 'testplayer x Thrill.com', type: 'group',
  membersCount: 8, connectedAccount: { id: 'cmrxpn5sm07tzqq1lsw847ply', username: 'ColtonThrill' },
  lastMessageDate: ago(1), lastMessage: { date: ago(1), sender: { id: PLAYER } }, ...over,
});
const msg = (days, senderId, over = {}) => ({ date: ago(days), senderId, isOut: false, actionType: null, senderName: null, ...over });

// --- scope ---------------------------------------------------------------
t('player chats are recognised in both title orderings', () => {
  eq(isPlayerChat(chat({ title: 'swish718 x Thrill.com' })), true);
  eq(isPlayerChat(chat({ title: 'Thrill.com x Shrimpmoneyy VIP' })), true);
});
t('affiliate and partnership rooms are not player chats', () => {
  eq(isPlayerChat(chat({ title: '(AFF) ID 80281 x BCGAME' })), false);
  eq(isPlayerChat(chat({ title: 'Thrill <> Nbavipbox Partnership (85029)' })), false);
});
t('community groups are excluded by size', () => eq(isPlayerChat(chat({ title: 'BetBodya x Thrill', membersCount: 5989 })), false));
t('player name is extracted', () => eq(playerNameFromTitle('swish718 x Thrill.com'), 'swish718'));

// --- the rules -----------------------------------------------------------
t('a player message with no reply is waiting_on_us', () => {
  const r = analyzeChat(chat(), { messages: [msg(2, PLAYER), msg(5, STAFF)], now: NOW, expectedMembers: 8 });
  eq(r.state, 'waiting_on_us');
  eq(Math.round(r.playerQuietDays), 2);
  eq(Math.round(r.staffQuietDays), 5);
});
t('silence both ways past the threshold is quiet', () => {
  const r = analyzeChat(chat({ lastMessageDate: ago(9), lastMessage: { date: ago(9), sender: { id: STAFF } } }),
    { messages: [msg(9, STAFF), msg(10, PLAYER)], now: NOW, expectedMembers: 8 });
  eq(r.state, 'quiet');
});
t('a host still posting into a silent player is outreach_ignored', () => {
  const r = analyzeChat(chat({ lastMessageDate: ago(2), lastMessage: { date: ago(2), sender: { id: STAFF } } }),
    { messages: [msg(2, STAFF), msg(40, PLAYER)], now: NOW, expectedMembers: 8 });
  eq(r.state, 'outreach_ignored');
  eq(Math.round(r.playerQuietDays), 40);
});
t('isOut is never used to decide who spoke: a staff message reads as staff even when isOut is false', () => {
  const r = analyzeChat(chat(), { messages: [msg(1, STAFF, { isOut: false })], now: NOW, expectedMembers: 8 });
  eq(r.spokeLast, 'staff');
});
t('an unrostered staff member is caught by the naming convention', () => {
  const r = analyzeChat(chat(), { messages: [msg(1, '999999', { senderName: 'Newhost | Thrill VIP' })], now: NOW, expectedMembers: 8 });
  eq(r.spokeLast, 'staff');
  eq(r.playerSeen, false);
});
t('a player named thrillseeker is still a player', () => {
  const r = analyzeChat(chat(), { messages: [msg(1, '999999', { senderName: 'thrillseeker99' })], now: NOW, expectedMembers: 8 });
  eq(r.spokeLast, 'player');
});

t('a conversation the player closed with thanks is quiet, not waiting on us', () => {
  const r = analyzeChat(chat({ lastMessageDate: ago(40), lastMessage: { date: ago(40), sender: { id: PLAYER } } }), {
    messages: [{ ...msg(40, PLAYER), text: 'Thanks' }, { ...msg(40.01, STAFF), text: 'sent your way now mate' }],
    now: NOW, expectedMembers: 8,
  });
  eq(r.state, 'quiet');
  eq(r.lastPlayerAck, true);
});
t('a real question left hanging is still waiting on us', () => {
  const r = analyzeChat(chat({ lastMessageDate: ago(40), lastMessage: { date: ago(40), sender: { id: PLAYER } } }), {
    messages: [{ ...msg(40, PLAYER), text: 'can you check my account for a bonus?' }, { ...msg(41, STAFF), text: 'hey' }],
    now: NOW, expectedMembers: 8,
  });
  eq(r.state, 'waiting_on_us');
});
t('naming a competitor on its own is not enough to call a player unhappy', () => {
  eq(ruleScan(['stake have more options for slots but ive been losing a lot there, i want to come back']).label, 'neutral');
});
t('naming a competitor as a destination is', () => {
  eq(ruleScan(['im moving to stake']).label, 'negative');
});

// --- leaving -------------------------------------------------------------
t('a leave action plus a low member count is player_left', () => {
  const r = analyzeChat(chat({ membersCount: 7 }), {
    messages: [msg(1, STAFF, { actionType: 'chatDeleteUser' }), msg(2, PLAYER), msg(3, STAFF)],
    now: NOW, expectedMembers: 8,
  });
  eq(r.state, 'player_left');
});
t('a leave action with a normal member count is not player_left, it is noted', () => {
  const r = analyzeChat(chat({ membersCount: 8 }), {
    messages: [msg(1, STAFF, { actionType: 'chatDeleteUser' }), msg(2, PLAYER)],
    now: NOW, expectedMembers: 8,
  });
  if (r.state === 'player_left') throw new Error('should not conclude the player left on one uncorroborated action');
  if (!r.signals.some((s) => /does not corroborate/.test(s))) throw new Error('should record the uncorroborated leave');
});
t('staff being added does not look like a departure', () => {
  const r = analyzeChat(chat(), { messages: [msg(1, STAFF, { actionType: 'chatAddUser' }), msg(2, PLAYER)], now: NOW, expectedMembers: 8 });
  eq(r.state, 'waiting_on_us');
});
t('a service message is not outreach', () => {
  const r = analyzeChat(chat({ lastMessageDate: ago(1) }), {
    messages: [msg(1, STAFF, { actionType: 'chatAddUser' }), msg(30, PLAYER), msg(45, STAFF)],
    now: NOW, expectedMembers: 8,
  });
  eq(Math.round(r.staffQuietDays), 45, 'the add should not count as us speaking:');
});

// --- host state ----------------------------------------------------------
t("an inactive host's chats are unhosted, not quiet", () => {
  const r = analyzeChat(chat({ connectedAccount: { id: 'cmrjnjs2r0q2xs51ko0u2bt2g', username: 'byronthrill' }, lastMessageDate: ago(400) }), { now: NOW });
  eq(r.state, 'unhosted');
});
t('90 days of silence is dormant, not an alert', () => {
  const r = analyzeChat(chat({ lastMessageDate: ago(120), lastMessage: { date: ago(120), sender: { id: STAFF } } }), { now: NOW });
  eq(r.state, 'dormant');
});

// --- cache ---------------------------------------------------------------
t('cached timestamps reproduce the same verdict without a history call', () => {
  const live = analyzeChat(chat(), { messages: [msg(2, PLAYER), msg(5, STAFF)], now: NOW, expectedMembers: 8 });
  const cached = analyzeChat(chat(), { cached: { lastPlayerAt: ago(2), lastStaffAt: ago(5), playerSeen: true, leaveActionAt: null }, now: NOW, expectedMembers: 8 });
  eq(cached.state, live.state);
  eq(cached.fromCache, true);
});

// --- output --------------------------------------------------------------
t('the alert names the player and both timestamps', () => {
  const r = analyzeChat(chat(), { messages: [msg(3, PLAYER), msg(6, STAFF)], now: NOW, expectedMembers: 8 });
  const text = formatAlert(r, { tier: 'Diamond III', playerUsername: 'testplayer' });
  if (!text.includes('testplayer')) throw new Error('player missing');
  if (!text.includes('Diamond III')) throw new Error('tier missing');
  if (!/player last spoke 3d ago/.test(text)) throw new Error(`player timestamp missing:\n${text}`);
  if (!/we last spoke 6d ago/.test(text)) throw new Error(`staff timestamp missing:\n${text}`);
});
t('a chat with no readable history says so', () => {
  const r = analyzeChat(chat({ lastMessageDate: ago(10), lastMessage: { date: ago(10), sender: { id: PLAYER } } }), { now: NOW });
  if (!/History not readable/.test(formatAlert(r))) throw new Error('should flag the weaker basis');
});

// --- sentiment -----------------------------------------------------------
t('an unresolved withdrawal complaint reads as negative', () => {
  eq(ruleScan(['my withdrawal has been pending for 3 days, where is my money']).label, 'negative');
});
t('a scam accusation plus a goodbye reads as at_risk', () => {
  const r = ruleScan(['this is rigged, absolute scam', 'im done with this site']);
  eq(r.label, 'at_risk');
  if (!r.flags.includes('scam')) throw new Error('should flag the accusation');
});
t('naming a competitor alongside a bonus complaint is at_risk', () => {
  eq(ruleScan(['bonus never credited, moving to stake']).label, 'at_risk');
});
t('ordinary chat is neutral and thanks is positive', () => {
  eq(ruleScan(['hey what time does the tournament start']).label, 'neutral');
  eq(ruleScan(['thanks mate, appreciate the quick payout']).label, 'positive');
});
t('the model verdict wins but the rule flags are kept', () => {
  const merged = mergeSentiment(ruleScan(['withdrawal still pending, where is my money']), { label: 'at_risk', reason: 'unpaid withdrawal, losing trust', source: 'openai' });
  eq(merged.label, 'at_risk');
  if (!merged.flags.includes('withdrawal')) throw new Error('rule flags should survive the merge');
});
t('the provider follows whichever key is set', () => {
  eq(detectProvider({ OPENAI_API_KEY: 'x' }), 'openai');
  eq(detectProvider({ ANTHROPIC_API_KEY: 'x' }), 'anthropic');
  eq(detectProvider({ OPENAI_API_KEY: 'x', ANTHROPIC_API_KEY: 'y', SENTIMENT_PROVIDER: 'anthropic' }), 'anthropic');
  eq(detectProvider({}), null);
  eq(detectProvider({ OPENAI_API_KEY: 'x', SENTIMENT_PROVIDER: 'none' }), null);
});
t('the alert carries the sentiment when it is not neutral', () => {
  const r = analyzeChat(chat(), { messages: [msg(3, PLAYER), msg(6, STAFF)], now: NOW, expectedMembers: 8 });
  r.sentiment = { label: 'at_risk', reason: 'unpaid withdrawal', flags: ['withdrawal'] };
  const text = formatAlert(r);
  if (!/Sentiment: at_risk \(unpaid withdrawal\)/.test(text)) throw new Error(`sentiment line missing:\n${text}`);
});
t('a neutral read adds no noise to the alert', () => {
  const r = analyzeChat(chat(), { messages: [msg(3, PLAYER)], now: NOW, expectedMembers: 8 });
  r.sentiment = { label: 'neutral', flags: [] };
  if (/Sentiment/.test(formatAlert(r))) throw new Error('neutral should not be printed');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
