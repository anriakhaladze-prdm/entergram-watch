import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Shell, { ScanStatus, Empty } from '../components/Shell';
import Icon from '../components/Icon';
import PlayerDrawer from '../components/PlayerDrawer';
import { useSnapshot } from '../components/useSnapshot';
import { parseFilters, matchRow, filterLabel, queueHref, SETS, TABS, TAB, tabOf } from '../components/filters';
import { STATES, STATE, ACTIONABLE, age, mins } from '../lib/states.js';

// The worklist. Every filter is in the URL, so a tile on the overview, a
// Slack alert and a host's own bookmark all open the same view.
const COLS = [
  { key: 'player', label: 'Player', w: 'minmax(160px, 1.2fr)', sort: 'player' },
  { key: 'host', label: 'Host', w: '130px', sort: 'host' },
  { key: 'state', label: 'State', w: '140px', sort: 'severity' },
  { key: 'we', label: 'We spoke', w: '110px', sort: 'staffQuiet', num: true },
  { key: 'player_last', label: 'Player spoke', w: '136px', sort: 'playerQuiet', num: true },
  { key: 'silent', label: 'Silent', w: '90px', sort: 'quiet', num: true },
  { key: 'reply', label: 'Reply', w: '92px', sort: 'reply', num: true },
  { key: 'mood', label: 'Mood', w: '100px', sort: 'mood' },
  { key: 'detail', label: 'Detail', w: 'minmax(220px, 1.6fr)', sort: null },
];
const ORDER = STATES.map((s) => s.key);
const DEFAULT_F = ['actionable'];

