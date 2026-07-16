/**
 * FILE: apps/admin/src/components/integrations/CodebaseIndexCard.tsx
 * PURPOSE: Phase 3 of the Mushi PDCA unblock — let the user turn on
 *          codebase RAG indexing for the active project without dropping into
 *          SQL. Without a `project_repos` row the fix-worker has no grounding
 *          and emits "INVESTIGATION_NEEDED.md" stubs.
 *
 * Data contract:
 *   - GET  /v1/admin/projects/:id/codebase/stats → indexed_files +
 *          last_indexed_at + repo_url + has_webhook_secret +
 *          language_distribution + at_file_cap + path_globs
 *   - POST /v1/admin/projects/:id/codebase/enable → upserts project_repos,
 *          flips codebase_index_enabled, kicks an immediate sweep, and
 *          returns a freshly-generated webhook secret on first enable.
 *   - POST /v1/admin/projects/:id/codebase/rotate-secret → regenerates the
 *          webhook secret without re-enabling indexing.
 */

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { langVizColor } from '../../lib/vizTokens'

// JSX text nodes do NOT decode \u escapes — `Hello \u2014 world` renders
// the literal six chars `\u2014`. Keep these as JS constants and interpolate
// via `{EM_DASH}` so the displayed character is `—`.
const EM_DASH = '\u2014'
const ELLIPSIS = '\u2026'
const WARNING_SIGN = '\u26a0'
const WARNING_EMOJI = '\u26a0\ufe0f'
import {
  Card,
  Btn,
  Badge,
  Input,
  Toggle,
  FilterChip,
  RelativeTime,
  ResultChip,
  CopyButton,
  DetailRows,
  ErrorAlert,
  type DetailRowItem,
} from '../ui'
import { useToast } from '../../lib/toast'
import { GitHubAppInstallButton, GitHubPatDisclosure } from './GitHubAppInstallButton'
import { CHIP_TONE } from '../../lib/chipTone'

const SUPPORTED_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'pyi', 'go', 'rs']
const PATH_GLOB_PRESETS = ['src/**', 'app/**', 'apps/*/src/**', 'packages/*/src/**']

interface CodebaseStats {
  codebase_index_enabled: boolean
  repo_url: string | null
  default_branch: string | null
  installation_id: number | null
  indexing_enabled: boolean | null
  path_globs: string[] | null
  indexed_files: number
  file_cap: number
  at_file_cap: boolean
  language_distribution: Record<string, number>
  last_indexed_at: string | null
  last_index_attempt_at: string | null
  last_index_error: string | null
  has_webhook_secret: boolean
}

interface AutofixState {
  autofix_enabled: boolean
}

interface EnableResponse {
  repo_url: string
  default_branch: string
  webhook_secret: string
  webhook_secret_issued: boolean
  indexed_files_eta_seconds: number
}

interface RotateSecretResponse {
  webhook_secret: string
}

interface Props {
  projectId: string
}

function buildStatsRows(stats: CodebaseStats, hasFiles: boolean): DetailRowItem[] {
  const rows: DetailRowItem[] = [
    {
      label: 'Repo',
      value: stats.repo_url ?? '\u2014',
      mono: true,
      tone: 'info',
      copyable: !!stats.repo_url,
      hint: 'GitHub repository indexed by the Mushi RAG sweeper.',
    },
    {
      label: 'Branch',
      value: stats.default_branch ?? 'main',
      mono: true,
      hint: 'Branch the sweeper pulls from on each push.',
    },
    {
      label: 'Indexed files',
      value: stats.at_file_cap
        ? `${stats.indexed_files.toLocaleString()} (cap reached \u2014 ${stats.file_cap} max)`
        : stats.indexed_files.toLocaleString(),
      mono: true,
      tone: hasFiles ? (stats.at_file_cap ? 'warn' : 'ok') : 'warn',
      hint: `Number of file-chunks in pgvector. Sweeper stops at ${stats.file_cap} files per run.`,
    },
  ]
  if (stats.path_globs && stats.path_globs.length > 0) {
    rows.push({
      label: 'Path filter',
      value: stats.path_globs.join(', '),
      mono: true,
      hint: 'Only files matching these globs are indexed. Empty = all supported extensions.',
    })
  }
  if (stats.last_indexed_at) {
    rows.push({
      label: 'Last sweep',
      value: <RelativeTime value={stats.last_indexed_at} />,
      hint: 'When the most recent successful sweep finished.',
    })
  }
  if (stats.last_index_error) {
    rows.push({
      label: 'Last error',
      value: stats.last_index_error,
      tone: 'danger',
      mono: true,
      wrap: true,
      hint: 'Upstream error from the most recent failed chunk during the sweep.',
    })
  }
  return rows
}

