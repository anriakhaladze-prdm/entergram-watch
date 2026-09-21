import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Shell, { ScanStatus, Empty } from '../components/Shell';
import { Stats, BarList, Histogram, Trend } from '../components/Charts';
import { useSnapshot, fmtAge } from '../components/useSnapshot';
import { SILENCE_BUCKETS, REPLY_BUCKETS, silenceBucket, replyBucket, queueHref } from '../components/filters';
import { STATES, MOODS, ACTIONABLE, mins, pct, age } from '../lib/states.js';

export default function Overview() {
  const s = useSnapshot();
  const { session, snap, rows, summary, error } = s;
  const [history, setHistory] = useState(null);
  useEffect(() => { if (snap) fetch('/api/history').then((r) => (r.ok ? r.json() : null)).then(setHistory).catch(() => {}); }, [snap?.generatedAt]);

  const m = useMemo(() => {
    const hosted = rows.filter((r) => !r.flags.left && !r.flags.barred);
    const silence = SILENCE_BUCKETS.map((b) => ({ ...b, value: hosted.filter((r) => silenceBucket(r) === b.key).length, href: queueHref({ f: 'all', silence: b.key }) }));
    const reply = REPLY_BUCKETS.map((b) => ({ ...b, value: hosted.filter((r) => replyBucket(r) === b.key).length, href: queueHref({ f: 'all', reply: b.key }) }));
    const moods = MOODS.map((k) => ({ key: k.key, label: k.label, tone: k.tone, value: hosted.filter((r) => (r.sentiment?.label || 'neutral') === k.key).length, href: queueHref({ f: 'all', mood: k.key }) }));
    const scored = hosted.filter((r) => r.sentiment).length;
    return { hosted, silence, reply, moods, scored };
  }, [rows]);

  const days = (history?.daily || []).slice(-30);
  const run = snap?.run || null;
  const status = <ScanStatus {...s} />;

  if (error || !snap || !summary) {
    return <Shell title="Overview" email={session?.user?.email} status={status}><Empty error={error} /></Shell>;
  }

  const tiles = [
    { key: 'hosted', label: 'Active players', value: summary.active, sub: `${summary.total} chats · ${summary.barred} time-barred · ${summary.left} left`, href: queueHref({ tab: 'active' }) },
    { key: 'cov', label: 'Contacted in last 7 days', value: pct(summary.contacted7d, summary.contactKnown), tone: 'green', sub: `${summary.contacted7d} of ${summary.contactKnown} known${summary.active - summary.contactKnown ? `, ${summary.active - summary.contactKnown} unknown` : ''}`, href: queueHref({ f: 'contacted' }) },
    { key: 'nc', label: 'No contact 7d+', value: summary.noContact7d, tone: summary.noContact7d ? 'yellow' : 'green', sub: 'Slack alert lane · time-barred excluded', href: queueHref({ f: 'no_contact' }) },
    { key: 'wait', label: 'Waiting on a reply', value: summary.waiting, tone: summary.waiting ? 'orange' : 'green', sub: summary.waiting ? `longest wait ${age(summary.waitingOldestDays)}` : 'every message answered', href: queueHref({ f: 'waiting' }) },
    { key: 'unhappy', label: 'Unhappy', value: summary.unhappy, tone: summary.unhappy ? 'red' : 'green', sub: `${m.scored} of ${summary.active} scored`, href: queueHref({ mood: 'at_risk' }) },
    { key: 'reply', label: 'Median first reply', value: mins(summary.replyMedianMins), sub: summary.replyMeasured ? `p90 ${mins(summary.replyP90Mins)} · ${summary.replyMeasured} chats measured` : 'no exchanges measured yet' },
  ];

  return (
    <Shell title="Overview" email={session?.user?.email} status={status}>
      <div className="ow-page">
        <div className="ow-strip">
          <span className="ow-strip-main typ-label-small">
            {run ? `${run.mode === 'full' ? 'Full sweep' : 'Incremental scan'} ${fmtAge(s.scanAgeMin)} in ${Math.round(run.ms / 1000)}s · ${run.changed} chats moved · ${run.read} histories read · ${run.posted} alert${run.posted === 1 ? '' : 's'} posted` : 'Scan details unavailable'}
            {run?.alertError ? ` · ${run.alertError}` : ''}
          </span>
          <span className="ow-strip-sub typ-label-small">
            {summary.historyRead} chats with readable history
            {summary.historyEvents ? <>, <Link className="th-link" href={queueHref({ f: 'all', history: 'events' })}>{summary.historyEvents} from the event stream</Link></> : null}
            {summary.historyUnavailable ? <>, <Link className="th-link" href={queueHref({ f: 'all', history: 'unavailable' })}>{summary.historyUnavailable} timing only</Link></> : null}
            {summary.historyPending ? `, ${summary.historyPending} queued` : ''}
            {' · '}<Link className="th-link" href="/activity">activity</Link>
          </span>
        </div>

        <Stats items={tiles} />

        <div className="ow-section-head">
          <span className="ow-section-title typ-label-small">Where the book sits</span>
          <span className="ow-section-sub typ-label-small">{summary.active} active players</span>
        </div>
        <div className="ow-charts">
          <Histogram title="Days since we last spoke" sub="active players" buckets={m.silence} tone="yellow" />
          <BarList title="Mood" sub={m.scored ? `${m.scored} scored` : 'nothing scored yet'} rows={m.moods} />
        </div>
        <div className="ow-charts">
          <BarList title="State" sub="one state per player" rows={STATES.map((st) => ({ key: st.key, label: st.label, value: summary.counts[st.key] || 0, tone: st.tone, href: queueHref(st.key === 'barred' ? { tab: 'barred' } : st.key === 'left' ? { tab: 'left' } : { f: st.key }) }))} />
          {summary.replyMeasured ? <Histogram title="Time to first reply" sub={`median ${mins(summary.replyMedianMins)} · p90 ${mins(summary.replyP90Mins)}`} buckets={m.reply} tone="green" /> : null}
        </div>

        <div className="ow-section-head">
          <span className="ow-section-title typ-label-small">Trend</span>
        </div>
        <div className="ow-charts ow-charts-wide">
          <Trend title="Players needing action" sub={days.length > 1 ? `${days.length} days` : null} days={days.map((d) => d.day?.slice(5) || '')}
            series={[
              { key: 'nc', label: 'no contact 7d+', tone: 'yellow', values: days.map((d) => d.noContact7d ?? 0) },
              { key: 'w', label: 'waiting', tone: 'orange', values: days.map((d) => d.waiting ?? 0) },
              { key: 'u', label: 'unhappy', tone: 'red', values: days.map((d) => d.unhappy ?? 0) },
            ]} />
        </div>
      </div>
    </Shell>
  );
}
