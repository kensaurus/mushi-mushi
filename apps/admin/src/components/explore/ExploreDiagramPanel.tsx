/**
 * Map → Diagram on /explore: an AI architecture diagram of the connected
 * repo (Plan 020 §10.3.2). Drawn on demand only (one AI call per commit),
 * every file path checked against the real repo, stored per commit.
 * Needs a connected GitHub repo, not codebase indexing.
 */

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, apiFetchMutate } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { githubPathUrl, type DiagramResponse } from '../../lib/repoUnderstanding'
import { Btn, Card, ErrorAlert } from '../ui'
import { ExploreDiagramCanvas } from './ExploreDiagramCanvas'
import { ExploreDiagramPublishCard } from './ExploreDiagramPublishCard'

interface Props {
  projectId: string
}

export function ExploreDiagramPanel({ projectId }: Props) {
  const toast = useToast()
  const [data, setData] = useState<DiagramResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const path = `/v1/admin/projects/${projectId}/codebase/diagram`

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await apiFetch<DiagramResponse>(path, { cache: 'no-store' })
    setLoading(false)
    if (!res.ok || !res.data) {
      setError(res.error?.message ?? 'Could not load the diagram')
      return
    }
    setData(res.data)
  }, [path])

  useEffect(() => {
    void load()
  }, [load])

  const draw = async (force: boolean) => {
    setDrawing(true)
    const res = await apiFetchMutate<DiagramResponse>(path, { method: 'POST', body: JSON.stringify({ force }) })
    setDrawing(false)
    if (!res.ok || !res.data) {
      toast.error('Could not draw the diagram', res.error?.message)
      return
    }
    setSelectedId(null)
    setData(res.data)
    if (res.data.reused) toast.info('No new commit since the last diagram', 'Use Redraw to ask the AI again.')
  }

  if (loading && !data) {
    return <div className="h-[560px] animate-pulse rounded-md bg-surface-raised" role="status" aria-label="Loading diagram" />
  }
  if (error) return <ErrorAlert message={error} onRetry={() => void load()} />

  const diagram = data?.diagram ?? null
  if (!diagram) {
    return (
      <div data-testid="explore-diagram-empty">
      <Card className="p-6 space-y-3 text-center">
        <h3 className="text-sm font-semibold text-fg">See how your app fits together</h3>
        <p className="mx-auto max-w-prose text-xs text-fg-muted">
          Mushi reads your repo on GitHub at the latest commit and asks AI to draw the main parts and how they connect.
          Every file path is checked against the real repo. It costs one AI call, and nothing changes until you redraw.
        </p>
        <Btn onClick={() => void draw(false)} loading={drawing}>
          Draw diagram
        </Btn>
      </Card>
      </div>
    )
  }

  const selected = diagram.graph.nodes.find((n) => n.id === selectedId) ?? null
  const invalid = diagram.stats.invalid_paths?.length ?? 0

  return (
    <div className="space-y-3" data-testid="explore-diagram">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-fg-muted">
          {diagram.repo_owner}/{diagram.repo_name} · commit{' '}
          <span className="font-mono">{diagram.commit_sha.slice(0, 7)}</span> · drawn{' '}
          {new Date(diagram.updated_at).toLocaleString()} · {diagram.graph.nodes.length} parts
          {invalid > 0 && ` · ${invalid} made-up path${invalid === 1 ? '' : 's'} removed`}
        </p>
        <div className="flex gap-2">
          <Btn size="sm" variant="ghost" onClick={() => void draw(false)} loading={drawing}>
            Update to latest commit
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => void draw(true)} loading={drawing}>
            Redraw
          </Btn>
        </div>
      </div>

      <ExploreDiagramCanvas graph={diagram.graph} selectedId={selectedId} onSelect={setSelectedId} />

      {selected && (
        <div data-testid="explore-diagram-selected">
        <Card className="p-4 space-y-1">
          <h3 className="text-sm font-semibold text-fg">{selected.label}</h3>
          {selected.description && <p className="text-xs text-fg-secondary">{selected.description}</p>}
          {selected.path ? (
            <a
              className="inline-block font-mono text-xs text-brand underline"
              href={githubPathUrl(diagram.repo_owner, diagram.repo_name, diagram.commit_sha, selected.path)}
              target="_blank"
              rel="noreferrer"
            >
              {selected.path} on GitHub
            </a>
          ) : (
            <p className="text-xs text-fg-faint">
              {selected.path_invalid
                ? 'The AI named a path that is not in the repo, so Mushi removed it.'
                : 'No single file or folder implements this part.'}
            </p>
          )}
        </Card>
        </div>
      )}

      {data && <ExploreDiagramPublishCard projectId={projectId} publication={data.publication} onChanged={() => void load()} />}
    </div>
  )
}
