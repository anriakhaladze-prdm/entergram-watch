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

t('politeness wrapped around a complaint is not an acknowledgement', () => {
  const r = analyzeChat(chat({ lastMessageDate: ago(3), lastMessage: { date: ago(3), sender: { id: PLAYER } } }), {
    messages: [{ ...msg(3, PLAYER), text: 'thanks but where is my money' }, { ...msg(4, STAFF), text: 'looking into it' }],
    now: NOW, expectedMembers: 8,
  });
  eq(r.lastPlayerAck, false);
  eq(r.state, 'waiting_on_us');
});
t('a question is never a sign-off however polite', () => {
  const r = analyzeChat(chat({ lastMessageDate: ago(3), lastMessage: { date: ago(3), sender: { id: PLAYER } } }), {
    messages: [{ ...msg(3, PLAYER), text: 'thanks! any chance of a bonus this week?' }],
    now: NOW, expectedMembers: 8,
  });
  eq(r.state, 'waiting_on_us');
});

// --- leaving -------------------------------------------------------------
t('a host being removed is not the player leaving', () => {
  // luvboobs x Thrill.com. Kyle removed Andre, another host. The member count
  // fell to 7 and the player was still in the group and still talking. This
  // exact chat was reported as "no player left in the group".
  const r = analyzeChat(chat({ title: 'luvboobs x Thrill.com', membersCount: 7 }), {
    messages: [
      { ...msg(1, '7973277038', { senderName: 'Kyle | Thrill VIP', actionType: 'chatDeleteUser' }), text: 'Kyle | Thrill VIP removed Andre' },
      { ...msg(2, PLAYER, { senderName: 'Luvboobs' }), text: 'Have a great night and thank you' },
      { ...msg(3, '8268223773', { senderName: 'Colton | Thrill VIP' }), text: 'what sports you fancy this weekend' },
    ],
    now: NOW, expectedMembers: 8,
  });
  if (r.state === 'player_left') throw new Error('a host rotation is not a player departure');
  eq(r.leaveActionAt, null);
  if (!r.staffChurn.includes('Andre')) throw new Error('the staff change should still be recorded');
});
t('the player leaving is caught by name', () => {
  const r = analyzeChat(chat({ title: 'luvboobs x Thrill.com', membersCount: 7 }), {
    messages: [
      { ...msg(1, '7973277038', { senderName: 'Kyle | Thrill VIP', actionType: 'chatDeleteUser' }), text: 'Kyle | Thrill VIP removed Luvboobs' },
      { ...msg(2, PLAYER, { senderName: 'Luvboobs' }), text: 'thanks' },
    ],
    now: NOW, expectedMembers: 8,
  });
  eq(r.state, 'player_left');
});
t('a player who leaves of their own accord is caught too', () => {
  const r = analyzeChat(chat({ title: 'swish718 x Thrill.com' }), {
    messages: [
      { ...msg(1, null, { senderName: null, actionType: 'chatDeleteUser' }), text: 'swish718 left the group' },
      { ...msg(2, PLAYER), text: 'ok' },
    ],
    now: NOW, expectedMembers: 8,
  });
  eq(r.state, 'player_left');
});
t('member count on its own decides nothing', () => {
  // Seven members with the player present is normal in plenty of these groups.
  const r = analyzeChat(chat({ membersCount: 6 }), {
    messages: [{ ...msg(1, PLAYER), text: 'still here' }, { ...msg(2, STAFF), text: 'good to hear' }],
    now: NOW, expectedMembers: 8,
  });
  if (r.state === 'player_left') throw new Error('a low member count is not evidence');
});
t('a silent history only counts when there is enough of it to be silent', () => {
  const thin = analyzeChat(chat(), { messages: [{ ...msg(1, STAFF), text: 'hello' }], now: NOW, expectedMembers: 8 });
  if (thin.state === 'player_left') throw new Error('one staff message is not proof the player is gone');
  const thick = analyzeChat(chat({ lastMessageDate: ago(9) }), {
    messages: Array.from({ length: 24 }, (_, i) => ({ ...msg(9 + i * 0.01, STAFF), text: 'checking in' })),
    now: NOW, expectedMembers: 8,
  });
  eq(thick.state, 'player_left');
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
t('a chat whose history genuinely cannot be read says so', () => {
  const r = analyzeChat(chat({ lastMessageDate: ago(10), lastMessage: { date: ago(10), sender: { id: PLAYER } } }),
    { now: NOW, historyState: 'unavailable' });
  eq(r.historyState, 'unavailable');
  if (!/history is not readable/i.test(formatAlert(r))) throw new Error('should flag the weaker basis');
});
t('a chat that has not been read yet is pending, not unavailable', () => {
  // The distinction the jp823 false positive turned on: a queue position is
  // not a permission fact, and an alert must not be raised from it.
  const r = analyzeChat(chat({ lastMessageDate: ago(10), lastMessage: { date: ago(10), sender: { id: PLAYER } } }), { now: NOW });
  eq(r.historyState, 'pending');
  eq(r.historyRead, false);
  if (/not readable/i.test(formatAlert(r))) throw new Error('must not claim the history cannot be read');
});
t('reading the history clears the pending state', () => {
  const r = analyzeChat(chat(), { messages: [msg(2, PLAYER), msg(5, STAFF)], now: NOW, expectedMembers: 8 });
  eq(r.historyState, 'read');
});
t('the acknowledgement that caused the false positive is caught once history is read', () => {
  // jp823: the player's last message was "I'd appreciate it. Thank you", right
  // after the host answered. Tier 1 has no text, so it read as unanswered.
  const withText = analyzeChat(chat({ lastMessageDate: ago(3), lastMessage: { date: ago(3), sender: { id: PLAYER } } }), {
    messages: [{ ...msg(3, PLAYER), text: "I'd appreciate it. Thank you" }, { ...msg(3.01, STAFF), text: 'will you give us a bit of time to review for you?' }],
    now: NOW, expectedMembers: 8,
  });
  if (withText.state === 'waiting_on_us') throw new Error('an acknowledgement is not an unanswered question');
  eq(withText.lastPlayerAck, true);
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
t('the alert says the verdict came from the player and quotes them', () => {
  const r = analyzeChat(chat(), { messages: [msg(3, PLAYER), msg(6, STAFF)], now: NOW, expectedMembers: 8 });
  r.sentiment = { label: 'negative', reason: 'disappointed about losses', flags: [], quote: 'While being down 15k on the book smh' };
  const text = formatAlert(r);
  if (!/player's messages only/.test(text)) throw new Error('should say whose words were scored');
  if (!/down 15k on the book/.test(text)) throw new Error('should quote the player');
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
