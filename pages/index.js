import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useSession, signIn, signOut } from 'next-auth/react';
import Icon from '../components/Icon';

// The rail doubles as the filter here: each section is a state, and the count
// is what makes three identical grey tiles legible at a glance.
const STATES = [
  { key: 'at_risk',          label: 'Unhappy',  glyph: 'bad',    badge: 'red',    blurb: 'sentiment negative or churn signalled' },
  { key: 'waiting_on_us',    label: 'Waiting',  glyph: 'warn',   badge: 'orange', blurb: 'player wrote, nobody replied' },
  { key: 'quiet',            label: 'Quiet',    glyph: 'info',   badge: 'yellow', blurb: 'no contact either way' },
  { key: 'outreach_ignored', label: 'Ignored',  glyph: 'mail',   badge: 'peach',  blurb: 'host posting, player silent' },
  { key: 'player_left',      label: 'Left',     glyph: 'logout', badge: 'purple', blurb: 'no player left in the group' },
  { key: 'unhosted',         label: 'Unhosted', glyph: 'user',   badge: 'blue',   blurb: 'host no longer hosting' },
  { key: 'dormant',          label: 'Dormant',  glyph: 'lock',   badge: 'gray',   blurb: 'silent 90 days or more' },
  { key: 'ok',               label: 'Healthy',  glyph: 'ok',     badge: 'green',  blurb: 'in contact' },
];
const BY_KEY = Object.fromEntries(STATES.map((s) => [s.key, s]));
const ORDER = STATES.map((s) => s.key);
const DEFAULT_ON = ['at_risk', 'waiting_on_us', 'quiet', 'outreach_ignored', 'player_left'];
// Eight items ran off the bottom of the rail at 950px. Dormant and healthy are
// not work queues, so they become toolbar toggles and the rail keeps the six
// states somebody has to do something about.
const RAIL = STATES.filter((s) => !['dormant', 'ok'].includes(s.key));
const EXTRA = STATES.filter((s) => ['dormant', 'ok'].includes(s.key));

const COLS = [
  { key: 'player',     label: 'Player',      w: '170px', sort: 'player' },
  { key: 'host',       label: 'Host',        w: '150px', sort: 'host' },
  { key: 'state',      label: 'State',       w: '150px', sort: 'severity' },
  { key: 'quiet',      label: 'Silent',      w: '104px', sort: 'quiet' },
  { key: 'player_last',label: 'Player said', w: '130px', sort: 'playerQuiet' },
  { key: 'we_last',    label: 'We said',     w: '118px', sort: 'staffQuiet' },
  { key: 'members',    label: 'Members',     w: '104px', sort: 'members' },
  { key: 'mood',       label: 'Mood',        w: '112px', sort: 'mood' },
  { key: 'detail',     label: 'Detail',      w: 'minmax(220px, 1fr)', sort: null },
];

const age = (n) => (n == null ? '–' : n < 2 ? `${Math.max(1, Math.round(n * 24))}h` : `${Math.round(n)}d`);

