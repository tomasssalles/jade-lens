// Effective-type classification for JSON string leaves, plus the pure
// conversions the date/time and wikilink micro-editors need (Phase 5g; design
// in docs/web/editing.md "JSON value editors"). A JSON string can stand for a
// date, a datetime, or a wikilink; only when the *whole* trimmed string is
// exactly one of those does it get a dedicated single-value editor behind the
// pencil. Anything else stays a plain string (edited later via the text editor).
//
// The date/datetime shapes mirror the display-side remarkDates plugin so what
// renders as a date is exactly what gets the date editor. No React here.

// Whole-string ISO shapes (anchored). Datetime covers naive, UTC (Z), and
// offset forms — matching remarkDates' DATE_RE set.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/;
const WIKILINK_RE = /^\[\[([^\][]+)\]\]$/;

/**
 * Classify a JSON string leaf's effective type.
 *
 * @param {string} value
 * @returns {'date'|'datetime'|'wikilink'|'plain'}
 */
export function classifyStringValue(value) {
  if (typeof value !== 'string') return 'plain';
  const s = value.trim();
  if (WIKILINK_RE.test(s)) return 'wikilink';
  if (DATE_RE.test(s)) return 'date';
  if (DATETIME_RE.test(s)) return 'datetime';
  return 'plain';
}

// ─── Wikilinks ────────────────────────────────────────────────────────────────

/** The inner path of a `[[path]]` string, or '' if it isn't a lone wikilink. */
export function wikilinkTarget(value) {
  const m = typeof value === 'string' ? value.trim().match(WIKILINK_RE) : null;
  return m ? m[1].trim() : '';
}

/** Wrap a repo path as a wikilink. Returns null for an empty path. */
export function toWikilink(path) {
  const p = (path ?? '').trim();
  return p ? `[[${p}]]` : null;
}

// ─── Dates / datetimes ────────────────────────────────────────────────────────

// Split a datetime ISO into its local part (everything up to seconds) and its
// zone suffix ('' | 'Z' | '+hh:mm' | '-hh:mm'), so editing the wall-clock value
// via a <input type="datetime-local"> never disturbs the original zone.
const DATETIME_PARTS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:\d{2})?$/;

export function splitDatetime(iso) {
  const m = String(iso).match(DATETIME_PARTS_RE);
  if (!m) return null;
  return { local: m[1], zone: m[2] ?? '' };
}

/**
 * The conventional-sign offset, in minutes, of a datetime's zone suffix
 * (e.g. `+02:00` → 120, `-05:30` → -330). `Z` → 0; a naive value ('') → null.
 */
export function parseZoneOffsetMinutes(zone) {
  if (!zone) return null;
  if (zone === 'Z') return 0;
  const m = zone.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * The small display suffix for a zoned datetime: `UTC` at offset 0, else a
 * normalized numeric offset like `+05:30` / `-05:00`. (Only shown for values
 * whose offset isn't the viewer's current local offset — that decision lives in
 * DateNode, which knows the browser's offset.)
 */
export function formatZoneSuffix(offsetMin) {
  if (offsetMin === 0) return 'UTC';
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

/**
 * The `value` to feed a native date / datetime-local input.
 *
 * - date → the `YYYY-MM-DD` string unchanged.
 * - datetime → the local part (`YYYY-MM-DDTHH:mm[:ss]`), zone suffix stripped.
 */
export function toDateInputValue(value, type) {
  const s = String(value).trim();
  if (type === 'date') return DATE_RE.test(s) ? s : '';
  const parts = splitDatetime(s);
  return parts ? parts.local : '';
}

/** True when a datetime ISO carries explicit seconds (drives the input step). */
export function datetimeHasSeconds(value) {
  const parts = splitDatetime(String(value).trim());
  return !!parts && /T\d{2}:\d{2}:\d{2}$/.test(parts.local);
}

/**
 * Turn a native input's value back into the JSON string to commit, preserving
 * the original datetime's zone suffix. Returns null when the input is empty or
 * malformed (so the caller can disable the commit button).
 *
 * @param {string} inputValue - the raw value from the date/datetime-local input.
 * @param {'date'|'datetime'} type
 * @param {string} original - the value being edited (source of the zone suffix).
 */
export function fromDateInputValue(inputValue, type, original) {
  const v = (inputValue ?? '').trim();
  if (type === 'date') return DATE_RE.test(v) ? v : null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(v)) return null;
  const parts = splitDatetime(String(original).trim());
  return v + (parts ? parts.zone : '');
}
