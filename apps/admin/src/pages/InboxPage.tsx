/**
 * FILE: apps/admin/src/pages/InboxPage.tsx
 * PURPOSE: Wave T (2026-04-23) — global Action Inbox. One card per
 *          actionable stage, grouped by PDCA phase, deriving each card
 *          from `computeNextBestAction` with live counts sourced from
 *          the existing `/v1/admin/dashboard` aggregate. Reusing the
 *          dashboard endpoint avoids a new round-trip + keeps the
 *          inbox's headline numbers consistent with the cards on the
 *          dashboard itself.
 *
 *          Wave U (2026-05-07) — operator feedback rebuild:
 *            - **Hero KPI strip at the top** — open count, clear count,
 *              and a freshness pill replace the old all-text page header.
 *              The first thing the eye lands on is "do I have anything
 *              to act on?" rather than five sub-headers titled "All
 *              clear".
 *            - **Filter chips** — quick toggles for All / Open / each
 *              PDCA stage so the page works as a focused worklist when
 *              the inbox grows beyond a single screen.
 *            - **Open actions list** — every card with an action gets
 *              promoted out of its PDCA section into a single priority
 *              list, severity-tinted, with a "stage" eyebrow so the
 *              operator never loses the PDCA mapping. This is the
 *              single biggest win — open work is now front and centre
 *              regardless of which stage it belongs to.
 *            - **Cleared stages strip** — pages with `null` action
 *              collapse from full-width "All clear" cards into a chip
 *              row with a check + page link. Saves ~60% vertical space
 *              on a fully-clean inbox while still keeping every page
 *              one click away.
 *
 *          Design principles:
 *            - No dead buttons — every card has a primary CTA that links
 *              to the page where the action actually happens.
 *            - `computeNextBestAction` returns `null` for "nothing to do"
 *              which we render as a calm "All clear" affordance so the
 *              inbox visually distinguishes "3 criticals waiting" from
 *              "nothing is broken right now".
 *            - `data-inbox-card` hooks on every card so the Wave T
 *              dead-button Playwright sweep can assert every CTA is
 *              reachable without relying on fragile text selectors.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ErrorAlert,
  Btn,
  FreshnessPill,
  PageHelp,
} from '../components/ui'
import { usePageData } from '../lib/usePageData'
import { usePageCopy } from '../lib/copy'
import { usePublishPageContext } from '../lib/pageContext'
import type { PageAction } from '../components/PageActionBar'
import type { DashboardData } from '../components/dashboard/types'
import { buildInboxCards, type InboxCard, type InboxCardGroup } from '../lib/actionInboxFromDashboard'

type Group = InboxCardGroup

const GROUP_LABEL: Record<Group, string> = {
  plan: 'Plan',
  do: 'Do',
  check: 'Check',
  act: 'Act',
  ops: 'Ops',
}

const GROUP_LONG_LABEL: Record<Group, string> = {
  plan: 'Plan — classify + triage',
  do: 'Do — dispatch + land fixes',
  check: 'Check — verify quality',
  act: 'Act — connections + config',
  ops: 'Ops — health + compliance',
}

// Tone tokens per PDCA group — used for the eyebrow chip on open cards
// so operators can tell at a glance which stage of the loop a card
// belongs to even after the cards have been promoted out of their
// per-stage sections.
const GROUP_TONE: Record<Group, { chip: string; chipText: string; ring: string }> = {
  plan: { chip: 'bg-info-muted',      chipText: 'text-info',  ring: 'border-info/30' },
  do:   { chip: 'bg-brand/15',        chipText: 'text-brand', ring: 'border-brand/30' },
  check:{ chip: 'bg-warn-muted',      chipText: 'text-warn',  ring: 'border-warn/30' },
  act:  { chip: 'bg-ok-muted',        chipText: 'text-ok',    ring: 'border-ok/30' },
  ops:  { chip: 'bg-surface-overlay', chipText: 'text-fg-muted', ring: 'border-edge' },
}

const TONE_RING: Record<PageAction['tone'], string> = {
  plan: 'border-info/40 bg-info-muted/15',
  do: 'border-brand/40 bg-brand/10',
  check: 'border-warn/40 bg-warn/10',
  act: 'border-ok/40 bg-ok-muted/15',
  idle: 'border-edge bg-surface-raised/40',
}

type FilterValue = 'all' | 'open' | 'clear' | Group

export function InboxPage() {
  const copy = usePageCopy('/inbox')
  const { data, loading, error, isValidating, lastFetchedAt, reload } = usePageData<DashboardData>('/v1/admin/dashboard')
  const cards = useMemo(() => buildInboxCards(data ?? undefined), [data])
  const [filter, setFilter] = useState<FilterValue>('all')

  const openCards = cards.filter((c) => c.action !== null)
  const clearCards = cards.filter((c) => c.action === null)
  const unreadCritical = openCards.length

  // Filter the rendered card list. `clear` is its own bucket so a user can
  // confirm "yes, every stage is genuinely settled" without scanning a
  // mostly-empty inbox.
  const visibleOpen = filter === 'clear'
    ? []
    : filter === 'open' || filter === 'all'
      ? openCards
      : openCards.filter((c) => c.group === filter)
  const visibleClear = filter === 'open'
    ? []
    : filter === 'clear' || filter === 'all'
      ? clearCards
      : clearCards.filter((c) => c.group === filter)

  usePublishPageContext({
    route: '/inbox',
    title: 'Action inbox',
    summary: unreadCritical > 0 ? `${unreadCritical} open action${unreadCritical === 1 ? '' : 's'}` : 'All clear',
    criticalCount: unreadCritical,
    questions: unreadCritical > 0
      ? [
          'Which action should I tackle first?',
          'Why is the highest-severity card blocking?',
          'Group these by PDCA stage and tell me where the loop is stuck.',
        ]
      : [
          'Is there anything that should be on this inbox but isn\u2019t?',
          'What changed in the last 24h to clear the inbox?',
        ],
    actions: [
      { id: 'inbox-refresh', label: 'Refresh', hint: 'Re-run the dashboard aggregate', run: reload },
    ],
  })

  if (loading) return (
    <div className="space-y-4 animate-pulse" aria-hidden="true" role="status" aria-label="Loading inbox">
      {/* Hero strip skeleton */}
      <div className="flex items-end justify-between gap-3 mb-4">
        <div className="space-y-2">
          <div className="h-5 w-32 rounded bg-surface-raised" />
          <div className="h-3 w-64 rounded bg-surface-raised" />
        </div>
        <div className="h-6 w-20 rounded bg-surface-raised" />
      </div>
      {/* KPI tile skeleton */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg border border-edge-subtle bg-surface-raised/40 px-4 py-3 space-y-2">
            <div className="h-3 w-10 rounded bg-surface-overlay" />
            <div className="h-7 w-8 rounded bg-surface-overlay" />
          </div>
        ))}
      </div>
      {/* Card skeletons */}
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-lg border border-edge-subtle bg-surface-raised/20 p-4 space-y-2">
          <div className="h-4 w-48 rounded bg-surface-raised" />
          <div className="h-3 w-72 rounded bg-surface-raised/60" />
        </div>
      ))}
    </div>
  )
  if (error) return <ErrorAlert message={error} />

  return (
    <div data-inbox-root>
      <PageHelp
        title={copy?.help?.title ?? 'About the inbox'}
        whatIsIt={copy?.help?.whatIsIt ?? 'A single dashboard that shows every action waiting for you — bugs to triage, fixes to review, and connections to set up.'}
        useCases={copy?.help?.useCases ?? [
          'Start every morning here — see what actually needs your attention today',
          'Jump to the highest-priority open action in one click',
          'Check at a glance which stages of the loop are clear vs. blocked',
        ]}
        howToUse={copy?.help?.howToUse ?? 'Click any open action card to jump straight to that page. Stages with a green check are all clear — no action needed.'}
      />

      {/* Hero strip — replaces the wordy PageHeader. The first thing the eye
          lands on is the open/clear ratio and a refresh affordance, not a
          paragraph of explanatory copy. */}
      <header className="mb-4 flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-fg leading-tight">Action inbox</h1>
          <p className="text-xs text-fg-muted mt-0.5">
            {unreadCritical > 0
              ? `${unreadCritical} open action${unreadCritical === 1 ? '' : 's'} across the PDCA loop · ${clearCards.length} stage${clearCards.length === 1 ? '' : 's'} clear`
              : 'No open actions. The loop is settled — check back after the next ingest.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <FreshnessPill at={lastFetchedAt} isValidating={isValidating} />
          <Btn size="sm" variant="ghost" onClick={reload}>
            Refresh
          </Btn>
        </div>
      </header>

      {/* KPI tile strip — three glanceable numbers. Severity-coloured ring
          on the OPEN tile so a non-zero count visually shouts. */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <KpiTile
          label="Open"
          value={unreadCritical}
          tone={unreadCritical > 0 ? 'do' : 'act'}
          hint={unreadCritical > 0 ? 'Awaiting action' : 'Inbox zero'}
        />
        <KpiTile
          label="Clear"
          value={clearCards.length}
          tone="act"
          hint={`Stage${clearCards.length === 1 ? '' : 's'} settled`}
        />
        <KpiTile
          label="Coverage"
          value={cards.length}
          tone="idle"
          hint="PDCA surfaces watched"
        />
      </div>

      {/* Filter pills — 'All' / 'Open' / 'Clear' / per-stage. Echoes the
          filter strip on /reports and /fixes so the muscle memory carries. */}
      <div
        role="toolbar"
        aria-label="Filter inbox"
        className="mb-4 flex flex-wrap items-center gap-1.5"
      >
        <FilterChip
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          count={cards.length}
        >
          All
        </FilterChip>
        <FilterChip
          active={filter === 'open'}
          onClick={() => setFilter('open')}
          count={openCards.length}
          tone={openCards.length > 0 ? 'do' : 'idle'}
        >
          Open
        </FilterChip>
        <FilterChip
          active={filter === 'clear'}
          onClick={() => setFilter('clear')}
          count={clearCards.length}
          tone="act"
        >
          Clear
        </FilterChip>
        <span aria-hidden className="mx-1 text-fg-faint">·</span>
        {(['plan', 'do', 'check', 'act', 'ops'] as Group[]).map((g) => {
          const groupOpen = openCards.filter((c) => c.group === g).length
          const groupTotal = cards.filter((c) => c.group === g).length
          if (groupTotal === 0) return null
          return (
            <FilterChip
              key={g}
              active={filter === g}
              onClick={() => setFilter(g)}
              count={groupTotal}
              tone={groupOpen > 0 ? 'do' : 'idle'}
            >
              {GROUP_LABEL[g]}
            </FilterChip>
          )
        })}
      </div>

      {/* Open actions — promoted into one priority list (regardless of PDCA
          group) so the operator sees the full work surface in one scan. The
          stage eyebrow on each card preserves the PDCA mapping. */}
      {visibleOpen.length > 0 ? (
        <section aria-labelledby="inbox-open" className="mb-6">
          <header className="mb-2 flex items-center gap-2">
            <h2 id="inbox-open" className="text-sm font-semibold text-fg">
              Awaiting action
            </h2>
            <span className="text-2xs text-fg-faint">·</span>
            <span className="text-2xs text-fg-muted">{visibleOpen.length} card{visibleOpen.length === 1 ? '' : 's'}</span>
          </header>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visibleOpen.map((card) => (
              <OpenInboxCard key={card.id} card={card} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Cleared stages — chip strip. Each chip is a real link so the
          operator can still jump to a settled page (e.g. to confirm or to
          go look at the metrics underlying the "all clear" status). */}
      {visibleClear.length > 0 ? (
        <section aria-labelledby="inbox-clear" className="mb-6">
          <header className="mb-2 flex items-center gap-2">
            <h2 id="inbox-clear" className="text-sm font-semibold text-fg-secondary">
              Clear stages
            </h2>
            <span className="text-2xs text-fg-faint">·</span>
            <span className="text-2xs text-fg-muted">
              {visibleClear.length} stage{visibleClear.length === 1 ? '' : 's'} settled
            </span>
          </header>
          <ul className="flex flex-wrap gap-1.5">
            {visibleClear.map((card) => (
              <li key={card.id}>
                <ClearChip card={card} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Empty-state when the active filter has nothing to show. Different
          copy for "no open work" vs "filtered down to zero" so the user
          knows whether to relax (inbox zero) or relax their filter. */}
      {visibleOpen.length === 0 && visibleClear.length === 0 ? (
        <section
          aria-label="Empty inbox"
          className="rounded-lg border border-dashed border-edge bg-surface-raised/30 p-6 text-center"
        >
          <p className="text-sm font-medium text-fg">Nothing matches this filter.</p>
          <p className="text-xs text-fg-muted mt-1 leading-snug">
            {filter === 'all'
              ? 'The PDCA loop is settled. Reports will refresh this view as they land.'
              : `No ${filter === 'open' ? 'open' : filter === 'clear' ? 'cleared' : GROUP_LONG_LABEL[filter as Group]} cards right now. Try the All filter to see everything Mushi watches.`}
          </p>
          {filter !== 'all' && (
            <button
              type="button"
              onClick={() => setFilter('all')}
              className="mt-3 inline-flex items-center gap-1 text-xs text-brand hover:text-brand-hover motion-safe:transition-colors"
            >
              Show all <span aria-hidden>→</span>
            </button>
          )}
        </section>
      ) : null}

      <details className="mt-8 group rounded-md border border-edge-subtle bg-surface-raised/30">
        <summary className="cursor-pointer list-none px-3 py-2 text-2xs uppercase tracking-wider text-fg-faint flex items-center gap-2 hover:text-fg-muted motion-safe:transition-colors">
          <span aria-hidden className="motion-safe:transition-transform group-open:rotate-90">›</span>
          How to read this inbox
        </summary>
        <div className="px-3 py-2 border-t border-edge-subtle/50 space-y-1.5 text-xs text-fg-muted leading-relaxed">
          <p>
            Every card here maps one-to-one with the next-best-action strip
            on the corresponding PDCA page — it's the single place to see
            every actionable item across the loop.
          </p>
          <p>
            Bookmark this page as your first stop each morning — work
            through the Awaiting cards top-to-bottom, then jump into the
            owning PDCA page for detail.
          </p>
        </div>
      </details>
    </div>
  )
}

// ─── Small subcomponents ──────────────────────────────────────────────────

function KpiTile({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: number | string
  tone: PageAction['tone']
  hint: string
}) {
  return (
    <div
      className={`rounded-md border ${TONE_RING[tone]} px-3 py-2`}
    >
      <p className="text-3xs uppercase tracking-wider text-fg-faint font-semibold">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-fg leading-none">{value}</p>
      <p className="mt-1 text-2xs text-fg-muted leading-snug truncate">{hint}</p>
    </div>
  )
}

function FilterChip({
  children,
  active,
  onClick,
  count,
  tone = 'idle',
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
  count?: number
  tone?: PageAction['tone']
}) {
  // Two visual states: active (filled brand) and inactive (ghost). The
  // count is the same colour as the chip text so it doesn't fight for
  // attention with the label.
  const groupTone = tone === 'do' ? 'text-brand' : tone === 'act' ? 'text-ok' : 'text-fg-muted'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-2xs font-medium motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
        active
          ? 'border-brand/40 bg-brand/15 text-brand'
          : 'border-edge-subtle bg-surface-raised/40 text-fg-muted hover:text-fg hover:bg-surface-overlay'
      }`}
    >
      <span>{children}</span>
      {typeof count === 'number' && (
        <span className={`tabular-nums ${active ? 'text-brand' : groupTone}`}>{count}</span>
      )}
    </button>
  )
}

function ClearChip({ card }: { card: InboxCard }) {
  return (
    <Link
      data-inbox-card={card.id}
      data-inbox-state="clear"
      to={card.pageTo}
      className="group inline-flex items-center gap-1.5 rounded-sm border border-edge-subtle bg-surface-raised/40 px-2 py-1 text-2xs font-medium text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      title={`${card.pageLabel} — all clear. Click to open.`}
    >
      <span aria-hidden className="text-ok">✓</span>
      <span className={`text-3xs uppercase tracking-wider ${GROUP_TONE[card.group].chipText}`}>
        {GROUP_LABEL[card.group]}
      </span>
      <span className="text-fg-secondary group-hover:text-fg">{card.pageLabel}</span>
    </Link>
  )
}

function OpenInboxCard({ card }: { card: InboxCard }) {
  const action = card.action
  if (!action) return null
  const groupTone = GROUP_TONE[card.group]
  return (
    <article
      data-inbox-card={card.id}
      data-inbox-state="open"
      className={`rounded-lg border p-4 ${TONE_RING[action.tone]}`}
    >
      <header className="flex items-center gap-2 mb-1.5">
        {/* Stage eyebrow chip — preserves the PDCA mapping even though
            the cards are no longer rendered inside per-stage sections. */}
        <span
          className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wider ${groupTone.chip} ${groupTone.chipText}`}
        >
          {GROUP_LABEL[card.group]}
        </span>
        <span className="text-2xs text-fg-faint truncate">{card.pageLabel}</span>
      </header>
      <p className="text-sm font-medium text-fg leading-snug">{action.title}</p>
      {action.reason && (
        <p className="mt-1 text-xs text-fg-muted leading-snug">{action.reason}</p>
      )}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {action.primary && action.primary.kind === 'link' && (
          <Link
            data-inbox-primary
            to={action.primary.to}
            className="inline-flex items-center gap-1 rounded-sm bg-brand px-3 py-1.5 text-xs font-medium text-brand-fg hover:bg-brand-hover motion-safe:transition-colors"
          >
            {action.primary.label} <span aria-hidden="true">→</span>
          </Link>
        )}
        {action.primary && action.primary.kind === 'button' && (
          <Btn size="sm" variant="primary" onClick={action.primary.onClick} data-inbox-primary>
            {action.primary.label}
          </Btn>
        )}
        {action.secondary?.slice(0, 1).map((s, i) =>
          s.kind === 'link' ? (
            <Link
              key={i}
              data-inbox-secondary
              to={s.to}
              className="inline-flex items-center gap-1 rounded-sm px-2.5 py-1 text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors"
            >
              {s.label}
            </Link>
          ) : null,
        )}
      </div>
    </article>
  )
}
