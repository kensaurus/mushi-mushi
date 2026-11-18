/**
 * FILE: apps/admin/src/pages/ChecksPage.tsx
 * PURPOSE: /checks — "is my app OK, and which check is red?" (console
 *          journeys 2026-10-27). One status sentence and one action: open the
 *          failing check. Then the CI page's signal language (2026-11-18): alert
 *          cards for failed, findings and stale checks, each with its number and
 *          its change since your last visit (lib/checkSignals.ts); the checks
 *          that need a look, each with a shape for its state and a graded age
 *          chip ("14d" reads worse than "now"); and the passing and watching
 *          checks folded into one line ("● 8 passing · 2 watching").
 *
 * Data: one nav-meta read for the check slices (the same aggregate the
 *       sidebar uses, asked for these slices only) and the app blueprint read
 *       for the recipe, design and CI cards. The state rules live in
 *       lib/checkCardStatus.ts: Pass only after a run was read, a platform
 *       cron error never fails this app's Health card, an unread slice is
 *       "Status unavailable", never "Failed". (Rules first written in PR 756 for
 *       bug 011fd428.)
 *
 * Labels, descriptions, icons and plan gates come from NAV_REGISTRY. A check
 * whose page is a Lab (AI prompts, CI runners) is listed only while that Lab
 * is on, so the grid never offers a page the sidebar hides.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { usePublishPageContext } from '../lib/pageContext'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { Badge, Btn, Card, Skeleton } from '../components/ui'
import { PageStatus, type PageStatusTone } from '../components/ui/page-status'
import { IconShieldCheck } from '../components/icons'
import { UpgradePill } from '../components/billing/UpgradeNudge'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { CHECK_GROUPS, CHECK_SUB_GROUPS, type CheckSubGroupId } from '../lib/navRegistry'
import { buildOperatorNav, type BuiltNavItem } from '../lib/buildNav'
import { navSlicesForPaths } from '../lib/navBadges'
import { useEntitlements } from '../lib/useEntitlements'
import { usePageData } from '../lib/usePageData'
import { labForPath, useLabs } from '../lib/labs'
import { normalizeNavSlices, type WorkspaceNavMetaResponse } from '../lib/workspaceNavMetaResponse'
import { pluralizeWithCount } from '../lib/format'
import type { RecipeElementSummary, RecipeResponse } from '../lib/recipeTypes'
import type { FreshEyesListData } from '../lib/freshEyes'
import { buildCheckCardViews, type CheckCardState, type CheckCardView, type ObservedElement } from '../lib/checkCardStatus'
import { baselineSnapshot, checkAlerts, countChange, readBaseline, staleness, STALE_DAYS, writeBaseline, type CheckBaseline } from '../lib/checkSignals'
import { useNow } from '../lib/useNow'
import { AlertCards } from '../components/signal/AlertCards'
import { AgeCell, ChangeChip } from '../components/signal/AgeChips'
import { HighlightProvider, useLinked } from '../components/signal/linkedHighlight'
import { StatusGlyph, type SignalTone } from '../components/signal/StatusGlyph'

const ALL_PATHS = CHECK_GROUPS.flatMap((g) => g.paths)
const GROUP_OF: ReadonlyMap<string, CheckSubGroupId> = new Map(CHECK_GROUPS.flatMap((g) => g.paths.map((p) => [p, g.id] as const)))

/** One nav-meta read with only the check slices (judge rides on include=counts). */
const NAV_META_PATH = `/v1/admin/workspace/nav-meta?${new URLSearchParams({
  include: 'counts,inventory',
  slices: navSlicesForPaths(ALL_PATHS).join(','),
}).toString()}`

/** path → registry-backed nav item (label, description, icon, gate). */
const NAV_BY_PATH: ReadonlyMap<string, BuiltNavItem> = new Map(
  buildOperatorNav().flatMap((section) => section.items.map((item) => [item.path, item] as const)),
)

/** Worst first: what failed, then what has findings, then what is unknown, then the rest. */
const STATE_RANK: Record<CheckCardState, number> = {
  failed: 0,
  findings: 1,
  unavailable: 2,
  not_checked: 3,
  not_set_up: 4,
  watching: 5,
  pass: 6,
}

/** The shape beside each state, so a state never depends on colour alone. */
const STATE_TONE: Record<CheckCardState, SignalTone> = {
  failed: 'danger',
  findings: 'warn',
  unavailable: 'off',
  not_checked: 'off',
  not_set_up: 'off',
  watching: 'info',
  pass: 'ok',
}

/** Passing and watching checks fold into one line; everything else stays open. */
const FOLDED: ReadonlySet<CheckCardState> = new Set(['pass', 'watching'])

