import { describe, it, expect } from 'vitest'
import { normalizeWikilinkPath, formatPath } from './pathUtils'

describe('normalizeWikilinkPath', () => {
  it('strips a leading ./', () => {
    expect(normalizeWikilinkPath('./foo/bar.md')).toBe('foo/bar.md')
  })
  it('collapses duplicate slashes', () => {
    expect(normalizeWikilinkPath('foo//bar///baz.md')).toBe('foo/bar/baz.md')
  })
  it('strips a leading slash', () => {
    expect(normalizeWikilinkPath('/foo/bar.md')).toBe('foo/bar.md')
  })
  it('leaves a clean path untouched', () => {
    expect(normalizeWikilinkPath('Projects/Leasing.json')).toBe('Projects/Leasing.json')
  })
})

describe('formatPath', () => {
  it('strips a non-dotfile extension and joins with " / "', () => {
    expect(formatPath('Projects/New language.json')).toBe('Projects / New language')
  })
  it('strips .md', () => {
    expect(formatPath('notes/today.md')).toBe('notes / today')
  })
  it('preserves dotfile names (no extension to strip)', () => {
    expect(formatPath('.gitignore')).toBe('.gitignore')
  })
  it('handles a bare filename', () => {
    expect(formatPath('index.json')).toBe('index')
  })
  it('does not strip a dotfile in a subdirectory', () => {
    expect(formatPath('config/.env')).toBe('config / .env')
  })
  it('only strips the final extension segment', () => {
    expect(formatPath('a/b.test.js')).toBe('a / b.test')
  })
})
