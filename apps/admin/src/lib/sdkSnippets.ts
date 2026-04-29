/**
 * FILE: apps/admin/src/lib/sdkSnippets.ts
 * PURPOSE: Single source of truth for the per-framework `npm install` + init
 *          snippet shown by the bug-capture web SDK install affordance and
 *          the live configurator. Lives in lib/ (not in any one page) because
 *          the same snippets render in four places — Onboarding Card 4,
 *          ProjectsPage per-project, Settings → Health, and McpPage — and we
 *          want copy/version drift between them to be impossible by
 *          construction.
 *
 *          The shape mirrors the real `MushiWidgetConfig` + `MushiCaptureConfig`
 *          interfaces in `packages/core/src/types.ts`. If those grow new
 *          options, mirror them here so the configurator stays honest.
 */

/** Mirror of `MushiWidgetConfig.position` from packages/core. */
export type WidgetPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

/** Mirror of `MushiWidgetConfig.theme`. */
export type WidgetTheme = 'auto' | 'light' | 'dark'

/** Mirror of `MushiWidgetConfig.trigger`. */
export type WidgetTrigger = 'auto' | 'edge-tab' | 'attach' | 'manual' | 'hidden'

/** Mirror of `MushiCaptureConfig.screenshot`. */
export type ScreenshotMode = 'on-report' | 'auto' | 'off'

/**
 * Options the configurator UI exposes. A subset of the full SDK config —
 * we expose what a typical first-time integrator wants to tune visually.
 * Everything else (zIndex, locale, replay, proactive triggers) is left to
 * code-level configuration so the preview stays focused.
 */
export interface SdkPreviewConfig {
  position: WidgetPosition
  theme: WidgetTheme
  trigger: WidgetTrigger
  triggerText: string
  capture: {
    console: boolean
    network: boolean
    performance: boolean
    screenshot: ScreenshotMode
    elementSelector: boolean
  }
  native: {
    triggerMode: 'shake' | 'button' | 'both' | 'none'
    minDescriptionLength: number
  }
}

/** Defaults match `MushiWidget` constructor defaults in packages/web/src/widget.ts
 *  so a zero-config user sees the same widget the snippet describes. */
export const DEFAULT_SDK_CONFIG: SdkPreviewConfig = {
  position: 'bottom-right',
  theme: 'auto',
  trigger: 'auto',
  triggerText: '\u{1F41B}',
  capture: {
    console: true,
    network: true,
    performance: false,
    screenshot: 'on-report',
    elementSelector: false,
  },
  native: {
    triggerMode: 'both',
    minDescriptionLength: 20,
  },
}

/**
 * Order matters — this is the tab strip order in `SdkInstallCard`. Web
 * frameworks come first (most users), then mobile (RN / Expo / Capacitor),
 * then the vanilla escape hatch last.
 */
export const FRAMEWORKS = [
  'react',
  'vue',
  'svelte',
  'react-native',
  'expo',
  'capacitor',
  'vanilla',
] as const
export type Framework = (typeof FRAMEWORKS)[number]

/**
 * Frameworks that ship a native runtime (mobile / hybrid). Used by the
 * configurator to (a) hide the web-only "screenshot" / "elementSelector"
 * controls that don't apply, and (b) route the configured `native.triggerMode`
 * into the snippet instead of the `widget.trigger` web mapping.
 */
export const MOBILE_FRAMEWORKS = ['react-native', 'expo', 'capacitor'] as const
export type MobileFramework = (typeof MOBILE_FRAMEWORKS)[number]

export function isMobileFramework(fw: Framework): fw is MobileFramework {
  return (MOBILE_FRAMEWORKS as readonly string[]).includes(fw)
}

export const API_KEY_PLACEHOLDER = 'mushi_xxx'

export function frameworkLabel(fw: Framework): string {
  if (fw === 'vanilla') return 'Vanilla JS'
  if (fw === 'react-native') return 'React Native'
  if (fw === 'capacitor') return 'Capacitor'
  return fw.charAt(0).toUpperCase() + fw.slice(1)
}