export default function Dashboard() {
  const { data: session, status } = useSession();
  const [snap, setSnap] = useState(null);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(new Set(DEFAULT_ON));
  const [host, setHost] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ col: 'severity', dir: 'asc' });
  const [scan, setScan] = useState({ busy: false, note: null });

  const load = () => fetch('/api/snapshot')
    .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error))))
    .then((s) => { setSnap(s); setError(null); })
    .catch((e) => setError(e.message));

  useEffect(() => { if (status === 'authenticated') load(); }, [status]);

  // The first run seeds the baseline and posts one summary; after that only
  // new threshold crossings alert, so this is safe to press.
  const runScan = async () => {
    setScan({ busy: true, note: 'Scanning. Sweeping 3548 chats and reading history, this takes a minute or two.' });
    try {
      const r = await fetch('/api/scan', { method: 'POST' });
      const body = await r.json();
      if (!r.ok || !body.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setScan({
        busy: false,
        note: `Scanned ${body.total} player chats in ${Math.round(body.ms / 1000)}s. History readable for ${body.read}, unavailable for ${body.denied}. ${body.seeded ? `${body.posted} alert${body.posted === 1 ? '' : 's'} posted.` : 'Baseline seeded, backlog not posted.'}`,
      });
      await load();
    } catch (e) {
      setScan({ busy: false, note: `Scan failed: ${e.message}` });
    }
  };

  const rows = snap?.rows || [];
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

  const toggle = (key) => setActive((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const sortBy = (col) => col && setSort((s) => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }));

  if (status === 'loading') return null;
  if (status !== 'authenticated') {
    if (typeof window !== 'undefined') signIn('google', { callbackUrl: '/' });
    return null;
  }

  const cell = (content, cls = '') => (
    <div className="th-grid-cell"><div><span className={`th-grid-cell-inner typ-label-medium ${cls}`}>{content}</span></div></div>
  );

  return (
    <>
      <Head><title>Player outreach · Sonar</title></Head>

      <div className="th-root" data-nav="closed" data-mask="off">
        <header className="th-header">
          <div className="th-header-logo">
            <span className="th-logo-wordmark" role="img" aria-label="Sonar" />
          </div>

          <div className="th-breadcrumb">
            <nav className="th-breadcrumb-inner" aria-label="Breadcrumb">
              <div className="th-crumb-train">
                <span className="th-crumb typ-label-large">Player Outreach</span>
                <span className="th-crumb typ-label-large">
                  {snap ? `${rows.length} chats` : 'Loading'}
                </span>
              </div>
            </nav>
          </div>

          <div className="th-header-actions">
            <button type="button" className="th-action focusable" data-tip={session?.user?.email || ''} aria-label="Account">
              <Icon name="user" size={20} />
            </button>
            <button type="button" className="th-action focusable" onClick={() => signOut({ callbackUrl: '/auth/signin' })} data-tip="Sign out" aria-label="Sign out">
              <Icon name="logout" size={20} />
            </button>
          </div>
        </header>

        <nav className="th-rail" aria-label="Sections">
          <ul className="th-nav">
            {RAIL.map((s) => (
              <li className="th-nav-item" key={s.key}>
                <a
                  className="th-nav-link focusable int-hover-scale-plus"
                  href="#"
                  onClick={(e) => { e.preventDefault(); toggle(s.key); }}
                  aria-current={active.has(s.key) ? 'page' : undefined}
                  data-tip={s.blurb}
                >
                  <span className="th-nav-tile"><Icon name={s.glyph} size={20} /></span>
                  <span className="th-nav-label typ-label-xxsmall">{s.label}</span>
                  <span className="ow-rail-count typ-label-small">{counts[s.key] ?? 0}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="th-main">
          <div className="th-card">
            <div className="th-toolbar">
              <label className="ow-search">
                <Icon name="search" size={12} />
                <input placeholder="Search player" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>

              <span className="th-chip typ-label-small" data-on={host === 'all'} onClick={() => setHost('all')}
                aria-pressed={host === 'all'} role="button" tabIndex={0}>All hosts</span>
              {hosts.map((h) => (
                <span key={h} className="th-chip typ-label-small" data-on={host === h} onClick={() => setHost(h)}
                  aria-pressed={host === h} role="button" tabIndex={0}>{h}</span>
              ))}

              {EXTRA.map((s) => (
                <span key={s.key} className="th-chip typ-label-small" data-on={active.has(s.key)}
                  onClick={() => toggle(s.key)} aria-pressed={active.has(s.key)} role="button" tabIndex={0}>
                  {s.label} {counts[s.key] ?? 0}
                </span>
              ))}

              <div className="th-toolbar-spacer" />

              <span className="ow-toolbar-note typ-label-small">
                {scan.note || (snap ? `Scanned ${new Date(snap.generatedAt).toLocaleString()}` : '')}
              </span>

              <button
                type="button"
                className="th-pill th-pill-primary focusable"
                onClick={runScan}
                disabled={scan.busy}
                aria-disabled={scan.busy}
              >
                {scan.busy ? <span className="ow-spin" /> : <Icon name="retry" size={12} />}
                <span className="th-pill-label typ-label-medium">{scan.busy ? 'Scanning' : 'Scan now'}</span>
              </button>
            </div>

            <div className="th-card-scroll">
              {error ? (
                <div className="th-empty">
                  <div className="th-empty-title typ-heading-small">No data yet</div>
                  <div className="th-empty-sub typ-paragraph-small">
                    {/^no snapshot/i.test(error)
                      ? 'Nothing has scanned yet. Press Scan now, or wait for the cron, which runs every 10 minutes.'
                      : error}
                  </div>
                </div>
              ) : !snap ? null : (
                <div className="th-grid-scroll">
                  <div className="th-grid" style={{ gridTemplateColumns: COLS.map((c) => c.w).join(' ') }}>
                    <div className="th-grid-headgroup">
                      <div className="th-grid-headrow">
                        {COLS.map((c) => (
                          <div
                            key={c.key}
                            className={`th-grid-headcell${c.sort ? ' ow-sortable' : ''}`}
                            onClick={() => sortBy(c.sort)}
                          >
                            <div>
                              <span className="th-grid-headlabel">{c.label}</span>
                              {c.sort ? (
                                <span className={`th-grid-sort${sort.col === c.sort ? ' ow-sort-on' : ''}`}>
                                  <Icon name="sort" size={10} />
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="th-grid-body">
                      {shown.map((r) => {
                        const s = BY_KEY[r.state] || { label: r.state, badge: 'gray' };
                        const mood = r.sentiment?.label;
                        return (
                          <div className="th-grid-row" key={r.chatId}>
                            {cell(r.player || r.title)}
                            {cell(r.host || '–', 'ow-sub')}
                            {cell(<span className={`th-badge th-badge-${s.badge} typ-label-small`}>{s.label}</span>)}
                            {cell(age(r.quietDays), 'ow-nums')}
                            {cell(
                              r.historyRead ? age(r.playerQuietDays) : <span className="ow-muted">–</span>,
                              `ow-nums${r.playerQuietDays > 30 ? ' ow-stale' : ''}`,
                            )}
                            {cell(r.historyRead ? age(r.staffQuietDays) : <span className="ow-muted">–</span>, 'ow-nums')}
                            {cell(r.membersCount ?? '–', 'ow-nums ow-sub')}
                            {cell(
                              mood && mood !== 'neutral'
                                ? <span className={`ow-mood ow-mood-${mood}`}>{mood === 'at_risk' ? 'at risk' : mood}</span>
                                : <span className="ow-muted">–</span>,
                            )}
                            {cell(r.signals?.[0] || (r.historyRead ? 'in contact' : 'history not readable'), 'ow-sub')}
                          </div>
                        );
                      })}
                      {!shown.length ? <div className="th-grid-empty typ-label-medium">Nothing matches these filters.</div> : null}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
