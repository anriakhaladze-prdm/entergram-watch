import { useMemo } from 'react';
import Shell from '../components/Shell';
import Icon from '../components/Icon';
import { useSnapshot, ACTIONABLE } from '../components/useSnapshot';

// Per host, because the load guideline and the response-time target are both
// per person: a book of 600 players cannot be worked to a five-minute first
// reply, and showing the two together is what makes that arguable.
const LOAD_MAX = 50;
const COLS = [
  { key: 'host',    label: 'Host',         w: 'minmax(200px, 1fr)' },
  { key: 'account', label: 'Account',      w: '180px' },
  { key: 'players', label: 'Players',      w: '110px' },
  { key: 'waiting', label: 'Waiting',      w: '110px' },
  { key: 'action',  label: 'Needs action', w: '140px' },
  { key: 'reply',   label: 'Median reply', w: '140px' },
  { key: 'worst',   label: 'Worst reply',  w: '130px' },
  { key: 'quiet',   label: 'Silent 7d+',   w: '130px' },
];
const mins = (m) => (m == null ? '–' : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`);
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

export default function Hosts() {
  const { session, snap, rows, error, scan, runScan } = useSnapshot();

  const hosts = useMemo(() => {
    const by = new Map();
    for (const r of rows) {
      const k = r.host || 'unassigned';
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(r);
    }
    return [...by.entries()].map(([host, list]) => {
      const replies = list.map((r) => r.replyMedianMins).filter((v) => v != null);
      return {
        host,
        account: list[0]?.hostAccount || null,
        active: list.some((r) => r.hostActive),
        players: list.length,
        waiting: list.filter((r) => r.state === 'waiting_on_us').length,
        action: list.filter((r) => ACTIONABLE.includes(r.state)).length,
        reply: median(replies),
        worst: replies.length ? Math.max(...list.map((r) => r.replyWorstMins || 0)) : null,
        quiet: list.filter((r) => (r.quietDays ?? 0) >= 7).length,
      };
    }).sort((a, b) => b.players - a.players);
  }, [rows]);

  const toolbar = (
    <>
      <span className="ow-section-title typ-label-small">Hosts</span>
      <div className="th-toolbar-spacer" />
      <span className="ow-toolbar-note typ-label-small">{scan.note || `${hosts.length} accounts carrying players`}</span>
      <button type="button" className="th-pill th-pill-primary focusable" onClick={runScan} disabled={scan.busy} aria-disabled={scan.busy}>
        {scan.busy ? <span className="ow-spin" /> : <Icon name="retry" size={12} />}
        <span className="th-pill-label typ-label-medium">{scan.busy ? 'Scanning' : 'Scan now'}</span>
      </button>
    </>
  );

  const cell = (c, cls = '') => (
    <div className="th-grid-cell"><div><span className={`th-grid-cell-inner typ-label-medium ${cls}`}>{c}</span></div></div>
  );

  if (error || !snap) {
    return (
      <Shell title="Hosts" crumb="Hosts" email={session?.user?.email} toolbar={toolbar}>
        {error ? (
          <div className="th-empty">
            <div className="th-empty-title typ-heading-small">No data yet</div>
            <div className="th-empty-sub typ-paragraph-small">Nothing has scanned yet. Press Scan now, or wait for the cron.</div>
          </div>
        ) : null}
      </Shell>
    );
  }

  return (
    <Shell title="Hosts" crumb="Hosts" email={session?.user?.email} toolbar={toolbar}>
      <div className="th-grid-scroll">
        <div className="th-grid" style={{ gridTemplateColumns: COLS.map((c) => c.w).join(' ') }}>
          <div className="th-grid-headgroup">
            <div className="th-grid-headrow">
              {COLS.map((c) => (
                <div key={c.key} className="th-grid-headcell"><div><span className="th-grid-headlabel">{c.label}</span></div></div>
              ))}
            </div>
          </div>
          <div className="th-grid-body">
            {hosts.map((h) => (
              <div className="th-grid-row" key={h.host}>
                {cell(
                  <>
                    {h.host}
                    {!h.active ? <span className="th-badge th-badge-blue typ-label-small ow-inline-badge">no longer hosting</span> : null}
                  </>,
                )}
                {cell(h.account || '–', 'ow-sub')}
                {cell(
                  <>
                    {h.players}
                    {h.players > LOAD_MAX ? <span className="ow-over">over guideline</span> : null}
                  </>,
                  `ow-nums${h.players > LOAD_MAX ? ' ow-stale' : ''}`,
                )}
                {cell(h.waiting || '–', `ow-nums${h.waiting ? ' ow-stale' : ''}`)}
                {cell(h.action || '–', 'ow-nums')}
                {cell(mins(h.reply), `ow-nums${h.reply != null && h.reply > 60 ? ' ow-stale' : ''}`)}
                {cell(mins(h.worst), 'ow-nums ow-sub')}
                {cell(h.quiet || '–', 'ow-nums ow-sub')}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}
