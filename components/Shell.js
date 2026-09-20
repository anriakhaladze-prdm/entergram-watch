import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { signOut } from 'next-auth/react';
import Icon from './Icon';
import { fmtAge } from './useSnapshot';

// The design system's three-region frame. The rail is navigation; filters live
// in the toolbar above the data they filter. The scan status sits in the header
// so every page says how fresh its numbers are.
const NAV = [
  { href: '/', label: 'Overview', glyph: 'chart' },
  { href: '/queue', label: 'Queue', glyph: 'warn' },
  { href: '/hosts', label: 'Hosts', glyph: 'user' },
  { href: '/activity', label: 'Activity', glyph: 'info' },
];

export function ScanStatus({ scan, scanAgeMin, stale, snap, runScan, compact = false }) {
  const tone = scan.busy ? 'busy' : scan.error ? 'error' : stale || !snap ? 'error' : 'live';
  const label = scan.busy ? 'Scanning' : !snap ? 'No scan yet' : stale ? `Stale, last scan ${fmtAge(scanAgeMin)}` : `Scanned ${fmtAge(scanAgeMin)}`;
  return (
    <div className="ow-scan">
      <span className={`th-status th-status-${tone} typ-label-xsmall`} title={snap?.generatedAt ? new Date(snap.generatedAt).toLocaleString() : ''}>
        <span className="th-status-dot" />{label}
      </span>
      {!compact && snap?.mode ? <span className="ow-scan-mode typ-label-xsmall">{snap.mode}</span> : null}
      <button type="button" className="th-pill th-pill-primary focusable" onClick={() => runScan('auto')} disabled={scan.busy} aria-disabled={scan.busy}>
        {scan.busy ? <span className="ow-spin" /> : <Icon name="retry" size={12} />}
        <span className="th-pill-label typ-label-medium">{scan.busy ? 'Scanning' : 'Scan now'}</span>
      </button>
    </div>
  );
}

export default function Shell({ title, crumb, toolbar, children, email, status }) {
  const { pathname } = useRouter();
  return (
    <>
      <Head><title>{title} · Sonar</title></Head>
      <div className="th-root" data-nav="closed" data-mask="off">
        <header className="th-header">
          <div className="th-header-logo">
            <span className="th-logo-wordmark" role="img" aria-label="Sonar" />
          </div>
          <div className="th-breadcrumb">
            <nav className="th-breadcrumb-inner" aria-label="Breadcrumb">
              <div className="th-crumb-train">
                <Link className="th-crumb typ-label-large" href="/">Player Outreach</Link>
                {crumb ? <span className="th-crumb typ-label-large">{crumb}</span> : null}
              </div>
            </nav>
          </div>
          <div className="th-header-actions">
            {status}
            <button type="button" className="th-action focusable" data-tip={email || ''} aria-label="Account">
              <Icon name="user" size={20} />
            </button>
            <button type="button" className="th-action focusable" onClick={() => signOut({ callbackUrl: '/auth/signin' })} data-tip="Sign out" aria-label="Sign out">
              <Icon name="logout" size={20} />
            </button>
          </div>
        </header>

        <nav className="th-rail" aria-label="Sections">
          <ul className="th-nav">
            {NAV.map((n) => (
              <li className="th-nav-item" key={n.href}>
                <Link className="th-nav-link focusable int-hover-scale-plus" href={n.href} aria-current={pathname === n.href ? 'page' : undefined}>
                  <span className="th-nav-tile"><Icon name={n.glyph} size={20} /></span>
                  <span className="th-nav-label typ-label-xxsmall">{n.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <main className="th-main">
          <div className="th-card">
            {toolbar ? <div className="th-toolbar">{toolbar}</div> : null}
            <div className="th-card-scroll">{children}</div>
          </div>
        </main>
      </div>
    </>
  );
}

export function Empty({ error }) {
  return (
    <div className="th-empty">
      <div className="th-empty-title typ-heading-small">{error ? 'No data yet' : 'Loading'}</div>
      <div className="th-empty-sub typ-paragraph-small">
        {error ? (/^no snapshot/i.test(error) ? 'Nothing has scanned yet. Press Scan now, or wait for the cron.' : error) : ''}
      </div>
    </div>
  );
}