/** The `npm install` command for the chosen framework.
 *  - Web adapters (Vue / Svelte) ship as a thin layer that depends on
 *    @mushi-mushi/web for the actual capture runtime, so we install both.
 *  - React bundles its own runtime in @mushi-mushi/react.
 *  - Mobile (react-native / expo / capacitor) ships the native runtime in a
 *    dedicated package — no @mushi-mushi/web on top, the web SDK doesn't run
 *    in those environments. Capacitor users on the WebView can additionally
 *    add @mushi-mushi/web (covered in the docs migration guide). */
export function installCommand(fw: Framework): string {
  if (fw === 'react') return 'npm install @mushi-mushi/react'
  if (fw === 'vanilla') return 'npm install @mushi-mushi/web'
  if (fw === 'react-native') return 'npm install @mushi-mushi/react-native'
  if (fw === 'expo') return 'npx expo install @mushi-mushi/react-native expo-sensors'
  if (fw === 'capacitor') return 'npm install @mushi-mushi/capacitor && npx cap sync'
  return `npm install @mushi-mushi/${fw} @mushi-mushi/web`
}

/* ── Snippet rendering ──────────────────────────────────────────────────
   We build the config object as a string of TS-ish key:value lines so the
   output reads like hand-written code (no JSON.stringify pretty-printing
   noise like quoted keys). Lines are emitted only when the value differs
   from the default — that way a user who keeps every default sees a clean
   one-liner snippet, while someone tweaking three options gets exactly
   three extra lines. */

function captureLines(c: SdkPreviewConfig['capture'], indent: string): string {
  const d = DEFAULT_SDK_CONFIG.capture
  const lines: string[] = []
  if (c.console !== d.console) lines.push(`${indent}  console: ${c.console},`)
  if (c.network !== d.network) lines.push(`${indent}  network: ${c.network},`)
  if (c.performance !== d.performance) lines.push(`${indent}  performance: ${c.performance},`)
  if (c.screenshot !== d.screenshot) lines.push(`${indent}  screenshot: '${c.screenshot}',`)
  if (c.elementSelector !== d.elementSelector) lines.push(`${indent}  elementSelector: ${c.elementSelector},`)
  if (lines.length === 0) return ''
  return `${indent}capture: {\n${lines.join('\n')}\n${indent}},\n`
}

function widgetLines(cfg: SdkPreviewConfig, indent: string): string {
  const d = DEFAULT_SDK_CONFIG
  const lines: string[] = []
  if (cfg.position !== d.position) lines.push(`${indent}  position: '${cfg.position}',`)
  if (cfg.theme !== d.theme) lines.push(`${indent}  theme: '${cfg.theme}',`)
  if (cfg.trigger !== d.trigger) lines.push(`${indent}  trigger: '${cfg.trigger}',`)
  // Empty / whitespace-only input means "I cleared the box" — the preview
  // already falls back to the default 🐛 in that case (see SdkInstallCard's
  // `config.triggerText.trim() ? config.triggerText : '\u{1F41B}'`, which
  // uses the SAME trim-then-fallback rule as the line below). Emitting
  // `triggerText: ""` here would break the WYSIWYG promise: the SDK
  // constructor used to take that empty string verbatim and render an
  // invisible trigger button. Treat empty as "unset" so what users see
  // is what they get.
  //
  // We compare the trimmed value to the default but emit the ORIGINAL
  // (untrimmed) string via JSON.stringify, so a deliberate ` Report `
  // round-trips exactly — preview, snippet, and SDK all preserve the
  // surrounding whitespace.
  if (cfg.triggerText.trim() && cfg.triggerText !== d.triggerText) {
    lines.push(`${indent}  triggerText: ${JSON.stringify(cfg.triggerText)},`)
  }
  if (lines.length === 0) return ''
  return `${indent}widget: {\n${lines.join('\n')}\n${indent}},\n`
}

/** Build the per-framework init snippet with the chosen config baked in.
 *  Pass `cfg = DEFAULT_SDK_CONFIG` (or omit) to get the minimal one-liner
 *  shape; pass any tweaks and they appear inline in the generated code. */
