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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConnectionStatus } from './ConnectionStatus'
import { Card, CodeValue, SegmentedControl } from './ui'
import { apiFetch, invalidateApiCache } from '../lib/supabase'
import {
  DEFAULT_SDK_CONFIG,
  installCommand,
  isServerFramework,
  renderSnippet,
  type Framework,
  type SdkPreviewConfig,
} from '../lib/sdkSnippets'
import {
  detectWebBundler,
  REACT_SETUP_OPTIONS,
  resolveDefaultSdkFramework,
  snippetBundler,
  type ReactSetup,
} from '../lib/sdkInstallDefaults'
import { usePageData } from '../lib/usePageData'
import { fromRemoteConfig, toRemoteConfig } from './sdk-install/sdk-install-config-mappers'
import { SdkInstallConfigurator } from './sdk-install/SdkInstallConfigurator'
import { SdkInstallKeyPanel } from './sdk-install/SdkInstallKeyPanel'
import { SdkInstallPreview } from './sdk-install/SdkInstallPreview'
import { SdkInstallSnippetColumn } from './sdk-install/SdkInstallSnippetColumn'
import { HostingGuide } from './sdk-install/HostingGuide'
import type { AssistantPreviewState, RemoteSdkConfig, SdkInstallCardProps } from './sdk-install/sdk-install-types'

