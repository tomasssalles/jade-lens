import { useState } from 'react'
import './Settings.css'
import SettingsForm from './SettingsForm'
import ArrowLeftIcon from './assets/arrow-left.svg?react'
import { DEFAULT_VIEWER_SETTINGS, BASE_COLORS } from './viewerSettings'

function SliderRow({ label, value, min, max, step = 1, onChange }) {
  return (
    <div className="adv-row">
      <div className="adv-row-header">
        <span className="adv-row-label">{label}</span>
        <span className="adv-row-value">{value}</span>
      </div>
      <input
        type="range"
        className="adv-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  )
}

function ColorRow({ label, value, onChange }) {
  return (
    <div className="adv-color-row">
      <span className="adv-row-label">{label}</span>
      <div className="adv-color-right">
        <input type="color" className="adv-color-swatch" value={value} onChange={e => onChange(e.target.value)} />
        <span className="adv-row-value">{value}</span>
      </div>
    </div>
  )
}

function ChoiceRow({ label, value, options, onChange }) {
  return (
    <div className="adv-color-row">
      <span className="adv-row-label">{label}</span>
      <div className="adv-choice-group">
        {options.map(opt => (
          <button
            key={opt.value}
            type="button"
            className={`adv-choice-btn${value === opt.value ? ' adv-choice-active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function AdvancedSettings({ settings: s, onChange }) {
  function set(key, value) {
    onChange({ ...s, [key]: value })
  }

  return (
    <div className="adv-settings">
      <div className="adv-section-label">Base color</div>
      <div className="adv-presets">
        {BASE_COLORS.map(c => (
          <button
            key={c.name}
            type="button"
            className={`adv-preset-btn${!s.useCustomColor && s.baseHue === c.hue && s.baseSaturation === c.sat ? ' adv-preset-active' : ''}`}
            style={{ background: `hsl(${c.hue}, ${c.sat}%, 78%)`, borderColor: `hsl(${c.hue}, ${c.sat}%, 52%)` }}
            onClick={() => onChange({ ...s, useCustomColor: false, baseHue: c.hue, baseSaturation: c.sat })}
            title={c.name}
          />
        ))}
      </div>
      <div className="adv-custom-color">
        <input
          type="checkbox"
          className="adv-checkbox"
          id="useCustomColor"
          checked={s.useCustomColor}
          onChange={e => set('useCustomColor', e.target.checked)}
        />
        <label htmlFor="useCustomColor" className="adv-checkbox-label">Custom color</label>
        {s.useCustomColor && (
          <input type="color" className="adv-color-swatch" value={s.customColorHex} onChange={e => set('customColorHex', e.target.value)} />
        )}
      </div>

      <div className="adv-section-label" style={{ marginTop: '1rem' }}>Lightness</div>
      <SliderRow label="Shallowest (depth 0)" value={s.baseLightnessStart} min={50} max={95} onChange={v => set('baseLightnessStart', v)} />
      <SliderRow label="Deepest (max depth)" value={s.baseLightnessEnd} min={60} max={100} onChange={v => set('baseLightnessEnd', v)} />
      <SliderRow label="Max color depth" value={s.maxColorDepth} min={1} max={15} onChange={v => set('maxColorDepth', v)} />

      <div className="adv-section-label" style={{ marginTop: '1rem' }}>Spacing</div>
      <SliderRow label="Card padding X" value={s.cardPaddingX} min={2} max={24} onChange={v => set('cardPaddingX', v)} />
      <SliderRow label="Card padding Y" value={s.cardPaddingY} min={2} max={20} onChange={v => set('cardPaddingY', v)} />
      <SliderRow label="Sibling gap" value={s.siblingGap} min={1} max={16} onChange={v => set('siblingGap', v)} />
      <SliderRow label="Indent per level" value={s.indentPerLevel} min={0} max={32} onChange={v => set('indentPerLevel', v)} />

      <div className="adv-section-label" style={{ marginTop: '1rem' }}>Shape</div>
      <SliderRow label="Border radius" value={s.borderRadius} min={0} max={16} onChange={v => set('borderRadius', v)} />
      <SliderRow label="Border width" value={s.borderWidth} min={0} max={4} onChange={v => set('borderWidth', v)} />

      <div className="adv-section-label" style={{ marginTop: '1rem' }}>Typography</div>
      <SliderRow label="Font size" value={s.fontSize} min={10} max={20} onChange={v => set('fontSize', v)} />

      <div className="adv-section-label" style={{ marginTop: '1rem' }}>Layout</div>
      <SliderRow label="Wide breakpoint" value={s.wideBreakpoint} min={320} max={1400} step={8} onChange={v => set('wideBreakpoint', v)} />
      <SliderRow label="Min card width" value={s.minCardWidth} min={100} max={600} step={8} onChange={v => set('minCardWidth', v)} />

      <div className="adv-section-label" style={{ marginTop: '1rem' }}>Link colors</div>
      <ColorRow label="Wikilink" value={s.wikilinkColor} onChange={v => set('wikilinkColor', v)} />
      <ColorRow label="URL" value={s.urlColor} onChange={v => set('urlColor', v)} />

      <div className="adv-section-label" style={{ marginTop: '1rem' }}>Dates</div>
      <ChoiceRow
        label="Time format"
        value={s.timeFormat ?? 'auto'}
        options={[
          { value: 'auto', label: 'Auto' },
          { value: '12h', label: '12h' },
          { value: '24h', label: '24h' },
        ]}
        onChange={v => set('timeFormat', v)}
      />

      <button type="button" className="adv-reset-btn" onClick={() => onChange({ ...DEFAULT_VIEWER_SETTINGS })}>
        Reset to defaults
      </button>
    </div>
  )
}

export default function Settings({ onClose, showToast, viewerSettings, onViewerSettingsChange }) {
  const [advOpen, setAdvOpen] = useState(false)

  return (
    <div className="settings-page">
      <div className="page-header">
        <button className="icon-button" onClick={onClose} aria-label="Back">
          <ArrowLeftIcon />
        </button>
        <h2>Settings</h2>
      </div>
      <SettingsForm onSuccess={onClose} showToast={showToast} />
      <div className="adv-toggle-wrap">
        <button type="button" className="adv-toggle-btn" onClick={() => setAdvOpen(v => !v)}>
          <span className={`adv-chevron${advOpen ? ' adv-chevron-open' : ''}`}>▶</span>
          Advanced settings
        </button>
        {advOpen && viewerSettings && (
          <AdvancedSettings settings={viewerSettings} onChange={onViewerSettingsChange} />
        )}
      </div>
    </div>
  )
}
