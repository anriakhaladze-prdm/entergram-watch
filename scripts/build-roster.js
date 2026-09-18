// Builds the staff roster, and with it the answer to "who spoke last".
//
// Why this exists: `isOut` is relative to the account making the request. We
// read as @Thrill_VIP_Ops, so a message Colton sent from his own account comes
// back isOut=false, identical to a player message. Direction is therefore
// useless for "did we reply". The only reliable test is sender identity, so we
// need the Telegram user ids of the staff.
//
// Deriving them is easy because of how the population is shaped: a player
// appears in exactly one chat, a host appears in hundreds. Sampling chats and
// counting distinct chats per sender separates the two cleanly.
//
// Output is metadata only. No message text is written to disk, only lengths.
import { writeFileSync } from 'node:fs';
import { loadEnv } from '../lib/env.js';
import { createClient } from '../lib/entergram.js';

loadEnv();
const api = createClient();
const SAMPLE = Number(process.env.ROSTER_SAMPLE || 120);
const READER = process.env.ENTERGRAM_READER_ACCOUNT_ID || 'cmu72hqn44wrcod011qefw9lh'; // @Thrill_VIP_Ops
const cut = (s, n = 30) => (s == null ? '' : String(s).replace(/\s+/g, ' ').slice(0, n));
const daysAgo = (d) => (d ? (Date.now() - new Date(d).getTime()) / 86400000 : null);

const isPlayerChat = (c) =>
  c.type === 'group' && (c.membersCount || 0) <= 25 && /\bx\s*thrill/i.test(c.title || c.name || '');

console.log('sweeping chats...');
const chats = await api.workspaceChats();
const players = chats.filter(isPlayerChat);
console.log(`${players.length} player chats of ${chats.length} total`);

// Sample across the whole silence range, not just the top of the list, so the
// roster is not skewed to whoever is active today.
const sorted = [...players].sort((a, b) => (daysAgo(b.lastMessageDate) ?? 0) - (daysAgo(a.lastMessageDate) ?? 0));
const step = Math.max(1, Math.floor(sorted.length / SAMPLE));
const sample = sorted.filter((_, i) => i % step === 0).slice(0, SAMPLE);
console.log(`sampling ${sample.length} chats, every ${step}th across the silence range\n`);