export function SdkInstallCard({
  projectId,
  projectSlug,
  linkedPackageJson,
  apiKey,
  keyPrefixes,
  compact,
  embedded = false,
  showConnectionStatus = false,
}: SdkInstallCardProps) {
  // The app's own package.json (its connected repo) picks the tab and, for
  // Vite or Next, an env-var snippet. Best effort: with no repo, no access or
  // a failed read the React tab asks "Next.js or Vite?" and shows the inline
  // snippet until answered. It never assumes Vite (re-audit 2026-11-11).
  const repoStack = usePageData<{ repo: string | null; packageJson: string | null; reason: string | null }>(
    projectId && !linkedPackageJson ? `/v1/admin/projects/${projectId}/github/stack` : null,
  )
  const packageJson = linkedPackageJson ?? repoStack.data?.packageJson ?? null
  const stackRepo = repoStack.data?.packageJson ? repoStack.data.repo : null
  const detectedBundler = useMemo(() => detectWebBundler(packageJson), [packageJson])
  // The user's answer wins over the repo read; null is "not asked yet".
  const [pickedSetup, setPickedSetup] = useState<ReactSetup | null>(null)
  const reactSetup: ReactSetup | null = pickedSetup ?? detectedBundler
  const detectedFramework = useMemo(
    () => resolveDefaultSdkFramework(projectSlug, packageJson),
    [projectSlug, packageJson],
  )
  const [framework, setFramework] = useState<Framework>(() => detectedFramework)
  const autoFrameworkApplied = useRef(false)
  const [config, setConfig] = useState<SdkPreviewConfig>(DEFAULT_SDK_CONFIG)
  const [savedConfig, setSavedConfig] = useState<SdkPreviewConfig>(DEFAULT_SDK_CONFIG)
  const [enabled, setEnabled] = useState(true)
  const [savedEnabled, setSavedEnabled] = useState(true)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [assistantPreview, setAssistantPreview] = useState<AssistantPreviewState>({
    enabled: false,
    label: 'Ask',
    greeting: '',
  })
  const [rotatedKey, setRotatedKey] = useState<string | null>(null)

  // NEVER bake a truncated key (e.g. `mushi_a1b2c3d4…`) into the copyable
  // snippet: it reads like a real key but fails when pasted, which was a
  // top setup-failure cause. When we don't hold the full secret in memory we
  // emit the explicit `YOUR_SDK_KEY` placeholder (renderSnippet's fallback) so
  // it's unmistakably a fill-in. The real prefix still shows in the info chip
  // above, and "Rotate key" mints + reveals a full paste-ready secret inline.
  const snippetKey = apiKey ?? rotatedKey ?? null

  const bundler = snippetBundler(framework, reactSetup)
  const askSetup = framework === 'react' && reactSetup === null
  const code = useMemo(
    () => renderSnippet(framework, projectId, snippetKey, config, projectSlug, bundler),
    [framework, projectId, snippetKey, config, projectSlug, bundler],
  )
  const install = installCommand(framework)
  const isDirty = enabled !== savedEnabled || JSON.stringify(config) !== JSON.stringify(savedConfig)

  const handleRotatedKeyChange = useCallback((key: string | null) => {
    setRotatedKey(key)
  }, [])

  const handleKeyError = useCallback((message: string) => {
    setSaveMessage(message)
  }, [])

  useEffect(() => {
    if (autoFrameworkApplied.current) return
    // 'loader' is the "unknown stack" default, not a detection: the repo read
    // can still land and name the real one (it used to test for 'react', the
    // old default, so a detected React app stayed on the Script tag).
    if (detectedFramework !== 'loader') {
      setFramework(detectedFramework)
      autoFrameworkApplied.current = true
    }
  }, [detectedFramework])

  useEffect(() => {
    let cancelled = false
    setLoadingConfig(true)
    setSaveMessage(null)
    void apiFetch<RemoteSdkConfig>(`/v1/admin/projects/${projectId}/sdk-config`).then((res) => {
      if (cancelled) return
      if (res.ok && res.data) {
        const next = fromRemoteConfig(res.data)
        setConfig(next)
        setSavedConfig(next)
        const nextEnabled = res.data.enabled !== false
        setEnabled(nextEnabled)
        setSavedEnabled(nextEnabled)
      } else {
        setSaveMessage(res.error?.message ?? 'Could not load saved SDK config')
      }
    }).finally(() => {
      if (!cancelled) setLoadingConfig(false)
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    void apiFetch<{
      enabled?: boolean
      label?: string
      greeting?: string | null
    }>(`/v1/admin/projects/${projectId}/assistant`).then((res) => {
      if (cancelled || !res.ok || !res.data) return
      setAssistantPreview({
        enabled: res.data.enabled === true,
        label: (res.data.label ?? 'Ask').trim() || 'Ask',
        greeting: (res.data.greeting ?? '').trim(),
      })
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  function reset() {
    setConfig(DEFAULT_SDK_CONFIG)
    setEnabled(true)
  }

  async function saveConfig() {
    setSavingConfig(true)
    setSaveMessage(null)
    const res = await apiFetch<RemoteSdkConfig>(`/v1/admin/projects/${projectId}/sdk-config`, {
      method: 'PUT',
      body: JSON.stringify(toRemoteConfig(config, enabled)),
    })
    setSavingConfig(false)
    if (res.ok && res.data) {
      const next = fromRemoteConfig(res.data)
      setConfig(next)
      setSavedConfig(next)
      const nextEnabled = res.data.enabled !== false
      setEnabled(nextEnabled)
      setSavedEnabled(nextEnabled)
      invalidateApiCache(`/v1/admin/projects/${projectId}/sdk-config`)
      setSaveMessage(nextEnabled
        ? 'Saved. Apps will pick this up from runtime config.'
        : 'Saved. Runtime config is disabled; apps will keep local defaults.')
    } else {
      setSaveMessage(res.error?.message ?? 'Save failed')
    }
  }

  const isDefault =
    enabled &&
    config.position === DEFAULT_SDK_CONFIG.position &&
    config.theme === DEFAULT_SDK_CONFIG.theme &&
    config.trigger === DEFAULT_SDK_CONFIG.trigger &&
    config.triggerText === DEFAULT_SDK_CONFIG.triggerText &&
    config.attachToSelector === DEFAULT_SDK_CONFIG.attachToSelector &&
    config.bannerVariant === DEFAULT_SDK_CONFIG.bannerVariant &&
    config.bannerPosition === DEFAULT_SDK_CONFIG.bannerPosition &&
    config.bannerMessage === DEFAULT_SDK_CONFIG.bannerMessage &&
    config.bannerLabel === DEFAULT_SDK_CONFIG.bannerLabel &&
    config.bannerBugCta === DEFAULT_SDK_CONFIG.bannerBugCta &&
    config.bannerFeatureCta === DEFAULT_SDK_CONFIG.bannerFeatureCta &&
    config.screenshotSensitiveHint === DEFAULT_SDK_CONFIG.screenshotSensitiveHint &&
    config.capture.console === DEFAULT_SDK_CONFIG.capture.console &&
    config.capture.network === DEFAULT_SDK_CONFIG.capture.network &&
    config.capture.performance === DEFAULT_SDK_CONFIG.capture.performance &&
    config.capture.screenshot === DEFAULT_SDK_CONFIG.capture.screenshot &&
    config.capture.elementSelector === DEFAULT_SDK_CONFIG.capture.elementSelector &&
    config.native.triggerMode === DEFAULT_SDK_CONFIG.native.triggerMode &&
    config.native.minDescriptionLength === DEFAULT_SDK_CONFIG.native.minDescriptionLength

  return (
    // Embedded call sites already sit inside a Card, so drawing our own
    // border/background there stacks two frames around the same content.
    <SdkInstallShell
      embedded={embedded}
      className={embedded ? 'space-y-4' : compact ? 'p-3 space-y-4' : 'p-5 space-y-5'}
    >
      {showConnectionStatus && (
        <div className="flex flex-wrap items-center gap-2">
          <ConnectionStatus compact />
          {/* This only checks that the console reaches the Mushi backend; it
              said it tracked the SDK heartbeat, so "All systems healthy"
              showed before any SDK was installed (QA bug 140). */}
          <span className="text-2xs text-fg-muted">
            Checks that Mushi Mushi&apos;s backend is reachable. Whether your app has checked in shows on each key
            below (&ldquo;Never used&rdquo; until it does).
          </span>
        </div>
      )}

      <SdkInstallKeyPanel
        projectId={projectId}
        projectSlug={projectSlug}
        apiKey={apiKey}
        keyPrefixes={keyPrefixes}
        onRotatedKeyChange={handleRotatedKeyChange}
        onError={handleKeyError}
        // Always rows with dividers: this card is already the frame, so a bordered keys card with
        // bordered rows inside it was three levels (round-3 review, 2026-11-19).
        flat
      />

      {!compact && (
        <div>
          <h3 className="text-sm font-semibold text-fg">Configure & install the SDK</h3>
          <p className="text-xs text-fg-muted mt-1">
            Tune the widget on the left, then copy the snippet on the right into your app.
          </p>
        </div>
      )}
      {/* Three install paths as one labelled list, not five stacked
          paragraphs (round-2 review 2026-11-18). The no-coding path leads
          (ADR 0056: Lovable / Bolt lead wherever install paths are listed). */}
      <dl
        // mushi-mushi-allowlist: label / value pairs: the label column sizes to its words
        className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 text-xs text-fg-secondary"
        data-testid="sdk-install-fast-paths"
      >
        {/* Where the key comes from, in one row, on Set up and on Connect. */}
        {!snippetKey ? (
          <>
            <dt className="font-medium text-fg">Key</dt>
            <dd className="min-w-0" data-testid="sdk-snippet-key-hint">
              Press <span className="font-medium text-fg">Make a key and fill it in</span> above; it is shown only once.
            </dd>
          </>
        ) : null}
        <dt className="font-medium text-fg">No coding</dt>
        <dd className="min-w-0">Script tag below, or Lovable / Bolt under &ldquo;Where does your app run?&rdquo;</dd>
        <dt className="font-medium text-fg">Terminal</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <CodeValue value="npx mushi-mushi" inline />
          <span className="text-fg-muted">signs you in, installs the SDK, writes your env file</span>
        </dd>
        {stackRepo && (
          <>
            <dt className="font-medium text-fg">Detected</dt>
            <dd className="min-w-0 text-fg-muted" data-testid="sdk-stack-note">
              {framework === 'react' && detectedBundler === 'vite'
                ? 'React on Vite (key from .env.local)'
                : framework === 'react' && detectedBundler === 'next'
                  ? 'React on Next.js (key from .env.local)'
                  : `${framework}, from its package.json`}{' '}
              in <span className="break-words font-mono text-fg-secondary">{stackRepo}</span>
            </dd>
          </>
        )}
      </dl>

      <div className="@container/sdk">
      {/* Compact (setup): snippet first, one column, widget settings folded
          away; the defaults work, so minute two is one copy, not 14 choices. */}
      <div className={`grid gap-4 ${isServerFramework(framework) || compact ? '' : '@2xl/sdk:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'}`}>
        {/* ─── LEFT COLUMN: live preview + configurator ─── */}
        {/* Hidden for server frameworks — the widget only runs in browsers. */}
        {isServerFramework(framework) ? (
          <SdkInstallShell embedded={embedded} className={`${embedded ? '' : 'px-4 py-3 '}text-xs text-fg-secondary leading-relaxed`}>
            <p className="font-medium text-fg mb-1">Server-side capture</p>
            <p>
              <code className="px-1 py-0.5 rounded-sm bg-surface-overlay font-mono">mushi-mushi/node</code>{' '}
              runs in Node 18+ (and edge runtimes). It captures uncaught exceptions, unhandled rejections,
              and 5xx errors — no browser widget needed. Reports land in the same inbox as user-submitted bugs,
              so your team sees server and client failures in one queue.
            </p>
            <p className="mt-2">
              Add <code className="px-1 py-0.5 rounded-sm bg-surface-overlay font-mono">MUSHI_PROJECT_ID</code> and{' '}
              <code className="px-1 py-0.5 rounded-sm bg-surface-overlay font-mono">MUSHI_API_KEY</code> to your
              deployment env. Copy the snippet on the right into your instrumentation file.
            </p>
          </SdkInstallShell>
        ) : (
        <WidgetCustomizeColumn compact={compact}>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-2xs text-fg-secondary font-semibold">Preview: press the button to try it</span>
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
            <SdkInstallPreview config={config} assistant={assistantPreview} />
          </div>

          <SdkInstallConfigurator
            config={config}
            enabled={enabled}
            framework={framework}
            onEnabledChange={setEnabled}
            onChange={setConfig}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-2xs text-fg-faint">
              {loadingConfig ? 'Loading saved config…' : saveMessage ?? 'Saved config is served to SDKs at startup.'}
            </p>
            <button
              type="button"
              onClick={saveConfig}
              disabled={!isDirty || savingConfig || loadingConfig}
              className={`px-2.5 py-1 rounded-sm text-2xs font-medium transition-opacity ${
                isDirty && !savingConfig && !loadingConfig
                  ? 'bg-brand text-brand-fg hover:bg-brand-hover'
                  : 'bg-surface-raised text-fg-faint cursor-not-allowed'
              }`}
            >
              {savingConfig ? 'Saving…' : isDirty ? 'Save config' : 'Saved'}
            </button>
          </div>
        </WidgetCustomizeColumn>
        )}

        {/* ─── RIGHT COLUMN: framework picker, install, snippet ─── */}
        <div className={compact ? 'order-first' : undefined}>
        <SdkInstallSnippetColumn
          framework={framework}
          onFrameworkChange={setFramework}
          autoFrameworkApplied={autoFrameworkApplied}
          code={code}
          install={install}
          belowTabs={
            framework === 'react' ? (
              <div className="space-y-1" data-testid="sdk-react-setup">
                <p className="text-xs text-fg-secondary">
                  <span className="font-medium text-fg">Which React setup?</span>{' '}
                  {askSetup
                    ? 'Next.js and Vite read your key from differently named values. Pick yours and the code below changes to match.'
                    : reactSetup === 'other'
                      ? 'The code below holds your project and key itself.'
                      : `The code below reads ${reactSetup === 'next' ? 'NEXT_PUBLIC_' : 'VITE_'}MUSHI_… values from .env.local.`}
                </p>
                <SegmentedControl<ReactSetup>
                  value={reactSetup ?? ('' as ReactSetup)}
                  options={REACT_SETUP_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
                  onChange={setPickedSetup}
                  ariaLabel="React setup"
                  size="sm"
                  wrap
                />
              </div>
            ) : null
          }
        />
        {!isServerFramework(framework) && (
          <HostingGuide
            projectId={projectId}
            apiKey={snippetKey}
            bundler={bundler}
            askSetup={askSetup}
            scriptTag={framework === 'loader'}
            onUseScriptTag={() => {
              autoFrameworkApplied.current = true
              setFramework('loader')
            }}
          />
        )}
        </div>
      </div>
      </div>
    </SdkInstallShell>
  )
}

/** Card root standalone; bare div when the caller already owns the frame. */
function SdkInstallShell({
  embedded,
  className,
  children,
}: {
  embedded: boolean
  className: string
  children: React.ReactNode
}) {
  if (embedded) return <div className={className}>{children}</div>
  return <Card className={className}>{children}</Card>
}

/** The widget preview and settings: a closed disclosure on setup, a column elsewhere. */
function WidgetCustomizeColumn({ compact, children }: { compact?: boolean; children: React.ReactNode }) {
  if (!compact) return <div className="space-y-3">{children}</div>
  return (
    <details className="group rounded-sm border border-edge-subtle">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs text-fg-secondary hover:text-fg">
        Customize the report button (optional, the defaults work)
      </summary>
      <div className="space-y-3 border-t border-edge-subtle p-3">{children}</div>
    </details>
  )
}
