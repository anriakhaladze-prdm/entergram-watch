import { useEffect, useMemo, useState } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';

const STATES = [
  { key: 'at_risk',          label: 'Unhappy',        hue: 'red',    blurb: 'sentiment is negative or the player is signalling churn' },
  { key: 'waiting_on_us',    label: 'Waiting on us',  hue: 'orange', blurb: 'player wrote, nobody replied' },
  { key: 'quiet',            label: 'Gone quiet',     hue: 'yellow', blurb: 'no contact either way' },
  { key: 'outreach_ignored', label: 'Ignoring us',    hue: 'peach',  blurb: 'host posting, player silent' },
  { key: 'player_left',      label: 'Left',           hue: 'purple', blurb: 'no player in the group' },
  { key: 'unhosted',         label: 'Unhosted',       hue: 'blue',   blurb: 'host no longer hosting' },
  { key: 'dormant',          label: 'Dormant',        hue: 'gray',   blurb: 'silent 90 days or more' },
  { key: 'ok',               label: 'Healthy',        hue: 'green',  blurb: 'in contact' },
];
const MOOD = { at_risk: 'red', negative: 'orange', neutral: 'gray', positive: 'green' };
const BY_KEY = Object.fromEntries(STATES.map((s) => [s.key, s]));
const ORDER = STATES.map((s) => s.key);

const days = (n) => (n == null ? '–' : n < 1 ? `${Math.max(1, Math.round(n * 24))}h` : `${Math.round(n)}d`);
const Badge = ({ state }) => {
  const s = BY_KEY[state] || { label: state, hue: 'gray' };
  return (
    <span className="badge" style={{ background: `var(--color-badge-${s.hue}-bg)`, color: `var(--color-badge-${s.hue})` }}>
      {s.label}
    </span>
  );
};

export default function Dashboard() {
  const { data: session, status } = useSession();
  const [snap, setSnap] = useState(null);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(new Set(['at_risk', 'waiting_on_us', 'quiet', 'outreach_ignored', 'player_left']));
  const [host, setHost] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ col: 'severity', dir: 'asc' });

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/snapshot')
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error))))
      .then(setSnap)
      .catch((e) => setError(e.message));
  }, [status]);

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
    return out.sort((a, b) => {
      const x = val(a), y = val(b);
      const cmp = typeof x === 'string' ? x.localeCompare(y) : y - x;
      const primary = sort.dir === 'asc' ? (sort.col === 'severity' ? -cmp : cmp) : -(sort.col === 'severity' ? -cmp : cmp);
      return primary || (b.quietDays ?? 0) - (a.quietDays ?? 0);
    });
  }, [rows, active, host, q, sort]);

  const toggle = (key) => setActive((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  const sortBy = (col) => setSort((s) => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }));
  const Th = ({ col, children, sortable = true }) => (
    <div data-sortable={sortable} onClick={sortable ? () => sortBy(col) : undefined}>
      {children}{sortable && sort.col === col ? <span className="sort">{sort.dir === 'asc' ? '▲' : '▼'}</span> : null}
    </div>
  );

  if (status === 'loading') return <div className="gate"><div className="gate-card"><div className="gate-sub">Checking access…</div></div></div>;
  if (status !== 'authenticated') {
    return (
      <div className="gate">
        <div className="gate-card">
          <div className="gate-title">Player outreach</div>
          <div className="gate-sub">Thrill.com · Entergram watch</div>
          <button className="gate-btn" onClick={() => signIn('google', { callbackUrl: '/' })}>Continue with Google</button>
          <div className="gate-note">Restricted to @paradym.io accounts</div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="header">
        <div>
          <div className="typ-heading-medium" style={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.02em' }}>
            Player outreach
          </div>
          <div className="typ-label-xsmall muted" style={{ marginTop: 8 }}>
            {snap ? `${rows.length} hosted player chats · scanned ${new Date(snap.generatedAt).toLocaleString()}` : 'loading'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="typ-label-xsmall muted">{session?.user?.email}</span>
          <button className="chip" onClick={() => signOut({ callbackUrl: '/auth/signin' })}>Sign out</button>
        </div>
      </header>

      <nav className="rail">
        {STATES.slice(0, 4).map((s) => (
          <button key={s.key} className="rail-item" data-active={active.has(s.key)} onClick={() => toggle(s.key)} title={s.blurb}>
            <span className="rail-count">{counts[s.key] ?? 0}</span>
            <span className="rail-label">{s.label}</span>
          </button>
        ))}
      </nav>

      <main className="main">
        <section className="card">
          <div className="kpis">
            {STATES.map((s) => (
              <button key={s.key} className="kpi" data-on={active.has(s.key)} onClick={() => toggle(s.key)} title={s.blurb}>
                <div className="kpi-value" style={{ color: `var(--color-badge-${s.hue})` }}>{counts[s.key] ?? 0}</div>
                <div className="kpi-label">{s.label}</div>
              </button>
            ))}
          </div>

          <div className="toolbar">
            <input className="search" placeholder="Search player" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="chip" data-on={host === 'all'} onClick={() => setHost('all')}>All hosts</button>
            {hosts.map((h) => (
              <button key={h} className="chip" data-on={host === h} onClick={() => setHost(h)}>{h}</button>
            ))}
          </div>

          {error ? <div className="empty">{error}</div> : !snap ? <div className="empty">Loading…</div> : (
            <div className="scroller">
              <div className="grid">
                <div className="head">
                  <Th col="player">Player</Th>
                  <Th col="host">Host</Th>
                  <Th col="severity">State</Th>
                  <Th col="quiet">Quiet</Th>
                  <Th col="playerQuiet">Player last</Th>
                  <Th col="staffQuiet">We last</Th>
                  <Th col="members">Members</Th>
                  <Th col="mood">Mood</Th>
                  <Th col="title" sortable={false}>Detail</Th>
                </div>
                {shown.map((r) => (
                  <div className="row" key={r.chatId}>
                    <div><div className="cell"><span className="truncate">{r.player || r.title}</span></div></div>
                    <div><div className="cell"><span className="truncate muted">{r.host || '–'}</span></div></div>
                    <div><div className="cell"><Badge state={r.state} /></div></div>
                    <div><div className="cell num">{days(r.quietDays)}</div></div>
                    <div><div className="cell num" style={{ color: r.playerQuietDays > 30 ? 'var(--color-badge-red)' : undefined }}>
                      {r.historyRead ? days(r.playerQuietDays) : <span className="muted">–</span>}
                    </div></div>
                    <div><div className="cell num">{r.historyRead ? days(r.staffQuietDays) : <span className="muted">–</span>}</div></div>
                    <div><div className="cell num muted">{r.membersCount ?? '–'}</div></div>
                    <div><div className="cell">
                      {r.sentiment?.label && r.sentiment.label !== 'neutral'
                        ? <span style={{ color: `var(--color-badge-${MOOD[r.sentiment.label] || 'gray'})`, fontWeight: 700, fontSize: 12, textTransform: 'uppercase' }}>
                            {r.sentiment.label === 'at_risk' ? 'at risk' : r.sentiment.label}
                          </span>
                        : <span className="muted">–</span>}
                    </div></div>
                    <div><div className="cell"><span className="truncate muted">
                      {r.signals?.[0] || (r.historyRead ? 'in contact' : 'history not readable')}
                    </span></div></div>
                  </div>
                ))}
                {!shown.length ? <div className="empty">Nothing matches these filters.</div> : null}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
