import { useMemo, useState } from 'react';
import Shell from '../components/Shell';
import Icon from '../components/Icon';
import { useSnapshot, STATES, BY_KEY, BADGE, ACTIONABLE, age } from '../components/useSnapshot';

const COLS = [
  { key: 'player',      label: 'Player',      w: '170px', sort: 'player' },
  { key: 'host',        label: 'Host',        w: '170px', sort: 'host' },
  { key: 'state',       label: 'State',       w: '150px', sort: 'severity' },
  { key: 'quiet',       label: 'Silent',      w: '104px', sort: 'quiet' },
  { key: 'player_last', label: 'Player said', w: '130px', sort: 'playerQuiet' },
  { key: 'we_last',     label: 'We said',     w: '118px', sort: 'staffQuiet' },
  { key: 'members',     label: 'Members',     w: '104px', sort: 'members' },
  { key: 'mood',        label: 'Mood',        w: '112px', sort: 'mood' },
  { key: 'detail',      label: 'Detail',      w: 'minmax(220px, 1fr)', sort: null },
];
const ORDER = STATES.map((s) => s.key);

export default function Queue() {
  const { session, snap, rows, error, scan, runScan } = useSnapshot();
  const [active, setActive] = useState(new Set(ACTIONABLE));
  const [host, setHost] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ col: 'severity', dir: 'asc' });

  const hosts = useMemo(() => [...new Set(rows.map((r) => r.host).filter(Boolean))].sort(), [rows]);
  const counts = useMemo(() => rows.reduce((a, r) => ({ ...a, [r.state]: (a[r.state] || 0) + 1 }), {}), [rows]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const out = rows.filter((r) =>
      (active.size === 0 || active.has(r.state)) &&
      (host === 'all' || r.host === host) &&
      (!term || (r.player || '').toLowerCase().includes(term) || (r.title || '').toLowerCase().includes(term)));
    const val = (r) => ({
      severity: ORDER.indexOf(r.state), player: (r.player || '').toLowerCase(), host: r.host || '',
      quiet: r.quietDays ?? -1, playerQuiet: r.playerQuietDays ?? -1, staffQuiet: r.staffQuietDays ?? -1,
      members: r.membersCount ?? -1,
      mood: ['at_risk', 'negative', 'neutral', 'positive'].indexOf(r.sentiment?.label ?? 'neutral'),
    }[sort.col]);
    return [...out].sort((a, b) => {
      const x = val(a), y = val(b);
      const cmp = typeof x === 'string' ? x.localeCompare(y) : y - x;
      const dir = sort.dir === 'asc' ? 1 : -1;
      return (sort.col === 'severity' ? -cmp : cmp) * dir || (b.quietDays ?? 0) - (a.quietDays ?? 0);
    });
  }, [rows, active, host, q, sort]);

  const toggle = (k) => setActive((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const sortBy = (c) => c && setSort((s) => ({ col: c, dir: s.col === c && s.dir === 'asc' ? 'desc' : 'asc' }));
  const cell = (content, cls = '') => (
    <div className="th-grid-cell"><div><span className={`th-grid-cell-inner typ-label-medium ${cls}`}>{content}</span></div></div>
  );

  const toolbar = (
    <>
      <label className="ow-search">
        <Icon name="search" size={12} />
        <input placeholder="Search player" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {STATES.map((s) => (
        <span key={s.key} className="th-chip typ-label-small" data-on={active.has(s.key)}
          onClick={() => toggle(s.key)} role="button" tabIndex={0} aria-pressed={active.has(s.key)} data-tip={s.blurb}>
          {s.short} {counts[s.key] ?? 0}
        </span>
      ))}
      <div className="th-toolbar-spacer" />
      <span className="ow-toolbar-note typ-label-small">{scan.note || (snap ? `${shown.length} shown` : '')}</span>
      <button type="button" className="th-pill th-pill-primary focusable" onClick={runScan} disabled={scan.busy} aria-disabled={scan.busy}>
        {scan.busy ? <span className="ow-spin" /> : <Icon name="retry" size={12} />}
        <span className="th-pill-label typ-label-medium">{scan.busy ? 'Scanning' : 'Scan now'}</span>
      </button>
    </>
  );

  return (
    <Shell title="Queue" crumb="Queue" email={session?.user?.email} toolbar={toolbar}>
      {error ? (
        <div className="th-empty">
          <div className="th-empty-title typ-heading-small">No data yet</div>
          <div className="th-empty-sub typ-paragraph-small">
            {/^no snapshot/i.test(error) ? 'Nothing has scanned yet. Press Scan now, or wait for the cron.' : error}
          </div>
        </div>
      ) : !snap ? null : (
        <>
          <div className="ow-hostbar">
            <span className="th-chip typ-label-small" data-on={host === 'all'} onClick={() => setHost('all')} role="button" tabIndex={0}>All hosts</span>
            {hosts.map((h) => (
              <span key={h} className="th-chip typ-label-small" data-on={host === h} onClick={() => setHost(h)} role="button" tabIndex={0}>{h}</span>
            ))}
          </div>
          <div className="th-grid-scroll">
            <div className="th-grid" style={{ gridTemplateColumns: COLS.map((c) => c.w).join(' ') }}>
              <div className="th-grid-headgroup">
                <div className="th-grid-headrow">
                  {COLS.map((c) => (
                    <div key={c.key} className={`th-grid-headcell${c.sort ? ' ow-sortable' : ''}`} onClick={() => sortBy(c.sort)}>
                      <div>
                        <span className="th-grid-headlabel">{c.label}</span>
                        {c.sort ? <span className={`th-grid-sort${sort.col === c.sort ? ' ow-sort-on' : ''}`}><Icon name="sort" size={10} /></span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="th-grid-body">
                {shown.map((r) => {
                  const s = BY_KEY[r.state] || { label: r.state };
                  const mood = r.sentiment?.label;
                  return (
                    <div className="th-grid-row" key={r.chatId}>
                      {cell(r.inviteLink
                        ? <a className="th-link ow-player-link" href={r.inviteLink} target="_blank" rel="noreferrer"
                            title="Open the group in Telegram">{r.player || r.title}</a>
                        : (r.player || r.title))}
                      {cell(r.host || '–', 'ow-sub ow-clip')}
                      {cell(<span className={`th-badge th-badge-${BADGE[r.state] || 'gray'} typ-label-small`}>{s.label}</span>)}
                      {cell(age(r.quietDays), 'ow-nums')}
                      {cell(r.historyRead ? age(r.playerQuietDays) : <span className="ow-muted">·</span>,
                        `ow-nums${r.playerQuietDays > 30 ? ' ow-stale' : ''}`)}
                      {cell(r.historyRead ? age(r.staffQuietDays) : <span className="ow-muted">·</span>, 'ow-nums')}
                      {cell(r.membersCount ?? '–', 'ow-nums ow-sub')}
                      {cell(mood && mood !== 'neutral'
                        ? <span className={`ow-mood ow-mood-${mood}`}>{mood === 'at_risk' ? 'at risk' : mood}</span>
                        : <span className="ow-muted">–</span>)}
                      {cell(r.signals?.[0]
                        || (r.historyState === 'read' ? 'in contact'
                          : r.historyState === 'unavailable' ? 'history not readable' : 'history not read yet'), 'ow-sub ow-clip')}
                    </div>
                  );
                })}
                {!shown.length ? <div className="th-grid-empty typ-label-medium">Nothing matches these filters.</div> : null}
              </div>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}
