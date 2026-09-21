// The vocabulary shared by the engine, the alerts and the dashboard. No
// imports, so the browser bundle can use it too.

export const STATES = [
  { key: 'waiting',    label: 'Waiting on us',   short: 'Waiting',    tone: 'orange', blurb: 'the player wrote and nobody has replied' },
  { key: 'unhappy',    label: 'Unhappy',         short: 'Unhappy',    tone: 'red',    blurb: 'sentiment negative or churn signalled' },
  { key: 'no_contact', label: 'No contact 7d+',  short: 'No contact', tone: 'yellow', blurb: 'nothing from us for a week or more' },
  { key: 'ignored',    label: 'Not responding',  short: 'Ignoring',   tone: 'peach',  blurb: 'we are posting, the player is not answering' },
  { key: 'ok',         label: 'In contact',      short: 'In contact', tone: 'green',  blurb: 'spoken to within the week' },
  { key: 'left',       label: 'Left group',      short: 'Left group', tone: 'purple', blurb: 'the player is no longer in the group' },
  { key: 'not_joined', label: 'Not joined',      short: 'Not joined', tone: 'blue',   blurb: 'the group was opened for the player and they never arrived' },
];
export const STATE = Object.fromEntries(STATES.map((s) => [s.key, s]));

// States that make up the "needs action" figure. Left is real but it is not
// the worklist.
export const ACTIONABLE = ['waiting', 'unhappy', 'no_contact', 'ignored'];

export const MOODS = [
  { key: 'at_risk',  label: 'At risk',  tone: 'red' },
  { key: 'negative', label: 'Negative', tone: 'orange' },
  { key: 'neutral',  label: 'Neutral',  tone: 'gray' },
  { key: 'positive', label: 'Positive', tone: 'green' },
];

export const ALERT_KINDS = {
  no_contact: { label: '7 days without contact', dot: '🟡' },
  urgent:     { label: 'Churn signal',           dot: '🔴' },
};

export const age = (days) => (days == null ? '–' : days < 1 / 24 ? 'now' : days < 2 ? `${Math.max(1, Math.round(days * 24))}h` : `${Math.round(days)}d`);
export const mins = (m) => (m == null ? '–' : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`);
export const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '–');
