import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../lib/supabase'
import { useExploreUx } from '../../lib/exploreModeUx'
import { Btn, Card } from '../ui'
import { ExploreUnderstandEmpty } from './ExploreUnderstandEmpty'
import { readVizToken } from '../../lib/vizTokens'
import { LAYER_COLORS, LAYER_LABELS } from './exploreLayers'
import type { CodebaseUnderstandError } from './exploreUnderstandTypes'
import type { ExploreLayer, ExploreNode } from './exploreTypes'

interface Props {
  node: ExploreNode | null
  projectId?: string
  onClear: () => void
  /** Called when user clicks "View in graph" — parent should switch to graph view */
  onViewInGraph?: () => void
  /** Called when user clicks "Find similar" — parent should switch to Search tab with this query */
  onFindSimilar?: (query: string) => void
  /** Seed the Ask tab with a question about this file */
  onAskAboutFile?: (filePath: string, symbolName: string | null) => void
}

type Complexity = { label: string; pct: number; color: string }

function fileComplexity(lineCount: number | null): Complexity | null {
  if (lineCount == null) return null
  if (lineCount <= 50)   return { label: 'Tiny',   pct: 6,   color: readVizToken('viz-complexity-tiny') }
  if (lineCount <= 200)  return { label: 'Small',   pct: 22,  color: readVizToken('viz-complexity-small') }
  if (lineCount <= 500)  return { label: 'Medium',  pct: 45,  color: readVizToken('viz-complexity-medium') }
  if (lineCount <= 1000) return { label: 'Large',   pct: 68,  color: readVizToken('viz-complexity-large') }
  if (lineCount <= 2000) return { label: 'XLarge',  pct: 84,  color: readVizToken('viz-complexity-xlarge') }
  return                        { label: 'Huge',    pct: 100, color: readVizToken('viz-complexity-huge') }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="text-2xs text-fg-faint hover:text-fg transition-opacity px-1.5 py-0.5 rounded border border-transparent hover:border-edge-subtle"
      title="Copy path"
      aria-label="Copy file path"
    >
      {copied ? (
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M2 7l4 4 6-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="4" y="4" width="8" height="8" rx="1.5" />
          <path d="M10 4V2.5A1.5 1.5 0 0 0 8.5 1h-6A1.5 1.5 0 0 0 1 2.5v6A1.5 1.5 0 0 0 2.5 10H4" />
        </svg>
      )}
    </button>
  )
}

