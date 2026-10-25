/**
 * Nore seasonal events (Halloween, winter/Christmas): start/end/peak times for countdowns.
 * API v1 `/events` gives { id, name, active, startsAt? }; API v2 adds countdowns. When the API does
 * not give the times, the known yearly windows are used.
 */
const WINDOWS = {
  // month is 0-based; end is exclusive
  halloween: { start: [9, 1], peak: [9, 31], end: [10, 3] },
  christmas: { start: [11, 10], peak: [11, 24], end: [0, 7], wraps: true },
  winter: { start: [11, 10], peak: [11, 24], end: [0, 7], wraps: true },
};

const at = (y, [m, d]) => Date.UTC(y, m, d) - 3600_000; // midnight Europe/Warsaw (CET)

/** { startsAt, peakAt, endsAt, active, upcoming } for an event at `now`. */
export function eventTimes(ev, now = Date.now()) {
  const w = WINDOWS[ev.id];
  const y = new Date(now).getUTCFullYear();
  let startsAt = ev.startsAt ? Date.parse(ev.startsAt) : null;
  let endsAt = ev.endsAt ? Date.parse(ev.endsAt) : null;
  let peakAt = ev.peakAt ? Date.parse(ev.peakAt) : null;
  if (w) {
    // pick the window that has not ended yet (this year's or next year's)
    for (const year of [y - 1, y, y + 1]) {
      const s = at(year, w.start);
      const e = at(w.wraps ? year + 1 : year, w.end);
      if (e > now) {
        startsAt ??= s;
        endsAt ??= e;
        peakAt ??= at(year, w.peak);
        break;
      }
    }
  }
  const active = typeof ev.active === 'boolean' ? ev.active && (!endsAt || now < endsAt) : (startsAt ? now >= startsAt && (!endsAt || now < endsAt) : false);
  return { startsAt, peakAt, endsAt, active, upcoming: !active && !!startsAt && startsAt > now };
}

/** Which reminder (7d / 1d) is due for an upcoming event, or null. */
export function dueReminder(times, now = Date.now()) {
  if (!times.upcoming || !times.startsAt) return null;
  const left = times.startsAt - now;
  if (left <= 86_400_000) return '1d';
  if (left <= 7 * 86_400_000) return '7d';
  return null;
}
