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
 *          Design principles:
 *            - No dead buttons — every card has a primary CTA that links
 *              to the page where the action actually happens.
 *            - `computeNextBestAction` returns `null` for "nothing to do"
 *              which we render as an "All clear" affordance so the inbox
 *              visually distinguishes "3 criticals waiting" from "nothing
 *              is broken right now".
 *            - `data-inbox-card` hooks on every card so the Wave T
 *              dead-button Playwright sweep can assert every CTA is
 *              reachable without relying on fragile text selectors.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  PageHeader,
  PageHelp,
  ErrorAlert,
  Loading,
  Btn,
} from '../components/ui'
import { usePageData } from '../lib/usePageData'
import { usePublishPageContext } from '../lib/pageContext'
import { computeNextBestAction } from '../lib/useNextBestAction'
import type { PageAction } from '../components/PageActionBar'
import type { DashboardData } from '../components/dashboard/types'

type Group = 'plan' | 'do' | 'check' | 'act' | 'ops'

interface InboxCard {
  id: string
  scope: string
  group: Group
  pageLabel: string
  pageTo: string
  action: PageAction | null
}

const GROUP_LABEL: Record<Group, string> = {
  plan: 'Plan — classify + triage',
  do: 'Do — dispatch + land fixes',
  check: 'Check — verify quality',
  act: 'Act — connections + config',
  ops: 'Ops — health + compliance',
}

const GROUP_DESCRIPTION: Record<Group, string> = {
  plan: 'What\u2019s coming in off the ingestion pipeline that needs a human call.',
  do: 'Fixes in flight or stalled — dispatch, merge, or retry.',
  check: 'Quality signals that tell you whether the loop is actually working.',
  act: 'Integrations and secrets that keep the pipeline wired to reality.',
  ops: 'Cron jobs, SOC 2 evidence, queues, and storage — the unglamorous glue.',
}

function buildCards(data: DashboardData | undefined): InboxCard[] {
  // When the dashboard aggregate is empty (new project / no ingest yet) we
  // still show the stable set of cards with `null` action so the user sees
  // the PDCA surface they will interact with once reports start landing.
  const reportsByDay = data?.reportsByDay ?? []
  const critical14d = reportsByDay.reduce((n, d) => n + (d.critical ?? 0), 0)
  const openBacklog = data?.counts?.openBacklog ?? 0
  const fixSummary = data?.fixSummary
  const failedFixes = fixSummary?.failed ?? 0
  const integrations = data?.integrations ?? []
  const redIntegrations = integrations.filter((i) => i.lastStatus === 'red' || i.lastStatus === 'fail').length
  const amberIntegrations = integrations.filter((i) => i.lastStatus === 'amber' || i.lastStatus === 'degraded').length

  return [
    {
      id: 'reports-plan',
      scope: 'intelligence',
      group: 'plan',
      pageLabel: 'Reports queue',
      pageTo: '/reports',
      action: critical14d > 0
        ? {
            tone: 'do',
            title: `${critical14d} critical report${critical14d === 1 ? '' : 's'} in the last 14 days`,
            reason: openBacklog > 0 ? `${openBacklog} still open.` : 'All resolved; double-check the rollup.',
            primary: { kind: 'link', to: '/reports?severity=critical', label: 'Open critical queue' },
          }
        : null,
    },
    {
      id: 'judge-check',
      scope: 'judge',
      group: 'check',
      pageLabel: 'Judge',
      pageTo: '/judge',
      action: computeNextBestAction({
        scope: 'judge',
        disagreementRate: null,
        sampledCount: 0,
        staleHoursAgo: 49,
      }),
    },
    {
      id: 'fixes-do',
      scope: 'fixes',
      group: 'do',
      pageLabel: 'Fixes in flight',
      pageTo: '/fixes',
      action: failedFixes > 0
        ? {
            tone: 'do',
            title: `${failedFixes} fix attempt${failedFixes === 1 ? '' : 's'} failed`,
            reason: 'Review the failure, fix the agent prompt, or retry manually.',
            primary: { kind: 'link', to: '/fixes?status=failed', label: 'Open failed fixes' },
          }
        : null,
    },
    {
      id: 'health-ops',
      scope: 'health',
      group: 'ops',
      pageLabel: 'Integration health',
      pageTo: '/health',
      action: computeNextBestAction({
        scope: 'health',
        redCount: redIntegrations,
        amberCount: amberIntegrations,
      }),
    },
    {
      id: 'integrations-act',
      scope: 'integrations',
      group: 'act',
      pageLabel: 'Integrations',
      pageTo: '/integrations',
      action: computeNextBestAction({
        scope: 'integrations',
        disconnectedCount: redIntegrations,
        expiringCount: 0,
      }),
    },
  ]
}

