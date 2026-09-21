export const tierLabel = (value) => String(value || '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase())
  .replace(/\b(\d)\b/g, (d) => ['', 'I', 'II', 'III', 'IV', 'V'][Number(d)] || d);

export const tierTone = (value) => {
  const key = String(value || '').split('_')[0].toLowerCase();
  return ['base', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'obsidian'].includes(key) ? key : 'base';
};

export const accountStatusLabel = (value) => ({
  active: 'Active', frozen: 'Frozen', self_excluded: 'Self-excluded',
}[String(value || '').toLowerCase()] || String(value || '').replace(/_/g, ' '));

export const shortDate = (value) => value
  ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  : '–';

export const money = (value) => value == null || value === '' ? '–' : `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
