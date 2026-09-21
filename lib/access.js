// Who may use the dashboard and who may see the Logs section, in one place.
//
// Precedence, applied at sign-in and on every session read:
//   1. A blocked address is refused, whatever its domain. The static list comes
//      from BLOCKED_EMAILS; the dashboard-managed list lives in the store and
//      is checked in lib/gate.js.
//   2. Every account on the Workspace domain is admitted.
//
// The monitoring whitelist is separate: those addresses see the Logs section
// (sign-ins, sessions, the block-list, scans and alerts) and can revoke
// sessions and block accounts. Nobody on it can be blocked.
//
// No Node built-ins here, so the same rules can run in the browser bundle.

const normalise = (v) => String(v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export const ALLOWED_DOMAIN = String(process.env.ALLOWED_HD || 'paradym.io').trim().toLowerCase();
export const MONITORING_EMAILS = normalise(process.env.MONITORING_EMAILS || 'anri.akhaladze@paradym.io,shane.austin@paradym.io');
export const BLOCKED_EMAILS = normalise(process.env.BLOCKED_EMAILS || '');

export const norm = (email) => String(email || '').trim().toLowerCase();
export const onDomain = (email) => Boolean(email) && norm(email).endsWith('@' + ALLOWED_DOMAIN);
export const isMonitor = (email) => Boolean(email) && MONITORING_EMAILS.includes(norm(email));
export const isStaticallyBlocked = (email) => Boolean(email) && BLOCKED_EMAILS.includes(norm(email));

// A coarse device label for the Sessions table: which of my devices is this,
// not analytics.
export function describeUa(ua) {
  const s = String(ua || '');
  if (!s) return 'Unknown device';
  let browser = 'Unknown';
  if (/\bEdg\//.test(s)) browser = 'Edge';
  else if (/\bOPR\/|\bOpera\//.test(s)) browser = 'Opera';
  else if (/\bChrome\//.test(s) && !/\bChromium\//.test(s)) browser = 'Chrome';
  else if (/\bChromium\//.test(s)) browser = 'Chromium';
  else if (/\bFirefox\//.test(s)) browser = 'Firefox';
  else if (/\bSafari\//.test(s) && /\bVersion\//.test(s)) browser = 'Safari';
  let os = 'Unknown';
  if (/Windows/.test(s)) os = 'Windows';
  else if (/iPhone|iPod/.test(s)) os = 'iPhone';
  else if (/iPad/.test(s)) os = 'iPad';
  else if (/Mac OS X/.test(s)) os = 'macOS';
  else if (/Android/.test(s)) os = 'Android';
  else if (/CrOS/.test(s)) os = 'ChromeOS';
  else if (/Linux/.test(s)) os = 'Linux';
  return browser === 'Unknown' && os === 'Unknown' ? 'Unknown device' : `${browser} on ${os}`;
}

// Best-effort client address from the proxy headers Vercel sets.
export function clientIp(headers = {}) {
  const get = (k) => (typeof headers.get === 'function' ? headers.get(k) : headers[k]) || '';
  const xff = get('x-forwarded-for');
  if (xff) return String(xff).split(',')[0].trim();
  return String(get('x-real-ip') || '');
}
