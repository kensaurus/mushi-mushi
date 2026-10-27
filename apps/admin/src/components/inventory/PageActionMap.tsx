/**
 * FILE: apps/admin/src/components/inventory/PageActionMap.tsx
 * PURPOSE: The story map at the top of /inventory: one card per page of the
 *          app, with what a user can do on it underneath (page → action).
 *          Broken actions (regressed, or a stub with no code behind it) are
 *          red and sort first, so the page answers "what broke?" before
 *          "what exists?". Plain list markup: works at phone width.
 */

import { Badge } from '../ui'
import type { TreeRow } from './InventoryTree'

type ActionHealth = 'broken' | 'warn' | 'ok' | 'unknown'

interface MappedAction {
  row: TreeRow
  health: ActionHealth
}

interface MappedPage {
  path: string
  actions: MappedAction[]
  broken: number
}

/** @internal Exported for tests only. stub = the button does nothing; regressed = it worked and stopped. */
export function actionHealth(status: string | null | undefined): ActionHealth {
  switch ((status ?? '').toLowerCase()) {
    case 'regressed':
    case 'stub':
      return 'broken'
    case 'mocked':
      return 'warn'
    case 'verified':
    case 'wired':
      return 'ok'
    default:
      return 'unknown'
  }
}

const HEALTH_RANK: Record<ActionHealth, number> = { broken: 0, warn: 1, unknown: 2, ok: 3 }

/** @internal Exported for tests only. Rows grouped by page; pages with broken actions first, broken actions first within a page. */
export function buildPageActionMap(rows: readonly TreeRow[]): MappedPage[] {
  const byPath = new Map<string, MappedAction[]>()
  for (const row of rows) {
    const list = byPath.get(row.pagePath) ?? []
    list.push({ row, health: actionHealth(row.status) })
    byPath.set(row.pagePath, list)
  }
  const pages: MappedPage[] = [...byPath.entries()].map(([path, actions]) => ({
    path,
    actions: [...actions].sort((a, b) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health]),
    broken: actions.filter((a) => a.health === 'broken').length,
  }))
  return pages.sort((a, b) => b.broken - a.broken || a.path.localeCompare(b.path))
}

const DOT: Record<ActionHealth, string> = {
  broken: 'bg-danger',
  warn: 'bg-warn',
  ok: 'bg-ok',
  unknown: 'bg-fg-faint',
}

const HEALTH_WORD: Record<ActionHealth, string> = {
  broken: 'broken',
  warn: 'uses fake data',
  ok: 'works',
  unknown: 'not checked yet',
}

/** Actions shown per page before "+N more" sends the user to the full list. */
const ACTIONS_PER_PAGE = 8

export function PageActionMap({
  rows,
  onSelect,
  onShowAll,
}: {
  rows: readonly TreeRow[]
  onSelect?: (row: TreeRow) => void
  onShowAll?: () => void
}) {
  const pages = buildPageActionMap(rows)
  if (pages.length === 0) return null
  return (
    <section aria-labelledby="inventory-page-map" className="space-y-2" data-testid="inventory-page-map">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="inventory-page-map" className="text-sm font-semibold text-fg">
          Your app, page by page
        </h2>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-muted">
          {(['broken', 'warn', 'ok', 'unknown'] as const).map((h) => (
            <span key={h} className="inline-flex items-center gap-1">
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${DOT[h]}`} />
              {HEALTH_WORD[h]}
            </span>
          ))}
        </p>
      </div>
      <ul className="grid list-none gap-2 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {pages.map((page) => {
          const shown = page.actions.slice(0, ACTIONS_PER_PAGE)
          const more = page.actions.length - shown.length
          return (
            <li
              key={page.path}
              data-testid="inventory-page-map-page"
              className={`min-w-0 rounded-md border bg-surface-raised p-3 ${page.broken > 0 ? 'border-danger/40' : 'border-edge-subtle'}`}
            >
              <div className="mb-2 flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate font-mono text-xs text-fg" title={page.path}>
                  {page.path}
                </span>
                {page.broken > 0 ? (
                  <Badge tone="dangerSubtle" className="ml-auto shrink-0">
                    {page.broken} broken
                  </Badge>
                ) : null}
              </div>
              <ul className="list-none space-y-0.5 p-0">
                {shown.map(({ row, health }) => (
                  <li key={row.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onSelect?.(row)}
                      title={`${row.actionLabel}: ${HEALTH_WORD[health]}`}
                      data-health={health}
                      className={`flex w-full min-w-0 items-center gap-2 rounded-sm px-1 py-0.5 text-left text-xs hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${health === 'broken' ? 'font-medium text-danger' : 'text-fg-secondary'}`}
                    >
                      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT[health]}`} />
                      <span className="min-w-0 truncate">{row.actionLabel}</span>
                      <span className="sr-only">: {HEALTH_WORD[health]}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {more > 0 && onShowAll ? (
                <button
                  type="button"
                  onClick={onShowAll}
                  className="mt-1 rounded-sm px-1 text-2xs text-fg-muted underline-offset-2 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                >
                  +{more} more
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
