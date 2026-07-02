import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { Btn } from '../ui'
import type { CodebaseImpactResult } from './exploreUnderstandTypes'

interface Props {
  projectId: string
  onImpact: (nodeIds: Set<string>, filePaths: string[]) => void
  onClear: () => void
  active: boolean
}

interface FixRow {
  id: string
  files_changed: string[] | null
  status: string
}

export function ExploreImpactControl({ projectId, onImpact, onClear, active }: Props) {
  const [pathsInput, setPathsInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [lastResult, setLastResult] = useState<CodebaseImpactResult | null>(null)
  const [openFixId, setOpenFixId] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    if (!projectId) return
    void (async () => {
      const res = await apiFetch<{ fixes: FixRow[] }>(
        `/v1/admin/fixes?project_id=${encodeURIComponent(projectId)}&limit=10`,
      )
      if (!res.ok || !res.data?.fixes) return
      const candidate = res.data.fixes.find(
        (f) =>
          (f.files_changed?.length ?? 0) > 0 &&
          !['merged', 'closed', 'failed'].includes(f.status),
      )
      setOpenFixId(candidate?.id ?? null)
    })()
  }, [projectId])

  const applyImpact = useCallback(
    async (qs: string) => {
      if (!projectId) return
      setLoading(true)
      const res = await apiFetch<CodebaseImpactResult>(
        `/v1/admin/projects/${projectId}/codebase/impact?${qs}`,
      )
      setLoading(false)
      if (!res.ok || !res.data) return
      setLastResult(res.data)
      onImpact(new Set(res.data.affected_node_ids), res.data.affected_file_paths)
    },
    [projectId, onImpact],
  )

  const runManualImpact = useCallback(async () => {
    const paths = pathsInput
      .split(/[\n,]/)
      .map((p) => p.trim())
      .filter(Boolean)
    if (!paths.length) return
    await applyImpact(`paths=${encodeURIComponent(paths.join(','))}`)
  }, [pathsInput, applyImpact])

  const runLastPush = useCallback(async () => {
    await applyImpact('ref=last_push')
  }, [applyImpact])

  const runFixPr = useCallback(async () => {
    if (!openFixId) return
    await applyImpact(`fix_id=${encodeURIComponent(openFixId)}`)
  }, [openFixId, applyImpact])

  return (
    <div className="rounded-md border border-edge-subtle bg-surface-overlay/30 p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs uppercase tracking-wider text-fg-faint">Diff impact</span>
        {active && (
          <button
            type="button"
            onClick={() => {
              setLastResult(null)
              onClear()
            }}
            className="text-2xs text-fg-muted hover:text-fg underline"
          >
            Clear highlight
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Btn size="sm" variant="primary" onClick={() => void runLastPush()} loading={loading}>
          Last push
        </Btn>
        {openFixId && (
          <Btn size="sm" variant="ghost" onClick={() => void runFixPr()} loading={loading}>
            Open fix PR
          </Btn>
        )}
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-2xs text-fg-muted hover:text-fg underline self-center"
        >
          {showAdvanced ? 'Hide manual paths' : 'Manual paths'}
        </button>
      </div>

      {showAdvanced && (
        <>
          <textarea
            value={pathsInput}
            onChange={(e) => setPathsInput(e.target.value)}
            placeholder="Paste changed paths (comma or newline)…"
            rows={2}
            className="w-full text-2xs font-mono rounded border border-edge-subtle bg-surface-raised px-2 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 resize-none"
            aria-label="Changed file paths for impact analysis"
          />
          <Btn size="sm" variant="ghost" onClick={() => void runManualImpact()} loading={loading} disabled={!pathsInput.trim()}>
            Show dependents
          </Btn>
        </>
      )}

      {lastResult && (
        <p className="text-2xs text-fg-muted tabular-nums">
          {lastResult.changed_paths.length} changed · {lastResult.affected_file_paths.length} affected
          {lastResult.source ? ` · ${lastResult.source}` : ''}
        </p>
      )}
    </div>
  )
}
