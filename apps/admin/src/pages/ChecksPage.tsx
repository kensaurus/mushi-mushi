/**
 * FILE: apps/admin/src/pages/ChecksPage.tsx
 * PURPOSE: /checks — "is my app OK, and which check is red?" (console
 *          journeys 2026-10-27). One grid of every automatic check, each with
 *          a coloured dot, its state, when it last ran and its open count;
 *          failing checks first, then ones with findings, then the rest. One
 *          status sentence above it and one action: open the failing check.
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
import { buildCheckCardViews, type CheckCardState, type CheckCardView, type ObservedElement } from '../lib/checkCardStatus'

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
  pass: 5,
}

const DOT: Record<CheckCardState, string> = {
  failed: 'bg-danger',
  findings: 'bg-warn',
  unavailable: 'bg-fg-faint',
  not_checked: 'bg-fg-faint',
  not_set_up: 'bg-fg-faint',
  pass: 'bg-ok',
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
      const ra = a.card.view ? STATE_RANK[a.card.view.state] : 6
      const rb = b.card.view ? STATE_RANK[b.card.view.state] : 6
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
        sentence: `Mushi could not read ${unread === cards.length ? 'your checks' : pluralizeWithCount(unread, 'check')} right now, so ${unread === 1 ? 'its' : 'their'} state is unknown. Reload in a minute.${restText}`,
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

  usePublishPageContext({
    route: '/checks',
    title: 'Checks',
    summary: status.sentence,
    questions: ['Which check needs my attention first?', 'What does each check cover?'],
  })

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-checks">
      <PageHeaderBar
        title="Checks"
        icon={<IconShieldCheck />}
        description="Every automatic check on this app, failing ones first."
        helpTitle="About Checks"
        helpWhatIsIt="Each card is one automatic check Mushi runs on your app or on its own triage: scheduled browser tests, app health, audits, user stories, the app blueprint, design tokens, content, and how well the AI graded, learned from and prompted each fix."
        helpHowToUse="Red means the check failed, amber that it found something to fix, green that its last run passed. Grey is not set up, not run yet, or could not be read: never a pass. Open a card to see that check. A Pro pill means the check needs a plan upgrade."
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

      <ul className="grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3" aria-label="Checks, failing first">
        {cards.map(({ path, item, view }) => {
          const Icon = item.icon
          const gated = !!item.requiresFeature && !has(item.requiresFeature) && !isSuperAdmin
          const group = GROUP_OF.get(path)
          return (
            <li key={path} className="min-w-0" data-testid={`checks-card-${path.slice(1)}`} data-state={view?.state ?? 'loading'}>
              <Card interactive className={`relative flex h-full flex-col gap-2 p-4 ${gated ? 'opacity-80' : ''}`}>
                <div className="flex min-w-0 items-center gap-2">
                  {view ? (
                    <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[view.state]}`} />
                  ) : (
                    <Skeleton className="h-2.5 w-2.5 shrink-0 rounded-full" />
                  )}
                  <Icon className="h-4 w-4 shrink-0 text-fg-secondary" />
                  <Link
                    to={path}
                    className="truncate rounded-sm text-sm font-medium text-fg after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
                  >
                    {item.label}
                  </Link>
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    {gated && item.requiresFeature && <UpgradePill flag={item.requiresFeature} />}
                    {view ? (
                      <Badge tone={view.tone} title={view.detail ?? view.chip}>
                        {view.chip}
                      </Badge>
                    ) : null}
                  </span>
                </div>
                <p className="text-xs leading-snug text-fg-muted">{item.description}</p>
                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-faint">
                  {view?.detail ? <span className="text-fg-secondary">{view.detail}</span> : null}
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
        })}
      </ul>
    </div>
  )
}
