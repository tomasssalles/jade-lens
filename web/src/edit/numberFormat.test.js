import { describe, it, expect } from 'vitest'
import {
  resolveDecimalSeparator,
  mapToSeparator,
  isPartialNumberInput,
  parseNumberInput,
  formatNumberForDisplay,
} from './numberFormat.js'

describe('resolveDecimalSeparator', () => {
  it('returns an explicit separator unchanged', () => {
    expect(resolveDecimalSeparator('.')).toBe('.')
    expect(resolveDecimalSeparator(',')).toBe(',')
  })
  it("derives a concrete separator for 'auto'", () => {
    expect(['.', ',']).toContain(resolveDecimalSeparator('auto'))
  })
  it('falls back to a period for unexpected input', () => {
    expect(['.', ',']).toContain(resolveDecimalSeparator(undefined))
  })
})

describe('mapToSeparator', () => {
  it('maps a period to a configured comma', () => {
    expect(mapToSeparator('3.14', ',')).toBe('3,14')
  })
  it('maps a comma to a configured period', () => {
    expect(mapToSeparator('3,14', '.')).toBe('3.14')
  })
  it('turns a grouped number into repeated separators (later rejected)', () => {
    expect(mapToSeparator('1.000,5', ',')).toBe('1,000,5')
  })
  it('leaves a bare integer alone', () => {
    expect(mapToSeparator('-42', ',')).toBe('-42')
  })
})

describe('isPartialNumberInput', () => {
  const sep = '.'
  it('accepts in-progress fragments', () => {
    for (const t of ['', '-', '1', '1.', '.5', '-0.', '-12.34', '12']) {
      expect(isPartialNumberInput(t, sep)).toBe(true)
    }
  })
  it('rejects two separators (grouping) and junk', () => {
    for (const t of ['1.2.3', '1..2', 'abc', '1-2', '--1', '1e5']) {
      expect(isPartialNumberInput(t, sep)).toBe(false)
    }
  })
  it('respects a comma separator', () => {
    expect(isPartialNumberInput('1,5', ',')).toBe(true)
    expect(isPartialNumberInput('1.5', ',')).toBe(false) // unmapped period not allowed
  })
})

describe('parseNumberInput', () => {
  it('parses with a period separator', () => {
    expect(parseNumberInput('3.14', '.')).toBe(3.14)
    expect(parseNumberInput('-0.5', '.')).toBe(-0.5)
    expect(parseNumberInput('.5', '.')).toBe(0.5)
    expect(parseNumberInput('5.', '.')).toBe(5)
  })
  it('parses with a comma separator', () => {
    expect(parseNumberInput('3,14', ',')).toBe(3.14)
    expect(parseNumberInput('-1000', ',')).toBe(-1000)
  })
  it('normalizes an integer-valued input to an integer', () => {
    expect(parseNumberInput('5,0', ',')).toBe(5)
    expect(Number.isInteger(parseNumberInput('5,0', ','))).toBe(true)
  })
  it('returns null for incomplete or invalid input', () => {
    for (const t of ['', '-', '.', ',', '-,', 'abc', '1.2.3']) {
      expect(parseNumberInput(t, t.includes(',') ? ',' : '.')).toBeNull()
    }
  })
})

describe('formatNumberForDisplay', () => {
  it('uses a period as-is', () => {
    expect(formatNumberForDisplay(3.14, '.')).toBe('3.14')
    expect(formatNumberForDisplay(1000, '.')).toBe('1000')
  })
  it('swaps in a comma without grouping', () => {
    expect(formatNumberForDisplay(3.14, ',')).toBe('3,14')
    expect(formatNumberForDisplay(1000, ',')).toBe('1000')
    expect(formatNumberForDisplay(-2.5, ',')).toBe('-2,5')
  })
})
