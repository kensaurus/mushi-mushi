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
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mushi-vermillion)] ${
                  active
                    ? 'border-[var(--mushi-ink)] bg-[var(--mushi-ink)] text-[var(--mushi-paper)]'
                    : 'border-[var(--mushi-rule)] bg-[var(--mushi-paper)] text-[var(--mushi-ink-muted)] hover:border-[color-mix(in_oklch,var(--mushi-ink)_30%,var(--mushi-rule))] hover:text-[var(--mushi-ink)]'
                }`}
              >
                {FILTER_LABELS[key]}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
                    active
                      ? 'bg-[var(--mushi-paper)]/20 text-current'
                      : 'bg-[var(--mushi-paper-wash)] text-[var(--mushi-ink-muted)]'
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
            className="w-full rounded-full border border-[var(--mushi-rule)] bg-[var(--mushi-paper)] px-3 py-1.5 text-sm text-[var(--mushi-ink)] placeholder:text-[var(--mushi-ink-faint)] focus:border-[color-mix(in_oklch,var(--mushi-ink)_40%,var(--mushi-rule))] focus:outline-none focus:ring-2 focus:ring-[var(--mushi-vermillion-wash)]"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-[var(--mushi-rule)] px-6 py-10 text-center text-sm text-[var(--mushi-ink-muted)]">
          No migration guides match{' '}
          {query ? <>&ldquo;{query}&rdquo;</> : <>this filter</>}.{' '}
          <a
            href="https://github.com/kensaurus/mushi-mushi/issues/new?labels=migration-request"
            className="text-[var(--mushi-vermillion)] underline underline-offset-2 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mushi-vermillion)]"
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
                className={`group block h-full rounded-xl border p-4 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mushi-vermillion)] ${
                  g.status === 'draft'
                    ? 'border-dashed border-[var(--mushi-rule)] bg-[var(--mushi-paper-wash)] hover:border-[color-mix(in_oklch,var(--mushi-ink)_20%,var(--mushi-rule))]'
                    : 'border-[var(--mushi-rule)] bg-[var(--mushi-paper)] hover:border-[color-mix(in_oklch,var(--mushi-ink)_30%,var(--mushi-rule))] hover:shadow-[0_4px_16px_-8px_rgba(14,13,11,0.15)]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold text-[var(--mushi-ink)]">
                    {g.title}
                  </h3>
                  {g.status === 'draft' && (
                    <span className="shrink-0 rounded-full border border-[var(--mushi-rule)] px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-[var(--mushi-ink-muted)]">
                      draft
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-sm text-[var(--mushi-ink-muted)]">
                  {g.summary}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-[var(--mushi-paper-wash)] px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide text-[var(--mushi-ink-muted)]">
                    {CATEGORY_LABELS[g.category]}
                  </span>
                  <EffortBadge level={g.effort} />
                  <RiskBadge level={g.risk} />
                  <span className="ml-auto text-xs text-[var(--mushi-ink-faint)] transition group-hover:text-[var(--mushi-ink-muted)]">
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
