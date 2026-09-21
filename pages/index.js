import { useEffect, useMemo, useState } from 'react';
import Shell, { ScanStatus, Empty } from '../components/Shell';
import { Stats, BarList, Histogram, Trend } from '../components/Charts';
import { useSnapshot } from '../components/useSnapshot';
import { SILENCE_BUCKETS, REPLY_BUCKETS, silenceBucket, replyBucket, queueHref } from '../components/filters';
import { STATES, MOODS, ACTIONABLE, mins, pct, age } from '../lib/states.js';

export default function Overview() {
  const s = useSnapshot();
  const { session, snap, rows, summary, error } = s;
  const [history, setHistory] = useState(null);
  useEffect(() => { if (snap) fetch('/api/history').then((r) => (r.ok ? r.json() : null)).then(setHistory).catch(() => {}); }, [snap?.generatedAt]);

  const m = useMemo(() => {
    const hosted = rows.filter((r) => !r.flags.left && !r.flags.not_joined);
    const silence = SILENCE_BUCKETS.map((b) => ({ ...b, value: hosted.filter((r) => silenceBucket(r) === b.key).length, href: queueHref({ f: 'all', silence: b.key }) }));
    const reply = REPLY_BUCKETS.map((b) => ({ ...b, value: hosted.filter((r) => replyBucket(r) === b.key).length, href: queueHref({ f: 'all', reply: b.key }) }));
    const moods = MOODS.map((k) => ({ key: k.key, label: k.label, tone: k.tone, value: hosted.filter((r) => (r.sentiment?.label || 'neutral') === k.key).length, href: queueHref({ f: 'all', mood: k.key }) }));
    const scored = hosted.filter((r) => r.sentiment).length;
    return { hosted, silence, reply, moods, scored };
  }, [rows]);

  const days = (history?.daily || []).slice(-30);
  const status = <ScanStatus {...s} />;

  if (error || !snap || !summary) {
    return <Shell title="Overview" email={session?.user?.email} monitor={Boolean(session?.monitor)} status={status}><Empty error={error} /></Shell>;
  }

  const tiles = [
    { key: 'hosted', label: 'Groups', value: summary.active, sub: [summary.notJoined ? `${summary.notJoined} not joined` : null, summary.left ? `${summary.left} left` : null].filter(Boolean).join(' · ') || null, href: queueHref({ tab: 'active' }) },
    { key: 'cov', label: 'Contacted in last 7 days', value: pct(summary.contacted7d, summary.contactKnown), tone: 'green', sub: `${summary.contacted7d} of ${summary.contactKnown}`, href: queueHref({ f: 'contacted' }) },
    { key: 'nc', label: 'No contact 7d+', value: summary.noContact7d, tone: summary.noContact7d ? 'yellow' : 'green', sub: summary.noContact7d ? `${pct(summary.noContact7d, summary.active)} of active` : null, href: queueHref({ f: 'no_contact' }) },
    { key: 'wait', label: 'Waiting on a reply', value: summary.waiting, tone: summary.waiting ? 'orange' : 'green', sub: summary.waiting ? `longest ${age(summary.waitingOldestDays)}` : null, href: queueHref({ f: 'waiting' }) },
    { key: 'unhappy', label: 'Unhappy', value: summary.unhappy, tone: summary.unhappy ? 'red' : 'green', sub: `${m.scored} scored`, href: queueHref({ mood: 'at_risk' }) },
    { key: 'reply', label: 'Median first reply', value: mins(summary.replyMedianMins), sub: summary.replyMeasured ? `p90 ${mins(summary.replyP90Mins)} · ${summary.replyMeasured} chats` : null },
  ];

  return (
    <Shell title="Overview" email={session?.user?.email} monitor={Boolean(session?.monitor)} status={status}>
      <div className="ow-page ow-page-top">
        <Stats items={tiles} />

        <div className="ow-charts">
          <Histogram title="Days since we last spoke" buckets={m.silence} tone="yellow" />
          <BarList title="Mood" sub={m.scored ? `${m.scored} scored` : null} rows={m.moods} />
        </div>
        <div className="ow-charts">
          <BarList title="State" rows={STATES.map((st) => ({ key: st.key, label: st.label, value: summary.counts[st.key] || 0, tone: st.tone, href: queueHref(st.key === 'left' ? { tab: 'left' } : st.key === 'not_joined' ? { tab: 'not_joined' } : { f: st.key }) }))} />
          {summary.replyMeasured ? <Histogram title="Time to first reply" sub={`median ${mins(summary.replyMedianMins)} · p90 ${mins(summary.replyP90Mins)}`} buckets={m.reply} tone="green" /> : null}
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
