import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Shell, { ScanStatus, Empty } from '../components/Shell';
import Icon from '../components/Icon';
import Menu from '../components/Menu';
import Badge from '../components/Badge';
import PlayerDrawer from '../components/PlayerDrawer';
import { useSnapshot } from '../components/useSnapshot';
import { parseFilters, matchRow, queueHref, SETS, TABS, TAB, tabOf, SILENCE_BUCKETS, REPLY_BUCKETS, HISTORY, GROUPS, moodOf, tierOf, silenceBucket, replyBucket, activeCount } from '../components/filters';
import { STATES, STATE, MOODS, ACTIONABLE, age, mins } from '../lib/states.js';

// The worklist. Every filter is in the URL, so a tile on the overview, a
// Slack alert and a host's own bookmark all open the same view.
const COLS = [
  { key: 'player', label: 'Player', w: 'minmax(180px, 1.2fr)', sort: 'player' },
  { key: 'state', label: 'State', w: '150px', sort: 'severity' },
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
  // Most recently contacted first: the top of the list is where the work is
  // happening, the bottom is where it has stopped.
  const [sort, setSort] = useState({ col: 'staffQuiet', dir: 'asc' });
  const [q, setQ] = useState(fl.q);
  useEffect(() => { setQ(fl.q); }, [fl.q]);

  const setParams = (patch) => {
    const next = { ...router.query, ...patch };
    for (const k of Object.keys(next)) if (next[k] == null || next[k] === '' || (Array.isArray(next[k]) && !next[k].length)) delete next[k];
    router.replace(queueHref(next), undefined, { shallow: true });
  };
  // Unticking the last state on the Active tab leaves f=all rather than
  // removing it: with no filter keys at all the Needs action default returns.
  const toggleF = (k) => {
    const cur = new Set(active.filter((x) => x !== 'all'));
    cur.has(k) ? cur.delete(k) : cur.add(k);
    setParams({ f: cur.size ? [...cur] : ['all'] });
  };
  // Ticking anything outside the state group pins the state filter as it
  // stands, so the default does not come and go as other groups change.
  const pinF = () => (tabDef.states.length && !fl.f.length ? { f: active.length ? active : ['all'] } : {});
  const toggleIn = (group, k) => {
    const cur = new Set(fl[group]);
    cur.has(k) ? cur.delete(k) : cur.add(k);
    setParams({ [group]: [...cur], ...pinF() });
  };
  const clearAll = () => setParams({ ...Object.fromEntries(GROUPS.map((g) => [g, null])), alerted: null, f: tab === 'active' ? ['all'] : null });

  const inTab = useMemo(() => rows.filter((r) => tabDef.test(r)), [rows, tab]);
  const tabCounts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, rows.filter((r) => t.test(r)).length])), [rows]);
  // Every choice in the menu carries how many rows in the tab it would match
  // on its own.
  const counts = useMemo(() => {
    const c = { state: {}, mood: {}, silence: {}, reply: {}, history: {}, tier: {}, actionable: 0, contacted: 0, alerted: 0 };
    const add = (m, k) => { if (k != null) m[k] = (m[k] || 0) + 1; };
    for (const r of inTab) {
      add(c.state, r.state); add(c.mood, moodOf(r)); add(c.silence, silenceBucket(r)); add(c.reply, replyBucket(r)); add(c.history, r.history); add(c.tier, tierOf(r));
      if (r.actionable) c.actionable++;
      if (SETS.contacted.test(r)) c.contacted++;
      if (SETS.alerted.test(r)) c.alerted++;
    }
    return c;
  }, [inTab]);
  const tiers = useMemo(() => Object.keys(counts.tier).filter((t) => t !== 'none').sort(), [counts]);
  const nActive = activeCount(fl, active);

  const [menuOpen, setMenuOpen] = useState(false);
  const filterBtn = useRef(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const withCount = (label, n) => `${label}  (${(n || 0).toLocaleString()})`;
  const menuItems = (() => {
    const items = [{ label: 'Clear all', keepOpen: true, alwaysShow: true, onClick: clearAll }, '-'];
    if (tabDef.states.length) {
      items.push({ header: true, label: 'State' });
      items.push({ label: withCount(SETS.actionable.label, counts.actionable), selected: active.includes('actionable'), keepOpen: true, onClick: () => toggleF('actionable') });
      for (const st of STATES.filter((x) => tabDef.states.includes(x.key))) items.push({ label: withCount(st.label, counts.state[st.key]), selected: active.includes(st.key), keepOpen: true, onClick: () => toggleF(st.key) });
      items.push({ label: withCount(SETS.contacted.label, counts.contacted), selected: active.includes('contacted'), keepOpen: true, onClick: () => toggleF('contacted') });
      items.push('-');
    }
    items.push({ header: true, label: 'Mood' });
    for (const m of MOODS) items.push({ label: withCount(m.label, counts.mood[m.key]), selected: fl.mood.includes(m.key), keepOpen: true, onClick: () => toggleIn('mood', m.key) });
    items.push('-', { header: true, label: 'We spoke' });
    for (const b of SILENCE_BUCKETS) items.push({ label: withCount(b.label, counts.silence[b.key]), selected: fl.silence.includes(b.key), keepOpen: true, onClick: () => toggleIn('silence', b.key) });
    items.push('-', { header: true, label: 'Reply time' });
    for (const b of REPLY_BUCKETS) items.push({ label: withCount(b.label, counts.reply[b.key]), selected: fl.reply.includes(b.key), keepOpen: true, onClick: () => toggleIn('reply', b.key) });
    items.push('-', { header: true, label: 'History' });
    for (const h of HISTORY) items.push({ label: withCount(h.label, counts.history[h.key]), selected: fl.history.includes(h.key), keepOpen: true, onClick: () => toggleIn('history', h.key) });
    if (tiers.length) {
      items.push('-', { header: true, label: 'Tier' });
      for (const t of tiers) items.push({ label: withCount(t.replace(/_/g, ' '), counts.tier[t]), selected: fl.tier.includes(t), keepOpen: true, onClick: () => toggleIn('tier', t) });
    }
    items.push('-', { header: true, label: 'Alerts' });
    items.push({ label: withCount('Alerted', counts.alerted), selected: Boolean(fl.alerted), keepOpen: true, onClick: () => setParams({ alerted: fl.alerted ? null : '1', ...pinF() }) });
    return items;
  })();

  const shown = useMemo(() => {
    const filters = { ...fl, tab, f: active, q };
    const out = rows.filter((r) => matchRow(r, filters));
    const val = (r) => ({
      severity: ORDER.indexOf(r.state), player: (r.player || '').toLowerCase(),
      quiet: r.quietDays ?? 1e9, playerQuiet: r.playerQuietDays ?? 1e9, staffQuiet: r.staffQuietDays ?? r.noContactDays ?? 1e9,
      reply: r.reply?.medianMins ?? 1e9,
      mood: ['at_risk', 'negative', 'neutral', 'positive'].indexOf(r.sentiment?.label ?? 'neutral'),
    }[sort.col]);
    // Ascending on every column means the natural top of the list: most
    // severe state, fewest days since we spoke (most recent first), fastest
    // reply, worst mood.
    return [...out].sort((a, b) => {
      const x = val(a), y = val(b);
      const cmp = typeof x === 'string' ? x.localeCompare(y) : x - y;
      return cmp * (sort.dir === 'asc' ? 1 : -1) || (a.staffQuietDays ?? 1e9) - (b.staffQuietDays ?? 1e9);
    });
  }, [rows, fl, tab, active, q, sort]);

  const open = openRow;
  const setTab = (k) => { setMenuOpen(false); setParams({ tab: k === 'active' ? null : k, f: null, ...Object.fromEntries(GROUPS.map((g) => [g, null])), alerted: null, chat: null }); };
  const sortBy = (c) => c && setSort((st) => ({ col: c, dir: st.col === c && st.dir === 'asc' ? 'desc' : 'asc' }));
  const cell = (content, cls = '') => <div className="th-grid-cell"><div><span className={`th-grid-cell-inner typ-label-medium ${cls}`}>{content}</span></div></div>;
  const status = <ScanStatus {...s} compact />;

  // The pill reports its own state: the selected tint and a count while
  // anything is ticked, in place of a row of controls each reporting theirs.
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
      <div className="th-field th-field-search">
        <span className="th-field-body">
          <Icon name="search" size={12} />
          <input type="text" placeholder="Search player or chat" autoComplete="off" spellCheck={false} value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setParams({ q })} onKeyDown={(e) => { if (e.key === 'Enter') setParams({ q }); }} />
        </span>
      </div>
      <button type="button" ref={filterBtn} className={`th-pill focusable${nActive ? ' th-pill-selected' : ''}`} onClick={() => setMenuOpen((v) => !v)} aria-haspopup="true" aria-expanded={menuOpen}>
        <Icon name="filter" size={12} />
        <span className="th-pill-label typ-label-medium">{nActive ? `Filters (${nActive})` : 'Filters'}</span>
        <Icon name="caret" size={8} />
      </button>
      <Menu trigger={filterBtn} items={menuItems} open={menuOpen} onClose={closeMenu} align="right" search="Find a filter…" />
    </>
  );

  return (
    <Shell title="Queue" crumb="Queue" email={session?.user?.email} monitor={Boolean(session?.monitor)} status={status} toolbar={toolbar}>
      {error || !snap ? <Empty error={error} /> : (
        <>
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
                      {cell(<Badge tone={st.tone}>{st.label}</Badge>)}
                      {cell(r.lastStaffAt ? age(r.staffQuietDays) : (r.noContactDays != null ? `${age(r.noContactDays)}+` : <span className="ow-muted">?</span>), `ow-nums${(r.noContactDays ?? 0) >= 7 ? ' ow-warn' : ''}`)}
                      {cell(r.lastPlayerAt ? age(r.playerQuietDays) : <span className="ow-muted">·</span>, `ow-nums${r.flags.waiting ? ' ow-stale' : ''}`)}
                      {cell(age(r.quietDays), 'ow-nums ow-sub')}
                      {cell(r.reply ? mins(r.reply.medianMins) : <span className="ow-muted">·</span>, 'ow-nums ow-sub')}
                      {cell(mood && mood !== 'neutral' ? <span className={`ow-mood ow-mood-${mood}`}>{mood.replace('_', ' ')}</span> : <span className="ow-muted">–</span>)}
                      {cell(r.signals?.[0] || <span className="ow-muted">–</span>, 'ow-sub ow-clip')}
                    </div>
                  );
                })}
                {!shown.length ? <div className="th-grid-empty typ-label-medium">Nothing to show</div> : null}
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