export function renderSnippet(
  fw: Framework,
  projectId: string,
  apiKey?: string | null,
  cfg: SdkPreviewConfig = DEFAULT_SDK_CONFIG,
): string {
  const key = apiKey || API_KEY_PLACEHOLDER

  if (fw === 'react') {
    const innerIndent = '      '
    const widget = widgetLines(cfg, innerIndent)
    const capture = captureLines(cfg.capture, innerIndent)
    const extras = `${widget}${capture}`
    return `import { MushiProvider } from '@mushi-mushi/react'

function App() {
  return (
    <MushiProvider config={{
      projectId: '${projectId}',
      apiKey: '${key}',
${extras}    }}>
      <YourApp />
    </MushiProvider>
  )
}`
  }

  // Vanilla — single Mushi.init() call carries the entire config.
  if (fw === 'vanilla') {
    const innerIndent = '  '
    const widget = widgetLines(cfg, innerIndent)
    const capture = captureLines(cfg.capture, innerIndent)
    const extras = `${widget}${capture}`
    return `import { Mushi } from '@mushi-mushi/web'

Mushi.init({
  projectId: '${projectId}',
  apiKey: '${key}',
${extras}})`
  }

  /* Vue / Svelte — TWO init calls, both required.
   *
   *   1. The framework adapter (MushiPlugin / initMushi) only wires up the
   *      composables + framework-level error handler. Its config interface is
   *      narrow: { projectId, apiKey, endpoint? } — anything else is silently
   *      dropped. See packages/vue/src/index.ts:14 and packages/svelte/src/index.ts:12.
   *
   *   2. The actual visual bug-capture widget (the floating trigger button +
   *      submission modal + console/network capture) lives in
   *      @mushi-mushi/web and is mounted by Mushi.init(). The Vue and Svelte
   *      adapters explicitly DO NOT mount any UI — packages/vue/src/index.ts:87
   *      says so out loud.
   *
   *  Earlier versions of these snippets passed widget/capture to the adapter
   *  and forgot Mushi.init() entirely, so users got no widget at all and
   *  every configurator setting was silently dropped. Don't regress this:
   *  always emit both calls, and route widget/capture through Mushi.init().
   *
   *  We always emit the long form (even for default config) because hiding
   *  the second import behind a "you only see it sometimes" code path is the
   *  exact thing that caused the original bug. Better to be a few lines
   *  longer and unambiguous. */
  const innerIndent = '  '
  const widget = widgetLines(cfg, innerIndent)
  const capture = captureLines(cfg.capture, innerIndent)
  const hasExtras = widget.length > 0 || capture.length > 0
  const extras = `${widget}${capture}`

  // Build the Mushi.init(...) body. Spread the credentials so it's obvious
  // both calls share the same projectId/apiKey, then layer on any tweaks.
  const mushiInitBody = hasExtras
    ? `{
  ...credentials,
${extras}}`
    : `credentials`

  if (fw === 'vue') {
    return `import { MushiPlugin } from '@mushi-mushi/vue'
import { Mushi } from '@mushi-mushi/web'

const credentials = { projectId: '${projectId}', apiKey: '${key}' }

// Vue plugin: provides useMushi() composable + global Vue errorHandler.
app.use(MushiPlugin, credentials)

// @mushi-mushi/web: mounts the visual bug-capture widget (floating button + modal).
// All widget/capture options go here — the Vue plugin doesn't render UI.
Mushi.init(${mushiInitBody})`
  }

  if (fw === 'svelte') {
    return `import { initMushi } from '@mushi-mushi/svelte'
import { Mushi } from '@mushi-mushi/web'

const credentials = { projectId: '${projectId}', apiKey: '${key}' }

// Svelte adapter: getMushi() / createMushiErrorHandler() for SvelteKit.
initMushi(credentials)

// @mushi-mushi/web: mounts the visual bug-capture widget (floating button + modal).
// All widget/capture options go here — the Svelte adapter doesn't render UI.
Mushi.init(${mushiInitBody})`
  }

  /* ── Mobile / hybrid ─────────────────────────────────────────────────
   * React Native, Expo (bare or managed-with-dev-client), and Capacitor
   * ship through dedicated native runtimes. They use a different config
   * shape than the web SDK — `widget.trigger` accepts the same `'shake'`
   * vocabulary but the rest of the config lives under `widget` / `capture`
   * in RN/Expo and under top-level keys (`triggerMode`, `captureScreenshot`)
   * in Capacitor.
   *
   * We surface ONLY the options the configurator's `native` block exposes
   * (trigger mode, min description length) plus the `console`/`network`
   * capture toggles where they map cleanly. Screenshot/elementSelector are
   * silently ignored on mobile because the RN package doesn't yet ship a
   * native screenshot path (tracked in the migration guide). */

  if (fw === 'react-native' || fw === 'expo') {
    /* `MushiRNConfig.widget.trigger` accepts 'shake' | 'button' | 'both' |
     * 'manual' | 'auto' | 'edge-tab' | 'hidden' | 'attach' — but NOT 'none'.
     * The web SDK canonicalises the same way in
     * packages/web/src/mushi.ts:mergeRuntimeConfig (`nativeTrigger ===
     * 'none' → widget.trigger = 'manual'`). Mirror that here so a user who
     * picks "none" in the configurator gets a snippet that actually
     * type-checks against @mushi-mushi/react-native instead of one TS
     * silently rejects. */
    const trigger = cfg.native.triggerMode === 'none' ? 'manual' : cfg.native.triggerMode
    const widgetExtras: string[] = []
    if (trigger !== 'both') widgetExtras.push(`        trigger: '${trigger}',`)

    const captureExtras: string[] = []
    if (!cfg.capture.console) captureExtras.push(`        console: false,`)
    if (!cfg.capture.network) captureExtras.push(`        network: false,`)

    const blocks: string[] = []
    if (widgetExtras.length > 0) {
      blocks.push(`      widget: {\n${widgetExtras.join('\n')}\n      },`)
    }
    if (captureExtras.length > 0) {
      blocks.push(`      capture: {\n${captureExtras.join('\n')}\n      },`)
    }
    const configProp = blocks.length > 0 ? `\n      config={{\n${blocks.join('\n')}\n      }}` : ''

    const expoNote =
      fw === 'expo'
        ? `// Expo: works on bare workflow OR managed with a dev client.
// 'shake' trigger uses expo-sensors (already added via 'npx expo install').

`
        : `// React Native CLI: 'shake' trigger needs expo-sensors:
//   npx install-expo-modules@latest && npm install expo-sensors

`

    return `${expoNote}import { MushiProvider } from '@mushi-mushi/react-native'

export default function App() {
  return (
    <MushiProvider
      projectId="${projectId}"
      apiKey="${key}"${configProp}
    >
      <YourApp />
    </MushiProvider>
  )
}`
  }

  // capacitor
  /* `MushiTriggerMode = 'shake' | 'button' | 'both' | 'none'` (see
   * packages/capacitor/src/definitions.ts) — 'none' IS a valid value and
   * means "don't auto-trigger anything". The plugin's runtime default is
   * 'shake', so we omit the line for 'shake' (implicit default) but emit
   * every other value explicitly — including 'none'. The previous version
   * coerced 'none' → null and then dropped the line, which silently flipped
   * the user's "no auto-trigger" choice into shake-to-report at runtime. */
  const triggerMode = cfg.native.triggerMode
  const capScreenshot = cfg.capture.screenshot !== 'off'
  const capLines: string[] = [
    `  projectId: '${projectId}',`,
    `  apiKey: '${key}',`,
  ]
  if (triggerMode !== 'shake') capLines.push(`  triggerMode: '${triggerMode}',`)
  if (!capScreenshot) capLines.push(`  captureScreenshot: false,`)
  if (cfg.native.minDescriptionLength !== DEFAULT_SDK_CONFIG.native.minDescriptionLength) {
    capLines.push(`  minDescriptionLength: ${cfg.native.minDescriptionLength},`)
  }

  return `// In your Capacitor app's bootstrap (e.g. src/main.ts).
// After install, run:  npx cap sync
import { Mushi } from '@mushi-mushi/capacitor'

await Mushi.configure({
${capLines.join('\n')}
})`
}
