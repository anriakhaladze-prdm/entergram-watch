import { useEffect, useState } from 'react';
import Icon from './Icon';
import Badge from './Badge';
import { STATE, MOODS, age, mins } from '../lib/states.js';
import { accountStatusLabel, money, shortDate, tierLabel, tierTone } from '../lib/playerProfile.js';

// The drill-in behind a row: what the scan knows about this player, and the
// recent conversation read live from Entergram when the reader account can see
// the group. Nothing here is stored; closing the drawer drops it.
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');

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
  const live = conv?.customFields || {};
  const profile = {
    tier: live.tier ?? row.tier,
    accountStatus: live.account_status ?? row.accountStatus,
    selfExcludedUntil: live.self_excluded_until ?? row.selfExcludedUntil,
    signupDate: live.signup_date ?? row.signupDate,
    typicalBetUsd: live.typical_bet_usd ?? row.typicalBetUsd,
    sportsbook: live.sportsbook ?? row.sportsbook,
    originals: live.originals ?? row.originals,
    slots: live.slots ?? row.slots,
    liveCasino: live.live_casino ?? row.liveCasino,
    favouriteGames: live.favourite_games ?? row.favouriteGames,
    favouriteProviders: live.favourite_providers ?? row.favouriteProviders,
  };
  const posted = Object.entries(row.alerts || {}).filter(([, v]) => v && !v.seeded);
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
              <div className="ow-drawer-sub">
                <Badge tone={st.tone}>{st.label}</Badge>
                {profile.tier ? <span className={`ow-tier ow-tier-${tierTone(profile.tier)}`}>{tierLabel(profile.tier)}</span> : null}
                {profile.accountStatus ? <span className={`ow-account ow-account-${profile.accountStatus}`}>{accountStatusLabel(profile.accountStatus)}</span> : null}
                {mood && mood.key !== 'neutral' ? <Badge tone={mood.tone}>{mood.label}</Badge> : null}
                <span className="ow-sub typ-label-small">{row.title}</span>
              </div>
            </div>
            <button type="button" className="th-action focusable" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
          </div>
          <div className="th-drawer-body">
            <div className="ow-drawer-acts">
              {row.inviteLink ? <a className="th-pill focusable" href={row.inviteLink} target="_blank" rel="noreferrer"><span className="th-pill-label typ-label-medium">Open in Telegram</span></a> : null}
              <button type="button" className="th-pill focusable" onClick={openEntergram}><span className="th-pill-label typ-label-medium">{copied ? 'Name copied' : 'Open Entergram'}</span></button>
              <button type="button" className="th-pill focusable" onClick={copyTitle}><span className="th-pill-label typ-label-medium">Copy chat name</span></button>
              <a className="th-pill focusable" href={`/api/export/${encodeURIComponent(row.chatId)}`} download><span className="th-pill-label typ-label-medium">Export PDF</span></a>
            </div>

            {row.signals?.[0] && row.signals[0] !== row.sentiment?.reason ? <div className="ow-drawer-signal typ-paragraph-small">{row.signals[0]}</div> : null}

            <div className="th-meta">
              {fact('We last spoke', row.lastStaffAt ? <>{age(row.staffQuietDays)} ago{row.lastStaffBy ? <span className="ow-sub"> · {row.lastStaffBy}</span> : null}</> : '–')}
              {fact('Player last spoke', row.lastPlayerAt ? <>{age(row.playerQuietDays)} ago{row.ack ? <span className="ow-sub"> · closed the exchange</span> : ''}</> : '–')}
              {fact('Last message', row.lastMessageAt ? `${age(row.quietDays)} ago` : '–')}
              {fact('First reply', row.reply ? <>median {mins(row.reply.medianMins)}<span className="ow-sub"> · p90 {mins(row.reply.p90Mins)} · worst {mins(row.reply.worstMins)} · {row.reply.samples} exchanges</span></> : '–', 'ow-wrap')}
              {fact('Members', row.membersCount ?? '–')}
              {fact('Tier', profile.tier ? tierLabel(profile.tier) : '–')}
              {fact('Account status', accountStatusLabel(profile.accountStatus) || '–')}
              {fact('Self-excluded until', profile.selfExcludedUntil ? shortDate(profile.selfExcludedUntil) : '–')}
              {fact('Signup date', shortDate(profile.signupDate))}
              {fact('Typical bet', profile.typicalBetUsd != null ? money(profile.typicalBetUsd) : '–')}
              {fact('Products', [profile.sportsbook && 'Sportsbook', profile.originals && 'Originals', profile.slots && 'Slots', profile.liveCasino && 'Live casino'].filter(Boolean).join(', ') || '–')}
              {fact('Favourite games', profile.favouriteGames || '–', 'ow-wrap')}
              {fact('Favourite providers', profile.favouriteProviders?.length ? profile.favouriteProviders.map((p) => p.replace(/_/g, ' ')).join(', ') : '–', 'ow-wrap')}
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
                <div className="ow-block-title typ-label-xsmall">Sentiment</div>
                <div className="typ-paragraph-small">
                  <span className={`ow-mood ow-mood-${row.sentiment.label}`}>{(mood?.label || row.sentiment.label).replace('_', ' ')}</span>
                  {row.sentiment.reason ? <> · {row.sentiment.reason}</> : null}
                </div>
                {row.sentiment.quote ? <blockquote className="ow-quote typ-paragraph-small">{row.sentiment.quote}</blockquote> : null}
              </div>
            ) : null}

            {posted.length ? (
              <div className="ow-block">
                <div className="ow-block-title typ-label-xsmall">Slack alerts</div>
                <div className="typ-paragraph-small">
                  {posted.map(([k, v]) => (
                    <div key={k}>{k === 'no_contact' ? '7 days without contact' : 'Churn signal'} · {when(v.at)}</div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="ow-block">
              <div className="ow-block-title typ-label-xsmall">Recent conversation</div>
              {!conv ? <div className="ow-sub typ-label-small">Loading</div>
                : conv.unavailable ? <div className="ow-sub typ-label-small">Not readable. @Thrill_VIP_Ops is not in this group.</div>
                : (
                  <div className="ow-transcript">
                    {conv.messages.map((mm) => (
                      <div key={mm.id || mm.date} className={`ow-msg ow-msg-${mm.side}`}>
                        <div className="ow-msg-meta typ-label-xsmall">{mm.side === 'system' ? when(mm.date) : <>{mm.name} · {when(mm.date)}</>}</div>
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
