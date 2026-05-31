import { describe, it, expect } from 'vitest'
import remarkWikilinks from './remarkWikilinks'
import remarkDates from './remarkDates'

// Build a minimal mdast tree wrapping a single text node, run the plugin's
// transformer over it, and return the resulting children of the paragraph.
function runOnText(plugin, text) {
  const textNode = { type: 'text', value: text }
  const paragraph = { type: 'paragraph', children: [textNode] }
  const tree = { type: 'root', children: [paragraph] }
  plugin()(tree)
  return paragraph.children
}

describe('remarkWikilinks', () => {
  it('extracts a wikilink into its own node', () => {
    const out = runOnText(remarkWikilinks, 'see [[Projects/Leasing.json]] now')
    expect(out.map(n => n.type)).toEqual(['text', 'wikilink', 'text'])
    expect(out[1].data.hProperties.path).toBe('Projects/Leasing.json')
    expect(out[0].value).toBe('see ')
    expect(out[2].value).toBe(' now')
  })
  it('handles multiple wikilinks', () => {
    const out = runOnText(remarkWikilinks, '[[a.md]] and [[b.md]]')
    const links = out.filter(n => n.type === 'wikilink')
    expect(links.map(l => l.data.hProperties.path)).toEqual(['a.md', 'b.md'])
  })
  it('leaves plain text with no wikilinks alone', () => {
    const out = runOnText(remarkWikilinks, 'no links here')
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('text')
  })
})

describe('remarkDates', () => {
  it('extracts a date-only ISO string', () => {
    const out = runOnText(remarkDates, 'due 2026-06-15 ok')
    expect(out.map(n => n.type)).toEqual(['text', 'inlinedate', 'text'])
    expect(out[1].data.hProperties.iso).toBe('2026-06-15')
  })
  it('extracts a naive datetime', () => {
    const out = runOnText(remarkDates, 'at 2026-06-15T19:00')
    const date = out.find(n => n.type === 'inlinedate')
    expect(date.data.hProperties.iso).toBe('2026-06-15T19:00')
  })
  it('extracts a UTC datetime with seconds', () => {
    const out = runOnText(remarkDates, '2026-06-15T17:00:00Z exported')
    const date = out.find(n => n.type === 'inlinedate')
    expect(date.data.hProperties.iso).toBe('2026-06-15T17:00:00Z')
  })
  it('extracts an offset datetime', () => {
    const out = runOnText(remarkDates, '2026-06-15T19:00+02:00')
    const date = out.find(n => n.type === 'inlinedate')
    expect(date.data.hProperties.iso).toBe('2026-06-15T19:00+02:00')
  })
  it('leaves text with no date alone', () => {
    const out = runOnText(remarkDates, 'no date here')
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('text')
  })
})
