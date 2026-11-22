import { useState } from 'react'
import { Badge, Input, SegmentedControl } from '../ui'
import { Card } from '../../components/ui'
import { McpToolCard, scopeBadgeTone } from './McpToolCard'
import { SignalChip } from '../report-detail/ReportSurface'
import {
  TOOL_CATALOG,
  RESOURCE_CATALOG,
  PROMPT_CATALOG,
} from '../../lib/mcpCatalog'
import { MCP_USE_CASE_GROUPS } from '../../lib/mcpPageHelpers'
import type { CatalogTabId } from './types'

/**
 * @internal Exported for tests. Tools whose name, title or description has
 * every word of the query. 133 cards stacked into a 7,000 px page with nothing
 * to narrow them (round-3 review 2026-11-19).
 */
export function filterTools<T extends { name: string; title: string; description: string }>(tools: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...tools]
  return tools.filter((t) => {
    const hay = `${t.name} ${t.title} ${t.description}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

export interface McpCatalogPanelProps {
  catalogTab: CatalogTabId
  catalogOptions: Array<{ id: CatalogTabId; label: string; count?: number }>
  onCatalogTab: (tab: CatalogTabId) => void
  toolCount: number
}

export function McpCatalogPanel({
  catalogTab,
  catalogOptions,
  onCatalogTab,
}: McpCatalogPanelProps) {
  const [query, setQuery] = useState('')
  const matches = filterTools(TOOL_CATALOG, query)
  const searching = query.trim() !== ''
  const readTools = matches.filter((t) => t.scope === 'mcp:read')
  const writeTools = matches.filter((t) => t.scope === 'mcp:write')

  return (
    <div className="space-y-4" data-dav-anchor="mcp:verify">
      <SegmentedControl
        value={catalogTab}
        onChange={onCatalogTab}
        options={catalogOptions}
        ariaLabel="MCP catalog sections"
      />

      {catalogTab === 'tools' && (
        <div className="space-y-6">
          <div className="max-w-sm">
            <Input
              type="search"
              aria-label="Search tools"
              placeholder="Search tools, e.g. fix or lessons"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="mcp-tool-search"
            />
          </div>
          {searching && matches.length === 0 && (
            <p className="text-sm text-fg-muted">No tool matches “{query.trim()}”.</p>
          )}
          {!searching && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-fg">By use-case</p>
              <span className="text-2xs text-fg-faint">(quick orientation)</span>
            </div>
            {MCP_USE_CASE_GROUPS.map((group) => {
              const groupTools = TOOL_CATALOG.filter((t) => group.tools.includes(t.name))
              if (groupTools.length === 0) return null
              return (
                <Card key={group.label}  className="p-3">
                  <p className="text-xs font-semibold text-fg mb-0.5">{group.label}</p>
                  <p className="text-2xs text-fg-muted mb-2">{group.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {groupTools.map((t) => (
                      <span
                        key={t.name}
                        className="font-mono text-2xs rounded-sm bg-surface-overlay px-1.5 py-px text-fg-secondary"
                        title={t.useCase}
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                </Card>
              )
            })}
          </div>
          )}

          {readTools.length > 0 && (
          <div>
            <SignalChip tone="info" className="mb-2 uppercase tracking-wider font-medium">
              Read — always safe to loop on ({readTools.length})
            </SignalChip>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2" data-testid="mcp-tool-catalog-read">
              {readTools.map((tool) => (
                <McpToolCard key={tool.name} tool={tool} />
              ))}
            </div>
          </div>
          )}
          {writeTools.length > 0 && (
          <div>
            <SignalChip tone="warn" className="mb-2 uppercase tracking-wider font-medium">
              Write — mutate project state ({writeTools.length})
            </SignalChip>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2" data-testid="mcp-tool-catalog-write">
              {writeTools.map((tool) => (
                <McpToolCard key={tool.name} tool={tool} />
              ))}
            </div>
          </div>
          )}
        </div>
      )}

      {catalogTab === 'resources' && (
        <div className="space-y-2" data-testid="mcp-resource-catalog">
          {RESOURCE_CATALOG.map((r) => (
            <div
              key={r.name}
              // mushi-mushi-allowlist: hand-rolled surface (cn/template; not Card tile)
              className="rounded-md border border-edge-subtle bg-surface-raised p-3 motion-safe:transition-opacity hover:border-edge"
            >
              <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                <SignalChip tone="neutral" className="font-mono text-xs wrap-anywhere max-w-full">
                  {r.uri}
                </SignalChip>
                <Badge className={scopeBadgeTone(r.scope)}>{r.scope}</Badge>
              </div>
              <p className="text-xs leading-snug text-fg-muted [overflow-wrap:anywhere]">{r.description}</p>
            </div>
          ))}
        </div>
      )}

      {catalogTab === 'prompts' && (
        <div className="space-y-2" data-testid="mcp-prompt-catalog">
          {PROMPT_CATALOG.map((p) => (
            <div
              key={p.name}
              // mushi-mushi-allowlist: hand-rolled surface (cn/template; not Card tile)
              className="rounded-md border border-edge-subtle bg-surface-raised p-3 motion-safe:transition-opacity hover:border-edge"
            >
              <div className="text-sm font-semibold text-fg">{p.title}</div>
              <SignalChip tone="neutral" className="font-mono text-2xs mt-0.5 mb-1">
                /{p.name}
              </SignalChip>
              <p className="text-xs leading-snug text-fg-muted [overflow-wrap:anywhere]">{p.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
