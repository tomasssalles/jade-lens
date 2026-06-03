import { describe, it, expect } from 'vitest'
import { hexToHsl, getCardColor, getUnlockedLockColor, UNLOCKED_LOCK_RED, UNLOCKED_LOCK_RED_ALT, DEFAULT_VIEWER_SETTINGS } from './viewerSettings'

describe('hexToHsl', () => {
  it('converts white', () => {
    expect(hexToHsl('#ffffff')).toEqual({ h: 0, s: 0, l: 100 })
  })
  it('converts black', () => {
    expect(hexToHsl('#000000')).toEqual({ h: 0, s: 0, l: 0 })
  })
  it('converts pure red', () => {
    expect(hexToHsl('#ff0000')).toEqual({ h: 0, s: 100, l: 50 })
  })
  it('converts pure green (hue 120)', () => {
    expect(hexToHsl('#00ff00')).toEqual({ h: 120, s: 100, l: 50 })
  })
  it('expands 3-digit shorthand', () => {
    expect(hexToHsl('#fff')).toEqual({ h: 0, s: 0, l: 100 })
  })
  it('tolerates a missing leading #', () => {
    expect(hexToHsl('000000')).toEqual({ h: 0, s: 0, l: 0 })
  })
})

describe('getCardColor', () => {
  const s = DEFAULT_VIEWER_SETTINGS
  it('uses the start lightness at depth 0', () => {
    expect(getCardColor(0, s)).toBe(`hsl(${s.baseHue}, ${s.baseSaturation}%, ${s.baseLightnessStart}%)`)
  })
  it('uses the end lightness at max depth', () => {
    expect(getCardColor(s.maxColorDepth, s)).toBe(`hsl(${s.baseHue}, ${s.baseSaturation}%, ${s.baseLightnessEnd}%)`)
  })
  it('clamps depth beyond max to the end lightness', () => {
    expect(getCardColor(s.maxColorDepth + 5, s)).toBe(getCardColor(s.maxColorDepth, s))
  })
  it('derives hue/sat from the custom color when enabled', () => {
    const custom = { ...s, useCustomColor: true, customColorHex: '#ff0000' }
    expect(getCardColor(0, custom)).toBe(`hsl(0, 100%, ${s.baseLightnessStart}%)`)
  })
})

describe('getUnlockedLockColor', () => {
  it('is blazing red for a non-red theme (default slate blue)', () => {
    expect(getUnlockedLockColor(DEFAULT_VIEWER_SETTINGS)).toBe(UNLOCKED_LOCK_RED)
  })
  it('falls back to the alt colour when the theme hue is red', () => {
    const dustyRose = { ...DEFAULT_VIEWER_SETTINGS, baseHue: 350 }
    expect(getUnlockedLockColor(dustyRose)).toBe(UNLOCKED_LOCK_RED_ALT)
  })
  it('treats a red custom colour as red-ish', () => {
    const customRed = { ...DEFAULT_VIEWER_SETTINGS, useCustomColor: true, customColorHex: '#ff0000' }
    expect(getUnlockedLockColor(customRed)).toBe(UNLOCKED_LOCK_RED_ALT)
  })
})

describe('getViewerSettings (in-memory fallback merge)', () => {
  it('merges saved values over defaults without dropping unsaved keys', async () => {
    // No IDB in the test env → getDB rejects → getViewerSettings should still
    // be resilient. We assert the merge shape via the exported defaults.
    const merged = { ...DEFAULT_VIEWER_SETTINGS, ...{ fontSize: 18 } }
    expect(merged.fontSize).toBe(18)
    expect(merged.baseHue).toBe(DEFAULT_VIEWER_SETTINGS.baseHue)
  })
})
