// Second pass. Three things to settle:
//   1. Which connected accounts own the chats, and which of them this key can
//      actually read message history for.
//   2. Whether chat_id means the workspace UUID or the Telegram id.
//   3. What a real hosted-player chat looks like against the community-group
//      noise, so the scan has a defensible scope.
import { loadEnv } from '../lib/env.js';
import { createClient } from '../lib/entergram.js';

loadEnv();
const api = createClient();
const cut = (s, n = 40) => (s == null ? '' : String(s).replace(/\s+/g, ' ').slice(0, n));
const days = (d) => (d ? ((Date.now() - new Date(d).getTime()) / 86400000).toFixed(1) : 'n/a');

const mine = new Set((await api.accounts()).map((a) => a.id));
const chats = await api.workspaceChats();
console.log(`chats: ${chats.length}  my readable accounts: ${mine.size}`);

// --- 1. who owns the chats -------------------------------------------------
const byAcct = new Map();
for (const c of chats) {
  const a = c.connectedAccount;
  if (!a?.id) continue;
  if (!byAcct.has(a.id)) byAcct.set(a.id, { ...a, n: 0, groups: 0, small: 0 });
  const e = byAcct.get(a.id);
  e.n++;
  if (c.type === 'group') e.groups++;
  if (c.type === 'group' && (c.membersCount || 0) <= 25) e.small++;
}
console.log('\n== connected accounts seen across workspace chats ==');
for (const a of [...byAcct.values()].sort((x, y) => y.n - x.n)) {
  console.log(`  ${a.id}  @${a.username || '-'}  "${cut(a.displayName, 26)}"  chats=${a.n} groups=${a.groups} small=${a.small}  readable=${mine.has(a.id)}`);
}

// --- 2. what is a player chat ---------------------------------------------
const small = chats.filter((c) => c.type === 'group' && (c.membersCount || 0) <= 25);
const xThrill = chats.filter((c) => /\bx\s*thrill/i.test(c.title || c.name || ''));
console.log(`\n== shape ==`);
console.log(`groups <=25 members : ${small.length}`);
console.log(`title matches "x Thrill" : ${xThrill.length}  (of those, groups<=25: ${xThrill.filter((c) => c.type === 'group' && (c.membersCount || 0) <= 25).length})`);
const sizes = [2, 5, 10, 25, 50, 100];
console.log('group size buckets  :', sizes.map((s, i) => `<=${s}:${chats.filter((c) => c.type === 'group' && (c.membersCount || 0) <= s && (c.membersCount || 0) > (sizes[i - 1] || 0)).length}`).join('  '), ` >100:${chats.filter((c) => c.type === 'group' && (c.membersCount || 0) > 100).length}`);

console.log('\n-- 25 small-group titles with owner and silence --');
for (const c of small.slice(0, 25)) {
  console.log(`  ${days(c.lastMessageDate)}d  m=${String(c.membersCount).padStart(3)}  out=${c.lastMessage?.isOut}  @${c.connectedAccount?.username || '-'}  "${cut(c.title || c.name, 42)}"`);
}

console.log('\n-- 15 private chats --');
for (const c of chats.filter((x) => x.type === 'private').slice(0, 15)) {
  console.log(`  ${days(c.lastMessageDate)}d  out=${c.lastMessage?.isOut}  @${c.connectedAccount?.username || '-'}  "${cut(c.title || c.name, 34)}"`);
}

