import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Badge from '../components/Badge';
import Shell, { ScanStatus, Empty } from '../components/Shell';
import { useSnapshot } from '../components/useSnapshot';
import { queueHref } from '../components/filters';
import { ALERT_KINDS } from '../lib/states.js';

// What the watcher has been doing: every scan, every alert it posted, and
// whether it is currently failing. This is where "why did that post" and "why
// has nothing posted" get answered.
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
const RUN_COLS = [
  { key: 'at', label: 'When', w: '150px' },
  { key: 'mode', label: 'Mode', w: '110px' },
  { key: 'ms', label: 'Took', w: '80px', num: true },
  { key: 'changed', label: 'Moved', w: '80px', num: true },
  { key: 'read', label: 'Read', w: '80px', num: true },
  { key: 'due', label: 'Due', w: '70px', num: true },
  { key: 'posted', label: 'Posted', w: '80px', num: true },
  { key: 'result', label: 'Result', w: 'minmax(220px, 1fr)' },
];
const ALERT_COLS = [
  { key: 'at', label: 'When', w: '150px' },
  { key: 'kind', label: 'Alert', w: '190px' },
  { key: 'player', label: 'Player', w: 'minmax(160px, 1fr)' },
  { key: 'sent', label: 'Slack', w: '90px' },
];

export default function Activity() {
  const s = useSnapshot();
  const { session, snap, summary, error } = s;
  const unidentified = summary?.unidentified || [];
  const router = useRouter();
  const [h, setH] = useState(null);
  useEffect(() => { fetch('/api/history').then((r) => (r.ok ? r.json() : null)).then(setH).catch(() => {}); }, [snap?.generatedAt]);

  const status = <ScanStatus {...s} compact />;
  const cell = (c, cls = '') => <div className="th-grid-cell"><div><span className={`th-grid-cell-inner typ-label-medium ${cls}`}>{c}</span></div></div>;
  if (error && !h) return <Shell title="Activity" crumb="Activity" email={session?.user?.email} status={status}><Empty error={error} /></Shell>;

  const runs = h?.runs || [];
  const alerts = h?.alerts || [];
  const okRuns = runs.filter((r) => r.ok);
  const avgMs = okRuns.length ? Math.round(okRuns.reduce((a, r) => a + (r.ms || 0), 0) / okRuns.length / 1000) : null;
  const failing = (h?.failures || 0) > 0;

  return (
    <Shell title="Activity" crumb="Activity" email={session?.user?.email} status={status}>
      <div className="ow-page">
        <div className="ow-strip">
          <span className="ow-strip-main typ-label-small">
            {failing ? <span className="ow-stale">{h.failures} consecutive failed scan{h.failures === 1 ? '' : 's'}</span> : 'Scans completing'}
            {h?.meta?.lastGoodAt ? ` · last good scan ${when(h.meta.lastGoodAt)}` : ''}
            {h?.meta?.lastFullAt ? ` · last full sweep ${when(h.meta.lastFullAt)}` : ''}
            {avgMs != null ? ` · average ${avgMs}s per scan` : ''}
          </span>

        </div>

        <div className="ow-section-head">
          <span className="ow-section-title typ-label-small">Alerts posted</span>
          <span className="ow-section-sub typ-label-small">{alerts.length ? `last ${alerts.length}` : 'none yet'}</span>
        </div>
        <div className="th-grid-scroll ow-grid-inline">
          <div className="th-grid" style={{ gridTemplateColumns: ALERT_COLS.map((c) => c.w).join(' ') }}>
            <div className="th-grid-headgroup"><div className="th-grid-headrow">
              {ALERT_COLS.map((c) => <div key={c.key} className="th-grid-headcell"><div><span className="th-grid-headlabel">{c.label}</span></div></div>)}
            </div></div>
            <div className="th-grid-body">
              {alerts.map((a, i) => (
                <div className="th-grid-row is-link" key={`${a.at}-${i}`} onClick={() => router.push(queueHref({ f: 'all', chat: a.chatId }))} role="link" tabIndex={0}>
                  {cell(when(a.at), 'ow-sub')}
                  {cell(ALERT_KINDS[a.kind]?.label || a.kind)}
                  {cell(a.player, 'ow-clip')}
                  {cell(a.dryRun ? 'dry run' : a.ts ? 'sent' : 'logged', 'ow-sub')}
                </div>
              ))}
              {!alerts.length ? <div className="th-grid-empty typ-label-medium">No alerts have been posted since the restart.</div> : null}
            </div>
          </div>
        </div>

        <div className="ow-section-head">
          <span className="ow-section-title typ-label-small">Scans</span>
          <span className="ow-section-sub typ-label-small">last {runs.length}</span>
        </div>
        <div className="th-grid-scroll ow-grid-inline">
          <div className="th-grid" style={{ gridTemplateColumns: RUN_COLS.map((c) => c.w).join(' ') }}>
            <div className="th-grid-headgroup"><div className="th-grid-headrow">
              {RUN_COLS.map((c) => <div key={c.key} className="th-grid-headcell"><div><span className={`th-grid-headlabel${c.num ? ' ow-right' : ''}`}>{c.label}</span></div></div>)}
            </div></div>
            <div className="th-grid-body">
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
              {!runs.length ? <div className="th-grid-empty typ-label-medium">No scans recorded yet.</div> : null}
            </div>
          </div>
        </div>

        {unidentified.length ? (
          <>
            <div className="ow-section-head">
              <span className="ow-section-title typ-label-small">Staff senders not in the team table</span>
              <span className="ow-section-sub typ-label-small">config/team.json</span>
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
