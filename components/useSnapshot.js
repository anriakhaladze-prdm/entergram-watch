import { useCallback, useEffect, useState } from 'react';
import { useSession, signIn } from 'next-auth/react';

// One source for every page: the stored snapshot, plus the scan trigger, so a
// page never talks to Entergram itself and opening one costs nothing.
export function useSnapshot() {
  const { data: session, status } = useSession();
  const [snap, setSnap] = useState(null);
  const [error, setError] = useState(null);
  const [scan, setScan] = useState({ busy: false, note: null });

  const load = useCallback(() => fetch('/api/snapshot')
    .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error))))
    .then((s) => { setSnap(s); setError(null); })
    .catch((e) => setError(e.message)), []);

  useEffect(() => {
    if (status === 'unauthenticated') signIn('google', { callbackUrl: window.location.pathname });
    if (status === 'authenticated') load();
  }, [status, load]);

  const runScan = useCallback(async () => {
    setScan({ busy: true, note: 'Scanning. Sweeping every chat and reading history, this takes a minute or two.' });
    try {
      const r = await fetch('/api/scan', { method: 'POST' });
      const body = await r.json();
      if (!r.ok || !body.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setScan({
        busy: false,
        note: `${body.total} chats in ${Math.round(body.ms / 1000)}s. History read for ${body.read}, ${body.pending} still queued, ${body.denied} unavailable. ${body.seeded ? `${body.posted} alert${body.posted === 1 ? '' : 's'} posted.` : 'Baseline seeded.'}`,
      });
      await load();
    } catch (e) {
      setScan({ busy: false, note: `Scan failed: ${e.message}` });
    }
  }, [load]);

  return { session, status, snap, rows: snap?.rows || [], error, scan, runScan, reload: load };
}

export const STATES = [
  { key: 'at_risk',          label: 'Unhappy',   short: 'Unhappy',  tone: 'badge-red',    blurb: 'sentiment negative or churn signalled' },
  { key: 'waiting_on_us',    label: 'Waiting',   short: 'Waiting',  tone: 'badge-orange', blurb: 'player wrote, nobody replied' },
  { key: 'quiet',            label: 'Quiet',     short: 'Quiet',    tone: 'badge-yellow', blurb: 'no contact either way' },
  { key: 'outreach_ignored', label: 'Ignoring',  short: 'Ignoring', tone: 'badge-peach',  blurb: 'host posting, player silent' },
  { key: 'player_left',      label: 'Left',      short: 'Left',     tone: 'badge-purple', blurb: 'no player left in the group' },
  { key: 'unhosted',         label: 'Unhosted',  short: 'Unhosted', tone: 'badge-blue',   blurb: 'host no longer hosting' },
  { key: 'dormant',          label: 'Dormant',   short: 'Dormant',  tone: 'badge-gray',   blurb: 'silent 90 days or more' },
  { key: 'ok',               label: 'Healthy',   short: 'Healthy',  tone: 'badge-green',  blurb: 'in contact' },
];
export const BY_KEY = Object.fromEntries(STATES.map((s) => [s.key, s]));
export const ACTIONABLE = ['at_risk', 'waiting_on_us', 'quiet', 'outreach_ignored', 'player_left'];
export const BADGE = Object.fromEntries(STATES.map((s) => [s.key, s.tone.replace('badge-', '')]));
export const age = (n) => (n == null ? '–' : n < 2 ? `${Math.max(1, Math.round(n * 24))}h` : `${Math.round(n)}d`);
