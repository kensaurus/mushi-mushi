import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { Btn, Card, Badge } from '../ui'
import { ExploreUnderstandEmpty } from './ExploreUnderstandEmpty'
import type { CodebaseUnderstandError, DomainExtractionSource, DomainView } from './exploreUnderstandTypes'

interface Props {
  projectId: string
  onFileClick?: (filePath: string) => void
}

export function ExploreDomainsPanel({ projectId, onFileClick }: Props) {
  const [domains, setDomains] = useState<DomainView[]>([])
  const [source, setSource] = useState<DomainExtractionSource | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CodebaseUnderstandError | null>(null)
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null)

  const load = useCallback(async (force = false) => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    const res = await apiFetch<{ domains: DomainView[]; source?: DomainExtractionSource }>(
      `/v1/admin/projects/${projectId}/codebase/domains${force ? '?force=1' : ''}`,
    )
    setLoading(false)
    if (!res.ok) {
      setError(res.error ?? { code: 'LOAD_FAILED', message: 'Failed to load domains' })
      return
    }
    setDomains(res.data?.domains ?? [])
    setSource(res.data?.source ?? null)
    if (res.data?.domains?.[0]) setExpandedDomain(res.data.domains[0].id)
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  if (error && (error.code === 'NO_LLM_KEY' || error.code === 'INDEX_DISABLED' || error.code === 'FORBIDDEN')) {
    return <ExploreUnderstandEmpty error={error} onRetry={() => void load()} />
  }

  if (loading && domains.length === 0) {
    return (
      <Card className="p-4 animate-pulse" aria-hidden>
        <div className="h-4 w-48 rounded bg-surface-overlay mb-3" />
        <div className="h-24 rounded bg-surface-overlay/60" />
      </Card>
    )
  }

  if (domains.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-sm text-fg-muted">No domains extracted yet.</p>
        <Btn size="sm" variant="ghost" className="mt-2" onClick={() => void load(true)}>
          Retry
        </Btn>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-fg-secondary">
          Business domains → user flows → implementation files (LLM-extracted from the index).
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {source === 'fallback' && (
            <Badge className="bg-warn/15 text-warning-foreground">
              Layer fallback
            </Badge>
          )}
          {source === 'llm' && (
            <Badge className="bg-ok/15 text-ok">LLM extracted</Badge>
          )}
          <Btn size="sm" variant="ghost" onClick={() => void load(true)} loading={loading}>
            Refresh
          </Btn>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {domains.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setExpandedDomain(d.id)}
            className={[
              'shrink-0 px-3 py-2 rounded-md border text-left min-w-[140px] max-w-[220px] transition-colors',
              expandedDomain === d.id
                ? 'border-brand/50 bg-brand/10'
                : 'border-edge-subtle bg-surface-overlay/40 hover:border-brand/30',
            ].join(' ')}
          >
            <p className="text-sm font-medium text-fg truncate">{d.name}</p>
            <p className="text-2xs text-fg-muted line-clamp-2 mt-0.5">{d.description}</p>
          </button>
        ))}
      </div>

      {domains
        .filter((d) => d.id === expandedDomain)
        .map((domain) => (
          <Card key={domain.id} className="p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-fg">{domain.name}</h3>
              <p className="text-xs text-fg-muted mt-1">{domain.description}</p>
            </div>
            <div className="space-y-3">
              {domain.flows.map((flow) => (
                <div key={flow.id} className="border border-edge-subtle rounded-md p-3 bg-surface-overlay/20">
                  <p className="text-sm font-medium text-fg">{flow.name}</p>
                  <p className="text-2xs text-fg-muted mt-0.5">{flow.description}</p>
                  <ol className="mt-2 space-y-2">
                    {flow.steps.map((step, si) => (
                      <li key={step.id} className="flex gap-2 items-start">
                        <span className="text-2xs font-mono text-brand tabular-nums shrink-0 pt-0.5">
                          {si + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-fg">{step.name}</p>
                          <p className="text-2xs text-fg-muted">{step.description}</p>
                          {step.file_paths.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {step.file_paths.slice(0, 4).map((fp) => (
                                <button
                                  key={fp}
                                  type="button"
                                  onClick={() => onFileClick?.(fp)}
                                  className="text-2xs font-mono px-1 py-0.5 rounded border border-edge-subtle hover:border-brand/40 truncate max-w-full"
                                >
                                  {fp.split('/').pop() ?? fp}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </Card>
        ))}
    </div>
  )
}
