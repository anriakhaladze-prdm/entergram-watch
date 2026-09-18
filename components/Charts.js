// Charts, drawn as inline SVG against the design system's own tokens.
//
// Forms follow the job, not habit: magnitude comparisons are bars, a
// distribution is a histogram, change over time is a line. No pie, no dual
// axis, no colour-only identity - every category is labelled in text, so the
// hues are reinforcement rather than the key. Text wears text tokens; only the
// mark carries the state colour.
import { useState } from 'react';

const T = (v) => `var(--color-${v})`;

/* ---- stat tiles: the headline numbers, no plot ------------------------- */
export function Stats({ items }) {
  return (
    <div className="th-stats">
      {items.map((s) => (
        <div className="th-stat" key={s.key}>
          <span className="th-stat-key typ-label-xsmall">{s.label}</span>
          <span className="th-stat-val typ-display-xsmall" style={s.tone ? { color: T(s.tone) } : undefined}>
            {s.value}
          </span>
          {s.sub ? <span className="th-stat-sub typ-label-xsmall">{s.sub}</span> : null}
        </div>
      ))}
    </div>
  );
}

/* ---- horizontal bars: magnitude across named categories ---------------- */
export function BarList({ title, sub, rows, max, unit = '' }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="th-chart">
      <div className="th-chart-head">
        <span className="th-chart-title typ-label-small">{title}</span>
        {sub ? <span className="th-chart-sub typ-label-small">{sub}</span> : null}
      </div>
      <div className="ow-barlist">
        {rows.map((r) => (
          <div className="ow-bar-row" key={r.key} title={`${r.label}: ${r.value}${unit}`}>
            <span className="ow-bar-label">{r.label}</span>
            <span className="ow-bar-track">
              <span
                className="ow-bar-fill"
                style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / top) * 100)}%`, background: T(r.tone || 'foreground-muted-2') }}
              />
            </span>
            <span className="ow-bar-value ow-nums">{r.value}{unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- histogram: one distribution, one hue ------------------------------ */
export function Histogram({ title, sub, buckets, height = 180 }) {
  const [hover, setHover] = useState(null);
  const top = Math.max(1, ...buckets.map((b) => b.value));
  return (
    <div className="th-chart">
      <div className="th-chart-head">
        <span className="th-chart-title typ-label-small">{title}</span>
        <span className="th-chart-sub typ-label-small">
          {hover ? `${hover.label}: ${hover.value}` : sub}
        </span>
      </div>
      <div className="ow-histo" style={{ height }}>
        {buckets.map((b) => (
          <div
            className="ow-histo-col"
            key={b.key}
            onMouseEnter={() => setHover(b)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="ow-histo-val ow-nums">{b.value}</span>
            <span
              className="ow-histo-bar"
              style={{ height: `${Math.max(b.value > 0 ? 3 : 0, (b.value / top) * 100)}%` }}
              data-on={hover?.key === b.key}
            />
            <span className="ow-histo-label">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- trend: change over time, one axis, direct-labelled last points ---- */
export function Trend({ title, sub, series, days, height = 200 }) {
  if (!days.length) {
    return (
      <div className="th-chart">
        <div className="th-chart-head"><span className="th-chart-title typ-label-small">{title}</span></div>
        <div className="ow-chart-empty typ-label-small">
          Not enough history yet. One point is recorded per day, so this fills in over the coming week.
        </div>
      </div>
    );
  }
  const W = 640, H = height, PAD_L = 8, PAD_R = 92, PAD_T = 10, PAD_B = 22;
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
          <line key={f} x1={PAD_L} x2={W - PAD_R} y1={y(max * f)} y2={y(max * f)}
            stroke="var(--color-list-divider)" strokeWidth="1" />
        ))}
        {series.map((s) => (
          <polyline
            key={s.key}
            fill="none"
            stroke={T(s.tone)}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
          />
        ))}
        {series.map((s) => {
          const i = s.values.length - 1;
          return (
            <g key={`${s.key}-end`}>
              <circle cx={x(i)} cy={y(s.values[i])} r="3.5" fill={T(s.tone)} stroke="var(--color-list-background-secondary)" strokeWidth="2" />
              <text x={x(i) + 8} y={y(s.values[i]) + 4} fill="var(--color-foreground-muted-1)" fontSize="11" fontWeight="700">
                {s.values[i]}
              </text>
              <text x={x(i) + 8} y={y(s.values[i]) + 17} fill="var(--color-foreground-muted-3)" fontSize="10">
                {s.label}
              </text>
            </g>
          );
        })}
        <text x={PAD_L} y={H - 6} fill="var(--color-foreground-muted-3)" fontSize="10">{days[0]}</text>
        <text x={W - PAD_R} y={H - 6} textAnchor="end" fill="var(--color-foreground-muted-3)" fontSize="10">
          {days[days.length - 1]}
        </text>
      </svg>
    </div>
  );
}
