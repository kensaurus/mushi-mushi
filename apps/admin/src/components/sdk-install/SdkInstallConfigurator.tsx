import { ConfigHelp } from '../ConfigHelp'
import {
  isMobileFramework,
  type BannerPosition,
  type BannerVariant,
  type Framework,
  type ScreenshotMode,
  type SdkPreviewConfig,
  type WidgetPosition,
  type WidgetTheme,
} from '../../lib/sdkSnippets'

export const POSITIONS: WidgetPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
export const THEMES: WidgetTheme[] = ['auto', 'light', 'dark']
export const SCREENSHOT_MODES: ScreenshotMode[] = ['on-report', 'auto', 'off']
export const NATIVE_TRIGGER_MODES = ['shake', 'button', 'both', 'none'] as const

export const POSITION_LABEL: Record<WidgetPosition, string> = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
}

export const SCREENSHOT_LABEL: Record<ScreenshotMode, string> = {
  'on-report': 'When report opens',
  auto: 'Always',
  off: 'Never',
}

export function SdkInstallConfigurator({
  config,
  enabled,
  framework,
  onEnabledChange,
  onChange,
}: {
  config: SdkPreviewConfig
  enabled: boolean
  framework: Framework
  onEnabledChange: (next: boolean) => void
  onChange: (next: SdkPreviewConfig) => void
}) {
  function update<K extends keyof SdkPreviewConfig>(k: K, v: SdkPreviewConfig[K]) {
    onChange({ ...config, [k]: v })
  }

  function updateCapture<K extends keyof SdkPreviewConfig['capture']>(k: K, v: SdkPreviewConfig['capture'][K]) {
    onChange({ ...config, capture: { ...config.capture, [k]: v } })
  }

  function updateNative<K extends keyof SdkPreviewConfig['native']>(k: K, v: SdkPreviewConfig['native'][K]) {
    onChange({ ...config, native: { ...config.native, [k]: v } })
  }

  return (
    <div className="space-y-3 text-2xs">
      <label className="flex items-start gap-2 rounded-sm border border-edge-subtle bg-surface-raised/60 p-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="mt-0.5 h-3 w-3 accent-brand"
        />
        <span>
          <span className="block text-fg-secondary font-medium">Serve runtime config</span>
          <span className="block text-fg-faint mt-0.5">
            Turn off to make installed SDKs ignore saved console settings and keep their local bootstrap defaults.
          </span>
        </span>
      </label>

      {/* Position 4-corner picker */}
      <fieldset>
        <legend className="text-2xs text-fg-muted uppercase tracking-wider font-medium mb-1 inline-flex items-center gap-1">
          Position
          <ConfigHelp helpId="sdk-install.position" />
        </legend>
        <div
          className="grid grid-cols-2 gap-1 w-32 p-1 bg-surface-raised border border-edge-subtle rounded-sm"
          role="radiogroup"
          aria-label="Widget position"
        >
          {POSITIONS.map((pos) => (
            <button
              key={pos}
              type="button"
              role="radio"
              aria-checked={config.position === pos}
              aria-label={POSITION_LABEL[pos]}
              onClick={() => update('position', pos)}
              className={`h-6 rounded-sm transition-colors ${
                config.position === pos
                  ? 'bg-brand'
                  : 'bg-surface-overlay hover:bg-edge-subtle'
              }`}
              title={POSITION_LABEL[pos]}
            />
          ))}
        </div>
      </fieldset>

      {!isMobileFramework(framework) && (
        <fieldset>
          <legend className="text-2xs text-fg-muted uppercase tracking-wider font-medium mb-1 inline-flex items-center gap-1">
            Trigger mode
            <ConfigHelp helpId="sdk-install.trigger_mode" />
          </legend>
          {/* 3-option chooser — recommended order mirrors the plan's guidance:
              attach first (best headless UX), then auto (easy default), then
              manual / edge-tab for advanced hosts. */}
          <div className="space-y-1.5">
            {([
              { value: 'banner',   label: 'Header banner',          hint: 'A slim strip pinned to the top (or bottom) of the viewport. Less obtrusive than a FAB.' },
              { value: 'attach',   label: 'Attach to my button',    hint: 'Your button opens the reporter. No floating stamp.' },
              { value: 'auto',     label: 'Floating stamp (FAB)',    hint: 'SDK renders a bug-stamp in the chosen corner.' },
              { value: 'edge-tab', label: 'Edge tab',               hint: 'A vertical tab on the screen edge.' },
              { value: 'manual',   label: 'Headless (manual)',       hint: 'Use <MushiTrigger> anywhere in your JSX.' },
            ] as const).map(({ value, label, hint }) => (
              <button
                key={value}
                type="button"
                onClick={() => update('trigger', value)}
                title={hint}
                className={`w-full rounded-sm border px-2 py-1.5 text-left text-2xs transition-colors flex items-center gap-2 ${
                  config.trigger === value
                    ? 'border-brand bg-brand/15 text-brand'
                    : 'border-edge-subtle bg-surface-raised text-fg-muted hover:text-fg'
                }`}
              >
                <span className={`inline-flex items-center justify-center w-3 h-3 rounded-full border shrink-0 ${config.trigger === value ? 'border-brand bg-brand' : 'border-fg-faint'}`}>
                  {config.trigger === value && <span className="w-1.5 h-1.5 rounded-full bg-brand-fg" />}
                </span>
                <span className="font-medium">{label}</span>
                {value === 'banner' && <span className="ml-auto text-2xs text-ok uppercase tracking-wider font-semibold">Recommended</span>}
              </button>
            ))}
          </div>
          {config.trigger === 'banner' && (
            <div className="mt-2 rounded-sm border border-edge-subtle bg-surface-raised/50 p-2 space-y-2">
              <p className="text-fg-muted font-medium">Banner options</p>
              {/* Variant */}
              <fieldset>
                <legend className="text-fg-faint mb-1">Style</legend>
                <div className="flex gap-1.5">
                  {(['brand', 'neon', 'subtle'] as BannerVariant[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => onChange({ ...config, bannerVariant: v })}
                      className={`px-2 py-0.5 rounded-sm border text-2xs capitalize transition-colors ${
                        config.bannerVariant === v
                          ? 'border-brand bg-brand/15 text-brand'
                          : 'border-edge-subtle text-fg-muted hover:text-fg'
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </fieldset>
              {/* Position */}
              <fieldset>
                <legend className="text-fg-faint mb-1">Position</legend>
                <div className="flex gap-1.5">
                  {(['top', 'bottom'] as BannerPosition[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => onChange({ ...config, bannerPosition: p })}
                      className={`px-2 py-0.5 rounded-sm border text-2xs capitalize transition-colors ${
                        config.bannerPosition === p
                          ? 'border-brand bg-brand/15 text-brand'
                          : 'border-edge-subtle text-fg-muted hover:text-fg'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </fieldset>
              {/* Rich banner copy */}
              <label className="block">
                <span className="text-fg-faint">Banner message</span>
                <input
                  type="text"
                  value={config.bannerMessage}
                  onChange={(e) => onChange({ ...config, bannerMessage: e.target.value })}
                  placeholder="Your app is in active beta — expect rough edges."
                  className="mt-0.5 w-full px-2 py-1 bg-surface-overlay border border-edge-subtle rounded-sm text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand text-2xs"
                />
              </label>
              <label className="block">
                <span className="text-fg-faint">Pill label</span>
                <input
                  type="text"
                  value={config.bannerLabel}
                  onChange={(e) => onChange({ ...config, bannerLabel: e.target.value })}
                  placeholder="Beta"
                  className="mt-0.5 w-full px-2 py-1 bg-surface-overlay border border-edge-subtle rounded-sm text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand text-2xs"
                />
              </label>
              {/* Bug CTA label */}
              <label className="block">
                <span className="text-fg-faint">Bug button label</span>
                <input
                  type="text"
                  value={config.bannerBugCta}
                  onChange={(e) => onChange({ ...config, bannerBugCta: e.target.value })}
                  placeholder="🐛 Report a bug"
                  className="mt-0.5 w-full px-2 py-1 bg-surface-overlay border border-edge-subtle rounded-sm text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand text-2xs"
                />
              </label>
              {/* Feature CTA toggle */}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.bannerFeatureCta}
                  onChange={(e) => onChange({ ...config, bannerFeatureCta: e.target.checked })}
                  className="h-3 w-3 accent-brand"
                />
                <span className="text-fg-muted">Show "Request feature" button</span>
              </label>
            </div>
          )}
          {config.trigger === 'attach' && (
            <label className="block mt-2">
              <span className="text-fg-muted">CSS selector (optional)</span>
              <input
                type="text"
                value={config.attachToSelector}
                onChange={(e) => update('attachToSelector', e.target.value)}
                placeholder="#report-button"
                className="mt-1 w-full px-2 py-1 bg-surface-raised border border-edge-subtle rounded-sm text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand font-mono text-2xs"
              />
              <p className="text-fg-faint text-2xs mt-0.5">Leave blank to set programmatically via <code>sdk.attachTo(el)</code>.</p>
            </label>
          )}
          <p className="mt-1 text-fg-faint inline-flex items-center gap-1">
            Smart hide uses this mode as the desktop baseline.
            <ConfigHelp helpId="sdk-install.smart_hide" />
          </p>
        </fieldset>
      )}

      {/* Theme + trigger text on one row */}
      <div className="grid grid-cols-2 gap-3">
        <fieldset>
          <legend className="text-2xs text-fg-muted uppercase tracking-wider font-medium mb-1 inline-flex items-center gap-1">
            Theme
            <ConfigHelp helpId="sdk-install.theme" />
          </legend>
          <div className="flex gap-1" role="radiogroup" aria-label="Widget theme">
            {THEMES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={config.theme === t}
                onClick={() => update('theme', t)}
                className={`px-2 py-1 rounded-sm capitalize transition-colors ${
                  config.theme === t
                    ? 'bg-brand text-brand-fg'
                    : 'bg-surface-raised text-fg-muted border border-edge-subtle hover:text-fg'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="text-2xs text-fg-muted uppercase tracking-wider font-medium inline-flex items-center gap-1">
            Trigger
            <ConfigHelp helpId="sdk-install.trigger_text" />
          </span>
          <input
            type="text"
            value={config.triggerText}
            onChange={(e) => update('triggerText', e.target.value.slice(0, 12))}
            maxLength={12}
            className="mt-1 w-full px-2 py-1 bg-surface-raised border border-edge-subtle rounded-sm text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
            placeholder="\u{1F41B}"
            aria-label="Trigger button text or emoji"
          />
        </label>
      </div>

      {/* Capture options */}
      <fieldset>
        <legend className="text-2xs text-fg-muted uppercase tracking-wider font-medium mb-1">Capture</legend>
        <div className="grid grid-cols-2 gap-1.5">
          <CaptureToggle
            label="Console logs"
            helpId="sdk-install.capture_console"
            checked={config.capture.console}
            onChange={(v) => updateCapture('console', v)}
          />
          <CaptureToggle
            label="Network calls"
            helpId="sdk-install.capture_network"
            checked={config.capture.network}
            onChange={(v) => updateCapture('network', v)}
          />
          <CaptureToggle
            label="Performance"
            helpId="sdk-install.capture_performance"
            checked={config.capture.performance}
            onChange={(v) => updateCapture('performance', v)}
          />
          <CaptureToggle
            label="Element picker"
            helpId="sdk-install.capture_element_picker"
            checked={config.capture.elementSelector}
            onChange={(v) => updateCapture('elementSelector', v)}
          />
        </div>
        <label className="block mt-2">
          <span className="text-fg-muted inline-flex items-center gap-1">
            Screenshot
            <ConfigHelp helpId="sdk-install.screenshot_mode" />
          </span>
          <select
            value={config.capture.screenshot}
            onChange={(e) => updateCapture('screenshot', e.target.value as ScreenshotMode)}
            className="ml-2 px-2 py-0.5 bg-surface-raised border border-edge-subtle rounded-sm text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
          >
            {SCREENSHOT_MODES.map((m) => (
              <option key={m} value={m}>{SCREENSHOT_LABEL[m]}</option>
            ))}
          </select>
        </label>
        {config.capture.screenshot !== 'off' && (
          <div className="mt-2 rounded-sm border border-edge-subtle bg-surface-raised/40 p-2">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={config.screenshotSensitiveHint !== false}
                onChange={(e) =>
                  update(
                    'screenshotSensitiveHint',
                    e.target.checked
                      ? typeof config.screenshotSensitiveHint === 'string'
                        ? config.screenshotSensitiveHint
                        : true
                      : false,
                  )
                }
                className="accent-brand"
              />
              <span className="text-fg-muted inline-flex items-center gap-1">
                Privacy caption on screenshot preview
                <ConfigHelp helpId="sdk-install.screenshot_sensitive_hint" />
              </span>
            </label>
            {config.screenshotSensitiveHint !== false && (
              <input
                type="text"
                maxLength={200}
                value={typeof config.screenshotSensitiveHint === 'string' ? config.screenshotSensitiveHint : ''}
                placeholder="Default: warn not to share passwords or personal info"
                onChange={(e) => update('screenshotSensitiveHint', e.target.value ? e.target.value : true)}
                className="mt-1.5 w-full px-2 py-1 bg-surface-raised border border-edge-subtle rounded-sm text-fg placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
              />
            )}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="text-2xs text-fg-muted uppercase tracking-wider font-medium mb-1">
          Native mobile
        </legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-fg-muted">Trigger</span>
            <select
              value={config.native.triggerMode}
              onChange={(e) => updateNative('triggerMode', e.target.value as SdkPreviewConfig['native']['triggerMode'])}
              className="mt-1 w-full px-2 py-1 bg-surface-raised border border-edge-subtle rounded-sm text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
            >
              {NATIVE_TRIGGER_MODES.map((mode) => (
                <option key={mode} value={mode}>{mode}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-fg-muted">Min description</span>
            <input
              type="number"
              min={0}
              max={1000}
              value={config.native.minDescriptionLength}
              onChange={(e) => updateNative('minDescriptionLength', Number(e.target.value))}
              className="mt-1 w-full px-2 py-1 bg-surface-raised border border-edge-subtle rounded-sm text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
            />
          </label>
        </div>
      </fieldset>
    </div>
  )
}

function CaptureToggle({
  label,
  checked,
  onChange,
  helpId,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  /** Optional id into `apps/admin/src/lib/configDocs.ts`. */
  helpId?: string
}) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3 w-3 accent-brand"
      />
      <span className="text-fg-secondary inline-flex items-center gap-1">
        {label}
        {helpId && <ConfigHelp helpId={helpId} />}
      </span>
    </label>
  )
}
