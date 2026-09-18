import { useEffect, useMemo, useState } from 'react';
import Shell from '../components/Shell';
import Icon from '../components/Icon';
import { Stats, BarList, Histogram, Trend } from '../components/Charts';
import { useSnapshot, STATES, ACTIONABLE } from '../components/useSnapshot';

// Benchmarks are from published VIP management practice, not invented here, so
// a number on this page can be argued with rather than just displayed:
//   first response inside 5 minutes
//   30 to 50 active accounts per manager
//   outreach ladder at day 1, day 8 and day 15, stop after three unanswered
//   27% of churned players return if engaged on day one of silence, 2% after
//   three months, which is why the day-one bucket is called out on its own
const LOAD_MAX = 50;
const FIRST_REPLY_TARGET = 5;

const SILENCE_BUCKETS = [
  { key: 'd0', label: 'Today', lo: 0, hi: 1 },
  { key: 'd1', label: '1-7d', lo: 1, hi: 8 },
  { key: 'd8', label: '8-14d', lo: 8, hi: 15 },
  { key: 'd15', label: '15-30d', lo: 15, hi: 31 },
  { key: 'd31', label: '31-90d', lo: 31, hi: 91 },
  { key: 'd90', label: '90d+', lo: 91, hi: Infinity },
];
const REPLY_BUCKETS = [
  { key: 'r5', label: 'under 5m', lo: 0, hi: 5 },
  { key: 'r30', label: '5-30m', lo: 5, hi: 30 },
  { key: 'r120', label: '30m-2h', lo: 30, hi: 120 },
  { key: 'r720', label: '2-12h', lo: 120, hi: 720 },
  { key: 'r1440', label: '12-24h', lo: 720, hi: 1440 },
  { key: 'rmax', label: 'over 24h', lo: 1440, hi: Infinity },
];
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
const mins = (m) => (m == null ? '–' : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`);

export default function Overview() {
  const { session, snap, rows, error, scan, runScan } = useSnapshot();
  const [history, setHistory] = useState(null);
  useEffect(() => { fetch('/api/history').then((r) => (r.ok ? r.json() : null)).then(setHistory).catch(() => {}); }, [snap]);

  const m = useMemo(() => {
    const hosted = rows.filter((r) => r.hostActive);
    const counts = rows.reduce((a, r) => ({ ...a, [r.state]: (a[r.state] || 0) + 1 }), {});
    const replies = hosted.map((r) => r.replyMedianMins).filter((v) => v != null);
    const byHost = new Map();
    for (const r of hosted) {
      const k = r.host || 'unassigned';
      if (!byHost.has(k)) byHost.set(k, []);
      byHost.get(k).push(r);
    }
    const silence = SILENCE_BUCKETS.map((b) => ({
      ...b, value: hosted.filter((r) => (r.quietDays ?? -1) >= b.lo && (r.quietDays ?? -1) < b.hi).length,
    }));
    const reply = REPLY_BUCKETS.map((b) => ({
      ...b, value: hosted.filter((r) => r.replyMedianMins != null && r.replyMedianMins >= b.lo && r.replyMedianMins < b.hi).length,
    }));
    const moods = ['at_risk', 'negative', 'neutral', 'positive'].map((k) => ({
      key: k, label: k === 'at_risk' ? 'At risk' : k[0].toUpperCase() + k.slice(1),
      value: hosted.filter((r) => (r.sentiment?.label || 'neutral') === k).length,
      tone: { at_risk: 'badge-red', negative: 'badge-orange', neutral: 'badge-gray', positive: 'badge-green' }[k],
    }));
    return {
      counts, hosted, byHost, silence, reply, moods,
      actionable: hosted.filter((r) => ACTIONABLE.includes(r.state)).length,
      medianReply: median(replies),
      replyCovered: replies.length,
      winBack: silence.find((b) => b.key === 'd1')?.value ?? 0,
      today: silence.find((b) => b.key === 'd0')?.value ?? 0,
      cold: silence.find((b) => b.key === 'd90')?.value ?? 0,
      overloaded: [...byHost.entries()].filter(([, v]) => v.length > LOAD_MAX).length,
      pending: rows.filter((r) => r.historyState === 'pending').length,
      unavailable: rows.filter((r) => r.historyState === 'unavailable').length,
    };
  }, [rows]);

  const days = (history?.daily || []).slice(-30);
  const toolbar = (
    <>
      <span className="ow-section-title typ-label-small">Overview</span>
      <div className="th-toolbar-spacer" />
      <span className="ow-toolbar-note typ-label-small">
        {scan.note || (snap ? `Scanned ${new Date(snap.generatedAt).toLocaleString()}` : '')}
      </span>
      <button type="button" className="th-pill th-pill-primary focusable" onClick={runScan} disabled={scan.busy} aria-disabled={scan.busy}>
        {scan.busy ? <span className="ow-spin" /> : <Icon name="retry" size={12} />}
        <span className="th-pill-label typ-label-medium">{scan.busy ? 'Scanning' : 'Scan now'}</span>
      </button>
    </>
  );

  if (error) {
    return (
      <Shell title="Overview" email={session?.user?.email} toolbar={toolbar}>
        <div className="th-empty">
          <div className="th-empty-title typ-heading-small">No data yet</div>
          <div className="th-empty-sub typ-paragraph-small">
            {/^no snapshot/i.test(error) ? 'Nothing has scanned yet. Press Scan now, or wait for the cron.' : error}
          </div>
        </div>
      </Shell>
    );
  }
  if (!snap) return <Shell title="Overview" email={session?.user?.email} toolbar={toolbar}>{null}</Shell>;

  return (
    <Shell title="Overview" email={session?.user?.email} toolbar={toolbar}>
      <div className="ow-page">
        <Stats items={[
          { key: 'act', label: 'Needs action', value: m.actionable, tone: 'badge-orange', sub: `of ${m.hosted.length} hosted players` },
          { key: 'wait', label: 'Waiting on a reply', value: m.counts.waiting_on_us || 0, tone: 'badge-red', sub: 'player wrote, nobody answered' },
          { key: 'rep', label: 'Median first reply', value: mins(m.medianReply), sub: `target under ${FIRST_REPLY_TARGET}m · ${m.replyCovered} chats measured` },
          { key: 'win', label: 'Win-back window', value: m.winBack, tone: 'badge-green', sub: 'silent 1 to 7 days, best odds of return' },
          { key: 'risk', label: 'Unhappy', value: m.counts.at_risk || 0, tone: 'badge-red', sub: 'sentiment negative or churn signalled' },
          { key: 'cold', label: 'Past 90 days', value: m.cold, tone: 'badge-gray', sub: 'recovery rate collapses out here' },
        ]} />

        <div className="ow-section-head">
          <span className="ow-section-title typ-label-small">The book</span>
          <span className="ow-section-sub typ-label-small">
            {m.pending ? `${m.pending} chats still queued for a history read` : 'history read for every chat'}
            {m.unavailable ? `, ${m.unavailable} not readable` : ''}
          </span>
        </div>
        <div className="ow-charts">
          <BarList
            title="Where the book sits"
            sub={`${m.hosted.length} hosted`}
            rows={STATES.map((s) => ({ key: s.key, label: s.label, value: m.counts[s.key] || 0, tone: s.tone }))}
          />
          <BarList
            title="Mood"
            sub={m.moods.every((x) => !x.value) ? 'no sentiment scored yet' : `${m.moods.reduce((a, b) => a + b.value, 0)} scored`}
            rows={m.moods}
          />
        </div>

        <div className="ow-section-head">
          <span className="ow-section-title typ-label-small">Silence, against the outreach ladder</span>
          <span className="ow-section-sub typ-label-small">check in on day 1, follow up on day 8, last soft touch on day 15</span>
        </div>
        <div className="ow-charts ow-charts-wide">
          <Histogram title="Days since anyone spoke" sub={`${m.today} active today`} buckets={m.silence} />
        </div>

        <div className="ow-section-head">
          <span className="ow-section-title typ-label-small">How fast we answer</span>
          <span className="ow-section-sub typ-label-small">first reply to a player&rsquo;s message, median per chat</span>
        </div>
        <div className="ow-charts ow-charts-wide">
          <Histogram title="Time to first reply" sub={`median ${mins(m.medianReply)}`} buckets={m.reply} />
        </div>

        <div className="ow-section-head">
          <span className="ow-section-title typ-label-small">Load</span>
          <span className="ow-section-sub typ-label-small">
            {m.overloaded ? `${m.overloaded} host${m.overloaded === 1 ? '' : 's'} above the 30 to 50 account guideline` : 'within the 30 to 50 account guideline'}
          </span>
        </div>
        <div className="ow-charts ow-charts-wide">
          <BarList
            title="Players per host"
            sub={`guideline ${LOAD_MAX} maximum`}
            rows={[...m.byHost.entries()].sort((a, b) => b[1].length - a[1].length).map(([h, v]) => ({
              key: h, label: h, value: v.length, tone: v.length > LOAD_MAX ? 'badge-red' : 'badge-green',
            }))}
          />
        </div>

        <div className="ow-section-head">
          <span className="ow-section-title typ-label-small">Trend</span>
          <span className="ow-section-sub typ-label-small">one point per day</span>
        </div>
        <div className="ow-charts ow-charts-wide">
          <Trend
            title="Players needing action"
            sub={days.length ? `${days.length} days` : null}
            days={days.map((d) => d.day?.slice(5) || '')}
            series={[
              { key: 'waiting', label: 'waiting', tone: 'badge-red', values: days.map((d) => d.counts?.waiting_on_us || 0) },
              { key: 'quiet', label: 'quiet', tone: 'badge-yellow', values: days.map((d) => d.counts?.quiet || 0) },
            ]}
          />
        </div>
      </div>
    </Shell>
  );
}
