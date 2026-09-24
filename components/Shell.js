import { cloneElement, isValidElement, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { signOut } from 'next-auth/react';
import Icon from './Icon';
import { fmtAge } from './useSnapshot';

// The design system's three-region frame. The rail is navigation; filters live
// in the toolbar above the data they filter. The scan status sits in the header
// so every page says how fresh its numbers are.
//
// Below 768px the header and rail are hidden (duplicate and hide, never one
// adaptive component): the card carries its own mobile header row, and the
// sections, the scan controls and the account open from the menu button as a
// drawer over the page.
const NAV = [
  { href: '/', label: 'Overview', glyph: 'chart' },
  { href: '/queue', label: 'Queue', glyph: 'warn' },
  // The audit trails, for the monitoring whitelist only.
  { href: '/logs', label: 'Logs', glyph: 'info', monitor: true },
];

export function ScanStatus({ scan, scanAgeMin, stale, snap, runScan, variant = 'bar' }) {
  const tone = scan.busy ? 'busy' : scan.error ? 'error' : stale || !snap ? 'error' : 'live';
  const label = scan.busy ? 'Scanning' : !snap ? 'No scan yet' : stale ? `Stale, last scan ${fmtAge(scanAgeMin)}` : `Scanned ${fmtAge(scanAgeMin)}`;
  // The mobile header's one trailing action: scan now, tinted by freshness.
  if (variant === 'icon') {
    return (
      <button type="button" className={`th-circle-btn circle-button-surface focusable ow-scan-btn ow-scan-btn-${tone}`} onClick={() => runScan('auto')} disabled={scan.busy} aria-disabled={scan.busy} aria-label={scan.busy ? 'Scanning' : `Scan now. ${label}`}>
        {scan.busy ? <span className="ow-spin" /> : <Icon name="retry" size={16} />}
      </button>
    );
  }
  return (
    <div className={`ow-scan${variant === 'stack' ? ' ow-scan-stack' : ''}`}>
      <span className={`th-status th-status-${tone} typ-label-xsmall`} title={snap?.generatedAt ? new Date(snap.generatedAt).toLocaleString() : ''}>
        <span className="th-status-dot" />{label}
      </span>
      <button type="button" className="th-pill focusable" onClick={() => runScan('full')} disabled={scan.busy} aria-disabled={scan.busy}>
        <span className="th-pill-label typ-label-medium">Full sweep</span>
      </button>
      <button type="button" className="th-pill th-pill-primary focusable" onClick={() => runScan('auto')} disabled={scan.busy} aria-disabled={scan.busy}>
        {scan.busy ? <span className="ow-spin" /> : null}
        <span className="th-pill-label typ-label-medium">{scan.busy ? 'Scanning' : 'Scan now'}</span>
      </button>
    </div>
  );
}

const withVariant = (el, variant) => (isValidElement(el) ? cloneElement(el, { variant }) : el);

export default function Shell({ title, crumb, toolbar, children, email, status, monitor = false }) {
  const router = useRouter();
  const { pathname } = router;
  const [navOpen, setNavOpen] = useState(false);
  const nav = NAV.filter((n) => !n.monitor || monitor);

  // The drawer closes on any navigation, on Escape, and whenever the window
  // grows past the phone layout that owns it.
  useEffect(() => {
    const close = () => setNavOpen(false);
    router.events.on('routeChangeStart', close);
    return () => router.events.off('routeChangeStart', close);
  }, [router.events]);
  useEffect(() => {
    if (!navOpen) return undefined;
    const key = (e) => { if (e.key === 'Escape') setNavOpen(false); };
    const wide = window.matchMedia('(min-width: 768px)');
    const grow = (e) => { if (e.matches) setNavOpen(false); };
    window.addEventListener('keydown', key);
    wide.addEventListener('change', grow);
    return () => { window.removeEventListener('keydown', key); wide.removeEventListener('change', grow); };
  }, [navOpen]);

  const out = () => signOut({ callbackUrl: '/auth/signin' });

  return (
    <>
      <Head><title>{`${title} · Sonar`}</title></Head>
      <div className="th-root" data-nav={navOpen ? 'open' : 'closed'} data-mask="off">
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
            <button type="button" className="th-action focusable" onClick={out} data-tip="Sign out" aria-label="Sign out">
              <Icon name="logout" size={20} />
            </button>
          </div>
        </header>

        <nav className="th-rail" aria-label="Sections">
          <ul className="th-nav">
            {nav.map((n) => (
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
            <div className="th-mobile-header">
              <button type="button" className="th-circle-btn circle-button-surface focusable" onClick={() => setNavOpen(true)} aria-label="Menu" aria-expanded={navOpen} aria-controls="ow-mnav">
                <Icon name="menu" size={16} />
              </button>
              <div className="th-mobile-title">{crumb || title}</div>
              <div className="th-mobile-slot">{withVariant(status, 'icon')}</div>
            </div>
            {toolbar ? <div className="th-toolbar">{toolbar}</div> : null}
            <div className="th-card-scroll">{children}</div>
          </div>
        </main>

        <button type="button" className="th-rail-scrim" aria-hidden="true" tabIndex={-1} onClick={() => setNavOpen(false)} />
        <aside id="ow-mnav" className="ow-mnav" aria-label="Menu" aria-hidden={!navOpen} inert={navOpen ? undefined : ''}>
          <div className="ow-mnav-head">
            <span className="th-logo-wordmark" role="img" aria-label="Sonar" />
            <button type="button" className="th-circle-btn circle-button-surface focusable" onClick={() => setNavOpen(false)} aria-label="Close menu">
              <Icon name="close" size={16} />
            </button>
          </div>
          <nav aria-label="Sections">
            <ul className="ow-mnav-list">
              {nav.map((n) => (
                <li key={n.href}>
                  <Link className="ow-mnav-link focusable" href={n.href} aria-current={pathname === n.href ? 'page' : undefined} onClick={() => setNavOpen(false)}>
                    <span className="th-nav-tile"><Icon name={n.glyph} size={20} /></span>
                    <span className="ow-mnav-label typ-label-medium">{n.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          {status ? <div className="ow-mnav-block">{withVariant(status, 'stack')}</div> : null}
          <div className="ow-mnav-foot">
            {email ? <span className="ow-mnav-email typ-label-small">{email}</span> : null}
            <button type="button" className="th-pill focusable" onClick={out}>
              <span className="th-pill-label typ-label-medium">Sign out</span>
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}

export function Empty({ error }) {
  return (
    <div className="th-empty">
      <div className="th-empty-title typ-heading-small">{error ? 'No data yet' : 'Loading'}</div>
      <div className="th-empty-sub typ-paragraph-small">
        {error ? (/^no snapshot/i.test(error) ? 'No scan yet' : error) : ''}
      </div>
    </div>
  );
}
