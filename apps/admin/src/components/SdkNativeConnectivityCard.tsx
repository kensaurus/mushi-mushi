/**
 * FILE: apps/admin/src/components/SdkNativeConnectivityCard.tsx
 * PURPOSE: Diagnose and one-click-fix "SDK CI secrets missing — banner disabled
 *          in downloaded app" — the exact class of misconfiguration that caused
 *          the glot.it Capacitor banner to never appear in Play/App Store builds.
 *
 * Data flow:
 *   1. Fetches GET /v1/admin/projects/:id/sdk-diagnostics (authoritative CI check
 *      + heartbeat telemetry + config flags) on mount.
 *   2. Shows a status badge (healthy / ci-secret-missing / native-never-seen /
 *      banner-disabled / unknown).
 *   3. Primary CTA: POST /v1/admin/projects/:id/sync-ci-secrets — mints a fresh
 *      project-scoped API key and writes the required env vars into GitHub
 *      Actions as secrets/variables via the sealed-box flow.
 *   4. Fallback CTA: shows copy-pastable `gh secret set` / `gh variable set`
 *      commands when no GitHub token is available (or when GitHub returns 403).
 *   5. Always surfaces the freshly-minted raw API key once so the user can save
 *      it manually.
 *
 * Used by: ConnectPage (native CI section)
 */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Btn, Tooltip, CopyButton } from './ui'
import { IconAlertTriangle, IconCheck, IconGit, IconKey, IconRefresh } from './icons'
import { apiFetch } from '../lib/supabase'
import { useCiSecretSync } from '../lib/useCiSecretSync'
import { sdkCiStatusMeta, type SdkDiagnosticsResult, type SdkDiagnosticStatus } from '../lib/sdkCiSecrets'
import { mushiEnvVarsForProjectSlug } from '../lib/projectMushiEnv'

// ---------------------------------------------------------------------------
// Status visual helpers
// ---------------------------------------------------------------------------

const STATUS_ICON: Record<SdkDiagnosticStatus, React.ReactNode> = {
  healthy: <IconCheck className="h-4 w-4 text-ok shrink-0" aria-hidden />,
  'ci-secret-missing': <IconAlertTriangle className="h-4 w-4 text-[var(--color-error-foreground)] shrink-0" aria-hidden />,
  'native-never-seen': <IconAlertTriangle className="h-4 w-4 text-warn shrink-0" aria-hidden />,
  'banner-disabled': <IconAlertTriangle className="h-4 w-4 text-warn shrink-0" aria-hidden />,
  unknown: <IconRefresh className="h-4 w-4 text-fg-muted shrink-0" aria-hidden />,
}

