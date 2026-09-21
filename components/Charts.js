// Charts against the design system's own tokens. Magnitude comparisons are
// bars, a distribution is a histogram, change over time is a line. Every
// category is labelled in text, so the hue reinforces rather than carries the
// meaning, and every mark that stands for a set of players can be clicked to
// open that set in the queue.
import { useEffect, useRef, useState } from 'react';
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
          <button type="button" className="th-stat th-stat-drill focusable" key={s.key} onClick={() => router.push(s.href)}>{body}</button>
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
        <span className="th-chart-sub typ-label-small">{hover ? `${hover.label}: ${hover.value}` : sub}</span>
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

/* ---- trend: one small chart per series, each on its own scale ----------- */
function Spark({ label, tone, values, days, height }) {
  const box = useRef(null);
  const [width, setWidth] = useState(300);
  useEffect(() => {
    if (!box.current) return undefined;
    const ro = new ResizeObserver((entries) => { const w = entries[0]?.contentRect?.width; if (w) setWidth(Math.max(120, Math.floor(w))); });
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  // Pixel coordinates on a fixed-height canvas: the line follows the panel's
  // width without ever scaling its stroke or text.
  // The scale follows the data, not zero: a count that moved from 229 to 223
  // is a visible slope in the middle of the panel rather than a line pinned
  // along the top edge.
  const W = width, H = height, PAD = 6, PAD_T = 12, PAD_B = 20;
  let lo = Math.min(...values), hi = Math.max(...values);
  const pad = hi === lo ? Math.max(1, hi * 0.1) : (hi - lo) * 0.35;
  lo -= pad; hi += pad;
  const x = (i) => PAD + (i * (W - 2 * PAD)) / Math.max(1, values.length - 1);
  const y = (v) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
  const last = values[values.length - 1], prev = values.length > 1 ? values[values.length - 2] : null;
  const delta = prev == null ? null : last - prev;
  return (
    <div className="ow-spark">
      <div className="ow-spark-head">
        <span className="ow-spark-label typ-label-small">{label}</span>
        <span className="ow-spark-num">
          <span className="ow-spark-val typ-display-xsmall" style={{ color: T(tone) }}>{last}</span>
          {delta ? <span className={`ow-spark-delta typ-label-small${delta > 0 ? ' is-up' : ' is-down'}`}>{delta > 0 ? '+' : ''}{delta}</span> : null}
        </span>
      </div>
      <div ref={box} className="ow-trend-box" style={{ height }}>
        <svg width={W} height={H} className="ow-trend" role="img" aria-label={label}>
          <line x1={PAD} x2={W - PAD} y1={H - PAD_B} y2={H - PAD_B} stroke="var(--color-list-divider)" strokeWidth="1" strokeOpacity="0.5" />
          <polyline fill="none" stroke={T(tone)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
          <circle cx={x(values.length - 1)} cy={y(last)} r="3.5" fill={T(tone)} stroke="var(--color-background-secondary)" strokeWidth="2" />
          <text x={PAD} y={H - 5} fill="var(--color-foreground-muted-3)" fontSize="10" fontWeight="600">{days[0]}</text>
          <text x={W - PAD} y={H - 5} textAnchor="end" fill="var(--color-foreground-muted-3)" fontSize="10" fontWeight="600">{days[days.length - 1]}</text>
        </svg>
      </div>
    </div>
  );
}

export function Trend({ title, sub, series, days, height = 120 }) {
  return (
    <div className="th-chart">
      <div className="th-chart-head">
        <span className="th-chart-title typ-label-small">{title}</span>
        {sub ? <span className="th-chart-sub typ-label-small">{sub}</span> : null}
      </div>
      {days.length < 2 ? <div className="ow-chart-empty typ-label-small">–</div> : (
        <div className="ow-sparks">
          {series.map((s) => <Spark key={s.key} label={s.label} tone={s.tone} values={s.values} days={days} height={height} />)}
        </div>
      )}
    </div>
  );
}
