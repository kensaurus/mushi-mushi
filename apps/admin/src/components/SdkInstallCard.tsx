/**
 * FILE: apps/admin/src/components/SdkInstallCard.tsx
 * PURPOSE: Reusable per-framework "Install + configure the bug-capture web SDK"
 *          card. Combines three things in one self-explaining surface:
 *
 *            1. Live WIDGET PREVIEW — a mocked phone-frame viewport that
 *               renders the bug-capture trigger button using the same
 *               position / theme / triggerText settings the real SDK uses,
 *               so users see what their app will look like before they
 *               paste a single line of code.
 *
 *            2. CONFIGURATOR — interactive controls (4-corner position
 *               picker, theme radio, trigger text input, capture toggles,
 *               screenshot mode) that update the preview AND the snippet
 *               in real time. The shape mirrors `MushiWidgetConfig` and
 *               `MushiCaptureConfig` from packages/core so what users tune
 *               here is exactly what they'd write in code.
 *
 *            3. INSTALL SNIPPETS — framework tabs (React / Vue / Svelte /
 *               Vanilla) with the matching `npm install` command and the
 *               init code, with the configured options baked in.
 *
 *          Used in four places — Onboarding Card 4, ProjectsPage per-project,
 *          Settings → Health, and McpPage — so the snippet content lives in
 *          `lib/sdkSnippets.ts` and this file owns the visual shell.
 *
 *          `compact` shrinks vertical padding so the card sits comfortably
 *          inside an already-busy card (Projects row, MCP page) instead of
 *          dominating it.
 */

import { useMemo, useState } from 'react'
import { Card } from './ui'
import { ConfigHelp } from './ConfigHelp'
import {
  DEFAULT_SDK_CONFIG,
  FRAMEWORKS,
  frameworkLabel,
  installCommand,
  renderSnippet,
  type Framework,
  type ScreenshotMode,
  type SdkPreviewConfig,
  type WidgetPosition,
  type WidgetTheme,
} from '../lib/sdkSnippets'

interface Props {
  /** The project's external `project_id` (the value the SDK sends back to the
   *  ingest endpoint) — not the internal UUID. */
  projectId: string
  /** Plaintext API key, only available the moment after a mint. Anything else
   *  (page reload, navigating away and back, second visit) renders the
   *  `mushi_xxx` placeholder, with surrounding copy pointing the user to
   *  Projects → Mint key. */
  apiKey?: string | null
  /** When true, drops outer padding and the descriptive subhead so the card
   *  reads as a sub-block inside another card rather than a full section. */
  compact?: boolean
}

const POSITIONS: WidgetPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const THEMES: WidgetTheme[] = ['auto', 'light', 'dark']
const SCREENSHOT_MODES: ScreenshotMode[] = ['on-report', 'auto', 'off']

const POSITION_LABEL: Record<WidgetPosition, string> = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
}

const SCREENSHOT_LABEL: Record<ScreenshotMode, string> = {
  'on-report': 'When report opens',
  auto: 'Always',
  off: 'Never',
}

