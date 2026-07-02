import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { LAYER_COLORS, LAYER_LABELS, LAYER_ORDER } from './exploreLayers'
import type { ExploreLayer, ExploreSearchHit } from './exploreTypes'
import { ContainedBlock, InlineProof } from '../report-detail/ReportSurface'
import { EmptySectionMessage } from '../report-detail/ReportClassification'
import { CHIP_TONE } from '../../lib/chipTone'

interface Props {
  projectId: string
  /** Called with matched node ids so the canvas can highlight them. */
  onHighlight: (ids: Set<string>) => void
  /** Called when the user clicks a result row */
  onSelectHit: (hit: ExploreSearchHit) => void
  /** Pre-populate the search with this query (e.g. from "Find similar" in the symbol panel). */
  seedQuery?: string
  /** Called after the seed query has been consumed (so the parent can clear it). */
  onSeedConsumed?: () => void
}

const DEBOUNCE_MS = 500

const EXAMPLE_QUERIES = [
  'authentication and session handling',
  'database connection setup',
  'error handling middleware',
  'user permissions and access control',
  'payment processing logic',
  'file upload handling',
  'API rate limiting',
  'logging and telemetry',
]

/** Visual similarity bar: green above 70%, amber 50-70%, red below 50% */
function SimilarityBar({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color =
    pct >= 70 ? 'oklch(0.70 0.18 145)' :
    pct >= 50 ? 'oklch(0.70 0.18 80)' :
                'oklch(0.60 0.14 30)'
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <div className="w-12 h-1.5 rounded-full bg-surface-overlay overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-2xs font-mono tabular-nums" style={{ color }} title="Semantic similarity score">
        {pct}%
      </span>
    </div>
  )
}

type SearchMode = 'semantic' | 'name'

