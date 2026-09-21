import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Badge from '../components/Badge';
import Icon from '../components/Icon';
import Shell, { ScanStatus, Empty } from '../components/Shell';
import { useSnapshot } from '../components/useSnapshot';
import { queueHref } from '../components/filters';
import { ALERT_KINDS } from '../lib/states.js';

// The audit trails, for the monitoring whitelist: who signed in, which
// sessions are open, who is blocked, what the scan did and what it posted.
const when = (v) => (v ? new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
const ago = (v) => {
  if (!v) return '–';
  const m = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};
const TABS = [
  { key: 'allowed', label: 'Allowed' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'access', label: 'Sign-ins' },
  { key: 'scans', label: 'Scans' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'excluded', label: 'Excluded' },
];
const cell = (c, cls = '') => <div className="th-grid-cell"><div><span className={`th-grid-cell-inner typ-label-medium ${cls}`}>{c}</span></div></div>;
const Grid = ({ cols, children, empty, count }) => (
  <div className="th-grid-scroll">
    <div className="th-grid" style={{ gridTemplateColumns: cols.map((c) => c.w).join(' ') }}>
      <div className="th-grid-headgroup"><div className="th-grid-headrow">
        {cols.map((c) => <div key={c.label} className="th-grid-headcell"><div><span className={`th-grid-headlabel${c.num ? ' ow-right' : ''}`}>{c.label}</span></div></div>)}
      </div></div>
      <div className="th-grid-body">
        {children}
        {!count ? <div className="th-grid-empty typ-label-medium">{empty}</div> : null}
      </div>
    </div>
  </div>
);

function useJson(url, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => fetch(url, { cache: 'no-store' })
    .then(async (r) => { const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`); return j; })
    .then((j) => { setData(j); setError(null); })
    .catch((e) => setError(e.message)), [url]);
  useEffect(() => { load(); }, [load, ...deps]);
  return { data, error, reload: load };
}

function Access() {
  const { data, error } = useJson('/api/logs/access');
  const rows = data?.entries || [];
  const cols = [{ label: 'Email', w: 'minmax(240px, 1.6fr)' }, { label: 'Name', w: 'minmax(160px, 1fr)' }, { label: 'Device', w: 'minmax(160px, 1fr)' }, { label: 'IP', w: '150px' }, { label: 'When', w: '170px' }];
  if (error) return <div className="th-grid-empty typ-label-medium">{error}</div>;
  return (
    <Grid cols={cols} count={rows.length} empty="No sign-ins recorded">
      {rows.map((e, i) => (
        <div className="th-grid-row" key={`${e.at}-${i}`}>
          {cell(<>{e.email}{e.denied ? <span className="ow-inline-badge"><Badge tone="red">{e.reason === 'blocked' ? 'Blocked' : 'Not allowed'}</Badge></span> : null}</>, 'ow-clip')}
          {cell(e.name || '–', 'ow-sub ow-clip')}
          {cell(e.device || '–', 'ow-sub ow-clip')}
          {cell(e.ip || '–', 'ow-nums ow-sub')}
          {cell(when(e.at), 'ow-sub')}
        </div>
      ))}
    </Grid>
  );
}

function Sessions() {
  const { data, error, reload } = useJson('/api/logs/sessions');
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const rows = data?.sessions || [];
  const cols = [{ label: 'User', w: 'minmax(240px, 1.6fr)' }, { label: 'Device', w: 'minmax(160px, 1fr)' }, { label: 'IP', w: '150px' }, { label: 'Signed in', w: '120px' }, { label: 'Last seen', w: '120px' }, { label: '', w: '120px' }];
  const revoke = async (sid) => {
    setBusy(sid);
    try {
      const r = await fetch('/api/logs/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sid }) });
      const j = await r.json();
      if (j.self) { window.location.href = '/api/auth/signout'; return; }
      setConfirm(null);
      await reload();
    } finally { setBusy(null); }
  };
  if (error) return <div className="th-grid-empty typ-label-medium">{error}</div>;
  const target = confirm ? rows.find((r) => r.sid === confirm) : null;
  return (
    <>
      <Grid cols={cols} count={rows.length} empty="No open sessions">
        {rows.map((r) => (
          <div className="th-grid-row" key={r.sid}>
            {cell(<>{r.email}{r.current ? <span className="ow-inline-badge"><Badge tone="green">This device</Badge></span> : null}</>, 'ow-clip')}
            {cell(r.device || '–', 'ow-sub ow-clip')}
            {cell(r.ip || '–', 'ow-nums ow-sub')}
            {cell(ago(r.createdAt), 'ow-sub')}
            {cell(ago(r.lastSeen || r.createdAt), 'ow-sub')}
            {cell(<button type="button" className="th-chip typ-label-small ow-chip-danger" onClick={() => setConfirm(r.sid)} disabled={busy === r.sid}>Revoke</button>)}
          </div>
        ))}
      </Grid>
      {target ? (
        <div className="th-modal-wrap is-open" onClick={(e) => { if (e.target === e.currentTarget) setConfirm(null); }}>
          <div className="th-modal" role="dialog" aria-modal="true" style={{ width: 'min(460px, 100%)' }}>
            <div className="th-modal-head">
              <h2 className="th-modal-title typ-heading-small">Revoke session</h2>
              <button type="button" className="th-action focusable" onClick={() => setConfirm(null)} aria-label="Close"><Icon name="close" size={18} /></button>
            </div>
            <div className="th-modal-body">
              <p className="typ-paragraph-small ow-modal-text">{target.email} · {target.device}{target.ip ? ` · ${target.ip}` : ''}{target.current ? ' · this device' : ''}</p>
              <div className="ow-modal-acts">
                <button type="button" className="th-pill focusable" onClick={() => setConfirm(null)}><span className="th-pill-label typ-label-small">Cancel</span></button>
                <button type="button" className="th-pill th-pill-danger focusable" onClick={() => revoke(target.sid)} disabled={busy === target.sid}><span className="th-pill-label typ-label-small">Revoke</span></button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Allowed() {
  const { data, error, reload } = useJson('/api/logs/allowed');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const rows = data?.entries || [];
  const monitors = data?.monitors || [];
  const configured = data?.configured || [];
  const cols = [{ label: 'Email', w: 'minmax(240px, 1.6fr)' }, { label: 'Added by', w: 'minmax(200px, 1fr)' }, { label: 'When', w: '170px' }, { label: '', w: '120px' }];
  const send = async (method, body) => {
    setBusy(true); setNote(null);
    try {
      const r = await fetch('/api/logs/allowed', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || j.error) { setNote(j.error || `HTTP ${r.status}`); return; }
      if (method === 'POST') setText('');
      await reload();
    } finally { setBusy(false); }
  };
  if (error) return <div className="th-grid-empty typ-label-medium">{error}</div>;
  return (
    <>
      <form className="ow-blockform" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send('POST', { emails: text }); }}>
        <div className="th-field th-field-search ow-field-wide">
          <span className="th-field-body">
            <input type="text" placeholder={`name@${data?.domain || 'paradym.io'}, name@${data?.domain || 'paradym.io'}`} autoComplete="off" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
          </span>
        </div>
        <button type="submit" className="th-pill th-pill-primary focusable" disabled={busy || !text.trim()}><span className="th-pill-label typ-label-medium">Allow</span></button>
        {note ? <span className="ow-stale typ-label-small">{note}</span> : null}
      </form>
      <Grid cols={cols} count={rows.length + monitors.length + configured.length} empty="Nobody allowed">
        {monitors.map((e) => (
          <div className="th-grid-row" key={`mon-${e}`}>
            {cell(<>{e}<span className="ow-inline-badge"><Badge tone="green">Whitelist</Badge></span></>, 'ow-clip')}
            {cell('–', 'ow-sub')}{cell('–', 'ow-sub')}{cell('')}
          </div>
        ))}
        {configured.map((e) => (
          <div className="th-grid-row" key={`cfg-${e}`}>
            {cell(e, 'ow-clip')}{cell('Environment', 'ow-sub')}{cell('–', 'ow-sub')}{cell('')}
          </div>
        ))}
        {rows.map((r) => (
          <div className="th-grid-row" key={r.email}>
            {cell(r.email, 'ow-clip')}
            {cell(r.by || '–', 'ow-sub ow-clip')}
            {cell(when(r.at), 'ow-sub')}
            {cell(<button type="button" className="th-chip typ-label-small ow-chip-danger" onClick={() => send('DELETE', { email: r.email })} disabled={busy}>Remove</button>)}
          </div>
        ))}
      </Grid>
    </>
  );
}

function Blocked() {
  const { data, error, reload } = useJson('/api/logs/blocked');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const rows = data?.entries || [];
  const configured = data?.configured || [];
  const cols = [{ label: 'Email', w: 'minmax(240px, 1.6fr)' }, { label: 'Blocked by', w: 'minmax(200px, 1fr)' }, { label: 'When', w: '170px' }, { label: '', w: '120px' }];
  const send = async (method, value) => {
    setBusy(true); setNote(null);
    try {
      const r = await fetch('/api/logs/blocked', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: value }) });
      const j = await r.json();
      if (!r.ok || j.error) { setNote(j.error || `HTTP ${r.status}`); return; }
      if (method === 'POST') setEmail('');
      await reload();
    } finally { setBusy(false); }
  };
  if (error) return <div className="th-grid-empty typ-label-medium">{error}</div>;
  return (
    <>
      <form className="ow-blockform" onSubmit={(e) => { e.preventDefault(); if (email.trim()) send('POST', email.trim()); }}>
        <div className="th-field th-field-search">
          <span className="th-field-body">
            <input type="email" placeholder={`name@${data?.domain || 'paradym.io'}`} autoComplete="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} />
          </span>
        </div>
        <button type="submit" className="th-pill th-pill-danger focusable" disabled={busy || !email.trim()}><span className="th-pill-label typ-label-medium">Block</span></button>
        {note ? <span className="ow-stale typ-label-small">{note}</span> : null}
      </form>
      <Grid cols={cols} count={rows.length + configured.length} empty="Nobody blocked">
        {rows.map((r) => (
          <div className="th-grid-row" key={r.email}>
            {cell(r.email, 'ow-clip')}
            {cell(r.by || '–', 'ow-sub ow-clip')}
            {cell(when(r.at), 'ow-sub')}
            {cell(<button type="button" className="th-chip typ-label-small" onClick={() => send('DELETE', r.email)} disabled={busy}>Unblock</button>)}
          </div>
        ))}
        {configured.map((e) => (
          <div className="th-grid-row" key={`cfg-${e}`}>
            {cell(e, 'ow-clip')}
            {cell('Environment', 'ow-sub')}
            {cell('–', 'ow-sub')}
            {cell('')}
          </div>
        ))}
      </Grid>
    </>
  );
}

function Scans({ h, unidentified }) {
  const runs = h?.runs || [];
  const cols = [
    { label: 'When', w: '150px' }, { label: 'Mode', w: '110px' }, { label: 'Took', w: '80px', num: true }, { label: 'Moved', w: '80px', num: true },
    { label: 'Read', w: '80px', num: true }, { label: 'Due', w: '70px', num: true }, { label: 'Posted', w: '80px', num: true }, { label: 'Result', w: 'minmax(220px, 1fr)' },
  ];
  return (
    <>
      <Grid cols={cols} count={runs.length} empty="No scans recorded">
        {runs.map((r, i) => (
          <div className="th-grid-row" key={`${r.at}-${i}`}>
            {cell(when(r.at), 'ow-sub')}
            {cell(r.ok ? r.mode : <Badge tone="red">failed</Badge>)}
            {cell(r.ms != null ? `${Math.round(r.ms / 1000)}s` : '–', 'ow-nums ow-sub')}
            {cell(r.changed ?? '–', 'ow-nums ow-sub')}
            {cell(r.read ?? '–', 'ow-nums ow-sub')}
            {cell(r.due ?? '–', 'ow-nums ow-sub')}
            {cell(r.posted ?? '–', `ow-nums${r.posted ? '' : ' ow-sub'}`)}
            {cell(r.ok
              ? `${r.actionable ?? '–'} need action · ${r.noContact7d ?? '–'} no contact · ${r.waiting ?? '–'} waiting${r.overflow ? ` · ${r.overflow} alerts held` : ''}${r.alertError ? ` · ${r.alertError}` : ''}`
              : r.error, r.ok ? 'ow-sub ow-clip' : 'ow-stale ow-clip')}
          </div>
        ))}
      </Grid>
      {unidentified.length ? (
        <div className="ow-logs-block">
          <div className="ow-block-title typ-label-xsmall">Staff senders not in the team table</div>
          <Grid cols={[{ label: 'Telegram id', w: '200px' }, { label: 'Display name', w: 'minmax(200px, 1fr)' }, { label: 'Groups', w: '120px', num: true }]} count={unidentified.length} empty="">
            {unidentified.map((u) => (
              <div className="th-grid-row" key={u.id}>
                {cell(u.id, 'ow-nums')}{cell(u.name || '–', 'ow-clip')}{cell(u.chats, 'ow-nums')}
              </div>
            ))}
          </Grid>
        </div>
      ) : null}
    </>
  );
}

// Chats the shared account can see that the tool leaves out, with the reason.
function Excluded() {
  const { data, error } = useJson('/api/logs/excluded');
  const rows = data?.entries || [];
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const shown = term ? rows.filter((r) => `${r.title} ${r.reason}`.toLowerCase().includes(term)) : rows;
  const cols = [{ label: 'Chat', w: 'minmax(240px, 1.6fr)' }, { label: 'Accounts', w: 'minmax(160px, 1fr)' }, { label: 'Members', w: '100px', num: true }, { label: 'Last message', w: '150px' }, { label: 'Reason', w: 'minmax(180px, 1fr)' }];
  if (error) return <div className="th-grid-empty typ-label-medium">{error}</div>;
  return (
    <>
      <div className="ow-blockform">
        <div className="th-field th-field-search ow-field-wide">
          <span className="th-field-body">
            <Icon name="search" size={12} />
            <input type="text" placeholder="Search chat or reason" autoComplete="off" spellCheck={false} value={q} onChange={(e) => setQ(e.target.value)} />
          </span>
        </div>
      </div>
      <Grid cols={cols} count={shown.length} empty="Nothing left out">
        {shown.map((r) => (
          <div className="th-grid-row" key={r.chatId}>
            {cell(r.title || r.chatId, 'ow-clip')}
            {cell((r.accounts || []).join(', ') || '–', 'ow-sub ow-clip')}
            {cell(r.members ?? '–', 'ow-nums ow-sub')}
            {cell(r.lastMessageAt ? when(r.lastMessageAt) : '–', 'ow-sub')}
            {cell(r.reason, 'ow-sub ow-clip')}
          </div>
        ))}
      </Grid>
    </>
  );
}

function Alerts({ h }) {
  const router = useRouter();
  const alerts = h?.alerts || [];
  const cols = [{ label: 'When', w: '150px' }, { label: 'Alert', w: '190px' }, { label: 'Player', w: 'minmax(160px, 1fr)' }, { label: 'Slack', w: '90px' }];
  return (
    <Grid cols={cols} count={alerts.length} empty="No alerts posted">
      {alerts.map((a, i) => (
        <div className="th-grid-row is-link" key={`${a.at}-${i}`} onClick={() => router.push(queueHref({ f: 'all', chat: a.chatId }))} role="link" tabIndex={0}>
          {cell(when(a.at), 'ow-sub')}
          {cell(ALERT_KINDS[a.kind]?.label || a.kind)}
          {cell(a.player, 'ow-clip')}
          {cell(a.dryRun ? 'dry run' : a.ts ? 'sent' : 'logged', 'ow-sub')}
        </div>
      ))}
    </Grid>
  );
}

export default function Logs() {
  const s = useSnapshot();
  const { session, status: authStatus, snap, summary } = s;
  const router = useRouter();
  const tab = TABS.some((t) => t.key === router.query.tab) ? String(router.query.tab) : 'allowed';
  const [h, setH] = useState(null);
  useEffect(() => { if (session?.monitor) fetch('/api/history').then((r) => (r.ok ? r.json() : null)).then(setH).catch(() => {}); }, [snap?.generatedAt, session?.monitor]);
  const status = <ScanStatus {...s} compact />;
  const monitor = Boolean(session?.monitor);

  const toolbar = monitor ? (
    <div className="th-subtabs th-subtabs-section ow-tabs">
      {TABS.map((t) => (
        <button type="button" key={t.key} className={`th-pill focusable${tab === t.key ? ' th-pill-selected' : ''}`} onClick={() => router.replace({ pathname: '/logs', query: t.key === 'allowed' ? {} : { tab: t.key } }, undefined, { shallow: true })} aria-pressed={tab === t.key}>
          <span className="th-pill-label typ-label-medium">{t.label}</span>
        </button>
      ))}
    </div>
  ) : null;

  const body = useMemo(() => {
    if (!monitor) return null;
    if (tab === 'allowed') return <Allowed />;
    if (tab === 'access') return <Access />;
    if (tab === 'sessions') return <Sessions />;
    if (tab === 'blocked') return <Blocked />;
    if (tab === 'scans') return <Scans h={h} unidentified={summary?.unidentified || []} />;
    if (tab === 'excluded') return <Excluded />;
    return <Alerts h={h} />;
  }, [monitor, tab, h, summary]);

  return (
    <Shell title="Logs" crumb="Logs" email={session?.user?.email} monitor={monitor} status={status} toolbar={toolbar}>
      {authStatus === 'authenticated' && !monitor ? <Empty error="Not available" /> : body}
    </Shell>
  );
}