export function SdkInstallCard({ projectId, apiKey, compact }: Props) {
  const [framework, setFramework] = useState<Framework>('react')
  const [snippetCopied, setSnippetCopied] = useState(false)
  const [installCopied, setInstallCopied] = useState(false)
  const [config, setConfig] = useState<SdkPreviewConfig>(DEFAULT_SDK_CONFIG)

  const code = useMemo(() => renderSnippet(framework, projectId, apiKey, config), [framework, projectId, apiKey, config])
  const install = installCommand(framework)

  function copy(text: string, setter: (v: boolean) => void) {
    navigator.clipboard.writeText(text).then(() => {
      setter(true)
      setTimeout(() => setter(false), 2000)
    })
  }

  function reset() {
    setConfig(DEFAULT_SDK_CONFIG)
  }

  const isDefault =
    config.position === DEFAULT_SDK_CONFIG.position &&
    config.theme === DEFAULT_SDK_CONFIG.theme &&
    config.triggerText === DEFAULT_SDK_CONFIG.triggerText &&
    config.capture.console === DEFAULT_SDK_CONFIG.capture.console &&
    config.capture.network === DEFAULT_SDK_CONFIG.capture.network &&
    config.capture.performance === DEFAULT_SDK_CONFIG.capture.performance &&
    config.capture.screenshot === DEFAULT_SDK_CONFIG.capture.screenshot &&
    config.capture.elementSelector === DEFAULT_SDK_CONFIG.capture.elementSelector

  return (
    <Card className={compact ? 'p-3 space-y-4' : 'p-5 space-y-5'}>
      {!compact && (
        <div>
          <h3 className="text-sm font-semibold text-fg">Configure & install the SDK</h3>
          <p className="text-xs text-fg-muted mt-1">
            Tune the widget on the left, watch the snippet on the right update in real time, then copy it
            into your app. Your project ID is pre-filled; replace
            <code className="mx-1 px-1 py-0.5 rounded bg-surface-raised text-fg-secondary">mushi_xxx</code>
            with an API key (generate one in Projects).
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ─── LEFT COLUMN: live preview + configurator ─── */}
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-2xs text-fg-muted uppercase tracking-wider font-medium">Live preview</span>
              {!isDefault && (
                <button
                  type="button"
                  onClick={reset}
                  className="text-2xs text-fg-faint hover:text-fg-muted"
                >
                  Reset to defaults
                </button>
              )}
            </div>
            <WidgetPreview config={config} />
          </div>

          <ConfiguratorPanel config={config} onChange={setConfig} />
        </div>

        {/* ─── RIGHT COLUMN: framework picker, install, snippet ─── */}
        <div className="space-y-3">
          <div role="tablist" aria-label="Framework" className="flex items-center gap-1 border-b border-edge-subtle pb-2">
            <ConfigHelp helpId="sdk-install.framework" />
            {FRAMEWORKS.map((fw) => (
              <button
                key={fw}
                type="button"
                role="tab"
                aria-selected={framework === fw}
                onClick={() => {
                  setFramework(fw)
                  setSnippetCopied(false)
                  setInstallCopied(false)
                }}
                className={`px-2.5 py-1 rounded-sm text-xs transition-colors ${
                  framework === fw
                    ? 'bg-brand text-brand-fg font-medium'
                    : 'text-fg-muted hover:text-fg hover:bg-surface-overlay'
                }`}
              >
                {frameworkLabel(fw)}
              </button>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-2xs text-fg-muted uppercase tracking-wider font-medium">Install</span>
              <button
                type="button"
                onClick={() => copy(install, setInstallCopied)}
                className="text-2xs text-brand hover:text-brand-hover"
              >
                {installCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="bg-surface-raised border border-edge-subtle rounded-sm px-3 py-2 mt-1 text-xs font-mono text-fg-secondary overflow-x-auto whitespace-pre-wrap">
              {install}
            </pre>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-2xs text-fg-muted uppercase tracking-wider font-medium">Code</span>
              <button
                type="button"
                onClick={() => copy(code, setSnippetCopied)}
                className="text-2xs text-brand hover:text-brand-hover"
              >
                {snippetCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="bg-surface-raised border border-edge-subtle rounded-sm px-3 py-2 mt-1 text-2xs font-mono text-fg-secondary overflow-x-auto whitespace-pre-wrap max-h-72 overflow-y-auto">
              {code}
            </pre>
          </div>
        </div>
      </div>
    </Card>
  )
}

/* ── Live widget preview ─────────────────────────────────────────────── */

/**
 * A mock browser viewport that renders the bug-capture trigger button at
 * the chosen corner with the chosen theme and trigger text. We deliberately
 * do NOT instantiate the real `@mushi-mushi/web` SDK because it mounts a
 * shadow-root widget on `document.body` (would fight any real widget the
 * admin app already has, and pollute every other admin page once mounted).
 *
 * Visual styling mirrors `packages/web/src/styles.ts` — the "Mushi Mushi
 * Editorial" design language: paper background, sumi ink type, vermillion
 * stamp accent, rounded-square trigger card with a vermillion bottom edge
 * and a pulsing 朱 dot. Updating those tokens here in lockstep with the
 * widget keeps the preview honest; if the visual drifts, users will report
 * "the actual widget doesn't look like the preview".
 */
function WidgetPreview({ config }: { config: SdkPreviewConfig }) {
  const isDark =
    config.theme === 'dark' ||
    (config.theme === 'auto' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)

  // Mirror the named tokens from packages/web/src/styles.ts so the preview
  // and the real widget share a single colour story by intent, not by
  // copy-pasted hex values.
  const tokens = isDark
    ? {
        paper: '#0F0E0C',
        ink: '#F2EBDD',
        inkMuted: '#928B7E',
        rule: 'rgba(242,235,221,0.12)',
        vermillion: '#FF5A47',
        vermillionShadow: '#7A1F15',
      }
    : {
        paper: '#F8F4ED',
        ink: '#0E0D0B',
        inkMuted: '#5C5852',
        rule: 'rgba(14,13,11,0.12)',
        vermillion: '#E03C2C',
        vermillionShadow: '#9A2A1E',
      }

  const cornerPos: Record<WidgetPosition, React.CSSProperties> = {
    'top-left': { top: 10, left: 10 },
    'top-right': { top: 10, right: 10 },
    'bottom-left': { bottom: 10, left: 10 },
    'bottom-right': { bottom: 10, right: 10 },
  }

  return (
    <div
      className="relative h-44 w-full rounded-md border overflow-hidden"
      style={{
        background: tokens.paper,
        borderColor: tokens.rule,
        // Subtle paper-grain via two stacked radial gradients — costs nothing
        // and breaks the digital-flat look the previous gradient bg had.
        backgroundImage: isDark
          ? 'radial-gradient(circle at 20% 10%, rgba(255,255,255,0.02) 0%, transparent 40%), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.015) 0%, transparent 40%)'
          : 'radial-gradient(circle at 20% 10%, rgba(0,0,0,0.015) 0%, transparent 40%), radial-gradient(circle at 80% 80%, rgba(0,0,0,0.02) 0%, transparent 40%)',
      }}
      aria-label="Live preview of the bug-capture widget in your app"
    >
      {/* Faux browser chrome — kept minimal so the eye lands on the widget */}
      <div
        className="flex items-center gap-1 px-2 py-1 border-b"
        style={{
          background: isDark ? 'rgba(0,0,0,0.30)' : 'rgba(255,255,255,0.55)',
          borderColor: tokens.rule,
        }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#E06C5A' }} />
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#D4B158' }} />
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#7BA476' }} />
        <span
          className="ml-2 text-[10px]"
          style={{ color: tokens.inkMuted, fontFamily: 'ui-monospace, SF Mono, Menlo, monospace' }}
        >
          your-app.com
        </span>
      </div>

      {/* Faux page content — type sample lines, slight variation in width */}
      <div className="px-3 pt-3 space-y-1.5">
        <div className="h-2 w-2/3 rounded-sm" style={{ background: tokens.rule }} />
        <div className="h-2 w-1/2 rounded-sm" style={{ background: tokens.rule, opacity: 0.7 }} />
        <div className="h-2 w-3/4 rounded-sm" style={{ background: tokens.rule, opacity: 0.7 }} />
      </div>

      {/* Mock trigger — rounded-square paper card with vermillion bottom
          edge + pulsing 朱 dot, same materiality as the real widget. */}
      <button
        type="button"
        className="absolute flex items-center justify-center transition-transform hover:-translate-y-0.5"
        style={{
          ...cornerPos[config.position],
          height: 44,
          width: 44,
          background: tokens.paper,
          color: tokens.ink,
          border: `1px solid ${tokens.rule}`,
          borderRadius: 4,
          fontSize: 18,
          lineHeight: 1,
          fontFamily: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
          // Two-layer shadow + inset vermillion bar = the "stamp face" look
          boxShadow: `0 1px 0 ${tokens.rule}, 0 6px 12px -6px rgba(14,13,11,0.30), inset 0 -3px 0 ${tokens.vermillion}`,
        }}
        aria-label="Mock bug-capture trigger button"
        // Pure visual mock — clicking does nothing on purpose.
        onClick={(e) => e.preventDefault()}
      >
        {/* Trim BEFORE falling back, not after. Bare `||` would treat `"   "`
            as truthy and render three invisible spaces — a blank trigger button
            visually identical to the regression we just patched in widget.ts.
            The snippet generator (sdkSnippets.ts widgetLines) already trims
            before deciding whether to emit `triggerText`; this keeps the
            preview's "is this empty?" semantics IDENTICAL to the snippet's.

            Render the *original* (untrimmed) string when non-empty after trim
            — the snippet emits `JSON.stringify(cfg.triggerText)` which
            preserves leading/trailing whitespace verbatim, so a deliberate
            ` Report ` should look the same in the preview. */}
        <span aria-hidden="true">{config.triggerText.trim() ? config.triggerText : '\u{1F41B}'}</span>
        {/* Pulsing 朱 indicator dot */}
        <span
          aria-hidden="true"
          className="absolute"
          style={{
            top: 5,
            right: 5,
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: tokens.vermillion,
            boxShadow: `0 0 0 0 ${tokens.vermillion}`,
            // Inline animation name — defined in the global stylesheet via
            // a CSS string would be cleaner, but Tailwind's animate-pulse
            // is close enough and avoids a second style injection.
            animation: 'pulse 2.4s cubic-bezier(0.22, 1, 0.36, 1) infinite',
          }}
        />
      </button>

    </div>
  )
}

/* ── Configurator controls ────────────────────────────────────────────── */

function ConfiguratorPanel({
  config,
  onChange,
}: {
  config: SdkPreviewConfig
  onChange: (next: SdkPreviewConfig) => void
}) {
  function update<K extends keyof SdkPreviewConfig>(k: K, v: SdkPreviewConfig[K]) {
    onChange({ ...config, [k]: v })
  }

  function updateCapture<K extends keyof SdkPreviewConfig['capture']>(k: K, v: SdkPreviewConfig['capture'][K]) {
    onChange({ ...config, capture: { ...config.capture, [k]: v } })
  }

  return (
    <div className="space-y-3 text-2xs">
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
            className="mt-1 w-full px-2 py-1 bg-surface-raised border border-edge-subtle rounded-sm text-fg focus:outline-none focus:ring-1 focus:ring-brand"
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
            className="ml-2 px-2 py-0.5 bg-surface-raised border border-edge-subtle rounded-sm text-fg focus:outline-none focus:ring-1 focus:ring-brand"
          >
            {SCREENSHOT_MODES.map((m) => (
              <option key={m} value={m}>{SCREENSHOT_LABEL[m]}</option>
            ))}
          </select>
        </label>
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
