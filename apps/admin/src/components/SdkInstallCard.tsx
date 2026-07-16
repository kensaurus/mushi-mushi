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
import { Card } from './ui'
import { apiFetch, invalidateApiCache } from '../lib/supabase'
import {
  DEFAULT_SDK_CONFIG,
  installCommand,
  isServerFramework,
  renderSnippet,
  type Framework,
  type SdkPreviewConfig,
} from '../lib/sdkSnippets'
import { resolveDefaultSdkFramework } from '../lib/sdkInstallDefaults'
import { fromRemoteConfig, toRemoteConfig } from './sdk-install/sdk-install-config-mappers'
import { SdkInstallConfigurator } from './sdk-install/SdkInstallConfigurator'
import { SdkInstallKeyPanel } from './sdk-install/SdkInstallKeyPanel'
import { SdkInstallPreview } from './sdk-install/SdkInstallPreview'
import { SdkInstallSnippetColumn } from './sdk-install/SdkInstallSnippetColumn'
import type { AssistantPreviewState, RemoteSdkConfig, SdkInstallCardProps } from './sdk-install/sdk-install-types'

export function SdkInstallCard({
  projectId,
  projectSlug,
  linkedPackageJson,
  apiKey,
  keyPrefixes,
  compact,
  showConnectionStatus = false,
}: SdkInstallCardProps) {
  const detectedFramework = useMemo(
    () => resolveDefaultSdkFramework(projectSlug, linkedPackageJson),
    [projectSlug, linkedPackageJson],
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
  // emit the explicit `mushi_xxx` placeholder (renderSnippet's fallback) so
  // it's unmistakably a fill-in. The real prefix still shows in the info chip
  // above, and "Rotate key" mints + reveals a full paste-ready secret inline.
  const snippetKey = apiKey ?? rotatedKey ?? null

  const code = useMemo(
    () => renderSnippet(framework, projectId, snippetKey, config, projectSlug),
    [framework, projectId, snippetKey, config, projectSlug],
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
    if (detectedFramework !== 'react') {
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
    <Card className={compact ? 'p-3 space-y-4' : 'p-5 space-y-5'}>
      {showConnectionStatus && (
        <div className="flex flex-wrap items-center gap-2">
          <ConnectionStatus compact />
          <span className="text-2xs text-fg-muted">Shows ✓ when the SDK heartbeat or first report lands.</span>
        </div>
      )}

      <SdkInstallKeyPanel
        projectId={projectId}
        projectSlug={projectSlug}
        apiKey={apiKey}
        keyPrefixes={keyPrefixes}
        onRotatedKeyChange={handleRotatedKeyChange}
        onError={handleKeyError}
      />

      {!compact && (
        <div>
          <h3 className="text-sm font-semibold text-fg">Configure & install the SDK</h3>
          <p className="text-xs text-fg-muted mt-1">
            Tune the widget on the left, watch the snippet on the right update in real time, then copy it
            into your app. Your project ID is pre-filled. If the snippet still shows
            <code className="mx-1 px-1 py-0.5 rounded bg-surface-raised text-fg-secondary">mushi_xxx</code>,
            click <span className="font-medium text-fg-secondary">Mint SDK key</span> above and the real
            key fills in automatically.
          </p>
        </div>
      )}

      <div className="@container/sdk">
      <div className={`grid gap-4 ${isServerFramework(framework) ? '' : '@2xl/sdk:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'}`}>
        {/* ─── LEFT COLUMN: live preview + configurator ─── */}
        {/* Hidden for server frameworks — the widget only runs in browsers. */}
        {isServerFramework(framework) ? (
          <Card  className="px-4 py-3 text-2xs text-fg-secondary leading-relaxed">
            <p className="font-medium text-fg mb-1">Server-side capture</p>
            <p>
              <code className="px-1 py-0.5 rounded-sm bg-surface-overlay font-mono">@mushi-mushi/node</code>{' '}
              runs in Node 18+ (and edge runtimes). It captures uncaught exceptions, unhandled rejections,
              and 5xx errors — no browser widget needed. Reports land in the same inbox as user-submitted bugs,
              so your team sees server and client failures in one queue.
            </p>
            <p className="mt-2">
              Add <code className="px-1 py-0.5 rounded-sm bg-surface-overlay font-mono">MUSHI_PROJECT_ID</code> and{' '}
              <code className="px-1 py-0.5 rounded-sm bg-surface-overlay font-mono">MUSHI_API_KEY</code> to your
              deployment env. Copy the snippet on the right into your instrumentation file.
            </p>
          </Card>
        ) : (
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
        </div>
        )}

        {/* ─── RIGHT COLUMN: framework picker, install, snippet ─── */}
        <SdkInstallSnippetColumn
          framework={framework}
          onFrameworkChange={setFramework}
          autoFrameworkApplied={autoFrameworkApplied}
          code={code}
          install={install}
        />
      </div>
      </div>
    </Card>
  )
}
