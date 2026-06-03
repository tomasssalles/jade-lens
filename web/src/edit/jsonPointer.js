// RFC 6901 JSON Pointer helpers — shared by the json_patch generator and the
// card viewer's per-value pointer tracking, so escaping lives in one place.

/** Escape a single path token: `~` → `~0`, `/` → `~1`. */
export function escapePointerToken(token) {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Append one (unescaped) key/index to a base pointer. */
export function appendPointer(base, token) {
  return `${base}/${escapePointerToken(token)}`;
}
