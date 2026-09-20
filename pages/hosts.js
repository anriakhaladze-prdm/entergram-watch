import { useMemo } from 'react';
import { useRouter } from 'next/router';
import Shell, { ScanStatus, Empty } from '../components/Shell';
import { Stats } from '../components/Charts';
import { useSnapshot } from '../components/useSnapshot';
import { queueHref } from '../components/filters';
import { mins, pct } from '../lib/states.js';

// Per person, not per connected account. A player's host is the hosting team
// member who does the talking in their group, so the figures here are about
// how each person's book is being worked.
const COLS = [
  { key: 'host', label: 'Host', w: 'minmax(180px, 1.3fr)' },
  { key: 'players', label: 'Players', w: '100px', num: true },
  { key: 'contacted', label: 'Contacted 7d', w: '120px', num: true },
  { key: 'no_contact', label: 'No contact 7d+', w: '128px', num: true },
  { key: 'waiting', label: 'Waiting', w: '92px', num: true },
  { key: 'unhappy', label: 'Unhappy', w: '92px', num: true },
  { key: 'ignored', label: 'Ignoring', w: '100px', num: true },
  { key: 'reply', label: 'Median reply', w: '136px', num: true },
  { key: 'p90', label: 'p90 reply', w: '104px', num: true },
  { key: 'dormant', label: 'Dormant', w: '92px', num: true },
];

