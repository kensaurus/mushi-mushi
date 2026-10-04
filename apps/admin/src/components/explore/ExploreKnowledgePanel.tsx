import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { Btn, Card } from '../ui'
import { apiErrorMessage } from '../../lib/humanizeApiError'
import { CHIP_TONE } from '../../lib/chipTone'
import { ExploreUnderstandEmpty } from './ExploreUnderstandEmpty'
import type { CodebaseUnderstandError } from './exploreUnderstandTypes'

interface WikiSource {
  id: string
  kind: string
  root_path: string
  label: string | null
  status: string
  error?: string | null
}

const STATUS_COPY: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Waiting to be read', tone: CHIP_TONE.neutral },
  indexing: { label: 'Reading docs…', tone: CHIP_TONE.brandSubtle },
  ready: { label: 'Ready', tone: CHIP_TONE.okSubtle },
  failed: { label: 'Failed', tone: CHIP_TONE.dangerSubtle },
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
  const [addError, setAddError] = useState<string | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!projectId) return
    const [srcRes, graphRes] = await Promise.all([
      apiFetch<{ sources: WikiSource[] }>(`/v1/admin/projects/${projectId}/codebase/wiki/sources`),
      apiFetch<{ graphs: Array<{ graph: { nodes?: KnowledgeNode[] } }> }>(
        `/v1/admin/projects/${projectId}/codebase/knowledge/graph`,
      ),
    ])
    if (!srcRes.ok && srcRes.error?.code === 'FORBIDDEN') {
      setFatalError({ code: 'FORBIDDEN', message: srcRes.error.message })
      return
    }
    if (srcRes.ok && srcRes.data?.sources) setSources(srcRes.data.sources)
    // Every source's entities, not just the newest graph row.
    const graphNodes = (graphRes.data?.graphs ?? []).flatMap((g) => g.graph?.nodes ?? [])
    setNodes(graphNodes.slice(0, 40))
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload])

  // Reading a docs folder takes seconds to a minute; keep the list live
  // while any source is still waiting or being read.
  const busy = sources.some((s) => s.status === 'pending' || s.status === 'indexing')
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => void reload(), 4000)
    return () => clearInterval(t)
  }, [busy, reload])

  const retrySource = useCallback(
    async (id: string) => {
      setRetryingId(id)
      const res = await apiFetch(`/v1/admin/projects/${projectId}/codebase/wiki/sources/${id}/retry`, { method: 'POST' })
      setRetryingId(null)
      if (!res.ok) setAddError(apiErrorMessage(res.error, 'Could not restart reading this source. Try again.'))
      void reload()
    },
    [projectId, reload],
  )

  const addSource = useCallback(async () => {
    if (!rootPath.trim() || !projectId) return
    setLoading(true)
    setFatalError(null)
    setAddError(null)
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
      if (res.error?.code === 'FORBIDDEN') {
        setFatalError({ code: 'FORBIDDEN', message: res.error.message })
      } else {
        setAddError(apiErrorMessage(res.error, 'Could not add the source. Try again.'))
      }
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
        <p className="text-2xs text-fg-faint">
          Mushi reads the Markdown and text files in that folder of your connected GitHub repo. It needs GitHub access to that repo.
        </p>
        {addError ? <p className="text-2xs text-danger" role="alert">{addError}</p> : null}
      </Card>

      {sources.length > 0 && (
        <Card className="p-4 space-y-2">
          <p className="text-3xs uppercase tracking-wider text-fg-faint">Wiki sources</p>
          <ul className="space-y-2">
            {sources.map((s) => {
              const status = STATUS_COPY[s.status] ?? { label: s.status, tone: CHIP_TONE.neutral }
              return (
                <li key={s.id} className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-2xs">
                    <span className="font-mono text-fg-secondary">
                      {s.label ? `${s.label} · ` : ''}
                      {s.root_path}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={`rounded-full px-1.5 py-0.5 text-3xs ${status.tone}`}>{status.label}</span>
                      {s.status === 'failed' || s.status === 'ready' ? (
                        <Btn
                          size="sm"
                          variant="ghost"
                          loading={retryingId === s.id}
                          onClick={() => void retrySource(s.id)}
                        >
                          {s.status === 'failed' ? 'Retry' : 'Re-read'}
                        </Btn>
                      ) : null}
                    </span>
                  </div>
                  {s.status === 'failed' && s.error ? <p className="text-2xs text-danger">{s.error}</p> : null}
                </li>
              )
            })}
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
        <p className="text-2xs text-fg-muted">
          {busy
            ? 'Reading your docs. Entities appear here when it finishes.'
            : sources.length > 0
              ? 'No knowledge entities yet. Check the source status above.'
              : 'No docs added yet. Add a folder above, such as docs/.'}
        </p>
      )}
    </div>
  )
}
