// Who may use the dashboard and who may see the Logs section, in one place.
//
// Access is an allow-list. An address gets in when it is on the monitoring
// whitelist, on ALLOWED_EMAILS, or on the list managed under Logs, and is not
// blocked (BLOCKED_EMAILS or the list managed under Logs). Google only
// confirms that the visitor owns the account; the hd hint and the Internal
// consent screen keep the picker to Workspace accounts, and this decides who
// among them gets in. The store-backed halves are checked in lib/gate.js.
//
// The monitoring whitelist sees the Logs section (allowed and blocked lists,
// sessions, sign-ins, scans and alerts) and can change the lists and revoke
// sessions. Nobody on it can be blocked or removed.
//
// No Node built-ins here, so the same rules can run in the browser bundle.

const normalise = (v) => String(v ?? '').split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);

export const ALLOWED_DOMAIN = String(process.env.ALLOWED_HD || 'paradym.io').trim().toLowerCase();
export const MONITORING_EMAILS = normalise(process.env.MONITORING_EMAILS || 'anri.akhaladze@paradym.io,shane.austin@paradym.io');
export const ALLOWED_EMAILS = normalise(process.env.ALLOWED_EMAILS || '');
export const BLOCKED_EMAILS = normalise(process.env.BLOCKED_EMAILS || '');

export const norm = (email) => String(email || '').trim().toLowerCase();
export const onDomain = (email) => Boolean(email) && norm(email).endsWith('@' + ALLOWED_DOMAIN);
export const isMonitor = (email) => Boolean(email) && MONITORING_EMAILS.includes(norm(email));
export const isStaticallyAllowed = (email) => Boolean(email) && (isMonitor(email) || ALLOWED_EMAILS.includes(norm(email)));
export const isStaticallyBlocked = (email) => Boolean(email) && BLOCKED_EMAILS.includes(norm(email));
export const parseEmails = (v) => [...new Set(normalise(v).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];

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
