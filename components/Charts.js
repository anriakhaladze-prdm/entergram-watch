// Charts against the design system's own tokens. Magnitude comparisons are
// bars, a distribution is a histogram, change over time is a line. Every
// category is labelled in text, so the hue reinforces rather than carries the
// meaning, and every mark that stands for a set of players can be clicked to
// open that set in the queue.
import { useState } from 'react';
import { useRouter } from 'next/router';

const T = (v) => `var(--color-badge-${v})`;

/* ---- stat tiles: the headline numbers. Clickable ones drill into the queue. */
export function Stats({ items }) {
  const router = useRouter();
  return (
    <div className="th-stats">
      {items.map((s) => {
        const body = (
          <>
            <span className="th-stat-key typ-label-xsmall">{s.label}</span>
            <span className="th-stat-val typ-display-xsmall" style={s.tone ? { color: T(s.tone) } : undefined}>{s.value}</span>
            {s.sub ? <span className="th-stat-sub typ-label-xsmall">{s.sub}</span> : null}
          </>
        );
        return s.href ? (
          <button type="button" className="th-stat th-stat-drill focusable" key={s.key} onClick={() => router.push(s.href)} title={s.title || 'Open in the queue'}>{body}</button>
        ) : <div className="th-stat" key={s.key}>{body}</div>;
      })}
    </div>
  );
}

/* ---- horizontal bars: magnitude across named categories ---------------- */
export function BarList({ title, sub, rows, max, unit = '' }) {
  const router = useRouter();
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="th-chart">
      <div className="th-chart-head">
        <span className="th-chart-title typ-label-small">{title}</span>
        {sub ? <span className="th-chart-sub typ-label-small">{sub}</span> : null}
      </div>
      <div className="ow-barlist">
        {rows.map((r) => (
          <div className={`ow-bar-row${r.href ? ' ow-drill' : ''}`} key={r.key} title={`${r.label}: ${r.value}${unit}`}
            onClick={r.href ? () => router.push(r.href) : undefined} role={r.href ? 'link' : undefined} tabIndex={r.href ? 0 : undefined}
            onKeyDown={r.href ? (e) => { if (e.key === 'Enter') router.push(r.href); } : undefined}>
            <span className="ow-bar-label">{r.label}</span>
            <span className="ow-bar-track">
              <span className="ow-bar-fill" style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / top) * 100)}%`, background: r.tone ? T(r.tone) : 'var(--color-foreground-muted-2)' }} />
            </span>
            <span className="ow-bar-value ow-nums">{r.value}{unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- histogram: one distribution, one hue ------------------------------ */
export function Histogram({ title, sub, buckets, height = 160, tone = 'green' }) {
  const router = useRouter();
  const [hover, setHover] = useState(null);
  const top = Math.max(1, ...buckets.map((b) => b.value));
  return (
    <div className="th-chart">
      <div className="th-chart-head">
        <span className="th-chart-title typ-label-small">{title}</span>
        <span className="th-chart-sub typ-label-small">{hover ? `${hover.label}: ${hover.value}${hover.href ? ' · click to open' : ''}` : sub}</span>
      </div>
      <div className="ow-histo" style={{ height }}>
        {buckets.map((b) => (
          <div className={`ow-histo-col${b.href ? ' ow-drill' : ''}`} key={b.key}
            onMouseEnter={() => setHover(b)} onMouseLeave={() => setHover(null)}
            onClick={b.href ? () => router.push(b.href) : undefined} role={b.href ? 'link' : undefined} tabIndex={b.href ? 0 : undefined}
            onKeyDown={b.href ? (e) => { if (e.key === 'Enter') router.push(b.href); } : undefined}>
            <span className="ow-histo-val ow-nums">{b.value}</span>
            <span className="ow-histo-bar" data-tone={tone} style={{ height: `${Math.max(b.value > 0 ? 3 : 0, (b.value / top) * 100)}%` }} data-on={hover?.key === b.key} />
            <span className="ow-histo-label">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- trend: change over time, one axis, direct-labelled last points ---- */
export function Trend({ title, sub, series, days, height = 200, emptyNote }) {
  if (days.length < 2) {
    return (
      <div className="th-chart">
        <div className="th-chart-head"><span className="th-chart-title typ-label-small">{title}</span></div>
        <div className="ow-chart-empty typ-label-small">{emptyNote || `One point is recorded per day. ${days.length ? 'The first point is in; the line appears tomorrow.' : 'The first point is recorded at the next scan.'}`}</div>
      </div>
    );
  }
  const W = 640, H = height, PAD_L = 8, PAD_R = 110, PAD_T = 10, PAD_B = 22;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const x = (i) => PAD_L + (i * (W - PAD_L - PAD_R)) / Math.max(1, days.length - 1);
  const y = (v) => PAD_T + (1 - v / max) * (H - PAD_T - PAD_B);
  return (
    <div className="th-chart">
      <div className="th-chart-head">
        <span className="th-chart-title typ-label-small">{title}</span>
        {sub ? <span className="th-chart-sub typ-label-small">{sub}</span> : null}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="ow-trend" role="img" aria-label={title}>
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={PAD_L} x2={W - PAD_R} y1={y(max * f)} y2={y(max * f)} stroke="var(--color-list-divider)" strokeWidth="1" />
        ))}
        {series.map((s) => (
          <polyline key={s.key} fill="none" stroke={T(s.tone)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
            points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
        ))}
        {series.map((s, si) => {
          const i = s.values.length - 1;
          return (
            <g key={`${s.key}-end`}>
              <circle cx={x(i)} cy={y(s.values[i])} r="3.5" fill={T(s.tone)} stroke="var(--color-list-background-secondary)" strokeWidth="2" />
              <text x={x(i) + 8} y={y(s.values[i]) + 4 + (si % 2 ? 12 : 0)} fill="var(--color-foreground-muted-1)" fontSize="11" fontWeight="700">
                {s.values[i]} {s.label}
              </text>
            </g>
          );
        })}
        <text x={PAD_L} y={H - 6} fill="var(--color-foreground-muted-3)" fontSize="10">{days[0]}</text>
        <text x={W - PAD_R} y={H - 6} textAnchor="end" fill="var(--color-foreground-muted-3)" fontSize="10">{days[days.length - 1]}</text>
      </svg>
    </div>
  );
}