/** Renders a code block with leading line numbers for a content preview. */
function CodePreview({ content, startLine }: { content: string; startLine: number | null }) {
  const lines = content.split('\n')
  return (
    <div className="rounded-md border border-edge-subtle bg-surface-root overflow-hidden font-mono text-2xs leading-5">
      <div className="overflow-x-auto max-h-48">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="hover:bg-surface-overlay/50 group">
                <td
                  className="select-none text-right pr-2 pl-2 text-fg-faint/60 border-r border-edge-subtle/50 w-8 tabular-nums group-hover:text-fg-faint"
                  aria-hidden="true"
                >
                  {startLine != null ? startLine + i : i + 1}
                </td>
                <td className="pl-3 pr-2 text-fg-secondary whitespace-pre">{line || '\u00a0'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function ExploreSymbolPanel({
  node,
  projectId,
  onClear,
  onViewInGraph,
  onFindSimilar,
  onAskAboutFile,
}: Props) {
  const ux = useExploreUx()
  const [summary, setSummary] = useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<CodebaseUnderstandError | null>(null)

  useEffect(() => {
    setSummary(null)
    setSummaryLoading(false)
    setSummaryError(null)
  }, [node?.id])

  const loadSummary = useCallback(async () => {
    if (!node || !projectId) return
    const { file_path, symbol_name } = node.metadata
    setSummaryLoading(true)
    setSummaryError(null)
    const qs = new URLSearchParams({ file_path })
    if (symbol_name) qs.set('symbol_name', symbol_name)
    const res = await apiFetch<{ summary: string; cached?: boolean }>(
      `/v1/admin/projects/${projectId}/codebase/summary?${qs}`,
    )
    setSummaryLoading(false)
    if (!res.ok) {
      if (res.error?.code === 'NO_LLM_KEY' || res.error?.code === 'INDEX_DISABLED') {
        setSummaryError(res.error)
      }
      return
    }
    setSummary(res.data?.summary ?? null)
  }, [node, projectId])

  if (!node) {
    return (
      <Card className="p-3 self-start">
        <p className="text-xs text-fg-muted">
          Click any file to inspect it — path, language, layer, content preview, and linked bug reports.
        </p>
      </Card>
    )
  }

  const { file_path, symbol_name, signature, line_start, line_end, language, layer, content_preview } = node.metadata
  const layerColor = LAYER_COLORS[layer as ExploreLayer]
  const layerLabel = LAYER_LABELS[layer as ExploreLayer] ?? layer

  const lineCount = line_start != null && line_end != null ? line_end - line_start + 1 : null
  const fileStem = file_path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? ''
  const fileExt = file_path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? ''
  const reportLink = fileStem ? `/reports?component=${encodeURIComponent(fileStem)}` : null
  const complexity = fileComplexity(lineCount)
  const similarityQuery = symbol_name ?? (file_path.split('/').pop() ?? '')

  const previewContent = content_preview
    ? content_preview.length > 800 ? content_preview.slice(0, 800) + '\n…' : content_preview
    : null

  return (
    <Card className="p-0 self-start overflow-hidden">
      {/* Header strip with layer color accent */}
      <div
        className="px-3 py-2.5 border-b border-edge-subtle"
        style={{ borderTop: `3px solid ${layerColor ?? 'transparent'}` }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
              <span className="text-2xs uppercase tracking-wider text-fg-faint">
                {symbol_name ? 'Symbol' : 'File'}
              </span>
              {layer && (
                <span
                  className="text-2xs px-1.5 py-px rounded-sm border font-medium"
                  style={{
                    backgroundColor: `${layerColor}18`,
                    borderColor: `${layerColor}40`,
                    color: layerColor,
                  }}
                >
                  {layerLabel}
                </span>
              )}
              {fileExt && (
                <span className="text-2xs px-1 py-px rounded-sm bg-surface-overlay text-fg-faint border border-edge-subtle font-mono">
                  .{fileExt}
                </span>
              )}
              {lineCount != null && (
                <span className="text-2xs text-fg-faint">
                  {lineCount.toLocaleString()} lines
                </span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-fg break-words leading-snug">
              {symbol_name ?? file_path.split('/').pop() ?? file_path}
            </h3>
            {symbol_name && signature && (
              <code className="block text-2xs text-fg-secondary font-mono mt-0.5 break-all opacity-80">{signature}</code>
            )}
          </div>
          <button
            type="button"
            onClick={onClear}
            className="text-fg-faint hover:text-fg-muted p-1 shrink-0 rounded hover:bg-surface-overlay"
            aria-label="Clear selection"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M2 2l6 6M8 2l-6 6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* File path row */}
      <div className="px-3 py-2 border-b border-edge-subtle/60 flex items-center gap-1 bg-surface-overlay/40">
        <code className="text-2xs font-mono text-fg-secondary truncate flex-1 min-w-0" title={file_path}>
          {file_path}
        </code>
        <CopyButton text={file_path} />
      </div>

      {/* Metadata grid */}
      <div className="px-3 py-2 grid grid-cols-2 gap-x-3 gap-y-1.5 border-b border-edge-subtle/60">
        {language && (
          <>
            <span className="text-2xs text-fg-faint">Language</span>
            <span className="text-2xs font-mono text-brand">{language}</span>
          </>
        )}
        {line_start != null && line_end != null && (
          <>
            <span className="text-2xs text-fg-faint">Lines</span>
            <span className="text-2xs font-mono text-fg-secondary">
              {line_start.toLocaleString()}–{line_end.toLocaleString()}
            </span>
          </>
        )}
        <span className="text-2xs text-fg-faint">Node type</span>
        <span className="text-2xs text-fg-secondary">{node.node_type}</span>
        {complexity && (
          <>
            <span className="text-2xs text-fg-faint">Complexity</span>
            <div className="flex items-center gap-1.5">
              <span className="text-2xs font-medium" style={{ color: complexity.color }}>
                {complexity.label}
              </span>
              <div className="flex-1 h-1 rounded-full bg-surface-overlay overflow-hidden">
                <div
                  className="h-full rounded-full transition-[transform,opacity]"
                  style={{ width: `${complexity.pct}%`, backgroundColor: complexity.color }}
                />
              </div>
              {lineCount != null && (
                <span className="text-2xs text-fg-faint tabular-nums">{lineCount.toLocaleString()}</span>
              )}
            </div>
          </>
        )}
        {node.metadata.language_notes && node.metadata.language_notes.length > 0 && (
          <>
            <span className="text-2xs text-fg-faint col-span-2">Language concepts</span>
            <div className="col-span-2 flex flex-wrap gap-1">
              {node.metadata.language_notes.map((note) => (
                <span
                  key={note}
                  className="text-2xs px-1.5 py-0.5 rounded border border-info/30 bg-info-muted/50 text-info-foreground border border-info/25"
                >
                  {note}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Content preview */}
      {previewContent && (
        <div className="px-3 py-2.5 border-b border-edge-subtle/60">
          <div className="text-2xs uppercase tracking-wider text-fg-faint mb-1.5 flex items-center justify-between">
            <span>Preview</span>
            {content_preview && content_preview.length > 800 && (
              <span className="text-2xs text-fg-faint normal-case tracking-normal">truncated</span>
            )}
          </div>
          <CodePreview content={previewContent} startLine={line_start} />
        </div>
      )}

      {/* Plain-English summary */}
      {projectId && (
        <div className="px-3 py-2.5 border-b border-edge-subtle/60 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-2xs uppercase tracking-wider text-fg-faint">Plain English</span>
            {!summary && !summaryLoading && (
              <Btn size="sm" variant="ghost" onClick={() => void loadSummary()} className="h-7 text-2xs px-2">
                Explain this file
              </Btn>
            )}
          </div>
          {summaryError && (
            <ExploreUnderstandEmpty error={summaryError} onRetry={() => void loadSummary()} />
          )}
          {summaryLoading && (
            <p className="text-xs text-fg-muted animate-pulse">Generating summary…</p>
          )}
          {summary && !summaryLoading && (
            <p className={`text-xs text-fg-secondary leading-relaxed ${ux.isAdvanced ? '' : 'line-clamp-6'}`}>
              {summary}
            </p>
          )}
          {!summary && !summaryLoading && !summaryError && (
            <p className="text-2xs text-fg-muted">
              Lazy summary from the indexed chunk — uses your BYOK key once, then caches until the file changes.
            </p>
          )}
        </div>
      )}

      {/* Action links */}
      <div className="px-3 py-2 flex flex-wrap items-center gap-2">
        {onAskAboutFile && (
          <button
            type="button"
            onClick={() => onAskAboutFile(file_path, symbol_name)}
            className="inline-flex items-center gap-1 text-2xs text-brand hover:text-brand/80 border border-brand/30 hover:border-brand/50 rounded-sm px-2 py-1 transition-opacity"
          >
            Ask about this file
          </button>
        )}
        {onViewInGraph && (
          <button
            type="button"
            onClick={onViewInGraph}
            className="inline-flex items-center gap-1 text-2xs text-fg-secondary hover:text-fg border border-edge-subtle hover:border-edge rounded-sm px-2 py-1 transition-opacity"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="4" cy="8" r="2" /><circle cx="12" cy="4" r="2" /><circle cx="12" cy="12" r="2" />
              <path d="M6 7.5l4-2.5M6 8.5l4 2.5" />
            </svg>
            Graph
          </button>
        )}
        {onFindSimilar && (
          <button
            type="button"
            onClick={() => onFindSimilar(similarityQuery)}
            className="inline-flex items-center gap-1 text-2xs text-fg-secondary hover:text-fg border border-edge-subtle hover:border-edge rounded-sm px-2 py-1 transition-opacity"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="6.5" cy="6.5" r="4" /><path d="M10.5 10.5L14 14" strokeLinecap="round" />
            </svg>
            Find similar
          </button>
        )}
        {reportLink && (
          <Link
            to={reportLink}
            className="inline-flex items-center gap-1 text-2xs text-fg-secondary hover:text-fg border border-edge-subtle hover:border-edge rounded-sm px-2 py-1 transition-opacity"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M4 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
              <line x1="5.5" y1="5" x2="10.5" y2="5" /><line x1="5.5" y1="7.5" x2="10.5" y2="7.5" />
            </svg>
            Bug reports
          </Link>
        )}
        <Link
          to="/qa-coverage"
          className="inline-flex items-center gap-1 text-2xs text-fg-secondary hover:text-fg border border-edge-subtle hover:border-edge rounded-sm px-2 py-1 transition-opacity"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M13 2H3a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z" />
            <path d="M13 8H3a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1z" opacity="0.5" />
          </svg>
          Add QA story
        </Link>
      </div>
    </Card>
  )
}
