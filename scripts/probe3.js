// Third pass, the decisive one.
//
// probe2 showed the chat list reports connectedAccount.id values that are NOT
// the ids /v1/accounts hands back, even for the same username (@Thrill_VIP_Ops
// is cmrkls1... in the chat list and cmu72hq... in /v1/accounts). The account
// schema carries canonicalAccountId / legacyAccountIds / legacyIdDeprecated,
// so the 403 CANONICAL_ACCOUNT_GRANT_REVOKED is plausibly an id-space problem
// rather than a permission one. This builds the full matrix.
//
// Also confirmed in probe2: chat_id must be the TELEGRAM id. The UUID returns
// 400 "Telegram rejected the message request".
import { loadEnv } from '../lib/env.js';
import { createClient } from '../lib/entergram.js';

loadEnv();
const api = createClient();
const cut = (s, n = 34) => (s == null ? '' : String(s).replace(/\s+/g, ' ').slice(0, n));
const days = (d) => (d ? ((Date.now() - new Date(d).getTime()) / 86400000).toFixed(1) : 'n/a');

console.log('== /v1/accounts, full identity shape ==');
const accounts = await api.accounts();
for (const a of accounts) {
  console.log(JSON.stringify({
    id: a.id, canonicalAccountId: a.canonicalAccountId, legacyAccountIds: a.legacyAccountIds,
    legacyIdDeprecated: a.legacyIdDeprecated, identityVersion: a.identityVersion,
    routeAvailability: a.routeAvailability, username: a.username, telegramUserId: a.telegramUserId,
    capabilities: a.capabilities, chatCount: a.chatCount, ownerId: a.owner?.id,
  }));
}
const myIds = [...new Set(accounts.flatMap((a) => [a.id, a.canonicalAccountId, ...(a.legacyAccountIds || [])]).filter(Boolean))];
console.log('every id my accounts answer to:', myIds.join(', '));

const chats = await api.workspaceChats();
const playerish = (c) => c.type === 'group' && (c.membersCount || 0) <= 25 && /\bx\s*thrill/i.test(c.title || c.name || '');

// --- the matrix: which account_id unlocks which owner's chats -------------
console.log('\n== message access matrix (chat_id = telegramId) ==');
const owners = new Map();
for (const c of chats) if (c.connectedAccount?.id && !owners.has(c.connectedAccount.id)) {
  const sample = chats.find((x) => x.connectedAccount?.id === c.connectedAccount.id && playerish(x))
    || chats.find((x) => x.connectedAccount?.id === c.connectedAccount.id);
  owners.set(c.connectedAccount.id, { acct: c.connectedAccount, sample });
}
for (const [ownerId, { acct, sample }] of owners) {
  if (!sample) continue;
  console.log(`\n@${acct.username || '-'} (${ownerId})  sample "${cut(sample.title || sample.name, 32)}" tg=${sample.telegramId}`);
  const tries = [['own id', ownerId], ...myIds.map((id) => [`mine:${id.slice(0, 10)}`, id])];
  for (const [label, accountId] of tries) {
    try {
      const r = await api.messages(sample.telegramId, accountId, { limit: 20 });
      const lastIn = r.items.find((m) => !m.isOut);
      const lastOut = r.items.find((m) => m.isOut);
      console.log(`   ${label}: OK ${r.items.length} msgs  lastIn=${days(lastIn?.date)}d lastOut=${days(lastOut?.date)}d`);
      break; // first working id is the one the scan will use
    } catch (e) {
      console.log(`   ${label}: ${e.message.replace(/HTTP \d+ on \S+: /, '').slice(0, 60)}`);
    }
  }
}

