// Replays the sampled chats through the analyzer. No network: it reads
// roster-sample.json, so the classification can be checked against real
// conversations as often as the rules change.
import { readFileSync } from 'node:fs';
import { analyzeChat } from '../lib/analyze.js';
import { hosts } from '../lib/scope.js';

const sample = JSON.parse(readFileSync('roster-sample.json', 'utf8'));
const acctByUser = new Map(hosts.map((h) => [h.username, h.accountId]));
const counts = sample.filter((c) => !c.error && c.membersCount).map((c) => c.membersCount);
const mode = [...counts.reduce((m, n) => m.set(n, (m.get(n) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
console.log(`member-count mode across sample: ${mode}  (distribution ${[...new Set(counts)].sort((a,b)=>a-b).map((n) => n + ':' + counts.filter((c) => c === n).length).join(' ')})`);
const rows = [];
for (const c of sample) {
  if (c.error) continue;
  const msgs = c.messages || [];
  const newest = [...msgs].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  const chat = {
    id: c.uuid, telegramId: c.telegramId, title: c.title, type: 'group',
    membersCount: c.membersCount, unreadCount: c.unreadCount,
    lastMessageDate: c.lastMessageDate,
    lastMessage: newest ? { date: newest.date, isOut: newest.isOut, sender: { id: newest.senderId } } : null,
    connectedAccount: { id: acctByUser.get(c.owner), username: c.owner },
  };
  rows.push({ tier2: analyzeChat(chat, { messages: msgs, expectedMembers: mode }), tier1: analyzeChat(chat) });
}

const tally = (rs, f) => { const m = new Map(); for (const r of rs) m.set(f(r), (m.get(f(r)) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };
console.log(`replayed ${rows.length} chats with readable history\n`);
console.log('state, with history :', tally(rows, (r) => r.tier2.state).map(([k, v]) => `${k}=${v}`).join('  '));
console.log('state, list only    :', tally(rows, (r) => r.tier1.state).map(([k, v]) => `${k}=${v}`).join('  '));

const disagree = rows.filter((r) => r.tier1.state !== r.tier2.state);
console.log(`\nthe two tiers disagree on ${disagree.length} of ${rows.length}:`);
for (const d of disagree.slice(0, 12)) {
  console.log(`  ${d.tier1.state.padEnd(16)} -> ${d.tier2.state.padEnd(16)} "${(d.tier2.title || '').slice(0, 30)}"  quiet=${d.tier2.quietDays?.toFixed(0)}d player=${d.tier2.playerQuietDays?.toFixed(0) ?? '-'}d staff=${d.tier2.staffQuietDays?.toFixed(0) ?? '-'}d`);
}

console.log('\n-- rows that would alert, with history --');
const f = (n) => (n == null ? '  -' : String(Math.round(n)).padStart(3));
for (const r of rows.map((x) => x.tier2).filter((r) => ['quiet', 'waiting_on_us', 'outreach_ignored', 'player_left'].includes(r.state)).sort((a, b) => (b.quietDays ?? 0) - (a.quietDays ?? 0))) {
  console.log(`  ${r.state.padEnd(16)} quiet=${f(r.quietDays)}d player=${f(r.playerQuietDays)}d staff=${f(r.staffQuietDays)}d last=${String(r.spokeLast).padEnd(6)} m=${String(r.membersCount).padStart(2)} @${String(r.host).padEnd(16)} ${r.player}`);
}
