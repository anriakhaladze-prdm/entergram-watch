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
import { accountStatusLabel, money, shortDate, tierLabel, tierTone } from '../lib/playerProfile.js';

// The worklist. Every filter is in the URL, so a tile on the overview, a
// Slack alert and a host's own bookmark all open the same view.
const COLS = [
  { key: 'player', label: 'Player', w: 'minmax(220px, 1.15fr)', sort: 'player' },
  { key: 'state', label: 'State', w: '136px', sort: 'severity' },
  { key: 'we', label: 'We spoke', w: '88px', sort: 'staffQuiet', num: true },
  { key: 'player_last', label: 'Player spoke', w: '104px', sort: 'playerQuiet', num: true },
  { key: 'reply', label: 'Reply', w: '76px', sort: 'reply', num: true },
  { key: 'mood', label: 'Mood', w: '88px', sort: 'mood' },
  { key: 'profile', label: 'Player profile', w: 'minmax(282px, 1.85fr)', sort: null },
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

  const setParams = (patch, { push = false } = {}) => {
    const next = { ...router.query, ...patch };
    for (const k of Object.keys(next)) if (next[k] == null || next[k] === '' || (Array.isArray(next[k]) && !next[k].length)) delete next[k];
    router[push ? 'push' : 'replace'](queueHref(next), undefined, { shallow: true });
  };
  // Opening a player is a history entry, so the phone's back gesture closes
  // the drawer instead of leaving the queue. A drawer opened from a link
  // (a Slack alert, a bookmark) has nothing behind it, so it closes in place.
  const pushedChat = useRef(false);
  useEffect(() => { if (!fl.chat) pushedChat.current = false; }, [fl.chat]);
  const openChat = (id) => { pushedChat.current = true; setParams({ chat: id }, { push: true }); };
  const closeChat = () => {
    if (pushedChat.current) { pushedChat.current = false; router.back(); } else setParams({ chat: null });
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
  // Phones have no header row to sort from, so the same choices sit in a menu.
  const [sortOpen, setSortOpen] = useState(false);
  const sortBtn = useRef(null);
  const closeSort = useCallback(() => setSortOpen(false), []);
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
  const setTab = (k) => { setMenuOpen(false); setSortOpen(false); setParams({ tab: k === 'active' ? null : k, f: null, ...Object.fromEntries(GROUPS.map((g) => [g, null])), alerted: null, chat: null }); };
  const sortBy = (c) => c && setSort((st) => ({ col: c, dir: st.col === c && st.dir === 'asc' ? 'desc' : 'asc' }));
  const sortCols = COLS.filter((c) => c.sort);
  const sortItems = [
    { header: true, label: 'Sort by' },
    ...sortCols.map((c) => ({ label: c.label, selected: sort.col === c.sort, onClick: () => setSort((st) => ({ col: c.sort, dir: st.col === c.sort ? st.dir : 'asc' })) })),
    '-', { header: true, label: 'Order' },
    { label: 'Ascending', selected: sort.dir === 'asc', onClick: () => setSort((st) => ({ ...st, dir: 'asc' })) },
    { label: 'Descending', selected: sort.dir === 'desc', onClick: () => setSort((st) => ({ ...st, dir: 'desc' })) },
  ];
  // One set of values, drawn twice: the grid on wider screens, a card per
  // player on phones.
  const view = (r) => {
    const st = STATE[r.state] || { label: r.state, tone: 'gray' };
    const mood = r.sentiment?.label;
    const profileLoaded = Boolean(r.accountStatus || r.tier || r.signupDate || r.favouriteGames || r.typicalBetUsd != null);
    return {
      st,
      name: r.playerUsername || r.player || r.title,
      tags: <>{r.tier ? <span className={`ow-tier ow-tier-${tierTone(r.tier)}`}>{tierLabel(r.tier)}</span> : null}{r.accountStatus ? <span className={`ow-account ow-account-${r.accountStatus}`}>{accountStatusLabel(r.accountStatus)}</span> : null}</>,
      we: r.lastStaffAt ? age(r.staffQuietDays) : (r.noContactDays != null ? `${age(r.noContactDays)}+` : <span className="ow-muted">?</span>),
      weCls: (r.noContactDays ?? 0) >= 7 ? ' ow-warn' : '',
      them: r.lastPlayerAt ? age(r.playerQuietDays) : <span className="ow-muted">·</span>,
      themCls: r.flags.waiting ? ' ow-stale' : '',
      reply: r.reply ? mins(r.reply.medianMins) : <span className="ow-muted">·</span>,
      mood: mood && mood !== 'neutral' ? <span className={`ow-mood ow-mood-${mood}`}>{mood.replace('_', ' ')}</span> : <span className="ow-muted">–</span>,
      profileTitle: [r.favouriteGames, (r.favouriteProviders || []).join(', ')].filter(Boolean).join(' · '),
      profileMain: <span className={`ow-profile-main${profileLoaded ? '' : ' ow-profile-pending'}`}>{profileLoaded ? (r.typicalBetUsd != null ? `${money(r.typicalBetUsd)} median` : 'No casino bets') : 'Profile pending'}{r.sportsbook ? ' · Sportsbook' : ''}{r.originals ? ' · Originals' : ''}{r.slots ? ' · Slots' : ''}{r.liveCasino ? ' · Live' : ''}</span>,
      profileSub: <span className="ow-profile-sub">{profileLoaded ? (r.favouriteGames || (r.favouriteProviders || []).join(', ') || `Joined ${shortDate(r.signupDate)}`) : 'Waiting for attribute refresh'}</span>,
    };
  };
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
      <div className="ow-tools">
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
      <button type="button" ref={sortBtn} className="th-pill focusable ow-mobile-only" onClick={() => setSortOpen((v) => !v)} aria-haspopup="true" aria-expanded={sortOpen}>
        <Icon name="sort" size={12} />
        <span className="th-pill-label typ-label-medium">Sort</span>
        <Icon name="caret" size={8} />
      </button>
      </div>
      <Menu trigger={filterBtn} items={menuItems} open={menuOpen} onClose={closeMenu} align="right" search="Find a filter…" />
      <Menu trigger={sortBtn} items={sortItems} open={sortOpen} onClose={closeSort} align="right" />
    </>
  );

  return (
    <Shell title="Queue" crumb="Queue" email={session?.user?.email} monitor={Boolean(session?.monitor)} status={status} toolbar={toolbar}>
      {error || !snap ? <Empty error={error} /> : (
        <>
          <div className="th-grid-scroll ow-qgrid">
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
                  const v = view(r);
                  return (
                    <div className="th-grid-row is-link" key={r.chatId} onClick={() => openChat(r.chatId)} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') openChat(r.chatId); }}>
                      {cell(<span className="ow-player-cell"><span className="ow-player-name">{v.name}</span><span className="ow-player-badges">{v.tags}</span></span>)}
                      {cell(<Badge tone={v.st.tone}>{v.st.label}</Badge>)}
                      {cell(v.we, `ow-nums${v.weCls}`)}
                      {cell(v.them, `ow-nums${v.themCls}`)}
                      {cell(v.reply, 'ow-nums ow-sub')}
                      {cell(v.mood)}
                      {cell(<span className="ow-profile-cell" title={v.profileTitle}>{v.profileMain}{v.profileSub}</span>)}
                    </div>
                  );
                })}
                {!shown.length ? <div className="th-grid-empty typ-label-medium">Nothing to show</div> : null}
              </div>
            </div>
          </div>
          <div className="ow-qlist">
            {shown.map((r) => {
              const v = view(r);
              return (
                <div className="ow-qcard focusable" key={r.chatId} onClick={() => openChat(r.chatId)} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') openChat(r.chatId); }}>
                  <div className="ow-qcard-top">
                    <span className="ow-qcard-name">{v.name}</span>
                    <Badge tone={v.st.tone}>{v.st.label}</Badge>
                  </div>
                  {r.tier || r.accountStatus ? <div className="ow-qcard-tags">{v.tags}</div> : null}
                  <div className="ow-qcard-facts">
                    <div className="ow-qfact"><span className="ow-qfact-k">We spoke</span><span className={`ow-qfact-v ow-nums${v.weCls}`}>{v.we}</span></div>
                    <div className="ow-qfact"><span className="ow-qfact-k">Player spoke</span><span className={`ow-qfact-v ow-nums${v.themCls}`}>{v.them}</span></div>
                    <div className="ow-qfact"><span className="ow-qfact-k">Reply</span><span className="ow-qfact-v ow-nums ow-sub">{v.reply}</span></div>
                    <div className="ow-qfact"><span className="ow-qfact-k">Mood</span><span className="ow-qfact-v">{v.mood}</span></div>
                  </div>
                  <div className="ow-profile-cell ow-qcard-profile">{v.profileMain}{v.profileSub}</div>
                </div>
              );
            })}
            {!shown.length ? <div className="th-grid-empty typ-label-medium">Nothing to show</div> : null}
          </div>
          <PlayerDrawer row={open} onClose={closeChat} />
        </>
      )}
    </Shell>
  );
}

export { ACTIONABLE };