/** The last run's age as a graded cell (components/signal/AgeChips). */
function RunAge({ lastRunAt, now }: { lastRunAt: string | null | undefined; now: number }) {
  const age = staleness(lastRunAt, now)
  if (!age) return null
  const words = age.short === 'now' ? 'Last run just now' : `Last run ${age.short} ago${age.stale ? ', stale' : ''}`
  return <AgeCell age={age} words={words} title={lastRunAt ? `${words} (${new Date(lastRunAt).toLocaleString()})` : words} testId="checks-age" />
}

interface CheckCard {
  path: string
  item: BuiltNavItem
  view: CheckCardView | null
}

/** Exported for tests; page modules are knip entries, so it carries no tag. Cards worst first; a card still loading keeps its place at the end. */
export function sortCheckCards(cards: readonly CheckCard[]): CheckCard[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      const ra = a.card.view ? STATE_RANK[a.card.view.state] : 7
      const rb = b.card.view ? STATE_RANK[b.card.view.state] : 7
      return ra - rb || a.index - b.index
    })
    .map((x) => x.card)
}

/** Exported for tests; page modules are knip entries, so it carries no tag. One sentence: what needs you first, then what is fine. */
export function checksStatus(cards: readonly CheckCard[]): { tone: PageStatusTone; sentence: string } {
  const ready = cards.filter((c) => c.view)
  const failed = ready.filter((c) => c.view!.state === 'failed')
  const findings = ready.filter((c) => c.view!.state === 'findings')
  const pass = ready.filter((c) => c.view!.state === 'pass').length
  const notSetUp = ready.filter((c) => c.view!.state === 'not_set_up').length
  const red = [...failed, ...findings]
  const rest = [
    pass > 0 ? `${pass} ${pass === 1 ? 'passes' : 'pass'}` : null,
    notSetUp > 0 ? `${notSetUp} not set up` : null,
  ].filter(Boolean)
  const restText = rest.length > 0 ? ` ${rest.join(', ')}.` : ''
  const unread = ready.filter((c) => c.view!.state === 'unavailable').length
  if (red.length === 0) {
    // A check Mushi could not read is not a pass: never "nothing needs you" over it.
    if (unread > 0) {
      return {
        tone: 'warn',
        sentence: `Mushi Mushi could not read ${unread === cards.length ? 'your checks' : pluralizeWithCount(unread, 'check')} right now, so ${unread === 1 ? 'its' : 'their'} state is unknown. Reload in a minute.${restText}`,
      }
    }
    if (ready.length < cards.length) return { tone: 'neutral', sentence: 'Reading your checks…' }
    return { tone: pass > 0 ? 'ok' : 'neutral', sentence: `No check needs you right now.${restText}` }
  }
  const names = red.slice(0, 3).map((c) => `${c.item.label} (${c.view!.chip.toLowerCase()})`)
  const more = red.length > 3 ? ` and ${red.length - 3} more` : ''
  return {
    tone: failed.length > 0 ? 'danger' : 'warn',
    sentence: `${pluralizeWithCount(red.length, 'check')} ${red.length === 1 ? 'needs' : 'need'} you: ${names.join(', ')}${more}.${restText}`,
  }
}

function observed(el: RecipeElementSummary | undefined, fallback: string): ObservedElement | null {
  if (!el) return null
  const setup = el.links.find((link) => link.to.startsWith('/'))?.to ?? fallback
  return { state: el.state, lastCheckedAt: el.lastCheckedAt, findingsCount: el.findingsCount, setupTo: setup }
}

