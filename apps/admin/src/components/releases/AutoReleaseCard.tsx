/**
 * FILE: apps/admin/src/components/releases/AutoReleaseCard.tsx
 * PURPOSE: The per-project opt-in for auto-release. When the app ships (a
 *          GitHub release published, a successful production deploy, or a
 *          `release.published` event pushed to /v1/ingest/recipe/events),
 *          Mushi drafts a release from the fixed reports and publishes it,
 *          which tells each reporter their bug is live. Off by default.
 *
 *          Reads and writes `auto_release_enabled` through
 *          GET / PATCH /v1/admin/settings (project admins only on write), and
 *          reads GET /v1/admin/releases/auto-release: only one automatic draft
 *          may be open per project, so a draft whose publish failed pauses
 *          auto-release until someone publishes or deletes it. The card says
 *          so instead of letting it stall silently.
 */

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { Btn, Callout, Card, ErrorAlert, Toggle } from '../ui'

interface AutoReleaseSettings {
  auto_release_enabled?: boolean
}

/** Mirrors OpenAutoDraft in packages/server/supabase/functions/_shared/auto-release.ts. */
interface BlockingAutoDraft {
  id: string
  version: string
  createdAt: string
  autoSource: 'github_release' | 'github_deployment' | 'recipe_event'
  /** No run is still working on it: it blocks auto-release until a person acts. */
  stale: boolean
}

export function AutoReleaseCard({ projectId }: { projectId: string }) {
  const toast = useToast()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  // False when the server has no such column yet (migration not applied).
  const [available, setAvailable] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [blocking, setBlocking] = useState<BlockingAutoDraft | null>(null)
  const [blockingError, setBlockingError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    setBlockingError(null)
    const [res, blockRes] = await Promise.all([
      apiFetch<AutoReleaseSettings>('/v1/admin/settings'),
      apiFetch<{ blockingDraft: BlockingAutoDraft | null }>('/v1/admin/releases/auto-release'),
    ])
    if (!res.ok) {
      setLoadError(res.error?.message ?? 'Could not load the auto-release setting')
    } else {
      const value = res.data?.auto_release_enabled
      setAvailable(typeof value === 'boolean')
      setEnabled(value === true)
    }
    if (!blockRes.ok) {
      setBlocking(null)
      setBlockingError(blockRes.error?.message ?? 'Could not check for a stuck automatic release')
    } else {
      setBlocking(blockRes.data?.blockingDraft ?? null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, projectId])

  async function change(next: boolean) {
    setSaving(true)
    const res = await apiFetch('/v1/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ auto_release_enabled: next }),
    })
    setSaving(false)
    if (!res.ok) {
      toast.error('Could not change auto-release', res.error?.message)
      return
    }
    setEnabled(next)
    toast.success(next ? 'Auto-release is on' : 'Auto-release is off')
  }

  return (
    <Card className="p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-sm font-semibold text-fg">Release automatically when you ship</h3>
          <p className="text-2xs text-fg-secondary leading-snug">
            When you ship, Mushi drafts a release from the reports fixed since the last one and publishes it. Each
            reporter hears their bug is live. Nothing happens when no report was fixed.
          </p>
          <details className="text-2xs text-fg-faint leading-snug">
            <summary className="cursor-pointer hover:text-fg-secondary">What counts as shipping</summary>
            <p className="mt-1">
              A GitHub release is published, a production deploy succeeds, or your CI sends
              <code className="mx-1 font-mono">release.published</code>to
              <code className="mx-1 font-mono">/v1/ingest/recipe/events</code>. GitHub events need the Mushi GitHub
              App on the repo with the Releases and Deployments events. A CI event needs an agent key with{' '}
              <code className="font-mono">mcp:write</code> kept in CI secrets; the public SDK key records the event but
              never releases.
            </p>
          </details>
        </div>
        <Toggle
          ariaLabel="Auto-release"
          checked={enabled === true}
          disabled={enabled === null || saving || !available}
          onChange={(next) => void change(next)}
        />
      </div>
      {!available && enabled !== null ? (
        <p className="text-2xs text-fg-faint">Auto-release becomes available after the next server update.</p>
      ) : null}
      {blocking?.stale ? (
        <Callout
          tone="warn"
          label="Auto-release is paused"
          action={
            <Btn variant="ghost" size="sm" to="/releases?tab=drafts">
              Open drafts
            </Btn>
          }
        >
          <p className="text-2xs text-fg-secondary leading-snug">
            The automatic release <span className="font-mono">{blocking.version}</span> has been a draft since{' '}
            {new Date(blocking.createdAt).toLocaleString()} because its publish did not finish. Mushi releases nothing
            else automatically until you publish or delete it under Drafts.
          </p>
        </Callout>
      ) : blocking ? (
        <p className="text-2xs text-fg-faint">
          Publishing the automatic release <span className="font-mono">{blocking.version}</span> now.
        </p>
      ) : null}
      {loadError ? <ErrorAlert title="Auto-release" message={loadError} /> : null}
      {blockingError ? <ErrorAlert title="Auto-release status" message={blockingError} /> : null}
    </Card>
  )
}
