// Runs one scan against the live workspace with nothing posted and nothing
// persisted, and prints what it would have done. Reads .env.local.
//
//   node scripts/dryrun.js            incremental if the book exists, else full
//   node scripts/dryrun.js full       force a full sweep
import { loadEnv } from '../lib/env.js';
import { runScan } from '../lib/scan.js';
import { formatAlert } from '../lib/alerts.js';

loadEnv();
const mode = process.argv[2] === 'full' ? 'full' : 'auto';
const t0 = Date.now();
const result = await runScan({ mode, dryRun: true, log: (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`) });
if (result.skipped) { console.log(`skipped: ${result.skipped}`); process.exit(0); }

const s = result.summary;
console.log('\n== summary ==');
console.log(`chats ${s.total}  active ${s.active}  needs action ${s.actionable}  no contact 7d+ ${s.noContact7d}  waiting ${s.waiting}  unhappy ${s.unhappy}  ignored ${s.ignored}  time-barred ${s.barred}  left ${s.left}`);
console.log(`history read ${s.historyRead}  event stream ${s.historyEvents}  unavailable ${s.historyUnavailable}  pending ${s.historyPending}  contacted 7d ${s.contacted7d}/${s.contactKnown}  reply median ${s.replyMedianMins}m p90 ${s.replyP90Mins}m over ${s.replyMeasured} chats`);

console.log(`\n== alerts that would post (${result.posted} of ${result.due} due${result.seeded ? '' : ', cold start so all seeded'}) ==`);
for (const r of result.rows.filter((x) => x.flags.no_contact && !x.flags.barred && !x.flags.left).slice(0, 5)) console.log(formatAlert('no_contact', r), '\n');
console.log(`done in ${(result.ms / 1000).toFixed(1)}s`);