export function ChecksPage() {
  const { has, isSuperAdmin } = useEntitlements()
  const { isEnabled } = useLabs()
  const projectId = useActiveProjectId()
  const nav = usePageData<WorkspaceNavMetaResponse>(NAV_META_PATH, { deps: [projectId ?? ''] })
  const recipe = usePageData<RecipeResponse>(projectId ? `/v1/admin/projects/${projectId}/recipe` : null)
  const firstUserTest = usePageData<FreshEyesListData>(projectId ? `/v1/admin/projects/${projectId}/fresh-eyes` : null)

  // No selected app: the recipe read never starts, so these cards must not stay blank.
  const recipePhase = !projectId
    ? 'no_project'
    : recipe.data
      ? 'ready'
      : recipe.error
        ? 'error'
        : 'loading'
  const slices = nav.data ? normalizeNavSlices(nav.data.slices) : null
  const views = buildCheckCardViews({
    // A failed nav-meta read reads as Status unavailable on every slice card, never as a pass.
    navReady: nav.data != null || nav.error != null,
    qa: slices?.qaCoverage ?? null,
    health: slices?.health ?? null,
    audit: slices?.fullstackAudit ?? null,
    inventory: slices?.inventory ?? null,
    content: slices?.contentQuality ?? null,
    lessons: slices?.lessons ?? null,
    prompts: slices?.promptLab ?? null,
    judge: slices?.judge ?? null,
    recipePhase,
    recipeElements: recipe.data
      ? Object.values(recipe.data.elements).flatMap((el) => {
          const row = observed(el, '/recipe')
          return row ? [row] : []
        })
      : [],
    design: observed(recipe.data?.elements.design, '/design'),
    ci: observed(recipe.data?.elements.ci, '/ci'),
    firstUserTest: {
      phase: !projectId ? 'no_project' : firstUserTest.data ? 'ready' : firstUserTest.error ? 'error' : 'loading',
      runs: firstUserTest.data?.runs ?? [],
    },
  })

  const cards = sortCheckCards(
    ALL_PATHS.flatMap((path) => {
      const item = NAV_BY_PATH.get(path)
      if (!item) return []
      // A Lab page the user has not turned on stays out of the grid, as it does in the sidebar.
      const lab = labForPath(path)
      if (lab && !isEnabled(lab.id)) return []
      return [{ path, item, view: views[path] ?? null }]
    }),
  )
  const status = checksStatus(cards)
  const firstRed = cards.find((c) => c.view && (c.view.state === 'failed' || c.view.state === 'findings'))
  const now = useNow(60_000)

  // Each check's count at the end of the last full read, per app: the "▲ +3" on the cards.
  const [base, setBase] = useState<{ projectId: string | null; data: CheckBaseline | null }>(() => ({ projectId, data: readBaseline(projectId) }))
  if (base.projectId !== projectId) setBase({ projectId, data: readBaseline(projectId) })
  const snapshot = baselineSnapshot(cards)
  const snapshotKey = snapshot && base.projectId === projectId ? JSON.stringify(snapshot) : null
  useEffect(() => {
    if (snapshotKey && projectId) writeBaseline(projectId, JSON.parse(snapshotKey) as CheckBaseline)
  }, [snapshotKey, projectId])

  const alerts = checkAlerts(
    cards.map((c) => ({ path: c.path, label: c.item.label, description: c.item.description, view: c.view })),
    base.data,
    now,
  )
  const open = cards.filter((c) => !c.view || !FOLDED.has(c.view.state))
  const folded = cards.filter((c) => c.view && FOLDED.has(c.view.state))
  const passing = folded.filter((c) => c.view!.state === 'pass').length
  const watching = folded.length - passing
  const labelOf = new Map(cards.map((c) => [`check:${c.path}`, c.item.label]))

  usePublishPageContext({
    route: '/checks',
    title: 'Checks',
    summary: status.sentence,
    questions: ['Which check needs my attention first?', 'What does each check cover?'],
  })

  const rowProps = (card: CheckCard): RowProps => ({
    card,
    gated: !!card.item.requiresFeature && !has(card.item.requiresFeature) && !isSuperAdmin,
    change: countChange(card.path, card.view, base.data),
    now,
  })

  return (
    <HighlightProvider>
      <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-checks">
        <PageHeaderBar
          title="Checks"
          icon={<IconShieldCheck />}
          description="Every automatic check on this app, failing ones first."
          helpTitle="About Checks"
          helpWhatIsIt="Each row is one automatic check Mushi Mushi runs on your app or on its own triage: scheduled browser tests, app health, audits, user stories, the app blueprint, design tokens, content, a first-time user test, and how well the AI graded, learned from and prompted each fix."
          helpHowToUse={`The cards on top are what needs you: ▲ failed, ◆ findings or a run older than ${STALE_DAYS} days, each with its count and its ▲/▼ change since your last visit. The age chip darkens as a run gets older. Grey ○ is not set up, not run yet, or could not be read: never a pass. Passing (●) and watching (■) checks fold into one line. A Pro pill means the check needs a plan upgrade.`}
        />

        <PagePosture
          slots={[
            {
              priority: POSTURE_PRIORITY.status,
              children: (
                <PageStatus
                  ariaLabel="Checks status"
                  tone={status.tone}
                  sentence={status.sentence}
                  action={
                    firstRed ? (
                      <Btn size="sm" variant="primary" to={firstRed.path}>
                        Open {firstRed.item.label}
                      </Btn>
                    ) : undefined
                  }
                  data-testid="checks-status"
                />
              ),
            },
          ]}
        />

        <AlertCards alerts={alerts} emptyText={null} label="Checks that need you" testIdPrefix="checks" keyLabel={(k) => labelOf.get(k) ?? k} />

        {open.length > 0 && (
          <div className="@container">
            <ul className="grid list-none grid-cols-1 gap-2 p-0 @xl:grid-cols-2 @5xl:grid-cols-3" aria-label="Checks, failing first">
              {open.map((card) => (
                <OpenCheck key={card.path} {...rowProps(card)} />
              ))}
            </ul>
          </div>
        )}

        {folded.length > 0 && (
          <details className="group rounded-md border border-edge bg-surface-raised" data-testid="checks-passing">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-xs">
              <StatusGlyph tone="ok" />
              <span className="font-mono font-extrabold tabular-nums text-fg">{passing}</span>
              <span className="font-semibold text-fg">passing</span>
              {watching > 0 && (
                <>
                  <span className="text-fg-faint" aria-hidden="true">
                    ·
                  </span>
                  <StatusGlyph tone="info" />
                  <span className="font-mono font-extrabold tabular-nums text-fg">{watching}</span>
                  <span className="font-semibold text-fg">watching</span>
                </>
              )}
              <span className="ml-auto text-2xs text-fg-secondary group-open:hidden">Show</span>
              <span className="ml-auto hidden text-2xs text-fg-secondary group-open:inline">Hide</span>
            </summary>
            <ul className="list-none divide-y divide-edge-subtle border-t border-edge-subtle p-0" aria-label="Passing and watching checks">
              {folded.map((card) => (
                <FoldedCheck key={card.path} {...rowProps(card)} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </HighlightProvider>
  )
}

interface RowProps {
  card: CheckCard
  gated: boolean
  change: { text: string; worse: boolean } | null
  now: number
}

const LINK = 'truncate rounded-sm text-sm font-semibold text-fg after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60'

/** A check that needs a look (or is still being read): shape, name, state, age, change. */
function OpenCheck({ card, gated, change, now }: RowProps) {
  const { path, item, view } = card
  const Icon = item.icon
  const group = GROUP_OF.get(path)
  const link = useLinked([`check:${path}`], `check:${path}`)
  return (
    <li {...link} className={`${link.className} min-w-0`} data-testid={`checks-card-${path.slice(1)}`} data-state={view?.state ?? 'loading'}>
      <Card interactive className={`relative flex h-full flex-col gap-1.5 p-3 ${gated ? 'opacity-80' : ''}`}>
        <div className="flex min-w-0 items-center gap-2">
          {view ? <StatusGlyph tone={STATE_TONE[view.state]} /> : <Skeleton className="h-3 w-3 shrink-0 rounded-full" />}
          <Icon className="h-4 w-4 shrink-0 text-fg-secondary" />
          <Link to={path} className={LINK}>
            {item.label}
          </Link>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {gated && item.requiresFeature && <UpgradePill flag={item.requiresFeature} />}
            <ChangeChip change={change} testId="checks-change" />
            {view ? (
              <Badge tone={view.tone} title={view.detail ?? view.chip}>
                {view.chip}
              </Badge>
            ) : (
              // App blueprint and Design system wait on a slow read (7–30 s,
              // 2026-10-30); a blank corner read as broken.
              <Badge tone="neutral" className="motion-safe:animate-pulse">
                Checking…
              </Badge>
            )}
          </span>
        </div>
        <p className="text-xs leading-snug text-fg-secondary">{item.description}</p>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-muted">
          <RunAge lastRunAt={view?.lastRunAt} now={now} />
          {view?.detail && !view.lastRunAt ? <span className="text-fg-secondary">{view.detail}</span> : null}
          {group ? <span>{CHECK_SUB_GROUPS[group].title}</span> : null}
          {view?.state === 'not_set_up' && view.setupTo ? (
            <Link
              to={view.setupTo}
              className="relative z-10 rounded-sm font-medium text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
            >
              Set up →
            </Link>
          ) : null}
        </div>
      </Card>
    </li>
  )
}

/** A passing or watching check, one line inside the fold. */
function FoldedCheck({ card, gated, change, now }: RowProps) {
  const { path, item, view } = card
  const Icon = item.icon
  const link = useLinked([`check:${path}`], `check:${path}`)
  return (
    <li
      {...link}
      className={`${link.className} relative flex min-w-0 items-center gap-2 px-3 py-1.5 hover:bg-surface-overlay`}
      data-testid={`checks-card-${path.slice(1)}`}
      data-state={view?.state ?? 'loading'}
    >
      {view && <StatusGlyph tone={STATE_TONE[view.state]} />}
      <Icon className="h-3.5 w-3.5 shrink-0 text-fg-secondary" />
      <Link to={path} className={`${LINK} shrink-0`}>
        {item.label}
      </Link>
      <span className="hidden min-w-0 flex-1 truncate text-2xs text-fg-secondary sm:inline" title={item.description}>
        {item.description}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-2xs">
        {gated && item.requiresFeature && <UpgradePill flag={item.requiresFeature} />}
        <ChangeChip change={change} testId="checks-change" />
        {view?.lastRunAt ? <RunAge lastRunAt={view.lastRunAt} now={now} /> : view?.detail ? <span className="text-fg-secondary">{view.detail}</span> : null}
        {view && <span className="font-semibold text-fg-secondary">{view.chip}</span>}
      </span>
    </li>
  )
}