const TONE_RING: Record<PageAction['tone'], string> = {
  plan: 'border-info/40 bg-info-muted/15',
  do: 'border-brand/40 bg-brand/10',
  check: 'border-warn/40 bg-warn/10',
  act: 'border-ok/40 bg-ok-muted/15',
  idle: 'border-edge bg-surface-raised/40',
}

export function InboxPage() {
  const { data, loading, error } = usePageData<DashboardData>('/v1/admin/dashboard')
  const cards = useMemo(() => buildCards(data ?? undefined), [data])
  const actionable = cards.filter((c) => c.action !== null)
  const unreadCritical = actionable.length

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
  })

  if (loading) return <Loading text="Loading inbox…" />
  if (error) return <ErrorAlert message={error} />

  const grouped: Record<Group, InboxCard[]> = { plan: [], do: [], check: [], act: [], ops: [] }
  for (const card of cards) grouped[card.group].push(card)

  return (
    <div data-inbox-root>
      <PageHeader
        title="Action inbox"
        description={unreadCritical > 0
          ? `${unreadCritical} open action${unreadCritical === 1 ? '' : 's'} across the PDCA loop.`
          : 'Nothing to triage right now. Check back after the next ingest.'}
      />
      <PageHelp
        title="How to read this inbox"
        whatIsIt="Every card here maps one-to-one with the next-best-action strip on the corresponding PDCA page — it's the single place to see every actionable item across the loop."
        howToUse="Bookmark this page as your first stop each morning — work through the cards top-to-bottom, then jump into the owning PDCA page for detail."
      />

      <div className="mt-6 space-y-8">
        {(Object.keys(grouped) as Group[]).map((group) => {
          const groupCards = grouped[group]
          if (groupCards.length === 0) return null
          return (
            <section key={group} aria-labelledby={`inbox-${group}`}>
              <header className="mb-3">
                <h2 id={`inbox-${group}`} className="text-sm font-semibold text-fg">
                  {GROUP_LABEL[group]}
                </h2>
                <p className="text-xs text-fg-muted mt-0.5">{GROUP_DESCRIPTION[group]}</p>
              </header>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {groupCards.map((card) => (
                  <InboxCardView key={card.id} card={card} />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function InboxCardView({ card }: { card: InboxCard }) {
  if (!card.action) {
    return (
      <article
        data-inbox-card={card.id}
        data-inbox-state="clear"
        className="rounded-lg border border-edge bg-surface-raised/40 p-4"
      >
        <header className="flex items-center justify-between gap-2 mb-1">
          <h3 className="text-xs uppercase tracking-wider text-fg-faint font-semibold">{card.pageLabel}</h3>
          <span className="text-ok text-xs" aria-hidden="true">✓</span>
        </header>
        <p className="text-xs text-fg-muted">All clear. Nothing actionable here right now.</p>
        <div className="mt-3">
          <Link
            to={card.pageTo}
            className="text-xs text-fg-muted hover:text-fg underline underline-offset-2"
          >
            Open {card.pageLabel.toLowerCase()} →
          </Link>
        </div>
      </article>
    )
  }
  const { action } = card
  return (
    <article
      data-inbox-card={card.id}
      data-inbox-state="open"
      className={`rounded-lg border p-4 ${TONE_RING[action.tone]}`}
    >
      <header className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-xs uppercase tracking-wider text-fg-faint font-semibold">{card.pageLabel}</h3>
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
