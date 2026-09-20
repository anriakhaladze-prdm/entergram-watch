import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession, signIn } from 'next-auth/react';

// One source for every page: the stored snapshot, refreshed on a timer so the
// pages track the cron without anyone pressing anything, plus the manual scan
// trigger. No page talks to Entergram itself.
const REFRESH_MS = 60000;
export const STALE_AFTER_MIN = 15;

export function useSnapshot() {
  const { data: session, status } = useSession();
  const [snap, setSnap] = useState(null);
  const [error, setError] = useState(null);
  const [scan, setScan] = useState({ busy: false, note: null, error: false });
  const [tick, setTick] = useState(0);
  const timer = useRef(null);

  const load = useCallback(() => fetch('/api/snapshot')
    .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error))))
    .then((s) => { setSnap(s); setError(null); })
    .catch((e) => setError(e.message)), []);

  useEffect(() => {
    if (status === 'unauthenticated') signIn('google', { callbackUrl: window.location.pathname + window.location.search });
    if (status !== 'authenticated') return undefined;
    load();
    timer.current = setInterval(() => { load(); setTick((t) => t + 1); }, REFRESH_MS);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(timer.current); document.removeEventListener('visibilitychange', onVis); };
  }, [status, load]);

  // Re-render once a minute so "scanned 3 min ago" keeps moving between loads.
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 30000); return () => clearInterval(t); }, []);

  const runScan = useCallback(async (mode = 'auto') => {
    setScan({ busy: true, note: mode === 'full' ? 'Full sweep running. Every chat is being listed, this takes a minute or two.' : 'Scanning what changed since the last tick.', error: false });
    try {
      const r = await fetch(`/api/scan${mode === 'full' ? '?mode=full' : ''}`, { method: 'POST' });
      const body = await r.json();
      if (!r.ok || !body.ok) throw new Error(body.error || `HTTP ${r.status}`);
      if (body.skipped) setScan({ busy: false, note: 'A scan is already running. The page refreshes when it finishes.', error: false });
      else setScan({ busy: false, note: `${body.mode} scan in ${Math.round(body.ms / 1000)}s: ${body.read} histories read, ${body.posted} alert${body.posted === 1 ? '' : 's'} posted${body.overflow ? `, ${body.overflow} held` : ''}.`, error: false });
      await load();
    } catch (e) {
      setScan({ busy: false, note: `Scan failed: ${e.message}`, error: true });
    }
  }, [load]);

  const generatedAt = snap?.generatedAt ? new Date(snap.generatedAt) : null;
  const ageMin = generatedAt ? (Date.now() - generatedAt.getTime()) / 60000 : null;

  return {
    session, status, snap, rows: snap?.rows || [], summary: snap?.summary || null, error, scan, runScan, reload: load,
    scanAgeMin: ageMin, stale: ageMin != null && ageMin > STALE_AFTER_MIN, tick,
  };
}

export const fmtAge = (min) => (min == null ? '–' : min < 1 ? 'just now' : min < 60 ? `${Math.round(min)} min ago` : min < 48 * 60 ? `${Math.round(min / 60)}h ago` : `${Math.round(min / 1440)}d ago`);
