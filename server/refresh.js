'use strict';
// When the sales numbers were last loaded and when they load next.
// The DSR / DHR reports arrive by email each morning; scripts/refresh-sales.sh loads them at the times below.
const TZ = 'America/Chicago';
const TZ_LABEL = 'CT';
const RUN_TIMES = [[11, 20], [15, 20]]; // hour, minute in Central time. Keep in step with ops/com.dogwood.supercuts-portal-sales.plist

/** Wall-clock parts of `d` in Central time. */
function centralParts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return p;
}

/** The UTC instant for a Central wall-clock time (handles daylight saving by correcting once). */
function centralToUtc(y, mo, d, h, mi) {
  const guess = new Date(Date.UTC(y, mo - 1, d, h + 6, mi));
  const p = centralParts(guess);
  const drift = (h * 60 + mi) - (p.hour * 60 + p.minute);
  return new Date(guess.getTime() + drift * 60000);
}

function nextRefresh(now = new Date()) {
  const p = centralParts(now);
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    const base = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset));
    for (const [h, mi] of RUN_TIMES) {
      const at = centralToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), h, mi);
      if (at.getTime() > now.getTime() + 60000) return at;
    }
  }
  return null;
}

/** Shape sent to the pages. `source` is 'dsr' once real reports are loaded, 'sample' before that. */
function refreshInfo(db, now = new Date()) {
  const row = db.prepare("SELECT value_json FROM settings WHERE key = 'kpi_refresh'").get();
  let saved = null;
  try { saved = row ? JSON.parse(row.value_json) : null; } catch { saved = null; }
  if (!saved || saved.source !== 'dsr') return { source: 'sample', last_loaded_at: null, next_refresh_at: null, tz_label: TZ_LABEL, schedule_label: null };
  const next = nextRefresh(now);
  return {
    source: 'dsr',
    last_loaded_at: saved.last_loaded_at || null,
    data_through: saved.data_through || null,
    next_refresh_at: next ? next.toISOString() : null,
    tz_label: TZ_LABEL,
    schedule_label: 'Daily at 11:20 AM and 3:20 PM Central, from the morning DSR and DHR reports',
  };
}

module.exports = { refreshInfo, nextRefresh, RUN_TIMES, TZ };
