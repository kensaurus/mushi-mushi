/**
 * Summarises the two GitHub wiring paths operators confuse:
 * platform settings (PRs) vs codebase indexing (RAG / auto-fix grounding).
 */

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../lib/supabase'
import { Badge, Card } from '../ui'
import { CHIP_TONE } from '../../lib/chipTone'

interface CodebaseStats {
  codebase_index_enabled: boolean
  repo_url: string | null
  indexed_files: number
  last_index_error: string | null
}

interface Props {
  projectId: string
  platformRepoUrl?: string | null
}

export function RepoReadinessStrip({ projectId, platformRepoUrl }: Props) {
  const [stats, setStats] = useState<CodebaseStats | null>(null)

  const load = useCallback(async () => {
    const res = await apiFetch<CodebaseStats>(
      `/v1/admin/projects/${projectId}/codebase/stats`,
    )
    if (res.ok && res.data) setStats(res.data)
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  const indexRepo = stats?.repo_url ?? null
  const indexOn = !!stats?.codebase_index_enabled
  const files = stats?.indexed_files ?? 0
  const platformRepo = platformRepoUrl?.trim() || null

  const ragReady = indexOn && files > 0
  const prReady = !!platformRepo

  return (
    <Card className="p-3 space-y-2 border border-edge-subtle bg-surface-overlay/30">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold text-fg-primary">Repo readiness</h4>
        {ragReady && prReady ? (
          <Badge tone="okSubtle">Ready for fixes</Badge>
        ) : (
          <Badge tone="warnSubtle">Incomplete wiring</Badge>
        )}
      </div>
      <ul className="text-2xs text-fg-secondary space-y-1.5">
        <li className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-fg-primary">RAG index</span>
          {indexOn ? (
            <Badge className={files > 0 ? CHIP_TONE.okSubtle : CHIP_TONE.warnSubtle}>
              {files > 0 ? `${files.toLocaleString()} files` : 'Indexing…'}
            </Badge>
          ) : (
            <Badge tone="warnSubtle">Off</Badge>
          )}
          {indexRepo ? (
            <code className="font-mono text-3xs truncate max-w-full">{indexRepo}</code>
          ) : (
            <span>— enable codebase indexing below</span>
          )}
        </li>
        <li className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-fg-primary">Platform GitHub</span>
          {platformRepo ? (
            <code className="font-mono text-3xs truncate max-w-full">{platformRepo}</code>
          ) : (
            <span>— set repo URL on the GitHub platform card</span>
          )}
        </li>
        {stats?.last_index_error ? (
          <li className="text-danger wrap-anywhere">{stats.last_index_error}</li>
        ) : null}
      </ul>
      {!ragReady ? (
        <p className="text-2xs text-fg-muted">
          Auto-fix needs indexed source files. Without them the worker writes{' '}
          <code className="font-mono">INVESTIGATION_NEEDED.md</code> stubs.{' '}
          <Link to="/explore" className="text-accent hover:underline">
            Open Explore →
          </Link>
        </p>
      ) : null}
    </Card>
  )
}
