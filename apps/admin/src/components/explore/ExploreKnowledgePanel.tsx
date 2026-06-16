import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { Btn, Card } from '../ui'
import { ExploreUnderstandEmpty } from './ExploreUnderstandEmpty'
import type { CodebaseUnderstandError } from './exploreUnderstandTypes'

interface WikiSource {
  id: string
  kind: string
  root_path: string
  label: string | null
  status: string
}

interface KnowledgeNode {
  id: string
  type: string
  name: string
  summary?: string
}

interface Props {
  projectId: string
}

export function ExploreKnowledgePanel({ projectId }: Props) {
  const [sources, setSources] = useState<WikiSource[]>([])
  const [nodes, setNodes] = useState<KnowledgeNode[]>([])
  const [rootPath, setRootPath] = useState('docs/')
  const [label, setLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [fatalError, setFatalError] = useState<CodebaseUnderstandError | null>(null)

  const reload = useCallback(async () => {
    if (!projectId) return
    const [srcRes, graphRes] = await Promise.all([
      apiFetch<{ sources: WikiSource[] }>(`/v1/admin/projects/${projectId}/codebase/wiki/sources`),
      apiFetch<{ graphs: Array<{ graph: { nodes?: KnowledgeNode[] } }> }>(
        `/v1/admin/projects/${projectId}/codebase/knowledge/graph`,
      ),
    ])
    if (srcRes.ok && srcRes.data?.sources) setSources(srcRes.data.sources)
    const graphNodes = graphRes.data?.graphs?.[0]?.graph?.nodes ?? []
    setNodes(graphNodes.slice(0, 40))
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload])

  const addSource = useCallback(async () => {
    if (!rootPath.trim() || !projectId) return
    setLoading(true)
    setFatalError(null)
    const res = await apiFetch<{ source: WikiSource }>(
      `/v1/admin/projects/${projectId}/codebase/wiki/sources`,
      {
        method: 'POST',
        body: JSON.stringify({
          kind: 'repo_subpath',
          root_path: rootPath.trim(),
          label: label.trim() || undefined,
        }),
      },
    )
    setLoading(false)
    if (!res.ok) {
      setFatalError({ code: res.error?.code ?? 'ERROR', message: res.error?.message ?? 'Failed to add wiki source' })
      return
    }
    setRootPath('docs/')
    setLabel('')
    void reload()
  }, [projectId, rootPath, label, reload])

  if (fatalError) {
    return <ExploreUnderstandEmpty error={fatalError} onRetry={() => setFatalError(null)} />
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <p className="text-sm text-fg-secondary">
          Link a wiki or docs folder from your repo. Knowledge entities are merged into Ask answers alongside code citations.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
            placeholder="docs/ or wiki/"
            className="flex-1 text-sm rounded-md border border-edge-subtle bg-surface-raised px-3 py-2 font-mono"
            aria-label="Wiki root path"
          />
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Optional label"
            className="sm:w-40 text-sm rounded-md border border-edge-subtle bg-surface-raised px-3 py-2"
            aria-label="Wiki source label"
          />
          <Btn size="sm" variant="primary" loading={loading} onClick={() => void addSource()} disabled={!rootPath.trim()}>
            Add source
          </Btn>
        </div>
      </Card>

      {sources.length > 0 && (
        <Card className="p-4 space-y-2">
          <p className="text-3xs uppercase tracking-wider text-fg-faint">Wiki sources</p>
          <ul className="space-y-1">
            {sources.map((s) => (
              <li key={s.id} className="text-2xs font-mono text-fg-secondary flex justify-between gap-2">
                <span>{s.root_path}</span>
                <span className="text-fg-faint">{s.status}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {nodes.length > 0 ? (
        <Card className="p-4 space-y-2">
          <p className="text-3xs uppercase tracking-wider text-fg-faint">Knowledge entities</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {nodes.map((n) => (
              <li key={n.id} className="rounded border border-edge-subtle bg-surface-overlay/30 p-2">
                <p className="text-sm font-medium text-fg">{n.name}</p>
                <p className="text-3xs text-fg-faint uppercase">{n.type}</p>
                {n.summary && <p className="text-2xs text-fg-muted mt-1 line-clamp-3">{n.summary}</p>}
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <p className="text-2xs text-fg-muted">No wiki knowledge indexed yet. Add a source above or run Re-analyze on the Index tab.</p>
      )}
    </div>
  )
}
