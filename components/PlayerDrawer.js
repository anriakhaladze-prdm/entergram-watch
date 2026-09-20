import { useEffect, useState } from 'react';
import Icon from './Icon';
import { STATE, MOODS, age, mins } from '../lib/states.js';

// The drill-in behind a row: what the scan knows about this player, and the
// recent conversation read live from Entergram when the reader account can see
// the group. Nothing here is stored; closing the drawer drops it.
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
const tier = (t) => String(t || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(\d)\b/g, (d) => ['', 'I', 'II', 'III', 'IV', 'V'][Number(d)] || d);

export default function PlayerDrawer({ row, onClose }) {
  const [conv, setConv] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setConv(null);
    if (!row) return undefined;
    let live = true;
    fetch(`/api/chat/${encodeURIComponent(row.chatId)}`).then((r) => r.json()).then((d) => { if (live) setConv(d); }).catch((e) => { if (live) setConv({ unavailable: true, error: e.message, messages: [] }); });
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { live = false; window.removeEventListener('keydown', onKey); };
  }, [row?.chatId]);

  if (!row) return null;
  const st = STATE[row.state] || { label: row.state, tone: 'gray' };
  const mood = MOODS.find((x) => x.key === row.sentiment?.label);
  const copyTitle = () => navigator.clipboard?.writeText(row.title).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  // Entergram has no per-chat URL, so the name goes on the clipboard and the
  // app opens ready for one paste into its search.
  const openEntergram = async () => { await copyTitle(); window.open('https://app.entergram.com/', '_blank', 'noreferrer'); };

  const fact = (k, v, cls = '') => (
    <div className="th-meta-cell" key={k}>
      <span className="th-meta-key typ-label-xsmall">{k}</span>
      <span className={`th-meta-val typ-label-medium ${cls}`}><span className="txt">{v}</span></span>
    </div>
  );

  return (
    <>
      <div className="th-backdrop is-open" onClick={onClose} />
      <aside className="th-drawer is-open ow-drawer" role="dialog" aria-label={row.title}>
        <div className="th-drawer-surface">
          <div className="th-drawer-head">
            <div className="ow-drawer-title">
              <div className="ow-drawer-name typ-heading-small">{row.playerUsername || row.player}</div>
              <div className="ow-drawer-sub typ-label-small">
                <span className={`th-badge th-badge-${st.tone} typ-label-small`}>{st.label}</span>
                {row.tier ? <span className="th-badge th-badge-blue typ-label-small">{tier(row.tier)}</span> : null}
                {mood && mood.key !== 'neutral' ? <span className={`th-badge th-badge-${mood.tone} typ-label-small`}>{mood.label}</span> : null}
                <span className="ow-sub">{row.title}</span>
              </div>
            </div>
            <button type="button" className="th-action focusable" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
          </div>
          <div className="th-drawer-body">
            <div className="ow-drawer-acts">
              {row.inviteLink ? <a className="th-pill focusable" href={row.inviteLink} target="_blank" rel="noreferrer"><span className="th-pill-label typ-label-medium">Open in Telegram</span></a> : null}
              <button type="button" className="th-pill focusable" onClick={openEntergram}><span className="th-pill-label typ-label-medium">{copied ? 'Name copied, paste in Entergram search' : 'Open Entergram'}</span></button>
              <button type="button" className="th-pill focusable" onClick={copyTitle}><span className="th-pill-label typ-label-medium">Copy chat name</span></button>
            </div>

            <div className="ow-drawer-signal typ-paragraph-small">{row.signals?.[0] || 'in contact'}</div>

            <div className="th-meta">
              {fact('We last spoke', row.lastStaffAt ? <>{age(row.staffQuietDays)} ago{row.lastStaffBy ? <span className="ow-sub"> · {row.lastStaffBy}</span> : null}</> : row.history === 'read' ? 'not in the readable history' : 'unknown')}
              {fact('Player last spoke', row.lastPlayerAt ? <>{age(row.playerQuietDays)} ago{row.ack ? <span className="ow-sub"> · closed the exchange</span> : ''}</> : 'no player message on record')}
              {fact('Any message', row.lastMessageAt ? `${age(row.quietDays)} ago` : '–')}
              {fact('First reply', row.reply ? <>median {mins(row.reply.medianMins)}<span className="ow-sub"> · p90 {mins(row.reply.p90Mins)} · worst {mins(row.reply.worstMins)} · {row.reply.samples} exchanges</span></> : 'not measured', 'ow-wrap')}
              {fact('Members', row.membersCount ?? '–')}
              {fact('History', row.history === 'read' ? `read ${row.historyAt ? when(row.historyAt) : ''}` : row.history === 'events' ? 'event stream, text not readable' : row.history === 'unavailable' ? 'not readable, last message only' : 'queued for a read')}
              {fact('Known by accounts', (row.accounts || []).join(', ') || '–')}
              {fact('Chat id', row.chatId, 'mono')}
            </div>

            {row.staffSpeakers?.length ? (
              <div className="ow-block">
                <div className="ow-block-title typ-label-xsmall">Staff who have replied</div>
                <div className="ow-speakers">
                  {row.staffSpeakers.map((sp) => (
                    <span key={sp.id} className="th-chip typ-label-small">{sp.name} <span className="ow-nums">{sp.msgs}</span></span>
                  ))}
                </div>
              </div>
            ) : null}

            {row.sentiment ? (
              <div className="ow-block">
                <div className="ow-block-title typ-label-xsmall">Sentiment, from the player&rsquo;s messages only</div>
                <div className="typ-paragraph-small">
                  <span className={`ow-mood ow-mood-${row.sentiment.label}`}>{row.sentiment.label.replace('_', ' ')}</span>
                  {row.sentiment.reason ? <> · {row.sentiment.reason}</> : null}
                  {row.sentiment.flags?.length ? <span className="ow-sub"> · {row.sentiment.flags.join(', ')}</span> : null}
                  <span className="ow-sub"> · {row.sentiment.source}{row.sentiment.scoredAt ? `, ${when(row.sentiment.scoredAt)}` : ''}</span>
                </div>
                {row.sentiment.quote ? <blockquote className="ow-quote typ-paragraph-small">{row.sentiment.quote}</blockquote> : null}
              </div>
            ) : null}

            {row.alerts && Object.keys(row.alerts).length ? (
              <div className="ow-block">
                <div className="ow-block-title typ-label-xsmall">Slack alerts</div>
                <div className="typ-paragraph-small">
                  {Object.entries(row.alerts).map(([k, v]) => (
                    <div key={k}>{k === 'no_contact' ? '7 days without contact' : 'Churn signal'}: {v.seeded ? `baseline recorded ${when(v.at)}, not posted` : `posted ${when(v.at)}`}</div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="ow-block">
              <div className="ow-block-title typ-label-xsmall">Recent conversation</div>
              {!conv ? <div className="ow-sub typ-label-small">Loading from Entergram…</div>
                : conv.unavailable ? <div className="ow-sub typ-label-small">Not readable. @Thrill_VIP_Ops is not a member of this group{conv.error ? ` (${conv.error})` : ''}.</div>
                : (
                  <div className="ow-transcript">
                    {conv.messages.map((mm) => (
                      <div key={mm.id || mm.date} className={`ow-msg ow-msg-${mm.side}`}>
                        <div className="ow-msg-meta typ-label-xsmall">{mm.side === 'system' ? 'system' : mm.name} · {when(mm.date)}</div>
                        <div className="ow-msg-text typ-paragraph-small">{mm.text || <span className="ow-sub">(media)</span>}</div>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