// --- 3. can we read history, and under which id ---------------------------
const readable = chats.filter((c) => mine.has(c.connectedAccount?.id));
console.log(`\n== history access ==`);
console.log(`chats owned by a readable account: ${readable.length} of ${chats.length}`);
const target = readable.find((c) => c.type === 'group' && (c.membersCount || 0) <= 25) || readable[0];
if (!target) {
  console.log('no readable chat found, cannot test message history');
} else {
  console.log(`target: "${cut(target.title || target.name, 40)}"  uuid=${target.id}  tg=${target.telegramId}  acct=${target.connectedAccount.id}`);
  for (const [label, id] of [['uuid', target.id], ['telegramId', target.telegramId]]) {
    try {
      const r = await api.messages(id, target.connectedAccount.id, { limit: 100 });
      console.log(`  ${label}: OK  ${r.items.length} messages  hasMore=${r.hasMore}`);
      if (label === 'uuid' || r.items.length) {
        const m = r.items;
        const t = (f) => { const x = new Map(); for (const i of m) { const k = String(f(i)); x.set(k, (x.get(k) || 0) + 1); } return [...x].map(([k, v]) => `${k}=${v}`).join(' '); };
        console.log('    messageType:', t((i) => i.messageType));
        console.log('    actionType :', t((i) => i.actionType));
        console.log('    isOut      :', t((i) => i.isOut));
        console.log('    senders    :', [...new Set(m.map((i) => `${i.sender?.id}/${cut(i.sender?.name, 12)}`))].slice(0, 8).join('  '));
        const lastIn = m.find((i) => !i.isOut);
        const lastOut = m.find((i) => i.isOut);
        console.log(`    last inbound : ${lastIn?.date || 'none in page'}  (${days(lastIn?.date)}d)  by ${cut(lastIn?.sender?.name, 16)}`);
        console.log(`    last outbound: ${lastOut?.date || 'none in page'}  (${days(lastOut?.date)}d)  by ${cut(lastOut?.sender?.name, 16)}`);
      }
    } catch (e) {
      console.log(`  ${label}: FAILED ${e.message}`);
    }
  }

  // service messages, the only in-band evidence that somebody left
  console.log('\n-- scanning 5 readable groups for leave/join service messages --');
  for (const c of readable.filter((x) => x.type === 'group' && (x.membersCount || 0) <= 25).slice(0, 5)) {
    try {
      const r = await api.messages(c.id, c.connectedAccount.id, { limit: 100 });
      const svc = r.items.filter((m) => m.actionType || m.messageType === 'service' || m.messageType === 'action');
      console.log(`  "${cut(c.title || c.name, 30)}" m=${c.membersCount}: ${r.items.length} msgs, ${svc.length} service -> ${[...new Set(svc.map((s) => s.actionType || s.messageType))].join(',') || '-'}`);
    } catch (e) { console.log(`  "${cut(c.title || c.name, 30)}": ${e.message}`); }
  }
}

// --- 4. groups endpoint, keyed how? ---------------------------------------
console.log('\n== /v1/groups ==');
try {
  const gs = await api.groups({});
  console.log(`groups: ${gs.length}`);
  for (const g of gs.slice(0, 5)) console.log(`  ${g.groupId}  "${cut(g.displayName, 30)}"  type=${g.chatType} members=${g.memberCount} participants=${g.participantCount} knownBy=${(g.knownByAccounts || []).length}`);
  if (gs.length) {
    const g = gs.find((x) => (x.memberCount || 0) > 0 && (x.memberCount || 0) <= 25) || gs[0];
    console.log(`  members of ${g.groupId}:`);
    const ms = await api.groupMembers(g.groupId, {});
    for (const m of ms.slice(0, 12)) console.log(`    tg=${m.telegramUserId} @${m.username || '-'} "${cut(m.firstName, 14)}" bot=${m.isBot} roles=${JSON.stringify(m.roles || [])} knownBy=${(m.knownByAccounts || []).map((k) => k.username).join(',')}`);
  }
} catch (e) { console.log('FAILED:', e.message); }

console.log('\n== /v1/contacts (first page shape) ==');
try {
  const cs = await api.contacts({ limit: 5 });
  console.log(`contacts sampled: ${cs.length}`);
  for (const c of cs.slice(0, 5)) console.log(`  tg=${c.telegramUserId} @${c.username || '-'} "${cut(c.firstName, 14)}" sharedGroups=${c.sharedGroupCount}/${c.totalSharedGroupCount} knownBy=${(c.knownByAccounts || []).map((k) => k.username).join(',')}`);
} catch (e) { console.log('FAILED:', e.message); }

console.log('\n== scope recheck ==');
for (const [name, fn] of [['events.read', () => api.events({ after: 0, limit: 1 })], ['custom_fields.read', () => api.customColumns()]]) {
  try { await fn(); console.log(`  ${name}: OK`); } catch (e) { console.log(`  ${name}: ${e.message.slice(0, 90)}`); }
}