export function ExploreSearchBar({ projectId, onHighlight, onSelectHit, seedQuery, onSeedConsumed }: Props) {
  const [query, setQuery] = useState(seedQuery ?? '')
  const [mode, setMode] = useState<SearchMode>('semantic')
  const [results, setResults] = useState<ExploreSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeLayer, setActiveLayer] = useState<ExploreLayer | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      onHighlight(new Set())
      return
    }
    setSearching(true)
    setError(null)
    try {
      const res = await apiFetch<{ results: ExploreSearchHit[]; query: string }>(
        `/v1/admin/projects/${projectId}/codebase/search`,
        { method: 'POST', body: JSON.stringify({ query: q.trim(), k: 20, mode }) },
      )
      if (!res.ok) {
        setError(res.error?.message ?? 'Search failed')
        setResults([])
        onHighlight(new Set())
        return
      }
      const hits = res.data?.results ?? []
      setResults(hits)
      onHighlight(new Set(hits.map((h) => h.id)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
      // Clear stale results and highlights so the error state is consistent —
      // showing old hits while an error banner is displayed is misleading.
      setResults([])
      onHighlight(new Set())
    } finally {
      setSearching(false)
    }
  }, [projectId, onHighlight, mode])

  // Consume seed query from parent (e.g. "Find similar" button in symbol panel).
  // Only fires when seedQuery changes — intentionally excludes `query` and
  // `onSeedConsumed` from deps to avoid re-firing on every keystroke.
  const seedQueryRef = useRef(seedQuery)
  useEffect(() => {
    const prev = seedQueryRef.current
    seedQueryRef.current = seedQuery
    if (seedQuery && seedQuery !== prev) {
      setQuery(seedQuery)
      onSeedConsumed?.()
    }
  }, [seedQuery, onSeedConsumed])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) {
      setResults([])
      setError(null)
      onHighlight(new Set())
      return
    }
    debounceRef.current = setTimeout(() => { void runSearch(query) }, DEBOUNCE_MS)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, runSearch, onHighlight])

  const filteredResults = useMemo(() => {
    if (!activeLayer) return results
    return results.filter((r) => r.layer === activeLayer)
  }, [results, activeLayer])

  // Layers that appear in the current result set (for the filter tab strip)
  const presentLayers = useMemo(() => {
    const s = new Set(results.map((r) => r.layer))
    return LAYER_ORDER.filter((l) => s.has(l))
  }, [results])

  const clearSearch = () => {
    setQuery('')
    setResults([])
    setActiveLayer(null)
    inputRef.current?.focus()
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode('semantic')}
          className={`text-2xs px-2.5 py-1 rounded-md border ${
            mode === 'semantic'
              ? 'border-brand/40 bg-brand/10 text-fg'
              : 'border-edge-subtle text-fg-muted hover:text-fg'
          }`}
        >
          Semantic
        </button>
        <button
          type="button"
          onClick={() => setMode('name')}
          className={`text-2xs px-2.5 py-1 rounded-md border ${
            mode === 'name'
              ? 'border-brand/40 bg-brand/10 text-fg'
              : 'border-edge-subtle text-fg-muted hover:text-fg'
          }`}
        >
          Name
        </button>
      </div>
      {/* Search input */}
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint pointer-events-none" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="6.5" cy="6.5" r="4" />
            <path d="M10.5 10.5L14 14" strokeLinecap="round" />
          </svg>
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Describe what you're looking for…"
          className="w-full rounded-md border border-edge bg-surface-raised pl-9 pr-9 py-2.5 text-sm text-fg placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:border-brand/50"
          aria-label="Semantic codebase search"
        />
        {searching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-faint" aria-label="Searching…">
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.3" />
              <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
        )}
        {!searching && query && (
          <button
            type="button"
            onClick={clearSearch}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-faint hover:text-fg p-0.5 rounded"
            aria-label="Clear search"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {error && (
        <div className={`text-2xs rounded-sm border px-3 py-2 ${CHIP_TONE.dangerSubtle}`}>
          {error}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-2">
          {/* Layer filter strip */}
          {presentLayers.length > 1 && (
            <div className="flex items-center gap-1 flex-wrap">
              <button
                type="button"
                onClick={() => setActiveLayer(null)}
                className={[
                  'text-2xs px-2 py-0.5 rounded-sm border transition-colors',
                  activeLayer === null
                    ? 'border-edge bg-surface-overlay text-fg font-medium'
                    : 'border-edge-subtle bg-surface-raised text-fg-secondary hover:text-fg hover:border-edge',
                ].join(' ')}
              >
                All ({results.length})
              </button>
              {presentLayers.map((l) => {
                const count = results.filter((r) => r.layer === l).length
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setActiveLayer(l)}
                    className={[
                      'text-2xs px-2 py-0.5 rounded-sm border transition-colors flex items-center gap-1',
                      activeLayer === l
                        ? 'border-current font-medium'
                        : 'border-edge-subtle bg-surface-raised hover:border-current',
                    ].join(' ')}
                    style={{
                      color: LAYER_COLORS[l],
                      backgroundColor: activeLayer === l ? `${LAYER_COLORS[l]}18` : undefined,
                    }}
                  >
                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: LAYER_COLORS[l] }} aria-hidden="true" />
                    {LAYER_LABELS[l]} ({count})
                  </button>
                )
              })}
            </div>
          )}

          <InlineProof>
            {filteredResults.length} result{filteredResults.length !== 1 ? 's' : ''}
            {activeLayer ? ` in ${LAYER_LABELS[activeLayer]}` : ''} — most relevant first
          </InlineProof>

          <div className="space-y-1.5">
            {filteredResults.map((hit) => (
              <button
                key={hit.id}
                type="button"
                onClick={() => onSelectHit(hit)}
                className="w-full text-left rounded-md border border-edge-subtle bg-surface-raised hover:bg-surface-overlay hover:border-edge transition-colors p-3 space-y-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
                style={{ borderLeft: `3px solid ${LAYER_COLORS[hit.layer as ExploreLayer] ?? LAYER_COLORS.other}` }}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <code className="text-2xs font-mono text-fg font-semibold">
                        {hit.symbol_name ?? hit.file_path.split('/').pop()}
                      </code>
                      {hit.layer && (
                        <span
                          className="text-2xs px-1 py-px rounded-sm border"
                          style={{
                            backgroundColor: `${LAYER_COLORS[hit.layer as ExploreLayer]}15`,
                            borderColor: `${LAYER_COLORS[hit.layer as ExploreLayer]}35`,
                            color: LAYER_COLORS[hit.layer as ExploreLayer],
                          }}
                        >
                          {LAYER_LABELS[hit.layer as ExploreLayer] ?? hit.layer}
                        </span>
                      )}
                    </div>
                    <div className="text-2xs text-fg-faint font-mono mt-0.5 truncate">{hit.file_path}</div>
                  </div>
                  <SimilarityBar score={hit.similarity} />
                </div>
                {hit.content_preview && (
                  <pre className="mushi-code-block mushi-code-body text-2xs font-mono rounded-sm px-2.5 py-1.5 overflow-hidden max-h-16 whitespace-pre-wrap break-words leading-5">
                    {hit.content_preview.slice(0, 240)}
                  </pre>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {!searching && !error && query.trim() && results.length === 0 && (
        <div className="py-6">
          <EmptySectionMessage text="No matching files found — try rephrasing your query." />
        </div>
      )}

      {/* Empty state with examples */}
      {!query && (
        <ContainedBlock tone="muted" className="space-y-3">
          <div>
            <div className="text-2xs font-semibold text-fg mb-0.5">Semantic search</div>
            <p className="text-2xs text-fg-muted leading-relaxed">
              Search by meaning, not exact filenames — describe what you are looking for in a sentence or two.
            </p>
          </div>
          <div>
            <div className="text-2xs uppercase tracking-wider text-fg-faint mb-1.5">Example queries</div>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLE_QUERIES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setQuery(ex)}
                  className="text-2xs px-2 py-1 rounded-md border border-edge-subtle bg-surface-overlay text-fg-secondary hover:text-fg hover:border-edge hover:bg-surface-overlay transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        </ContainedBlock>
      )}
    </div>
  )
}