const out = [];
let ok = 0, denied = 0, empty = 0;
for (const [i, c] of sample.entries()) {
  try {
    const r = await api.messages(c.telegramId, READER, { limit: 100 });
    if (!r.items.length) { empty++; }
    else ok++;
    out.push({
      telegramId: c.telegramId, uuid: c.id, title: c.title || c.name,
      owner: c.connectedAccount?.username || null, membersCount: c.membersCount ?? null,
      lastMessageDate: c.lastMessageDate || null, unreadCount: c.unreadCount ?? null,
      messages: r.items.map((m) => ({
        id: m.id, date: m.date, isOut: m.isOut, messageType: m.messageType || null,
        actionType: m.actionType || null, senderId: m.sender?.id || null,
        senderName: m.sender?.name || null, senderUsername: m.sender?.username || null,
        textLen: (m.text || '').length, replyTo: m.replyToMessageId || null,
      })),
    });
  } catch (e) {
    denied++;
    out.push({ telegramId: c.telegramId, title: c.title || c.name, owner: c.connectedAccount?.username || null, error: e.message.replace(/HTTP \d+ on \S+: /, '') });
  }
  if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${sample.length}  ok=${ok} empty=${empty} denied=${denied}`);
  await new Promise((r) => setTimeout(r, 120));
}
writeFileSync('roster-sample.json', JSON.stringify(out, null, 1));
console.log(`\nreadable ${ok}, empty ${empty}, denied ${denied}  -> roster-sample.json`);

// --- who is staff ---------------------------------------------------------
const senders = new Map();
for (const c of out) {
  if (!c.messages) continue;
  const seen = new Set();
  for (const m of c.messages) {
    if (!m.senderId) continue;
    if (!senders.has(m.senderId)) senders.set(m.senderId, { id: m.senderId, names: new Set(), chats: new Set(), msgs: 0, isOut: 0 });
    const s = senders.get(m.senderId);
    if (m.senderName) s.names.add(m.senderName);
    s.chats.add(c.telegramId);
    s.msgs++;
    if (m.isOut) s.isOut++;
    seen.add(m.senderId);
  }
}
const ranked = [...senders.values()].sort((a, b) => b.chats.size - a.chats.size);
console.log(`\ndistinct senders: ${ranked.length}`);
console.log('\n-- senders by distinct chats (staff sit at the top) --');
for (const s of ranked.slice(0, 25)) {
  console.log(`  chats=${String(s.chats.size).padStart(3)}  msgs=${String(s.msgs).padStart(4)}  isOut=${s.isOut}  tg=${s.id}  "${cut([...s.names][0] || '', 28)}"`);
}
const STAFF_MIN_CHATS = Number(process.env.STAFF_MIN_CHATS || 5);
const staff = ranked.filter((s) => s.chats.size >= STAFF_MIN_CHATS);
console.log(`\n${staff.length} senders appear in >= ${STAFF_MIN_CHATS} chats, treating those as staff candidates`);
writeFileSync('staff-roster.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  method: `sender appears in >= ${STAFF_MIN_CHATS} of ${ok} sampled player chats`,
  readerAccountId: READER,
  staff: staff.map((s) => ({ telegramUserId: s.id, names: [...s.names], sampledChats: s.chats.size, messages: s.msgs })),
}, null, 1));
console.log('-> staff-roster.json');

// --- service messages, the in-band evidence of a player leaving ----------
const acts = new Map();
const types = new Map();
for (const c of out) for (const m of c.messages || []) {
  if (m.actionType) acts.set(m.actionType, (acts.get(m.actionType) || 0) + 1);
  types.set(m.messageType, (types.get(m.messageType) || 0) + 1);
}
console.log('\nmessageType across sample:', [...types].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  '));
console.log('actionType across sample :', acts.size ? [...acts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  ') : '(none seen)');

// --- what the alert would actually say -----------------------------------
const staffIds = new Set(staff.map((s) => s.id));
const rows = [];
for (const c of out) {
  if (!c.messages?.length) continue;
  const msgs = [...c.messages].sort((a, b) => new Date(b.date) - new Date(a.date));
  const lastStaff = msgs.find((m) => staffIds.has(m.senderId) || m.isOut);
  const lastPlayer = msgs.find((m) => m.senderId && !staffIds.has(m.senderId) && !m.isOut);
  rows.push({
    title: c.title, owner: c.owner, members: c.membersCount,
    quietDays: daysAgo(c.lastMessageDate),
    playerDays: daysAgo(lastPlayer?.date), staffDays: daysAgo(lastStaff?.date),
    spokeLast: !lastStaff ? 'player' : !lastPlayer ? 'staff' : (new Date(lastStaff.date) > new Date(lastPlayer.date) ? 'staff' : 'player'),
    playerSeenInWindow: Boolean(lastPlayer),
  });
}
const f = (n) => (n == null ? '   -' : n.toFixed(0).padStart(4));
console.log('\n-- what the report would say, 20 quietest sampled chats --');
console.log('  quiet  player  staff  whoLast  owner                title');
for (const r of rows.sort((a, b) => (b.quietDays ?? 0) - (a.quietDays ?? 0)).slice(0, 20)) {
  console.log(`  ${f(r.quietDays)}d ${f(r.playerDays)}d ${f(r.staffDays)}d  ${r.spokeLast.padEnd(7)}  ${String(r.owner).padEnd(20)} "${cut(r.title, 32)}"`);
}
const noPlayer = rows.filter((r) => !r.playerSeenInWindow);
console.log(`\nchats where no player message appears in the last 100 messages: ${noPlayer.length} of ${rows.length}`);
console.log('(these are the candidates for "the player has left and only staff remain")');
for (const r of noPlayer.slice(0, 10)) console.log(`   m=${r.members} quiet=${f(r.quietDays)}d "${cut(r.title, 34)}" @${r.owner}`);
