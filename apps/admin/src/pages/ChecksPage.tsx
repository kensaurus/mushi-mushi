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
import { Card, Skeleton } from '../components/ui'
import { PageStatus, type PageStatusTone } from '../components/ui/page-status'
import { IconShieldCheck } from '../components/icons'
import { UpgradePill } from '../components/billing/UpgradeNudge'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { CHECK_GROUPS } from '../lib/navRegistry'
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
import { StatusMark, StatusPill, type RunStatus } from '../components/signal/StatusMark'
import { StatusGlyph, TONE_INK, type SignalTone } from '../components/signal/StatusGlyph'
import type { OpsReadResponse } from '../lib/kensaurusOpsTypes'
import { providerState } from '../lib/providersView'
import { useReadTimedOut } from '../lib/ciReadTimeout'
import { CiNotChecked } from '../components/ci/CiNotChecked'

const ALL_PATHS = CHECK_GROUPS.flatMap((g) => g.paths)

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

/** Each state's status mark (colour plus glyph): ✕ failed, ⧗ findings, ● watching pulses, ✓ pass, ○ the rest. */
const STATE_STATUS: Record<CheckCardState, RunStatus> = {
  failed: 'failed',
  findings: 'slow',
  unavailable: 'idle',
  not_checked: 'idle',
  not_set_up: 'idle',
  watching: 'running',
  pass: 'passed',
}

/**
 * The banner's marks, worst first: only the states that need you. Each count shows once on the
 * page (2026-11-18 round 2: "2 watching · 1 passing" sat in the banner and again on the fold):
 * passing and watching are counted on their fold, not set up and not run on their list.
 */
const COUNT_MARKS: ReadonlyArray<{ state: CheckCardState; tone: SignalTone; word: string }> = [
  { state: 'failed', tone: 'danger', word: 'failed' },
  { state: 'findings', tone: 'warn', word: 'with findings' },
  { state: 'unavailable', tone: 'off', word: 'could not read' },
]

/** Passing and watching checks fold into one line. */
const FOLDED: ReadonlySet<CheckCardState> = new Set(['pass', 'watching'])
/** Checks that are not running yet: one compact list, not a card each (2026-11-18 round 2). */
const IDLE: ReadonlySet<CheckCardState> = new Set(['not_checked', 'not_set_up'])

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

/**
 * Exported for tests; page modules are knip entries, so it carries no tag. How many checks are in
 * each state, plus how many are still being read. The banner marks and the passing fold both read
 * this, so no two places on the page count differently (2026-11-18).
 */
export function checkCounts(cards: readonly CheckCard[]): Record<CheckCardState, number> & { reading: number } {
  const out = { failed: 0, findings: 0, unavailable: 0, not_checked: 0, not_set_up: 0, watching: 0, pass: 0, reading: 0 }
  for (const c of cards) {
    if (c.view) out[c.view.state] += 1
    else out.reading += 1
  }
  return out
}

/** The banner: one mark per non-empty problem state, worst first; the sentence when nothing needs you. */
function CountMarks({ counts, fallback }: { counts: ReturnType<typeof checkCounts>; fallback: string }) {
  const any = COUNT_MARKS.some((m) => counts[m.state] > 0) || counts.reading > 0
  if (!any) return <span data-testid="checks-counts">{fallback}</span>
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="checks-counts">
      {COUNT_MARKS.filter((m) => counts[m.state] > 0).map((m) => (
        <span key={m.state} className="inline-flex items-center gap-1 whitespace-nowrap" data-testid={`checks-count-${m.state}`}>
          <StatusGlyph tone={m.tone} />
          <span className={`font-mono font-extrabold tabular-nums ${TONE_INK[m.tone]}`}>{counts[m.state]}</span>
          <span className="text-fg-secondary">{m.word}</span>
        </span>
      ))}
      {counts.reading > 0 && (
        <span className="inline-flex items-center gap-1 whitespace-nowrap text-fg-secondary" data-testid="checks-count-reading">
          <StatusMark status="running" />
          {counts.reading} reading
        </span>
      )}
    </span>
  )
}

/** Exported for tests; page modules are knip entries, so it carries no tag. One sentence (the page context summary): what needs you first, then what is fine. */
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

/** The Providers card's input from the kensaurus-ops snapshot. */
function providersCheck(data: OpsReadResponse | null, errorCode: string | null, error: string | null) {
  if (!data) {
    const phase = errorCode === 'NOT_FOUND' ? 'not_set_up' : error ? 'error' : 'loading'
    return { phase, down: 0, warn: 0, critIncidents: 0, generatedAt: null } as const
  }
  const enabled = data.snapshot.providers.filter((p) => p.enabled)
  return {
    phase: 'ready',
    down: enabled.filter((p) => providerState(p) === 'down').length,
    warn: enabled.filter((p) => providerState(p) === 'warn').length,
    critIncidents: data.snapshot.incidents.filter((i) => i.severity === 'crit').length,
    generatedAt: data.snapshot.generated_at,
  } as const
}