const STATUS_CHIP_CLASS: Record<SdkDiagnosticStatus, string> = {
  healthy: 'bg-ok/10 text-ok border-ok/25',
  'ci-secret-missing': 'bg-danger/10 text-[var(--color-error-foreground)] border-danger/25',
  'native-never-seen': 'bg-warn/10 text-warn border-warn/25',
  'banner-disabled': 'bg-warn/10 text-warn border-warn/25',
  unknown: 'bg-surface-overlay text-fg-muted border-edge-subtle',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SdkNativeConnectivityCardProps {
  projectId: string
  projectSlug?: string | null
}

export function SdkNativeConnectivityCard({ projectId, projectSlug }: SdkNativeConnectivityCardProps) {
  const [diag, setDiag] = useState<SdkDiagnosticsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [showFallback, setShowFallback] = useState(false)
  const [showRawKey, setShowRawKey] = useState(false)
  const [showPlaybook, setShowPlaybook] = useState(false)
  const diagRef = useRef(false)

  const { state: syncState, sync, reset } = useCiSecretSync(projectId)

  // Fetch diagnostics on mount + after a successful sync.
  useEffect(() => {
    if (diagRef.current) return
    diagRef.current = true

    let cancelled = false
    async function load() {
      setLoading(true)
      setFetchError(null)
      const res = await apiFetch<SdkDiagnosticsResult>(`/v1/admin/projects/${projectId}/sdk-diagnostics`)
      if (cancelled) return
      if (res.ok && res.data) {
        setDiag(res.data)
      } else {
        setFetchError(res.error?.message ?? 'Failed to load diagnostics.')
      }
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
      // Reset so re-mounts (StrictMode double-invoke, projectId changes) can re-fetch.
      diagRef.current = false
    }
  }, [projectId])

  // Re-fetch after a successful sync so the status updates.
  const prevSyncStatus = useRef(syncState.status)
  useEffect(() => {
    const prev = prevSyncStatus.current
    prevSyncStatus.current = syncState.status
    if (prev !== 'idle' && (syncState.status === 'ok' || syncState.status === 'partial')) {
      diagRef.current = false
      setLoading(true)
      apiFetch<SdkDiagnosticsResult>(`/v1/admin/projects/${projectId}/sdk-diagnostics`).then((res) => {
        if (res.ok && res.data) setDiag(res.data)
        setLoading(false)
      })
    }
  }, [syncState.status, projectId])

  const envVars = mushiEnvVarsForProjectSlug(projectSlug)
  const status: SdkDiagnosticStatus = diag?.status ?? 'unknown'
  const meta = sdkCiStatusMeta(status, diag?.hasGithubToken ?? false, projectSlug, {
    nativeEverSeen: diag?.nativeEverSeen ?? false,
    launcherMode: diag?.launcherMode ?? null,
  })

  // Determine fallback commands to display (from sync result or diag).
  const fallback = syncState.fallback ?? null
  const minted = syncState.rawKey ? { rawKey: syncState.rawKey, prefix: syncState.keyPrefix } : null

  const isSyncing = syncState.status === 'syncing'
  const syncDone = syncState.status === 'ok' || syncState.status === 'partial'
  const syncFailed = ['forbidden', 'no-repo', 'failed'].includes(syncState.status)

  return (
    <Card>
      <div className="p-4 space-y-4">
        {/* Header — dynamic headline matches SdkHealthSummary voice */}
        <div className="flex flex-wrap items-start gap-3">
          <IconGit className="h-5 w-5 text-fg-muted shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0 flex-1 space-y-1">
            {!loading && diag ? (
              <>
                <p className="text-sm font-medium text-fg">{meta.headline}</p>
                <p className="text-xs text-fg-muted">{meta.subtitle}</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-fg">Checking native build setup…</p>
                <p className="text-xs text-fg-muted">
                  Verifying GitHub Actions secrets for{' '}
                  <span className="font-medium">{envVars.stackLabel}</span> builds.{' '}
                  <a
                    href="https://docs.mushi-mushi.dev/sdks"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    Docs →
                  </a>
                </p>
              </>
            )}
          </div>
          {!loading && diag && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium shrink-0 ${STATUS_CHIP_CLASS[status]}`}
              role="status"
            >
              {STATUS_ICON[status]}
              {meta.chipLabel}
            </span>
          )}
          {loading && (
            <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted shrink-0" aria-busy="true">
              <span className="h-3 w-3 shrink-0 rounded-full border-2 border-current/30 border-t-current motion-safe:animate-spin" aria-hidden />
              Checking…
            </span>
          )}
        </div>

        {/* Error state */}
        {fetchError && !loading && (
          <p className="text-xs text-[var(--color-error-foreground)]">{fetchError}</p>
        )}

        {/* Diagnosis detail — missing vars only; playbook holds fix steps */}
        {!loading && diag && status !== 'healthy' && diag.missingVars && diag.missingVars.length > 0 && (
          <div className="rounded-sm border border-edge-subtle/60 bg-surface-overlay/40 p-3 text-xs space-y-1.5">
            <p className="text-fg-muted">Missing from GitHub Actions:</p>
            <ul className="space-y-0.5">
              {diag.missingVars.map((v) => (
                <li key={v}>
                  <code className="font-mono text-2xs text-[var(--color-error-foreground)] bg-danger/5 rounded px-1 py-0.5">
                    {v}
                  </code>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!loading && diag && meta.playbookSteps.length > 0 && status !== 'healthy' && (
          <div className="space-y-2">
            <button
              type="button"
              className="flex w-full items-center gap-1.5 text-xs font-medium text-fg-secondary hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              onClick={() => setShowPlaybook((v) => !v)}
              aria-expanded={showPlaybook}
            >
              <span className="font-mono text-fg-faint" aria-hidden>{showPlaybook ? '▴' : '▾'}</span>
              How to fix
            </button>
            {showPlaybook && (
              <ol className="list-decimal pl-4 space-y-1.5 text-2xs text-fg-secondary">
                {meta.playbookSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            )}
          </div>
        )}

        {/* Healthy summary */}
        {!loading && diag && status === 'healthy' && (
          <div className="flex items-center gap-2 rounded-sm border border-ok/20 bg-ok/5 px-3 py-2 text-xs text-ok">
            <IconCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{meta.subtitle}</span>
          </div>
        )}

        {/* Sync result */}
        {syncDone && (
          <div className="rounded-sm border border-ok/20 bg-ok/5 px-3 py-2 text-xs text-ok space-y-1">
            <p className="font-medium">
              {syncState.written && syncState.written.length > 0
                ? `Written to GitHub: ${syncState.written.join(', ')}`
                : 'Sync complete (all vars already present or written).'}
            </p>
            {syncState.failed && syncState.failed.length > 0 && (
              <p className="text-warn">
                Partial: {syncState.failed.map((f) => f.name).join(', ')} could not be written.
                Use the copy commands below.
              </p>
            )}
          </div>
        )}

        {/* Forbidden / no-repo result → show guided fallback */}
        {(syncFailed) && syncState.errorMessage && (
          <div className="rounded-sm border border-warn/20 bg-warn/5 px-3 py-2 text-xs text-warn">
            <p className="font-medium">
              {syncState.errorCode === 'GH_SECRETS_FORBIDDEN'
                ? 'GitHub returned 403 — write permission denied.'
                : syncState.errorCode === 'NO_GITHUB_REPO' || syncState.errorCode === 'GH_NO_TOKEN'
                  ? 'No GitHub repo or token configured for this project.'
                  : syncState.errorMessage}
            </p>
            {syncState.errorCode === 'GH_SECRETS_FORBIDDEN' && (
              <p className="mt-1 text-fg-muted">
                Auto-write requires a fine-grained PAT with{' '}
                <strong className="font-medium">Actions secrets: Read and write</strong> stored in
                project Settings → GitHub. The Mushi GitHub App only has{' '}
                <code className="font-mono">Contents: write</code> and{' '}
                <code className="font-mono">Pull requests: write</code> — it does not have{' '}
                <code className="font-mono">Secrets: write</code>. To enable true auto-write, either
                add a fine-grained PAT in{' '}
                <strong className="font-medium">Settings → GitHub connection</strong>, or use the
                manual commands below.
              </p>
            )}
            {syncState.errorCode !== 'GH_SECRETS_FORBIDDEN' && (
              <p className="mt-1 text-fg-muted">
                Use the manual commands below to set secrets in your terminal.
              </p>
            )}
          </div>
        )}

        {/* Freshly minted key — show once */}
        {minted && (
          <div className="rounded-sm border border-edge-subtle/60 bg-surface-overlay/40 px-3 py-2 space-y-1.5">
            <p className="text-xs font-medium text-fg-secondary flex items-center gap-1.5">
              <IconKey className="h-3.5 w-3.5 text-warn" aria-hidden />
              New API key minted — copy it now
            </p>
            {showRawKey ? (
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate rounded bg-surface-overlay px-2 py-1 font-mono text-2xs text-fg">
                  {minted.rawKey}
                </code>
                <CopyButton value={minted.rawKey ?? ''} label="Copy API key" copiedLabel="Copied" size="sm" />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate rounded bg-surface-overlay px-2 py-1 font-mono text-2xs text-fg-muted">
                  {minted.prefix}…<span className="opacity-40">{'█'.repeat(24)}</span>
                </code>
                <Btn size="sm" variant="ghost" onClick={() => setShowRawKey(true)}>
                  Reveal
                </Btn>
              </div>
            )}
            <p className="text-2xs text-fg-faint">
              This is the only time the full key is shown. It has already been written to
              GitHub Actions if the sync succeeded. Store it securely.
            </p>
          </div>
        )}

        {/* Fallback commands */}
        {(fallback || (syncFailed && diag)) && (
          <div className="space-y-2">
            <button
              type="button"
              className="flex w-full items-center gap-1.5 text-xs text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              onClick={() => setShowFallback((v) => !v)}
              aria-expanded={showFallback}
            >
              <span className="font-mono text-fg-faint" aria-hidden>{showFallback ? '▴' : '▾'}</span>
              {showFallback ? 'Hide' : 'Show'} manual setup commands
            </button>

            {showFallback && fallback && (
              <div className="space-y-2 rounded-sm border border-edge-subtle/60 bg-surface-overlay/30 p-3">
                <p className="text-xs font-medium text-fg-secondary">
                  Run these commands in your terminal (requires{' '}
                  <a
                    href="https://cli.github.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2"
                  >
                    gh CLI
                  </a>
                  ):
                </p>
                <div className="space-y-1.5">
                  {fallback.commands.map((cmd) => (
                    <div key={cmd} className="flex items-center gap-2">
                      <code className="flex-1 min-w-0 truncate rounded bg-surface-overlay px-2 py-1 font-mono text-2xs text-fg">
                        {cmd}
                      </code>
                      <CopyButton value={cmd} label="Copy command" copiedLabel="Copied" size="sm" />
                    </div>
                  ))}
                </div>
                {fallback.envBlock && (
                  <div className="space-y-1">
                    <p className="text-2xs text-fg-muted">
                      Add to your CI workflow <code className="font-mono">env:</code> block:
                    </p>
                    <div className="flex items-start gap-2">
                      <pre className="mushi-code-block mushi-code-body flex-1 min-w-0 overflow-x-auto rounded px-2 py-1.5 font-mono text-2xs text-fg leading-relaxed whitespace-pre">
                        {fallback.envBlock}
                      </pre>
                      <CopyButton value={fallback.envBlock} label="Copy env block" copiedLabel="Copied" size="sm" />
                    </div>
                  </div>
                )}
                <p className="text-2xs text-fg-faint">
                  After setting secrets, trigger a new native build (CI push) to bake them in.
                  OTA updates cannot retrofit secrets into an already-installed store binary.
                </p>
              </div>
            )}

            {showFallback && !fallback && diag?.repoUrl && (
              <FallbackCommandsFromDiag
                repoUrl={diag.repoUrl}
                projectId={projectId}
                projectSlug={projectSlug}
                requiredVars={diag.requiredVars}
                missingVars={diag.missingVars ?? diag.requiredVars}
                endpoint={`https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api`}
              />
            )}
          </div>
        )}

        {/* CTAs */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {status === 'banner-disabled' ? (
            <Link to="/projects">
              <Btn size="sm" variant="primary">
                {meta.cta}
              </Btn>
            </Link>
          ) : (
            <Tooltip
              content={
                !diag?.hasGithubToken
                  ? 'No GitHub token stored — use the manual commands instead.'
                  : 'Mints a fresh API key and writes it directly to your GitHub Actions secrets.'
              }
              side="top"
            >
              <Btn
                size="sm"
                variant="primary"
                loading={isSyncing}
                disabled={!diag || (!diag.hasGithubToken && !loading)}
                onClick={() => {
                  reset()
                  setShowFallback(false)
                  setShowRawKey(false)
                  void sync()
                }}
              >
                {syncDone ? (
                  <>
                    <IconRefresh className="h-3.5 w-3.5" aria-hidden />
                    {meta.cta}
                  </>
                ) : (
                  meta.cta
                )}
              </Btn>
            </Tooltip>
          )}

          {(diag?.repoUrl || fallback) && !showFallback && status !== 'banner-disabled' && (
            <Btn
              size="sm"
              variant="ghost"
              onClick={() => setShowFallback(true)}
            >
              {hasGithubTokenFallbackLabel(diag?.hasGithubToken ?? false)}
            </Btn>
          )}
        </div>

        {/* Required env vars hint */}
        {diag && (
          <p className="text-2xs text-fg-faint">
            Required vars for{' '}
            <span className="font-medium">{envVars.stackLabel}</span>:{' '}
            {diag.requiredVars.map((v, i) => (
              <span key={v}>
                <code className="font-mono">{v}</code>
                {i < diag.requiredVars.length - 1 && ', '}
              </span>
            ))}
          </p>
        )}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Inline fallback commands when no sync has been run yet
// ---------------------------------------------------------------------------

function hasGithubTokenFallbackLabel(hasToken: boolean): string {
  return hasToken ? 'Show manual commands' : 'Copy setup commands'
}

function FallbackCommandsFromDiag({
  repoUrl,
  requiredVars,
  missingVars,
  projectId,
  projectSlug: _slug,
  endpoint,
}: {
  repoUrl: string
  requiredVars: string[]
  missingVars: string[]
  projectId: string
  projectSlug?: string | null
  endpoint: string
}) {
  const match = /github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(repoUrl)
  const repo = match ? match[1] : repoUrl
  const relevant = missingVars.length > 0 ? missingVars : requiredVars

  // Build simple commands — user must supply the API key value manually here
  // since we haven't minted one (no sync run yet).
  const commands = relevant.map((name) => {
    if (name.toLowerCase().includes('key')) {
      return `gh secret set ${name} --body "<your-mushi-api-key>" --repo ${repo}`
    }
    if (name.toLowerCase().includes('endpoint')) {
      return `gh variable set ${name} --body "${endpoint}" --repo ${repo}`
    }
    return `gh variable set ${name} --body "${projectId}" --repo ${repo}`
  })

  return (
    <div className="space-y-2 rounded-sm border border-edge-subtle/60 bg-surface-overlay/30 p-3">
      <p className="text-xs font-medium text-fg-secondary">Manual setup commands (no API key pre-filled):</p>
      <div className="space-y-1.5">
        {commands.map((cmd) => (
          <div key={cmd} className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate rounded bg-surface-overlay px-2 py-1 font-mono text-2xs text-fg">
              {cmd}
            </code>
            <CopyButton value={cmd} label="Copy" copiedLabel="Copied" size="sm" />
          </div>
        ))}
      </div>
      <p className="text-2xs text-fg-faint">
        Click "Sync CI secrets" above to have Mushi mint a key and write it automatically.
        That's the recommended flow — these are the manual fallback commands.
      </p>
    </div>
  )
}