export function CodebaseIndexCard({ projectId }: Props) {
  const toast = useToast()
  const [stats, setStats] = useState<CodebaseStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [repoUrl, setRepoUrl] = useState('')
  const [branch, setBranch] = useState('main')
  const [installationId, setInstallationId] = useState('')
  const [pathGlobs, setPathGlobs] = useState('')
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null)
  const [rotatingSec, setRotatingSec] = useState(false)
  const [enableError, setEnableError] = useState<string | null>(null)
  const [rotateError, setRotateError] = useState<string | null>(null)
  // Autofix toggle lives next to codebase indexing because they're the
  // two flags that gate `/v1/admin/fixes/dispatch`. Splitting them across
  // pages was the exact pain point that forced the earlier SQL-flip workaround.
  const [autofixEnabled, setAutofixEnabled] = useState<boolean | null>(null)
  const [autofixSaving, setAutofixSaving] = useState(false)

  const loadStats = useCallback(async () => {
    const [statsRes, autofixRes] = await Promise.all([
      apiFetch<CodebaseStats>(`/v1/admin/projects/${projectId}/codebase/stats`),
      apiFetch<AutofixState>(`/v1/admin/projects/${projectId}/autofix`),
    ])
    if (statsRes.ok && statsRes.data) {
      setStats(statsRes.data)
      if (statsRes.data.repo_url) setRepoUrl(statsRes.data.repo_url)
      if (statsRes.data.default_branch) setBranch(statsRes.data.default_branch)
      if (statsRes.data.installation_id != null)
        setInstallationId(String(statsRes.data.installation_id))
      if (statsRes.data.path_globs) setPathGlobs(statsRes.data.path_globs.join(', '))
    }
    if (autofixRes.ok && autofixRes.data) {
      setAutofixEnabled(autofixRes.data.autofix_enabled)
    }
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  const toggleAutofix = async (next: boolean) => {
    if (autofixSaving) return
    const previous = autofixEnabled
    setAutofixEnabled(next)
    setAutofixSaving(true)
    const res = await apiFetch<AutofixState>(
      `/v1/admin/projects/${projectId}/autofix/toggle`,
      { method: 'POST', body: JSON.stringify({ enabled: next }) },
    )
    setAutofixSaving(false)
    if (!res.ok) {
      setAutofixEnabled(previous)
      toast.error('Could not update autofix', res.error?.message ?? res.error?.code)
      return
    }
    toast.success(
      next ? 'Autofix enabled' : 'Autofix paused',
      next
        ? 'Dispatch buttons on the Reports page will now queue a fix worker.'
        : 'Reports can still be triaged; the Dispatch button is disabled until you re-enable.',
    )
  }

  useEffect(() => {
    if (editing) return
    if (stats && stats.indexed_files > 0 && stats.last_indexed_at) return
    if (!stats?.codebase_index_enabled) return
    const t = setInterval(() => { void loadStats() }, 5000)
    return () => clearInterval(t)
  }, [editing, stats, loadStats])

  const enable = async () => {
    if (!repoUrl.trim()) {
      toast.error('Repo URL required', 'Paste the https://github.com/owner/repo URL')
      return
    }
    setSaving(true)
    const globList = pathGlobs
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    const res = await apiFetch<EnableResponse>(`/v1/admin/projects/${projectId}/codebase/enable`, {
      method: 'POST',
      body: JSON.stringify({
        repo_url: repoUrl.trim(),
        default_branch: branch.trim() || 'main',
        installation_id: installationId.trim() || null,
        path_globs: globList.length > 0 ? globList : null,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const msg = res.error?.message ?? res.error?.code ?? 'Unknown error'
      toast.error('Enable failed', msg)
      setEnableError(msg)
      return
    }
    setEnableError(null)
    toast.success('Codebase indexing enabled', 'Sweep kicked \u2014 files will appear below')
    if (res.data?.webhook_secret_issued) setIssuedSecret(res.data.webhook_secret)
    setEditing(false)
    void loadStats()
  }

  const rotateSecret = async () => {
    if (rotatingSec) return
    setRotatingSec(true)
    const res = await apiFetch<RotateSecretResponse>(
      `/v1/admin/projects/${projectId}/codebase/rotate-secret`,
      { method: 'POST' },
    )
    setRotatingSec(false)
    if (!res.ok) {
      const msg = res.error?.message ?? res.error?.code ?? 'Unknown error'
      toast.error('Rotate failed', msg)
      setRotateError(msg)
      return
    }
    setRotateError(null)
    setIssuedSecret(res.data?.webhook_secret ?? null)
    toast.success('Webhook secret rotated', 'A new one-time secret has been generated. Update it in GitHub now.')
  }

  if (loading) {
    return (
      <Card className="p-3">
        <div className="h-4 w-40 rounded bg-surface-overlay animate-pulse" />
      </Card>
    )
  }

  const enabled = !!stats?.codebase_index_enabled
  const hasFiles = (stats?.indexed_files ?? 0) > 0

  return (
    <Card className="p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-semibold text-fg-primary">Codebase indexing</h4>
          {enabled
            ? <Badge tone="okSubtle">On</Badge>
            : <Badge tone="warnSubtle">Off</Badge>}
          {enabled && !hasFiles && (
            <ResultChip tone="running">{`Indexing${ELLIPSIS}`}</ResultChip>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {enabled && stats?.has_webhook_secret && (
            <>
              {rotateError && (
                <span className="text-2xs text-danger">{rotateError}</span>
              )}
              <Btn variant="ghost" size="sm" onClick={() => void rotateSecret()} loading={rotatingSec}>
                Rotate secret
              </Btn>
            </>
          )}
          {!editing && (
            <Btn variant="ghost" size="sm" onClick={() => setEditing(true)}>
              {enabled ? 'Reconfigure' : 'Enable'}
            </Btn>
          )}
        </div>
      </div>

      <p className="text-2xs text-fg-secondary pl-2 border-l-2 border-brand/30 leading-snug">
        Pulls your repo&apos;s source tree into Mushi&apos;s RAG so the auto-fix agent can read real files
        instead of guessing. Without this the worker emits{' '}
        <code className="font-mono bg-surface-overlay px-0.5 rounded-sm text-fg-secondary">INVESTIGATION_NEEDED.md</code>{' '}
        stubs.
      </p>

      {/* What gets indexed disclosure */}
      <details className="text-2xs text-fg-muted">
        <summary className="cursor-pointer select-none hover:text-fg-secondary transition-opacity">
          What gets indexed?
        </summary>
        <div className="mt-1.5 pl-2 border-l border-edge-subtle space-y-1">
          <p>
            <span className="font-medium text-fg-secondary">Supported extensions: </span>
            {SUPPORTED_EXTENSIONS.map(ext => (
              <code key={ext} className="font-mono bg-surface-overlay px-0.5 rounded-sm mr-1">
                .{ext}
              </code>
            ))}
          </p>
          <p>
            <span className="font-medium text-fg-secondary">File cap: </span>
            {stats?.file_cap ?? 300} files per sweep run (set via{' '}
            <code className="font-mono bg-surface-overlay px-0.5 rounded-sm">MUSHI_REPO_INDEX_SWEEP_FILE_CAP</code>).
            {stats?.at_file_cap && (
              <span className="text-warn ml-1">
                {WARNING_SIGN} Cap reached {EM_DASH} some files were not indexed. Add a path filter to narrow the scope.
              </span>
            )}
          </p>
          {Object.keys(stats?.language_distribution ?? {}).length > 0 && (
            <div>
              <span className="font-medium text-fg-secondary">Languages indexed: </span>
              <LanguageSparkline distribution={stats!.language_distribution} />
            </div>
          )}
        </div>
      </details>

      {stats?.repo_url && (
        <DetailRows items={buildStatsRows(stats, hasFiles)} />
      )}

      {enabled && hasFiles && stats?.at_file_cap && (
        <div className={`flex items-start gap-2 rounded ${CHIP_TONE.warnSubtle} px-2 py-1.5 text-2xs`}>
          <span aria-hidden="true">{WARNING_SIGN}</span>
          <span>
            Indexed {stats.indexed_files.toLocaleString()} of {stats.file_cap} max files.
            Some source files may have been skipped. Add a path filter below to index the most relevant directories.
          </span>
        </div>
      )}

      <AutofixToggleRow
        enabled={autofixEnabled}
        saving={autofixSaving}
        onToggle={(next) => void toggleAutofix(next)}
        codebaseReady={enabled && hasFiles}
      />

      {editing && (
        <div className="space-y-2 pt-1 border-t border-edge-subtle">
          {/* GitHub App is the preferred auth path — fewer permissions, no expiry */}
          <GitHubAppInstallButton
            projectId={projectId}
            hasInstallation={!!stats?.installation_id}
          />
          <GitHubPatDisclosure>
            <div className="grid grid-cols-2 gap-2">
              <Input
                label="GitHub App install ID (manual)"
                placeholder="e.g. 78245120"
                value={installationId}
                onChange={(e) => setInstallationId(e.currentTarget.value)}
              />
            </div>
          </GitHubPatDisclosure>
          <Input
            label="GitHub repo URL"
            placeholder="https://github.com/your-org/your-repo"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.currentTarget.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="Default branch"
              placeholder="main"
              value={branch}
              onChange={(e) => setBranch(e.currentTarget.value)}
            />
          </div>
          <div>
            <Input
              label="Path filter (advanced, optional)"
              placeholder="e.g. src/**, apps/*/src/**"
              value={pathGlobs}
              onChange={(e) => setPathGlobs(e.currentTarget.value)}
            />
            <div className="flex flex-wrap gap-1 mt-1">
              {PATH_GLOB_PRESETS.map(preset => {
                const globs = pathGlobs.split(',').map(s => s.trim()).filter(Boolean)
                return (
                  <FilterChip
                    key={preset}
                    label={preset}
                    active={globs.includes(preset)}
                    onClick={() => setPathGlobs(p => p ? `${p}, ${preset}` : preset)}
                    hint={`Add ${preset} to path filter`}
                  />
                )
              })}
            </div>
            <p className="text-2xs text-fg-muted mt-1">
              Comma-separated glob patterns. Leave blank to index all supported extensions.
              Use presets above to quickly add common source directories.
            </p>
          </div>
          <p className="text-2xs text-fg-muted">
            Leave the install ID blank to fall back to the project&apos;s GitHub PAT.
          </p>
          {enableError && (
            <ErrorAlert title="Enable failed" message={enableError} />
          )}
          <div className="flex items-center justify-end gap-2">
            <Btn variant="cancel" size="sm" onClick={() => setEditing(false)} disabled={saving}>Cancel</Btn>
            <Btn variant="primary" size="sm" onClick={() => void enable()} loading={saving}>
              {enabled ? 'Save & re-sweep' : 'Index now'}
            </Btn>
          </div>
        </div>
      )}

      {issuedSecret && (
        <WebhookSecretReveal secret={issuedSecret} onDismiss={() => setIssuedSecret(null)} />
      )}
    </Card>
  )
}

/** Mini horizontal bar chart of language distribution. */
function LanguageSparkline({ distribution }: { distribution: Record<string, number> }) {
  const total = Object.values(distribution).reduce((a, b) => a + b, 0)
  if (total === 0) return null
  return (
    <div className="flex items-center gap-1 flex-wrap mt-0.5">
      {Object.entries(distribution)
        .slice(0, 8)
        .map(([lang, count]) => {
          const langColor = langVizColor(lang)
          return (
          <span
            key={lang}
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-px text-2xs"
            style={{
              backgroundColor: `color-mix(in oklch, ${langColor} 13%, transparent)`,
              color: langColor,
              border: `1px solid color-mix(in oklch, ${langColor} 27%, transparent)`,
            }}
            title={`${count} files`}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: langColor }}
            />
            {lang} {Math.round((count / total) * 100)}%
          </span>
        )})}
    </div>
  )
}

function AutofixToggleRow({
  enabled,
  saving,
  onToggle,
  codebaseReady,
}: {
  enabled: boolean | null
  saving: boolean
  onToggle: (next: boolean) => void
  codebaseReady: boolean
}) {
  const isOn = enabled === true
  return (
    <div className="flex items-start justify-between gap-3 pt-2 border-t border-edge-subtle">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-fg-primary">Autofix dispatcher</span>
          <Badge className={isOn ? CHIP_TONE.okSubtle : CHIP_TONE.warnSubtle}>
            {enabled == null ? '\u2014' : isOn ? 'On' : 'Off'}
          </Badge>
        </div>
        <p className="text-2xs text-fg-secondary leading-snug mt-0.5">
          Controls whether <span className="font-mono">/v1/admin/fixes/dispatch</span> will
          queue a fix-worker for triaged reports. Turn off to pause every dispatch button
          without removing your GitHub or BYOK credentials.
        </p>
        {!codebaseReady && isOn && (
          <p className="text-2xs text-warn mt-0.5">
            Heads up: codebase indexing isn&apos;t finished yet {EM_DASH} fixes will be skipped with
            a &ldquo;no relevant code&rdquo; result until the sweep completes.
          </p>
        )}
      </div>
      <Toggle
        ariaLabel="Toggle autofix dispatcher"
        checked={isOn}
        onChange={onToggle}
        disabled={saving || enabled == null}
      />
    </div>
  )
}

function WebhookSecretReveal({ secret, onDismiss }: { secret: string; onDismiss: () => void }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      toast.success('Webhook secret copied', 'Paste into GitHub \u2192 Settings \u2192 Webhooks \u2192 Secret')
    } catch {
      toast.error('Clipboard blocked', 'Select the text and copy manually.')
    }
  }
  return (
    <div className="mt-2 pt-2 border-t border-edge-subtle bg-warn-muted/20 -mx-3 px-3 py-2">
      <div className="text-2xs text-warn font-medium uppercase tracking-wider mb-2">
        {WARNING_EMOJI} One-time webhook secret {EM_DASH} copy now, will not be shown again
      </div>
      <pre className="mushi-code-block mushi-code-body font-mono text-xs text-fg px-2 py-1 rounded-sm block whitespace-pre-wrap wrap-anywhere select-all">
        {secret}
      </pre>
      <div className="mt-2 flex items-center gap-2">
        <CopyButton
          onCopy={copy}
          copied={copied}
          label="Copy webhook secret"
          copiedLabel="Webhook secret copied"
        />
        <Btn variant="cancel" size="sm" onClick={onDismiss}>I&apos;ve stored it {EM_DASH} hide</Btn>
        <a
          href="https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries"
          target="_blank"
          rel="noreferrer"
          className="text-2xs text-accent hover:underline ml-auto"
        >
          How GitHub validates this \u2192
        </a>
      </div>
    </div>
  )
}
