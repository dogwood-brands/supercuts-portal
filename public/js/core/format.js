// Formatting helpers. Money arrives from the API in cents.

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** money(123456) -> "$1,235" · money(1234, {cents:true}) -> "$12.34" · money(12345678, {compact:true}) -> "$123.5K" */
export function money(cents, { compact = false, cents: showCents = false } = {}) {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '–';
  const dollars = cents / 100;
  if (compact) {
    const abs = Math.abs(dollars);
    if (abs >= 1e6) return `${dollars < 0 ? '-' : ''}$${(abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M`;
    if (abs >= 1e4) return `${dollars < 0 ? '-' : ''}$${(abs / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}K`;
  }
  return showCents ? usd2.format(dollars) : usd0.format(dollars);
}

/** Every *_pct field in the API is already in percent units: pct(104.2) -> "104.2%", pct(8.53) -> "8.5%". */
export function pct(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  return `${Number(n).toFixed(digits)}%`;
}

/** signed(4.2) -> "+4.2%" */
export function signed(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  const v = Number(n);
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

export function num(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  return int.format(n);
}

function toDate(iso) {
  if (iso instanceof Date) return iso;
  if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d); // date-only values are local calendar days, never shifted by timezone
  }
  return new Date(iso);
}

export function dateShort(iso) {
  if (!iso) return '';
  return toDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function dateLong(iso) {
  if (!iso) return '';
  return toDate(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function dateTime(iso) {
  if (!iso) return '';
  return toDate(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - toDate(iso).getTime()) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return dateShort(iso);
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function plural(n, one, many) {
  return `${num(n)} ${n === 1 ? one : many || `${one}s`}`;
}

export function greeting(date = new Date()) {
  const hr = date.getHours();
  if (hr < 12) return 'Good morning';
  if (hr < 17) return 'Good afternoon';
  return 'Good evening';
}

const ROLE_LABELS = {
  stylist: 'Stylist',
  salon_manager: 'Salon Manager',
  district_leader: 'District Leader',
  hr: 'HR',
  executive: 'Leadership',
  admin: 'Home Office',
};
export const roleLabel = (role) => ROLE_LABELS[role] || 'Team member';

/** "Marina Del Rey · Westside LA" — the line shown under a name on every post, per the brief. */
export function whereLabel(user) {
  if (!user) return '';
  if (user.salon) return [user.salon.name, user.salon.market].filter(Boolean).join(' · ');
  return user.title || roleLabel(user.role);
}

/**
 * "Next refresh today at 1:20 PM PST": when the sales numbers load next, in the viewer's own time zone.
 * `refresh` is the object the API returns beside KPI data; returns '' while the portal is on sample numbers.
 */
export function refreshNote(refresh) {
  if (!refresh || refresh.source !== 'dsr' || !refresh.next_refresh_at) return '';
  const at = new Date(refresh.next_refresh_at);
  const now = new Date();
  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const day = dayKey(at) === dayKey(now) ? 'today' : dayKey(at) === dayKey(tomorrow) ? 'tomorrow' : at.toLocaleDateString('en-US', { weekday: 'long' });
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  return `Next refresh ${day} at ${time}`;
}

/** "Loaded today at 11:21 AM": when the numbers on screen were last brought in. */
export function loadedNote(refresh) {
  if (!refresh || refresh.source !== 'dsr' || !refresh.last_loaded_at) return '';
  const at = new Date(refresh.last_loaded_at);
  const now = new Date();
  const same = at.toDateString() === now.toDateString();
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return same ? `Loaded today at ${time}` : `Loaded ${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${time}`;
}
