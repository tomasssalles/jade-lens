import { describe, it, expect } from 'vitest'
import {
  classifyStringValue,
  wikilinkTarget,
  toWikilink,
  splitDatetime,
  toDateInputValue,
  datetimeHasSeconds,
  fromDateInputValue,
  parseZoneOffsetMinutes,
  formatZoneSuffix,
} from './valueType'

describe('classifyStringValue', () => {
  it('classifies date-only strings', () => {
    expect(classifyStringValue('2026-06-06')).toBe('date')
  })

  it('classifies naive, UTC, and offset datetimes', () => {
    expect(classifyStringValue('2026-06-06T14:30')).toBe('datetime')
    expect(classifyStringValue('2026-06-06T14:30:00')).toBe('datetime')
    expect(classifyStringValue('2026-06-06T14:30:00Z')).toBe('datetime')
    expect(classifyStringValue('2026-06-06T14:30:00+02:00')).toBe('datetime')
  })

  it('classifies a lone wikilink', () => {
    expect(classifyStringValue('[[projects/leasing.md]]')).toBe('wikilink')
    expect(classifyStringValue('  [[a/b.md]]  ')).toBe('wikilink')
  })

  it('treats embedded or partial matches as plain', () => {
    expect(classifyStringValue('due 2026-06-06 sharp')).toBe('plain')
    expect(classifyStringValue('see [[a.md]] and [[b.md]]')).toBe('plain')
    expect(classifyStringValue('hello')).toBe('plain')
    expect(classifyStringValue('14:30')).toBe('plain') // bare time isn't a date
  })

  it('is plain for non-strings', () => {
    expect(classifyStringValue(5)).toBe('plain')
    expect(classifyStringValue(null)).toBe('plain')
  })
})

describe('wikilink helpers', () => {
  it('extracts the inner target', () => {
    expect(wikilinkTarget('[[projects/leasing.md]]')).toBe('projects/leasing.md')
    expect(wikilinkTarget('  [[a.md]] ')).toBe('a.md')
    expect(wikilinkTarget('not a link')).toBe('')
  })

  it('wraps a path, rejecting empties', () => {
    expect(toWikilink('a/b.md')).toBe('[[a/b.md]]')
    expect(toWikilink('  spaced.md ')).toBe('[[spaced.md]]')
    expect(toWikilink('')).toBeNull()
    expect(toWikilink('   ')).toBeNull()
  })
})

describe('datetime splitting', () => {
  it('separates the local part from the zone', () => {
    expect(splitDatetime('2026-06-06T14:30')).toEqual({ local: '2026-06-06T14:30', zone: '' })
    expect(splitDatetime('2026-06-06T14:30:00Z')).toEqual({ local: '2026-06-06T14:30:00', zone: 'Z' })
    expect(splitDatetime('2026-06-06T14:30:00+02:00')).toEqual({ local: '2026-06-06T14:30:00', zone: '+02:00' })
    expect(splitDatetime('2026-06-06T14:30:00-05:00')).toEqual({ local: '2026-06-06T14:30:00', zone: '-05:00' })
  })

  it('returns null for non-datetimes', () => {
    expect(splitDatetime('2026-06-06')).toBeNull()
    expect(splitDatetime('nope')).toBeNull()
  })
})

describe('toDateInputValue', () => {
  it('passes date-only through', () => {
    expect(toDateInputValue('2026-06-06', 'date')).toBe('2026-06-06')
  })

  it('strips the zone for datetime inputs', () => {
    expect(toDateInputValue('2026-06-06T14:30:00Z', 'datetime')).toBe('2026-06-06T14:30:00')
    expect(toDateInputValue('2026-06-06T14:30', 'datetime')).toBe('2026-06-06T14:30')
  })
})

describe('datetimeHasSeconds', () => {
  it('detects an explicit seconds component', () => {
    expect(datetimeHasSeconds('2026-06-06T14:30:00')).toBe(true)
    expect(datetimeHasSeconds('2026-06-06T14:30:00Z')).toBe(true)
    expect(datetimeHasSeconds('2026-06-06T14:30')).toBe(false)
  })
})

describe('fromDateInputValue', () => {
  it('validates and passes date-only', () => {
    expect(fromDateInputValue('2026-07-01', 'date', '2026-06-06')).toBe('2026-07-01')
    expect(fromDateInputValue('', 'date', '2026-06-06')).toBeNull()
    expect(fromDateInputValue('garbage', 'date', '2026-06-06')).toBeNull()
  })

  it('reattaches the original zone suffix to a datetime', () => {
    expect(fromDateInputValue('2026-07-01T09:15', 'datetime', '2026-06-06T14:30:00Z'))
      .toBe('2026-07-01T09:15Z')
    expect(fromDateInputValue('2026-07-01T09:15:30', 'datetime', '2026-06-06T14:30:00+02:00'))
      .toBe('2026-07-01T09:15:30+02:00')
    expect(fromDateInputValue('2026-07-01T09:15', 'datetime', '2026-06-06T14:30'))
      .toBe('2026-07-01T09:15')
  })

  it('rejects an empty or malformed datetime input', () => {
    expect(fromDateInputValue('', 'datetime', '2026-06-06T14:30')).toBeNull()
    expect(fromDateInputValue('2026-07-01', 'datetime', '2026-06-06T14:30')).toBeNull()
  })
})

describe('parseZoneOffsetMinutes', () => {
  it('returns null for a naive (zoneless) value', () => {
    expect(parseZoneOffsetMinutes('')).toBeNull()
  })

  it('maps Z to 0', () => {
    expect(parseZoneOffsetMinutes('Z')).toBe(0)
  })

  it('maps numeric offsets with the conventional sign', () => {
    expect(parseZoneOffsetMinutes('+02:00')).toBe(120)
    expect(parseZoneOffsetMinutes('-05:00')).toBe(-300)
    expect(parseZoneOffsetMinutes('+05:30')).toBe(330)
    expect(parseZoneOffsetMinutes('-05:30')).toBe(-330)
  })

  it('returns null for garbage', () => {
    expect(parseZoneOffsetMinutes('nope')).toBeNull()
  })
})

describe('formatZoneSuffix', () => {
  it('shows UTC at offset 0', () => {
    expect(formatZoneSuffix(0)).toBe('UTC')
  })

  it('shows a padded signed offset otherwise', () => {
    expect(formatZoneSuffix(120)).toBe('+02:00')
    expect(formatZoneSuffix(-300)).toBe('-05:00')
    expect(formatZoneSuffix(330)).toBe('+05:30')
    expect(formatZoneSuffix(-330)).toBe('-05:30')
  })
})
