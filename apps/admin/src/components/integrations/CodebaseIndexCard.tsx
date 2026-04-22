/**
 * FILE: apps/admin/src/components/integrations/CodebaseIndexCard.tsx
 * PURPOSE: Phase 3 of the Mushi PDCA unblock — let the user turn on
 *          codebase RAG indexing for the active project without dropping into
 *          SQL. Without a `project_repos` row the fix-worker has no grounding
 *          and emits "INVESTIGATION_NEEDED.md" stubs (the exact regression
 *          that produced glot.it PRs #3/#4/#5 pre-unblock).
 *
 * Data contract:
 *   - GET  /v1/admin/projects/:id/codebase/stats → indexed_files +
 *          last_indexed_at + repo_url + has_webhook_secret
 *   - POST /v1/admin/projects/:id/codebase/enable → upserts project_repos,
 *          flips codebase_index_enabled, kicks an immediate sweep, and
 *          returns a freshly-generated webhook secret on first enable.
 */

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { Card, Btn, Badge, Input, RelativeTime, ResultChip } from '../ui'
import { useToast } from '../../lib/toast'

interface CodebaseStats {
  codebase_index_enabled: boolean
  repo_url: string | null
  default_branch: string | null
  installation_id: number | null
  indexing_enabled: boolean | null
  indexed_files: number
  last_indexed_at: string | null
  last_index_attempt_at: string | null
  last_index_error: string | null
  has_webhook_secret: boolean
}

interface EnableResponse {
  repo_url: string
  default_branch: string
  webhook_secret: string
  webhook_secret_issued: boolean
  indexed_files_eta_seconds: number
}

interface Props {
  projectId: string
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
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null)

  const loadStats = useCallback(async () => {
    const res = await apiFetch<CodebaseStats>(`/v1/admin/projects/${projectId}/codebase/stats`)
    if (res.ok && res.data) {
      setStats(res.data)
      if (res.data.repo_url) setRepoUrl(res.data.repo_url)
      if (res.data.default_branch) setBranch(res.data.default_branch)
      if (res.data.installation_id != null) setInstallationId(String(res.data.installation_id))
    }
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  // Keep the file count fresh while a sweep is in flight so the user sees
  // numbers climb instead of staring at "0 files" for 60s after clicking
  // "Index now". Polling stops the moment we have files or the edit form
  // opens (avoiding a network storm on a page a user is actively typing in).
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
    const res = await apiFetch<EnableResponse>(`/v1/admin/projects/${projectId}/codebase/enable`, {
      method: 'POST',
      body: JSON.stringify({
        repo_url: repoUrl.trim(),
        default_branch: branch.trim() || 'main',
        installation_id: installationId.trim() || null,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      toast.error('Enable failed', res.error?.message ?? res.error?.code)
      return
    }
    toast.success('Codebase indexing enabled', 'Sweep kicked — files will appear below')
    if (res.data?.webhook_secret_issued) setIssuedSecret(res.data.webhook_secret)
    setEditing(false)
    void loadStats()
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
            ? <Badge className="bg-ok-muted text-ok">On</Badge>
            : <Badge className="bg-warn-muted text-warn">Off</Badge>}
          {enabled && !hasFiles && (
            <ResultChip tone="running">Indexing…</ResultChip>
          )}
        </div>
        {!editing && (
          <Btn variant="ghost" size="sm" onClick={() => setEditing(true)}>
            {enabled ? 'Reconfigure' : 'Enable'}
          </Btn>
        )}
      </div>

      <p className="text-2xs text-fg-muted">
        Pulls your repo's source tree into Mushi's RAG so the auto-fix agent can read real files
        instead of guessing. Without this the worker emits <code className="font-mono">INVESTIGATION_NEEDED.md</code> stubs.
      </p>

      {stats?.repo_url && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-2xs">
          <dt className="text-fg-muted">Repo</dt>
          <dd className="font-mono text-fg-primary truncate" title={stats.repo_url}>{stats.repo_url}</dd>
          <dt className="text-fg-muted">Branch</dt>
          <dd className="font-mono text-fg-primary">{stats.default_branch ?? 'main'}</dd>
          <dt className="text-fg-muted">Indexed files</dt>
          <dd className={hasFiles ? 'font-mono text-ok' : 'font-mono text-warn'}>{stats.indexed_files}</dd>
          {stats.last_indexed_at && (
            <>
              <dt className="text-fg-muted">Last sweep</dt>
              <dd className="text-fg-primary"><RelativeTime value={stats.last_indexed_at} /></dd>
            </>
          )}
          {stats.last_index_error && (
            <>
              <dt className="text-fg-muted">Last error</dt>
              <dd className="text-danger text-2xs truncate" title={stats.last_index_error}>{stats.last_index_error}</dd>
            </>
          )}
        </dl>
      )}

      {editing && (
        <div className="space-y-2 pt-1 border-t border-edge-subtle">
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
            <Input
              label="GitHub App install ID (optional)"
              placeholder="e.g. 78245120"
              value={installationId}
              onChange={(e) => setInstallationId(e.currentTarget.value)}
            />
          </div>
          <p className="text-2xs text-fg-muted">
            Leave the install ID blank to fall back to the project's GitHub PAT.
          </p>
          <div className="flex items-center justify-end gap-2">
            <Btn variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>Cancel</Btn>
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

function WebhookSecretReveal({ secret, onDismiss }: { secret: string; onDismiss: () => void }) {
  const toast = useToast()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret)
      toast.success('Webhook secret copied', 'Paste into GitHub → Settings → Webhooks → Secret')
    } catch {
      toast.error('Clipboard blocked', 'Select the text and copy manually.')
    }
  }
  return (
    <div className="mt-2 pt-2 border-t border-edge-subtle bg-warn-muted/20 -mx-3 px-3 py-2">
      <div className="text-2xs text-warn font-medium uppercase tracking-wider mb-2">
        ⚠️ One-time webhook secret — copy now, will not be shown again
      </div>
      <pre className="font-mono text-xs text-fg bg-surface-raised px-2 py-1 rounded-sm block whitespace-pre-wrap break-all select-all">
        {secret}
      </pre>
      <div className="mt-2 flex items-center gap-2">
        <Btn size="sm" onClick={() => void copy()}>Copy secret</Btn>
        <Btn variant="ghost" size="sm" onClick={onDismiss}>I've stored it — hide</Btn>
        <a
          href="https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries"
          target="_blank"
          rel="noreferrer"
          className="text-2xs text-accent hover:underline ml-auto"
        >
          How GitHub validates this →
        </a>
      </div>
    </div>
  )
}
