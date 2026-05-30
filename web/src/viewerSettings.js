import { getDB } from './db'

export const DEFAULT_VIEWER_SETTINGS = {
  cardPaddingX: 8,
  cardPaddingY: 6,
  siblingGap: 3,
  borderRadius: 5,
  borderWidth: 1,
  indentPerLevel: 12,
  wideBreakpoint: 768,
  minCardWidth: 260,
  maxColorDepth: 7,
  baseHue: 220,
  baseSaturation: 25,
  baseLightnessStart: 75,
  baseLightnessEnd: 96,
  useCustomColor: false,
  customColorHex: '#8ba0c2',
  fontSize: 14,
  keyFontWeight: 600,
  wikilinkColor: '#00965a',
  urlColor: '#2563eb',
}

export const BASE_COLORS = [
  { name: 'Slate blue', hue: 220, sat: 25 },
  { name: 'Warm gray', hue: 30, sat: 12 },
  { name: 'Sage green', hue: 150, sat: 18 },
  { name: 'Dusty rose', hue: 350, sat: 20 },
  { name: 'Amber', hue: 40, sat: 30 },
  { name: 'Teal', hue: 180, sat: 22 },
  { name: 'Lavender', hue: 270, sat: 20 },
  { name: 'Cool gray', hue: 210, sat: 8 },
]

export function hexToHsl(hex) {
  hex = hex.replace(/^#/, '')
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2]
  const r = parseInt(hex.slice(0,2),16)/255
  const g = parseInt(hex.slice(2,4),16)/255
  const b = parseInt(hex.slice(4,6),16)/255
  const max = Math.max(r,g,b), min = Math.min(r,g,b)
  let h=0, s=0, l=(max+min)/2
  if (max !== min) {
    const d = max-min
    s = l > 0.5 ? d/(2-max-min) : d/(max+min)
    if (max===r) h=((g-b)/d+(g<b?6:0))/6
    else if (max===g) h=((b-r)/d+2)/6
    else h=((r-g)/d+4)/6
  }
  return { h: Math.round(h*360), s: Math.round(s*100), l: Math.round(l*100) }
}

function resolveHueSat(s) {
  if (s.useCustomColor) {
    const hsl = hexToHsl(s.customColorHex)
    return { hue: hsl.h, sat: hsl.s }
  }
  return { hue: s.baseHue, sat: s.baseSaturation }
}

function cardLightness(depth, s) {
  const effectiveDepth = Math.min(depth, s.maxColorDepth)
  const t = s.maxColorDepth > 0 ? effectiveDepth / s.maxColorDepth : 0
  return s.baseLightnessStart + t * (s.baseLightnessEnd - s.baseLightnessStart)
}

export function getCardColor(depth, s) {
  const { hue, sat } = resolveHueSat(s)
  return `hsl(${hue}, ${sat}%, ${cardLightness(depth, s)}%)`
}

export function getTextColor(depth, s) {
  const { hue, sat } = resolveHueSat(s)
  const l = cardLightness(depth, s)
  // Light background → dark text; dark background → light text
  const textL = l > 55
    ? Math.max(l - 65, 8)
    : Math.min(l + 65, 95)
  return `hsl(${hue}, ${Math.min(sat + 5, 40)}%, ${textL}%)`
}

export function getBorderColor(s) {
  const { hue, sat } = resolveHueSat(s)
  return `hsl(${hue}, ${sat}%, ${Math.max(s.baseLightnessStart - 12, 30)}%)`
}

export function getTitleColor(s) {
  const { hue, sat } = resolveHueSat(s)
  return `hsl(${hue}, ${Math.min(sat + 10, 50)}%, ${Math.max(s.baseLightnessStart - 35, 20)}%)`
}

export function applySettingsCssVars(settings) {
  const root = document.documentElement
  root.style.setProperty('--jl-wikilink-color', settings.wikilinkColor)
  root.style.setProperty('--jl-wikilink-color-faded', settings.wikilinkColor + '66')
  root.style.setProperty('--jl-url-color', settings.urlColor)
  root.style.setProperty('--jl-url-color-faded', settings.urlColor + '66')
  root.style.setProperty('--jl-title-color', getTitleColor(settings))
  root.style.setProperty('--jl-border-color', getBorderColor(settings))
}

export async function getViewerSettings() {
  const db = await getDB()
  const saved = await db.get('config', 'viewerSettings')
  return { ...DEFAULT_VIEWER_SETTINGS, ...(saved ?? {}) }
}

export async function saveViewerSettings(values) {
  const db = await getDB()
  await db.put('config', values, 'viewerSettings')
}
