// Number value handling for the JSON card view (docs/web/editing.md). Integers
// and floats are one "number" type — JS has a single number type, and the
// mutation pipeline's canonical serialization already normalizes integer-valued
// floats (1.0 → 1), so we never have to preserve an int/float distinction.
//
// Locale: users never type grouping (thousands) separators into an input, so we
// forbid grouping entirely. That makes a *single* separator unambiguously the
// decimal point, so the input can MAP whichever decimal key is pressed/pasted
// ('.' or ',') to the configured separator (calculator-style) and reject a
// second separator. On commit we normalize the configured separator back to '.'
// (JSON-native). Display uses the configured separator, ungrouped.

/**
 * Resolve the effective decimal separator from the setting.
 * @param {'auto'|'.'|','} setting
 * @returns {'.'|','}
 */
export function resolveDecimalSeparator(setting) {
  if (setting === '.' || setting === ',') return setting
  // 'auto' (or anything unexpected) → derive from the browser locale.
  try {
    const part = new Intl.NumberFormat().formatToParts(1.1).find(p => p.type === 'decimal')
    return part && part.value === ',' ? ',' : '.'
  } catch {
    return '.'
  }
}

/**
 * Map any decimal-ish character ('.' or ',') to the configured separator, so the
 * field only ever contains that one separator — whatever key was pressed or text
 * pasted. Grouping survives as repeated separators, which `isPartialNumberInput`
 * then rejects.
 */
export function mapToSeparator(text, sep) {
  return String(text).replace(/[.,]/g, sep)
}

/**
 * Is `text` a valid *partial* number (so the field can accept it mid-typing)?
 * Optional leading '-', digits, at most one `sep`, digits. Assumes `text` has
 * already been mapped to `sep`.
 */
export function isPartialNumberInput(text, sep) {
  const escaped = sep === '.' ? '\\.' : sep
  return new RegExp(`^-?\\d*(${escaped}\\d*)?$`).test(text)
}

/**
 * Parse a finished input into a finite JS number, or null if it isn't a
 * complete, valid number. Expects `text` already mapped to `sep`.
 */
export function parseNumberInput(text, sep) {
  if (typeof text !== 'string') return null
  const t = text.trim()
  if (!isPartialNumberInput(t, sep)) return null
  if (t === '' || t === '-' || t === sep || t === `-${sep}`) return null
  const n = Number(t.split(sep).join('.'))
  return Number.isFinite(n) ? n : null
}

/**
 * Render a JS number for display/editing with the chosen separator and no
 * grouping. Exponential-notation magnitudes (very large/small) are left as-is
 * and aren't round-trip editable — an accepted edge case.
 */
export function formatNumberForDisplay(value, sep) {
  const s = String(value)
  return sep === ',' ? s.replace('.', ',') : s
}
