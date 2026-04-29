'use client'

/**
 * FILE: apps/docs/components/MigrationHub.tsx
 * PURPOSE: Filterable, searchable grid that drives the /migrations index page.
 *
 *   <MigrationHub guides={CATALOG} />
 *
 * UX
 *   - Category chips group guides into Mobile / Web / Switch to Mushi /
 *     SDK upgrade. The "All" chip resets to the full list.
 *   - Free-text search matches title, summary, and the optional fromLabel
 *     (so typing "instabug" or "luciq" both find the same guide).
 *   - Effort + risk badges render on every card so users can pick by
 *     "what fits in my afternoon" without opening anything.
 *   - Empty-state guides users to file an issue requesting a new guide.
 *
 * NOT in scope:
 *   - Sorting controls. The catalog order is editorially curated; sorting
 *     here would let users re-order it but also lets them hide what we
 *     consider the most-relevant guide. Skip until users ask.
 *   - Personalisation ("guides for your stack"). That's the CLI's job
 *     (`mushi migrate`) — keeping the docs hub framework-agnostic so it
 *     stays useful pre-install.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type GuideMeta,
  type MigrationCategory,
} from '../content/migrations/_catalog'
import { EffortBadge, RiskBadge } from './MigrationBadges'

interface Props {
  guides: readonly GuideMeta[]
}

type FilterKey = 'all' | MigrationCategory

const FILTER_ORDER: readonly FilterKey[] = ['all', ...CATEGORY_ORDER]

const FILTER_LABELS: Record<FilterKey, string> = {
  all: 'All',
  ...CATEGORY_LABELS,
}

function matches(guide: GuideMeta, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return (
    guide.title.toLowerCase().includes(q) ||
    guide.summary.toLowerCase().includes(q) ||
    (guide.fromLabel ?? '').toLowerCase().includes(q) ||
    guide.slug.toLowerCase().includes(q)
  )
}

export function MigrationHub({ guides }: Props) {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [query, setQuery] = useState('')

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = {
      all: guides.length,
      mobile: 0,
      web: 0,
      competitor: 0,
      'sdk-upgrade': 0,
    }
    for (const g of guides) c[g.category] += 1
    return c
  }, [guides])

  const filtered = useMemo(
    () =>
      guides.filter((g) => (filter === 'all' || g.category === filter) && matches(g, query)),
    [guides, filter, query],
  )

  return (
    <div className="not-prose my-6">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Filter migrations" className="flex flex-wrap gap-1">
          {FILTER_ORDER.map((key) => {
            const active = filter === key
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  active
                    ? 'border-neutral-900 bg-neutral-900 text-neutral-50 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                    : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:text-neutral-100'
                }`}
              >
                {FILTER_LABELS[key]}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                    active
                      ? 'bg-white/15 text-current'
                      : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
                  }`}
                >
                  {counts[key]}
                </span>
              </button>
            )
          })}
        </div>
        <div className="ml-auto w-full sm:w-auto sm:min-w-[16rem]">
          <label className="sr-only" htmlFor="migration-search">
            Search migrations
          </label>
          <input
            id="migration-search"
            type="search"
            placeholder="Search migrations…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-200 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-600 dark:focus:ring-neutral-800"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-neutral-300 px-6 py-10 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          No migration guides match{' '}
          {query ? <>&ldquo;{query}&rdquo;</> : <>this filter</>}.{' '}
          <a
            href="https://github.com/kensaurus/mushi-mushi/issues/new?labels=migration-request"
            className="underline underline-offset-2 hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            Request one →
          </a>
        </div>
      ) : (
        <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((g) => (
            <li key={g.slug}>
              {/* next/link prepends the configured `basePath` (set by
                  MUSHI_BASE_PATH at build time, see apps/docs/next.config.mjs).
                  A plain <a href="/migrations/..."> would resolve against the
                  origin root and 404 on the kensaur.us/mushi-mushi/docs
                  deployment because that prefix isn't applied to raw href
                  attributes. */}
              <Link
                href={`/migrations/${g.slug}`}
                className={`group block h-full rounded-xl border p-4 transition ${
                  g.status === 'draft'
                    ? 'border-dashed border-neutral-300 bg-neutral-50 hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-950'
                    : 'border-neutral-200 bg-white hover:border-neutral-400 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-neutral-600'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                    {g.title}
                  </h3>
                  {g.status === 'draft' && (
                    <span className="shrink-0 rounded-full border border-neutral-300 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                      draft
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">
                  {g.summary}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                    {CATEGORY_LABELS[g.category]}
                  </span>
                  <EffortBadge level={g.effort} />
                  <RiskBadge level={g.risk} />
                  <span className="ml-auto text-xs text-neutral-400 transition group-hover:text-neutral-600 dark:text-neutral-500 dark:group-hover:text-neutral-300">
                    Read →
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