export default function Queue() {
  const s = useSnapshot();
  const { session, snap, rows, error } = s;
  const router = useRouter();
  const fl = useMemo(() => parseFilters(router.query), [router.query]);
  // The tab comes from the URL, or from the row a link opened, or is Active.
  const openRow = fl.chat ? rows.find((r) => String(r.chatId) === String(fl.chat)) : null;
  const tab = fl.tab || (openRow ? tabOf(openRow) : 'active');
  const tabDef = TAB[tab];
  const active = fl.f.length ? fl.f : (router.isReady && Object.keys(router.query).some((k) => !['tab', 'chat'].includes(k)) ? [] : (tab === 'active' ? DEFAULT_F : []));
  const [sort, setSort] = useState({ col: 'severity', dir: 'asc' });
  const [q, setQ] = useState(fl.q);
  useEffect(() => { setQ(fl.q); }, [fl.q]);

  const setParams = (patch) => {
    const next = { ...router.query, ...patch };
    for (const k of Object.keys(next)) if (next[k] == null || next[k] === '' || (Array.isArray(next[k]) && !next[k].length)) delete next[k];
    router.replace(queueHref(next), undefined, { shallow: true });
  };
  const toggleF = (k) => {
    const cur = new Set(active.filter((x) => x !== 'all' && (x !== 'actionable' || k === 'actionable')));
    if (k === 'actionable') { setParams({ f: cur.has('actionable') ? ['all'] : ['actionable'] }); return; }
    cur.has(k) ? cur.delete(k) : cur.add(k);
    setParams({ f: [...cur].length ? [...cur] : ['all'] });
  };

  const inTab = useMemo(() => rows.filter((r) => tabDef.test(r)), [rows, tab]);
  const tabCounts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, rows.filter((r) => t.test(r)).length])), [rows]);
  const hosts = useMemo(() => {
    const m = new Map();
    for (const r of inTab) { const k = r.host || 'unattributed'; m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [inTab]);
  const counts = useMemo(() => {
    const c = {};
    for (const r of inTab) c[r.state] = (c[r.state] || 0) + 1;
    c.actionable = inTab.filter((r) => r.actionable).length;
    return c;
  }, [inTab]);

  const shown = useMemo(() => {
    const filters = { ...fl, tab, f: active, q };
    const out = rows.filter((r) => matchRow(r, filters));
    const val = (r) => ({
      severity: ORDER.indexOf(r.state), player: (r.player || '').toLowerCase(), host: (r.host || 'zz').toLowerCase(),
      quiet: r.quietDays ?? -1, playerQuiet: r.playerQuietDays ?? -1, staffQuiet: r.noContactDays ?? r.staffQuietDays ?? -1,
      reply: r.reply?.medianMins ?? -1,
      mood: ['at_risk', 'negative', 'neutral', 'positive'].indexOf(r.sentiment?.label ?? 'neutral'),
    }[sort.col]);
    return [...out].sort((a, b) => {
      const x = val(a), y = val(b);
      const cmp = typeof x === 'string' ? x.localeCompare(y) : y - x;
      const dir = sort.dir === 'asc' ? 1 : -1;
      return (sort.col === 'severity' ? -cmp : cmp) * dir || (b.noContactDays ?? 0) - (a.noContactDays ?? 0);
    });
  }, [rows, fl, tab, active, q, sort]);

  const open = openRow;
  const setTab = (k) => setParams({ tab: k === 'active' ? null : k, f: null, mood: null, silence: null, reply: null, chat: null });
  const sortBy = (c) => c && setSort((st) => ({ col: c, dir: st.col === c && st.dir === 'asc' ? 'desc' : 'asc' }));
  const cell = (content, cls = '') => <div className="th-grid-cell"><div><span className={`th-grid-cell-inner typ-label-medium ${cls}`}>{content}</span></div></div>;
  const status = <ScanStatus {...s} compact />;

  const toolbar = (
    <>
      <div className="th-subtabs th-subtabs-section ow-tabs">
        {TABS.map((t) => (
          <button type="button" key={t.key} className={`th-pill focusable${tab === t.key ? ' th-pill-selected' : ''}`} onClick={() => setTab(t.key)} aria-pressed={tab === t.key}>
            <span className="th-pill-label typ-label-medium">{t.label} <span className="ow-nums">{tabCounts[t.key] ?? 0}</span></span>
          </button>
        ))}
      </div>
      <div className="th-toolbar-spacer" />
      <label className="ow-search">
        <Icon name="search" size={12} />
        <input placeholder="Search player or chat" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setParams({ q })} onKeyDown={(e) => { if (e.key === 'Enter') setParams({ q }); }} />
      </label>
      <span className="ow-toolbar-note typ-label-small">{snap ? `${shown.length} shown` : ''}</span>
    </>
  );
  const stateChips = (
    <div className="ow-hostbar">
      {tab === 'active' ? (
        <span className={`th-chip typ-label-small${active.includes('actionable') ? ' is-on' : ''}`} onClick={() => toggleF('actionable')} role="button" tabIndex={0} aria-pressed={active.includes('actionable')}>
          Needs action {counts.actionable ?? 0}
        </span>
      ) : null}
      {STATES.filter((st) => tabDef.states.includes(st.key)).map((st) => (
        <span key={st.key} className={`th-chip typ-label-small${active.includes(st.key) ? ' is-on' : ''}`} onClick={() => toggleF(st.key)} role="button" tabIndex={0} aria-pressed={active.includes(st.key)}>
          {st.short} {counts[st.key] ?? 0}
        </span>
      ))}
    </div>
  );

  return (
    <Shell title="Queue" crumb="Queue" email={session?.user?.email} status={status} toolbar={toolbar}>
      {error || !snap ? <Empty error={error} /> : (
        <>
          {tabDef.states.length ? stateChips : null}
          <div className="ow-hostbar">
            <span className={`th-chip typ-label-small${!fl.host ? ' is-on' : ''}`} onClick={() => setParams({ host: null })} role="button" tabIndex={0}>All hosts</span>
            {hosts.map(([h, n]) => (
              <span key={h} className={`th-chip typ-label-small${fl.host === h ? ' is-on' : ''}`} onClick={() => setParams({ host: fl.host === h ? null : h })} role="button" tabIndex={0}>{h} <span className="ow-nums">{n}</span></span>
            ))}
            {(fl.mood || fl.silence || fl.reply || active.some((k) => SETS[k] && !['actionable', 'hosted', 'all'].includes(k))) ? (
              <span className="th-chip typ-label-small ow-chip-filter is-on" onClick={() => setParams({ mood: null, silence: null, reply: null, f: ['all'] })} role="button" tabIndex={0}>
                {filterLabel({ ...fl, f: active.filter((k) => SETS[k] && !['actionable', 'hosted', 'all'].includes(k)) })} <Icon name="close" size={10} />
              </span>
            ) : null}
          </div>
          <div className="th-grid-scroll">
            <div className="th-grid" style={{ gridTemplateColumns: COLS.map((c) => c.w).join(' ') }}>
              <div className="th-grid-headgroup">
                <div className="th-grid-headrow">
                  {COLS.map((c) => (
                    <div key={c.key} className={`th-grid-headcell${c.sort ? ' ow-sortable' : ''}`} onClick={() => sortBy(c.sort)}>
                      <div>
                        <span className={`th-grid-headlabel${c.num ? ' ow-right' : ''}`}>{c.label}</span>
                        {c.sort ? <span className={`th-grid-sort${sort.col === c.sort ? ' ow-sort-on' : ''}`}><Icon name="sort" size={10} /></span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="th-grid-body">
                {shown.map((r) => {
                  const st = STATE[r.state] || { label: r.state, tone: 'gray' };
                  const mood = r.sentiment?.label;
                  return (
                    <div className="th-grid-row is-link" key={r.chatId} onClick={() => setParams({ chat: r.chatId })} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setParams({ chat: r.chatId }); }}>
                      {cell(<>{r.playerUsername || r.player || r.title}{r.tier ? <span className="ow-sub ow-small"> · {String(r.tier).replace('_', ' ')}</span> : null}</>, 'ow-clip')}
                      {cell(<>{r.host || 'unattributed'}{r.hostUnattributed ? <span className="ow-sub ow-small"> ?</span> : null}</>, 'ow-sub ow-clip')}
                      {cell(<span className={`th-badge th-badge-${st.tone} typ-label-small`}>{st.label}</span>)}
                      {cell(r.lastStaffAt ? age(r.staffQuietDays) : (r.noContactDays != null ? `${age(r.noContactDays)}+` : <span className="ow-muted">?</span>), `ow-nums${(r.noContactDays ?? 0) >= 7 ? ' ow-warn' : ''}`)}
                      {cell(r.lastPlayerAt ? age(r.playerQuietDays) : <span className="ow-muted">·</span>, `ow-nums${r.flags.waiting ? ' ow-stale' : ''}`)}
                      {cell(age(r.quietDays), 'ow-nums ow-sub')}
                      {cell(r.reply ? mins(r.reply.medianMins) : <span className="ow-muted">·</span>, 'ow-nums ow-sub')}
                      {cell(mood && mood !== 'neutral' ? <span className={`ow-mood ow-mood-${mood}`}>{mood.replace('_', ' ')}</span> : <span className="ow-muted">–</span>)}
                      {cell(r.signals?.[0] || (r.history === 'read' ? 'in contact' : r.history === 'unavailable' ? 'history not readable' : 'history not read yet'), 'ow-sub ow-clip')}
                    </div>
                  );
                })}
                {!shown.length ? <div className="th-grid-empty typ-label-medium">Nothing matches these filters.</div> : null}
              </div>
            </div>
          </div>
          <PlayerDrawer row={open} onClose={() => setParams({ chat: null })} />
        </>
      )}
    </Shell>
  );
}

export { ACTIONABLE };