export default function Hosts() {
  const s = useSnapshot();
  const { session, snap, rows, summary, error } = s;
  const router = useRouter();

  const hosts = useMemo(() => {
    const by = new Map();
    for (const r of rows) {
      if (r.flags.left || r.flags.unhosted) continue;
      const k = r.host || 'unattributed';
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(r);
    }
    return [...by.entries()].map(([host, list]) => {
      const replies = list.map((r) => r.reply?.medianMins).filter((v) => v != null).sort((a, b) => a - b);
      const p90s = list.map((r) => r.reply?.p90Mins).filter((v) => v != null).sort((a, b) => a - b);
      return {
        host, email: list.find((r) => r.hostEmail)?.hostEmail || null,
        unattributed: list.every((r) => r.hostUnattributed),
        players: list.length,
        known: list.filter((r) => r.staffQuietDays != null).length,
        contacted: list.filter((r) => r.flags.contacted7d).length,
        no_contact: list.filter((r) => r.flags.no_contact && !r.flags.dormant).length,
        waiting: list.filter((r) => r.flags.waiting).length,
        unhappy: list.filter((r) => r.flags.unhappy).length,
        ignored: list.filter((r) => r.flags.ignored).length,
        dormant: list.filter((r) => r.flags.dormant).length,
        reply: replies.length ? replies[Math.floor(replies.length / 2)] : null,
        p90: p90s.length ? p90s[Math.min(p90s.length - 1, Math.floor(p90s.length * 0.9))] : null,
        measured: replies.length,
      };
    }).sort((a, b) => b.players - a.players);
  }, [rows]);

  const unhostedRows = rows.filter((r) => r.flags.unhosted);
  const unattributed = rows.filter((r) => r.hostUnattributed && !r.flags.left && !r.flags.unhosted).length;
  const unidentified = summary?.unidentified || [];
  const status = <ScanStatus {...s} compact />;
  const cell = (c, cls = '') => <div className="th-grid-cell"><div><span className={`th-grid-cell-inner typ-label-medium ${cls}`}>{c}</span></div></div>;

  if (error || !snap) return <Shell title="Hosts" crumb="Hosts" email={session?.user?.email} status={status}><Empty error={error} /></Shell>;

  return (
    <Shell title="Hosts" crumb="Hosts" email={session?.user?.email} status={status}>
      <div className="ow-page">
        <div className="ow-strip">
          <span className="ow-strip-main typ-label-small">{hosts.filter((h) => !h.unattributed).length} hosts · {summary.hosted} hosted players</span>
        </div>
        <div className="th-grid-scroll ow-grid-inline">
          <div className="th-grid" style={{ gridTemplateColumns: COLS.map((c) => c.w).join(' ') }}>
            <div className="th-grid-headgroup">
              <div className="th-grid-headrow">
                {COLS.map((c) => <div key={c.key} className="th-grid-headcell"><div><span className={`th-grid-headlabel${c.num ? ' ow-right' : ''}`}>{c.label}</span></div></div>)}
              </div>
            </div>
            <div className="th-grid-body">
              {hosts.map((h) => (
                <div className="th-grid-row is-link" key={h.host} onClick={() => router.push(queueHref({ f: 'hosted', host: h.host }))} role="link" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') router.push(queueHref({ f: 'hosted', host: h.host })); }}>
                  {cell(<>
                    {h.host}
                    {h.unattributed ? <span className="th-badge th-badge-gray typ-label-small ow-inline-badge">shared account, no person</span> : h.email ? <span className="ow-sub ow-small"> · {h.email}</span> : null}
                  </>, 'ow-clip')}
                  {cell(h.players, 'ow-nums')}
                  {cell(<>{pct(h.contacted, h.known)}<span className="ow-sub ow-small"> {h.contacted}/{h.known}</span></>, 'ow-nums')}
                  {cell(h.no_contact || '–', `ow-nums${h.no_contact ? ' ow-warn' : ''}`)}
                  {cell(h.waiting || '–', `ow-nums${h.waiting ? ' ow-stale' : ''}`)}
                  {cell(h.unhappy || '–', `ow-nums${h.unhappy ? ' ow-stale' : ''}`)}
                  {cell(h.ignored || '–', 'ow-nums ow-sub')}
                  {cell(<>{mins(h.reply)}{h.measured ? <span className="ow-sub ow-small"> {h.measured}</span> : null}</>, `ow-nums${h.reply != null && h.reply > 60 ? ' ow-stale' : ''}`)}
                  {cell(mins(h.p90), 'ow-nums ow-sub')}
                  {cell(h.dormant || '–', 'ow-nums ow-sub')}
                </div>
              ))}
            </div>
          </div>
        </div>

        <Stats items={[
          { key: 'unattr', label: 'Unattributed', value: unattributed, tone: unattributed ? 'gray' : undefined, sub: 'only the shared account has spoken', href: queueHref({ f: 'unattributed' }) },
          { key: 'unhosted', label: 'Unhosted', value: unhostedRows.length, tone: unhostedRows.length ? 'blue' : undefined, sub: 'former host, kept off the alerts', href: queueHref({ f: 'unhosted' }) },
          { key: 'unread', label: 'History not readable', value: summary.historyUnavailable, tone: summary.historyUnavailable ? 'yellow' : undefined, sub: '@Thrill_VIP_Ops not in the group', href: queueHref({ f: 'unavailable' }) },
        ]} />
        {unidentified.length ? (
          <>
            <div className="ow-section-head">
              <span className="ow-section-title typ-label-small">Unidentified staff senders</span>
              <span className="ow-section-sub typ-label-small">add the Telegram id to config/team.json</span>
            </div>
            <div className="th-grid-scroll ow-grid-inline">
              <div className="th-grid" style={{ gridTemplateColumns: '200px minmax(200px, 1fr) 120px' }}>
                <div className="th-grid-headgroup"><div className="th-grid-headrow">
                  {['Telegram id', 'Display name', 'Groups'].map((l) => <div key={l} className="th-grid-headcell"><div><span className="th-grid-headlabel">{l}</span></div></div>)}
                </div></div>
                <div className="th-grid-body">
                  {unidentified.map((u) => (
                    <div className="th-grid-row" key={u.id}>
                      {cell(u.id, 'ow-nums')}{cell(u.name || '–', 'ow-clip')}{cell(u.chats, 'ow-nums')}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </Shell>
  );
}
