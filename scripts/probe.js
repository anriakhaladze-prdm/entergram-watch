// Read-only reconnaissance against the live workspace. Prints shapes and
// distributions, never a full dump, so it is safe to paste into a ticket.
//
//   node scripts/probe.js
import { loadEnv } from '../lib/env.js';
import { createClient } from '../lib/entergram.js';

loadEnv();
const api = createClient();
const cut = (s, n = 48) => (s == null ? '' : String(s).replace(/\s+/g, ' ').slice(0, n));
const tally = (rows, f) => {
  const m = new Map();
  for (const r of rows) { const k = String(f(r)); m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

const me = await api.me();
console.log('== /v1/me ==');
console.log('workspace:', me?.data?.workspace?.name, me?.data?.workspace?.id);
console.log('scopes   :', (me?.data?.apiKey?.scopes || []).join(', '));
console.log('expires  :', me?.data?.apiKey?.expiresAt);

const accounts = await api.accounts();
console.log(`\n== /v1/accounts (${accounts.length}) ==`);
for (const a of accounts) {
  console.log(`  ${a.id}  tg=${a.telegramUserId}  @${a.username || '-'}  "${cut(a.displayName, 28)}"  owner="${cut(a.owner?.displayName, 20)}"  chats=${a.chatCount}  read=${a.capabilities?.read}  last=${cut(a.lastMessageDate, 24)}`);
}

let members = [];
try {
  members = await api.members();
  console.log(`\n== /v1/members (${members.length}) ==`);
  for (const m of members) console.log(`  ${m.userId}  ${m.role}  "${cut(m.user?.displayName || m.displayAlias, 28)}"  ${cut(m.user?.email, 34)}`);
} catch (e) {
  console.log(`\n== /v1/members == UNAVAILABLE: ${e.message}`);
}

console.log('\n== /v1/workspace/chats (full sweep) ==');
const t0 = Date.now();
const chats = await api.workspaceChats();
console.log(`total: ${chats.length}  in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('type     :', tally(chats, (c) => c.type).map(([k, v]) => `${k}=${v}`).join('  '));
console.log('status   :', tally(chats, (c) => c.status).map(([k, v]) => `${k}=${v}`).join('  '));
console.log('lastMsg  : has=', chats.filter((c) => c.lastMessageDate || c.lastMessage?.date).length, ' missing=', chats.filter((c) => !(c.lastMessageDate || c.lastMessage?.date)).length);
console.log('isOut    :', tally(chats.filter((c) => c.lastMessage), (c) => c.lastMessage.isOut).map(([k, v]) => `${k}=${v}`).join('  '));
console.log('members  :', tally(chats, (c) => (c.membersCount == null ? 'null' : c.membersCount <= 2 ? '<=2' : c.membersCount <= 5 ? '3-5' : '6+')).map(([k, v]) => `${k}=${v}`).join('  '));

const ages = chats
  .map((c) => c.lastMessageDate || c.lastMessage?.date)
  .filter(Boolean)
  .map((d) => (Date.now() - new Date(d).getTime()) / 86400000);
const bucket = (lo, hi) => ages.filter((a) => a >= lo && a < hi).length;
console.log(`silence  : <1d=${bucket(0, 1)}  1-3d=${bucket(1, 3)}  3-7d=${bucket(3, 7)}  7-14d=${bucket(7, 14)}  14-30d=${bucket(14, 30)}  30d+=${ages.filter((a) => a >= 30).length}`);

console.log('\n-- 3 sample rows, full shape --');
for (const c of chats.slice(0, 3)) {
  console.log(JSON.stringify({ ...c, name: cut(c.name, 20), title: cut(c.title, 20), lastMessageText: cut(c.lastMessageText, 40), lastMessage: c.lastMessage ? { ...c.lastMessage, text: cut(c.lastMessage.text, 40), sender: { ...c.lastMessage.sender, displayName: cut(c.lastMessage.sender?.displayName, 18) } } : null }, null, 1));
}

// Message shape, taken from the busiest group we can actually read.
const groupish = chats.filter((c) => (c.membersCount || 0) > 2 && c.connectedAccount?.id);
const probeChat = groupish[0] || chats.find((c) => c.connectedAccount?.id);
if (probeChat) {
  console.log(`\n== /v1/chats/${probeChat.id}/messages (account ${probeChat.connectedAccount.id}) ==`);
  try {
    const { items, hasMore } = await api.messages(probeChat.id, probeChat.connectedAccount.id, { limit: 100 });
    console.log(`returned ${items.length}  hasMore=${hasMore}`);
    console.log('messageType:', tally(items, (m) => m.messageType).map(([k, v]) => `${k}=${v}`).join('  '));
    console.log('actionType :', tally(items, (m) => m.actionType).map(([k, v]) => `${k}=${v}`).join('  '));
    console.log('isOut      :', tally(items, (m) => m.isOut).map(([k, v]) => `${k}=${v}`).join('  '));
    console.log('senders    :', tally(items, (m) => `${m.sender?.id}/${cut(m.sender?.name, 14)}`).slice(0, 8).map(([k, v]) => `${k}=${v}`).join('  '));
    console.log('-- newest 3 --');
    for (const m of items.slice(0, 3)) console.log(JSON.stringify({ id: m.id, date: m.date, isOut: m.isOut, isRead: m.isRead, messageType: m.messageType, actionType: m.actionType, sender: { id: m.sender?.id, name: cut(m.sender?.name, 16) }, text: cut(m.text, 60) }));
  } catch (e) {
    console.log('FAILED:', e.message);
  }

  console.log('\n== group members ==');
  try {
    const gm = await api.groupMembers(probeChat.id, {});
    console.log(`${gm.length} members`);
    for (const m of gm.slice(0, 10)) console.log(`  tg=${m.telegramUserId}  @${m.username || '-'}  "${cut(m.firstName, 14)} ${cut(m.lastName, 10)}"  bot=${m.isBot}  roles=${JSON.stringify(m.roles || [])}  knownBy=${(m.knownByAccounts || []).length}`);
  } catch (e) {
    console.log('FAILED:', e.message);
  }
}

console.log('\n== /v1/custom-columns ==');
try {
  const cols = await api.customColumns();
  console.log(cols.length ? cols.map((c) => `${c.key}(${c.type})`).join('  ') : '(none configured)');
} catch (e) { console.log('UNAVAILABLE:', e.message); }

console.log('\n== /v1/events ==');
try {
  const ev = await api.events({ after: 0, limit: 5 });
  console.log(`items=${ev.items.length} hasMore=${ev.hasMore} nextCursor=${ev.nextCursor}`);
  console.log('types:', tally(ev.items, (e) => e.type).map(([k, v]) => `${k}=${v}`).join('  '));
  for (const e of ev.items.slice(0, 3)) console.log(JSON.stringify({ cursor: e.cursor, type: e.type, direction: e.direction, isOut: e.isOut, chatId: e.chatId, chatTitle: cut(e.chatTitle, 20), occurredAt: e.occurredAt }));
} catch (e) { console.log('UNAVAILABLE:', e.message); }
