import { useCallback, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { Btn } from '../ui'
import type { CodebaseImpactResult } from './exploreUnderstandTypes'

interface Props {
  projectId: string
  onImpact: (nodeIds: Set<string>, filePaths: string[]) => void
  onClear: () => void
  active: boolean
}

export function ExploreImpactControl({ projectId, onImpact, onClear, active }: Props) {
  const [pathsInput, setPathsInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [lastResult, setLastResult] = useState<CodebaseImpactResult | null>(null)

  const runImpact = useCallback(async () => {
    const paths = pathsInput
      .split(/[\n,]/)
      .map((p) => p.trim())
      .filter(Boolean)
    if (!paths.length || !projectId) return

    setLoading(true)
    const qs = encodeURIComponent(paths.join(','))
    const res = await apiFetch<CodebaseImpactResult>(
      `/v1/admin/projects/${projectId}/codebase/impact?paths=${qs}`,
    )
    setLoading(false)
    if (!res.ok || !res.data) return

    setLastResult(res.data)
    onImpact(new Set(res.data.affected_node_ids), res.data.affected_file_paths)
  }, [pathsInput, projectId, onImpact])

  return (
    <div className="rounded-md border border-edge-subtle bg-surface-overlay/30 p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-3xs uppercase tracking-wider text-fg-faint">Diff impact</span>
        {active && (
          <button
            type="button"
            onClick={() => {
              setLastResult(null)
              onClear()
            }}
            className="text-3xs text-fg-muted hover:text-fg underline"
          >
            Clear highlight
          </button>
        )}
      </div>
      <textarea
        value={pathsInput}
        onChange={(e) => setPathsInput(e.target.value)}
        placeholder="Paste changed paths (comma or newline)…"
        rows={2}
        className="w-full text-3xs font-mono rounded border border-edge-subtle bg-surface-raised px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand/40 resize-none"
        aria-label="Changed file paths for impact analysis"
      />
      <div className="flex items-center gap-2">
        <Btn size="sm" variant="ghost" onClick={() => void runImpact()} loading={loading} disabled={!pathsInput.trim()}>
          Show dependents
        </Btn>
        {lastResult && (
          <span className="text-3xs text-fg-muted tabular-nums">
            {lastResult.affected_file_paths.length} files affected
          </span>
        )}
      </div>
    </div>
  )
}