// --- events: the account-independent path --------------------------------
console.log('\n== /v1/events ==');
try {
  const first = await api.events({ after: 0, limit: 200 });
  console.log(`page1: ${first.items.length} items  hasMore=${first.hasMore}  nextCursor=${first.nextCursor}`);
  if (first.items.length) {
    const t = (f) => { const m = new Map(); for (const i of first.items) { const k = String(f(i)); m.set(k, (m.get(k) || 0) + 1); } return [...m].map(([k, v]) => `${k}=${v}`).join('  '); };
    console.log('type      :', t((e) => e.type));
    console.log('direction :', t((e) => e.direction));
    console.log('isOut     :', t((e) => e.isOut));
    const dates = first.items.map((e) => e.occurredAt).filter(Boolean).sort();
    console.log(`oldest event on page1: ${dates[0]} (${days(dates[0])}d ago)`);
    console.log(`newest event on page1: ${dates[dates.length - 1]} (${days(dates[dates.length - 1])}d ago)`);
    console.log('cursor range:', Math.min(...first.items.map((e) => e.cursor)), '->', Math.max(...first.items.map((e) => e.cursor)));
    console.log('-- 3 raw --');
    for (const e of first.items.slice(0, 3)) console.log(JSON.stringify({ ...e, chatTitle: cut(e.chatTitle, 26), senderName: cut(e.senderName, 16) }));
    const distinctChats = new Set(first.items.map((e) => e.chatId));
    console.log(`distinct chats on page1: ${distinctChats.size}`);
    console.log(`chatId looks like: ${[...distinctChats][0]}  (telegramId form? ${/^-?\d+$/.test([...distinctChats][0])})`);
  }
} catch (e) { console.log('FAILED:', e.message); }

// --- custom fields: is player id or host stored there? -------------------
console.log('\n== /v1/custom-columns ==');
try {
  const cols = await api.customColumns();
  console.log(`${cols.length} columns`);
  for (const c of cols) console.log(`  key=${c.key} name="${cut(c.name, 24)}" type=${c.type} required=${c.isRequired} options=${(c.options || []).map((o) => o.label).slice(0, 8).join('|') || '-'}`);
  const sample = chats.find(playerish);
  if (sample && cols.length) {
    const v = await api.chatCustomFields(sample.telegramId);
    console.log(`  values on "${cut(sample.title, 26)}":`, JSON.stringify(v?.data?.values || {}).slice(0, 300));
  }
} catch (e) { console.log('FAILED:', e.message); }

// --- can we see group membership at all? ---------------------------------
console.log('\n== group membership visibility ==');
try {
  const me = (await api.members({ search: 'anri' }))[0];
  console.log(`me: ${me?.user?.displayName} role=${me?.role} canViewGroupMembersInfo=${me?.canViewGroupMembersInfo} canViewGroupManagementInfo=${me?.canViewGroupManagementInfo}`);
} catch (e) { console.log('members lookup failed:', e.message); }
const pc = chats.filter(playerish).slice(0, 3);
for (const c of pc) {
  try {
    const ms = await api.groupMembers(c.telegramId, {});
    console.log(`  "${cut(c.title, 28)}" tg=${c.telegramId} membersCount=${c.membersCount} -> groupMembers returned ${ms.length}`);
    for (const m of ms.slice(0, 12)) console.log(`      tg=${m.telegramUserId} @${m.username || '-'} "${cut(m.firstName, 12)}" bot=${m.isBot} roles=${JSON.stringify(m.roles || [])}`);
  } catch (e) { console.log(`  "${cut(c.title, 28)}": ${e.message.replace(/HTTP \d+ on \S+: /, '').slice(0, 60)}`); }
}

// --- scope of the real population ----------------------------------------
const players = chats.filter(playerish);
console.log(`\n== player-chat population ==`);
console.log(`matched: ${players.length}`);
const b = (lo, hi) => players.filter((c) => { const d = +days(c.lastMessageDate); return d >= lo && d < hi; }).length;
console.log(`silence : <1d=${b(0, 1)}  1-3d=${b(1, 3)}  3-7d=${b(3, 7)}  7-14d=${b(7, 14)}  14-30d=${b(14, 30)}  30d+=${players.filter((c) => +days(c.lastMessageDate) >= 30).length}  nolast=${players.filter((c) => !c.lastMessageDate).length}`);
console.log(`last msg direction: inbound=${players.filter((c) => c.lastMessage?.isOut === false).length}  outbound=${players.filter((c) => c.lastMessage?.isOut === true).length}  unknown=${players.filter((c) => c.lastMessage?.isOut == null).length}`);
console.log(`by owner:`, [...new Set(players.map((c) => c.connectedAccount?.username))].map((u) => `${u}=${players.filter((c) => c.connectedAccount?.username === u).length}`).join('  '));
console.log('\n-- 12 quietest player chats --');
for (const c of [...players].sort((x, y) => +days(y.lastMessageDate) - +days(x.lastMessageDate)).slice(0, 12)) {
  console.log(`  ${String(days(c.lastMessageDate)).padStart(6)}d  m=${String(c.membersCount).padStart(2)}  out=${c.lastMessage?.isOut}  @${c.connectedAccount?.username}  "${cut(c.title, 38)}"`);
}