export function ChecksPage() {
  const { has, isSuperAdmin, isOperator } = useEntitlements()
  const { isEnabled } = useLabs()
  const projectId = useActiveProjectId()
  const nav = usePageData<WorkspaceNavMetaResponse>(NAV_META_PATH, { deps: [projectId ?? ''] })
  const recipe = usePageData<RecipeResponse>(projectId ? `/v1/admin/projects/${projectId}/recipe` : null)
  const firstUserTest = usePageData<FreshEyesListData>(projectId ? `/v1/admin/projects/${projectId}/fresh-eyes` : null)
  // Providers & AI routes: operators only (the route 403s for everyone else).
  const ops = usePageData<OpsReadResponse>(isOperator ? '/v1/admin/kensaurus/ops' : null, { scope: 'none' })

  // Never an endless "Checking…": a read with no answer after 10 s reads as "could not read",
  // with one Retry (lib/ciReadTimeout.ts). An answer that lands later still renders.
  const navWaiting = nav.data == null && nav.error == null
  const recipeWaiting = !!projectId && recipe.data == null && recipe.error == null
  const testWaiting = !!projectId && firstUserTest.data == null && firstUserTest.error == null
  const opsWaiting = !!isOperator && ops.data == null && ops.error == null
  const { timedOut, restart } = useReadTimedOut(navWaiting || recipeWaiting || testWaiting || opsWaiting)
  const retryReads = () => {
    nav.reload()
    recipe.reload()
    firstUserTest.reload()
    ops.reload()
    restart()
  }

  // No selected app: the recipe read never starts, so these cards must not stay blank.
  const recipePhase = !projectId
    ? 'no_project'
    : recipe.data
      ? 'ready'
      : recipe.error || timedOut
        ? 'error'
        : 'loading'
  const slices = nav.data ? normalizeNavSlices(nav.data.slices) : null
  const views = buildCheckCardViews({
    // A failed nav-meta read reads as Status unavailable on every slice card, never as a pass.
    navReady: nav.data != null || nav.error != null || timedOut,
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
      phase: !projectId ? 'no_project' : firstUserTest.data ? 'ready' : firstUserTest.error || timedOut ? 'error' : 'loading',
      runs: firstUserTest.data?.runs ?? [],
    },
    providers: isOperator ? providersCheck(ops.data, ops.errorCode, ops.error ?? (timedOut ? 'timeout' : null)) : undefined,
  })

  const cards = sortCheckCards(
    ALL_PATHS.flatMap((path) => {
      const item = NAV_BY_PATH.get(path)
      if (!item) return []
      if (path === '/providers' && !isOperator) return []
      // A Lab page the user has not turned on stays out of the grid, as it does in the sidebar.
      const lab = labForPath(path)
      if (lab && !isEnabled(lab.id)) return []
      return [{ path, item, view: views[path] ?? null }]
    }),
  )
  const status = checksStatus(cards)
  const counts = checkCounts(cards)
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
  // A check with an alert card is shown there once, not again in the grid (2026-11-18).
  const alerted = new Set(alerts.map((a) => `/${a.id}`))
  const open = cards.filter((c) => (!c.view || (!FOLDED.has(c.view.state) && !IDLE.has(c.view.state))) && !alerted.has(c.path))
  const idle = cards.filter((c) => c.view && IDLE.has(c.view.state))
  const folded = cards.filter((c) => c.view && FOLDED.has(c.view.state))
  const passing = counts.pass
  const watching = counts.watching
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
          helpHowToUse={`The cards on top are what needs you: ▲ failed, ◆ findings or a run older than ${STALE_DAYS} days, each with its count and its ▲/▼ change since your last visit. The age chip darkens as a run gets older. Grey ○ is not set up, not run yet, or could not be read: never a pass. Passing (✓) and watching (a pulsing ●) checks fold into one line. A Pro pill means the check needs a plan upgrade.`}
        />

        <PagePosture
          slots={[
            {
              priority: POSTURE_PRIORITY.status,
              children: (
                // Counts as marks; the alert cards below carry the names and the Open buttons.
                <PageStatus ariaLabel="Checks status" tone={status.tone} marked sentence={<CountMarks counts={counts} fallback="No check needs you right now." />} data-testid="checks-status" />
              ),
            },
          ]}
        />

        {timedOut && <CiNotChecked what="Some checks" onRetry={retryReads} testId="checks-not-checked" />}

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

        {idle.length > 0 && (
          <section className="rounded-md border border-edge bg-surface-raised" aria-labelledby="checks-idle-title" data-testid="checks-idle">
            <h2 id="checks-idle-title" className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-fg">
              <StatusGlyph tone="off" />
              Not running yet
              <span className="font-mono font-extrabold tabular-nums" data-testid="checks-idle-count">
                ({idle.length})
              </span>
            </h2>
            {/* Two groups named once, rows without a pill each: "Not set up" ×3 and "Not run yet" ×2
                under one header said each state on every row (round 3). */}
            {[
              { id: 'not_set_up', word: 'Not set up', cards: idle.filter((c) => c.view!.state === 'not_set_up') },
              { id: 'not_checked', word: 'Not run yet', cards: idle.filter((c) => c.view!.state !== 'not_set_up') },
            ]
              .filter((g) => g.cards.length > 0)
              .map((g) => (
                <div key={g.id} className="border-t border-edge-subtle" data-testid={`checks-idle-${g.id}`}>
                  <p className="px-3 pt-1.5 text-2xs font-semibold text-fg-secondary">
                    {g.word} <span className="font-mono tabular-nums">{g.cards.length}</span>
                  </p>
                  <ul className="list-none divide-y divide-edge-subtle p-0" aria-label={`Checks ${g.word.toLowerCase()}`}>
                    {g.cards.map((card) => (
                      <FoldedCheck key={card.path} {...rowProps(card)} hidePill />
                    ))}
                  </ul>
                </div>
              ))}
          </section>
        )}

        {folded.length > 0 && (
          <details className="group rounded-md border border-edge bg-surface-raised" data-testid="checks-passing">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-xs">
              <StatusMark status="passed" />
              <span className="font-mono font-extrabold tabular-nums text-fg">{passing}</span>
              <span className="font-semibold text-fg">passing</span>
              {watching > 0 && (
                <>
                  <span className="text-fg-faint" aria-hidden="true">
                    ·
                  </span>
                  <StatusMark status="running" />
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
  const link = useLinked([`check:${path}`], `check:${path}`)
  return (
    <li {...link} className={`${link.className} min-w-0`} data-testid={`checks-card-${path.slice(1)}`} data-state={view?.state ?? 'loading'}>
      <Card interactive className={`relative flex h-full flex-col gap-1.5 p-3 ${gated ? 'opacity-80' : ''}`}>
        {/* Wraps: on a phone the state pill drops under the name instead of
            cutting it ("Mushi Mushi hea…", 2026-11-22 design pass). */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-testid="checks-card-head">
          {view ? <StatusMark status={STATE_STATUS[view.state]} /> : <Skeleton className="h-3 w-3 shrink-0 rounded-full" />}
          <Icon className="h-4 w-4 shrink-0 text-fg-secondary" />
          <Link to={path} className={LINK}>
            {item.label}
          </Link>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {gated && item.requiresFeature && <UpgradePill flag={item.requiresFeature} />}
            <ChangeChip change={change} testId="checks-change" />
            {view ? (
              <StatusPill status={STATE_STATUS[view.state]} label={view.chip} title={view.detail ?? view.chip} />
            ) : (
              // App blueprint and Design system wait on a slow read (7–30 s,
              // 2026-10-30); a blank corner read as broken.
              <StatusPill status="running" label="Checking…" />
            )}
          </span>
        </div>
        <p className="text-xs leading-snug text-fg-secondary">{item.description}</p>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-muted">
          <RunAge lastRunAt={view?.lastRunAt} now={now} />
          {view?.detail && !view.lastRunAt ? <span className="text-fg-secondary">{view.detail}</span> : null}
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
function FoldedCheck({ card, gated, change, now, hidePill = false }: RowProps & { hidePill?: boolean }) {
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
      {view && <StatusMark status={STATE_STATUS[view.state]} />}
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
        {view?.lastRunAt ? <RunAge lastRunAt={view.lastRunAt} now={now} /> : view?.detail ? <span className="hidden text-fg-secondary sm:inline">{view.detail}</span> : null}
        {view && !hidePill && <StatusPill status={STATE_STATUS[view.state]} label={view.chip} />}
        {view?.state === 'not_set_up' && view.setupTo ? (
          <Link
            to={view.setupTo}
            className="relative z-10 rounded-sm font-medium whitespace-nowrap text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
            aria-label={`Set up ${item.label}`}
          >
            Set up →
          </Link>
        ) : null}
      </span>
    </li>
  )
}
