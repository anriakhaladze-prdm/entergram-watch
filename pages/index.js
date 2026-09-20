import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Shell, { ScanStatus, Empty } from '../components/Shell';
import { Stats, BarList, Histogram, Trend } from '../components/Charts';
import { useSnapshot, fmtAge } from '../components/useSnapshot';
import { SILENCE_BUCKETS, REPLY_BUCKETS, silenceBucket, replyBucket, queueHref } from '../components/filters';
import { STATES, MOODS, ACTIONABLE, mins, pct, age } from '../lib/states.js';

const HOST_COLS = [
  { key: 'host', label: 'Host', w: 'minmax(180px, 1.4fr)' },
  { key: 'players', label: 'Players', w: '96px', num: true },
  { key: 'contacted', label: 'Contacted 7d', w: '120px', num: true },
  { key: 'no_contact', label: 'No contact 7d+', w: '128px', num: true },
  { key: 'waiting', label: 'Waiting', w: '96px', num: true },
  { key: 'unhappy', label: 'Unhappy', w: '96px', num: true },
  { key: 'reply', label: 'Median reply', w: '128px', num: true },
];

export default function Overview() {
  const s = useSnapshot();
  const { session, snap, rows, summary, error } = s;
  const router = useRouter();
  const [history, setHistory] = useState(null);
  useEffect(() => { if (snap) fetch('/api/history').then((r) => (r.ok ? r.json() : null)).then(setHistory).catch(() => {}); }, [snap?.generatedAt]);

  const m = useMemo(() => {
    const hosted = rows.filter((r) => !r.flags.left && !r.flags.unhosted && !r.flags.barred);
    const byHost = new Map();
    for (const r of hosted) {
      const k = r.host || 'unattributed';
      if (!byHost.has(k)) byHost.set(k, []);
      byHost.get(k).push(r);
    }
    const hosts = [...byHost.entries()].map(([host, list]) => {
      const known = list.filter((r) => r.staffQuietDays != null).length;
      const replies = list.map((r) => r.reply?.medianMins).filter((v) => v != null).sort((a, b) => a - b);
      return {
        host, players: list.length,
        contacted: list.filter((r) => r.flags.contacted7d).length, known,
        no_contact: list.filter((r) => r.flags.no_contact && !r.flags.barred).length,
        waiting: list.filter((r) => r.flags.waiting).length,
        unhappy: list.filter((r) => r.flags.unhappy).length,
        reply: replies.length ? replies[Math.floor(replies.length / 2)] : null,
        unattributed: list[0]?.hostUnattributed && host !== 'unattributed',
      };
    }).sort((a, b) => b.players - a.players);
    const silence = SILENCE_BUCKETS.map((b) => ({ ...b, value: hosted.filter((r) => silenceBucket(r) === b.key).length, href: queueHref({ f: 'hosted', silence: b.key }) }));
    const reply = REPLY_BUCKETS.map((b) => ({ ...b, value: hosted.filter((r) => replyBucket(r) === b.key).length, href: queueHref({ f: 'hosted', reply: b.key }) }));
    const moods = MOODS.map((k) => ({ key: k.key, label: k.label, tone: k.tone, value: hosted.filter((r) => (r.sentiment?.label || 'neutral') === k.key).length, href: queueHref({ f: 'hosted', mood: k.key }) }));
    const scored = hosted.filter((r) => r.sentiment).length;
    return { hosted, hosts, silence, reply, moods, scored };
  }, [rows]);

  const days = (history?.daily || []).slice(-30);
  const run = snap?.run || null;
  const status = <ScanStatus {...s} />;

  if (error || !snap || !summary) {
    return <Shell title="Overview" email={session?.user?.email} status={status}><Empty error={error} /></Shell>;
  }

  const tiles = [
    { key: 'hosted', label: 'Active players', value: summary.active, sub: `${summary.total} chats · ${summary.barred} time-barred · ${summary.left} left · ${summary.unhosted} unhosted`, href: queueHref({ tab: 'active' }) },
    { key: 'cov', label: 'Contacted in last 7 days', value: pct(summary.contacted7d, summary.contactKnown), tone: 'green', sub: `${summary.contacted7d} of ${summary.contactKnown} known${summary.active - summary.contactKnown ? `, ${summary.active - summary.contactKnown} unknown` : ''}`, href: queueHref({ f: 'contacted' }) },
    { key: 'nc', label: 'No contact 7d+', value: summary.noContact7d, tone: summary.noContact7d ? 'yellow' : 'green', sub: 'Slack alert lane · time-barred excluded', href: queueHref({ f: 'no_contact' }) },
    { key: 'wait', label: 'Waiting on a reply', value: summary.waiting, tone: summary.waiting ? 'orange' : 'green', sub: summary.waiting ? `longest wait ${age(summary.waitingOldestDays)}` : 'every message answered', href: queueHref({ f: 'waiting' }) },
    { key: 'unhappy', label: 'Unhappy', value: summary.unhappy, tone: summary.unhappy ? 'red' : 'green', sub: `${m.scored} of ${summary.active} scored`, href: queueHref({ mood: 'at_risk' }) },
    { key: 'reply', label: 'Median first reply', value: mins(summary.replyMedianMins), sub: summary.replyMeasured ? `p90 ${mins(summary.replyP90Mins)} · ${summary.replyMeasured} chats measured` : 'no exchanges measured yet', href: '/hosts' },
  ];

  const cell = (c, cls = '') => <div className="th-grid-cell"><div><span className={`th-grid-cell-inner typ-label-medium ${cls}`}>{c}</span></div></div>;

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
            {summary.historyEvents ? <>, <Link className="th-link" href={queueHref({ f: 'events' })}>{summary.historyEvents} from the event stream</Link></> : null}
            {summary.historyUnavailable ? <>, <Link className="th-link" href={queueHref({ f: 'unavailable' })}>{summary.historyUnavailable} timing only</Link></> : null}
            {summary.historyPending ? `, ${summary.historyPending} queued` : ''}
            {' · '}<Link className="th-link" href="/activity">activity</Link>
          </span>
        </div>

        <Stats items={tiles} />

        <div className="ow-section-head">
          <span className="ow-section-title typ-label-small">By host</span>
        </div>
        <div className="th-grid-scroll ow-grid-inline">
          <div className="th-grid" style={{ gridTemplateColumns: HOST_COLS.map((c) => c.w).join(' ') }}>
            <div className="th-grid-headgroup">
              <div className="th-grid-headrow">
                {HOST_COLS.map((c) => <div key={c.key} className="th-grid-headcell"><div><span className={`th-grid-headlabel${c.num ? ' ow-right' : ''}`}>{c.label}</span></div></div>)}
              </div>
            </div>
            <div className="th-grid-body">
              {m.hosts.map((h) => (
                <div className="th-grid-row is-link" key={h.host} onClick={() => router.push(queueHref({ f: 'hosted', host: h.host }))} role="link" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') router.push(queueHref({ f: 'hosted', host: h.host })); }}>
                  {cell(<>{h.host}{h.host === 'unattributed' || h.unattributed ? <span className="th-badge th-badge-gray typ-label-small ow-inline-badge">shared account</span> : null}</>)}
                  {cell(h.players, 'ow-nums')}
                  {cell(<>{pct(h.contacted, h.known)}<span className="ow-sub ow-small"> {h.contacted}/{h.known}</span></>, 'ow-nums')}
                  {cell(h.no_contact || '–', `ow-nums${h.no_contact ? ' ow-warn' : ''}`)}
                  {cell(h.waiting || '–', `ow-nums${h.waiting ? ' ow-stale' : ''}`)}
                  {cell(h.unhappy || '–', `ow-nums${h.unhappy ? ' ow-stale' : ''}`)}
                  {cell(mins(h.reply), 'ow-nums')}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="ow-section-head">
          <span className="ow-section-title typ-label-small">Where the book sits</span>
          <span className="ow-section-sub typ-label-small">{summary.active} active players</span>
        </div>
        <div className="ow-charts">
          <Histogram title="Days since we last spoke" sub="hosted players" buckets={m.silence} tone="yellow" />
          <BarList title="Mood" sub={m.scored ? `${m.scored} scored` : 'nothing scored yet'} rows={m.moods} />
        </div>
        <div className="ow-charts">
          <BarList title="State" sub="one state per player" rows={STATES.map((st) => ({ key: st.key, label: st.label, value: summary.counts[st.key] || 0, tone: st.tone, href: queueHref(st.key === 'barred' ? { tab: 'barred' } : st.key === 'left' || st.key === 'unhosted' ? { tab: 'gone', f: st.key } : { f: st.key }) }))} />
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
