/**
 * FILE: apps/admin/src/pages/ChecksPage.tsx
 * mushi-mushi-allowlist: launcher page with no status, snapshot or guide chrome to budget
 * PURPOSE: /checks — the one sidebar entry point to every automatic check on
 *          the app (console audit 2026-10-20). A launcher, not a dashboard:
 *          one card per check page, grouped App checks → AI quality.
 *
 * Labels, descriptions, icons and feature gates come from NAV_REGISTRY (via
 * buildOperatorNav) and the chips reuse the sidebar's resolveNavBadge, so this
 * page can never say something different from the nav rail.
 */

import { Link } from 'react-router-dom'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { usePublishPageContext } from '../lib/pageContext'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { Badge, Card, type BadgeTone } from '../components/ui'
import { IconShieldCheck } from '../components/icons'
import { UpgradePill } from '../components/billing/UpgradeNudge'
import { CHECK_SUB_GROUPS, type CheckSubGroupId } from '../lib/navRegistry'
import { buildOperatorNav, type BuiltNavItem } from '../lib/buildNav'
import { useNavCounts, type HealthTone } from '../lib/useNavCounts'
import { navBadgeStatus, navSlicesForPaths, resolveNavBadge } from '../lib/navBadges'
import { useEntitlements } from '../lib/useEntitlements'

/** Card order per group. Every path must exist in NAV_REGISTRY. */
const CHECK_GROUPS: ReadonlyArray<{ id: CheckSubGroupId; paths: readonly string[] }> = [
  {
    id: 'system-health',
    paths: ['/qa-coverage', '/health', '/ci', '/fullstack-audit', '/inventory', '/recipe', '/design', '/content'],
  },
  { id: 'quality-gates', paths: ['/judge', '/lessons', '/prompt-lab'] },
]

const ALL_PATHS = CHECK_GROUPS.flatMap((g) => g.paths)
const NAV_SLICES = navSlicesForPaths(ALL_PATHS)

/** path → registry-backed nav item (label, description, icon, gate). */
const NAV_BY_PATH: ReadonlyMap<string, BuiltNavItem> = new Map(
  buildOperatorNav().flatMap((section) => section.items.map((item) => [item.path, item] as const)),
)

const CHIP_TONE: Record<HealthTone, BadgeTone> = {
  idle: 'neutral',
  ok: 'okSubtle',
  warn: 'warnSubtle',
  danger: 'dangerSubtle',
}

export function ChecksPage() {
  const navCounts = useNavCounts({ live: true, slices: NAV_SLICES })
  const { has, isSuperAdmin } = useEntitlements()

  usePublishPageContext({
    route: '/checks',
    title: 'Checks',
    summary: `${ALL_PATHS.length} checks`,
    questions: ['Which check needs my attention first?', 'What does each check cover?'],
  })

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-checks">
      <PageHeaderBar
        title="Checks"
        icon={<IconShieldCheck />}
        description="Every automatic check on this app in one place."
        helpTitle="About Checks"
        helpWhatIsIt="Each card is one automatic check Mushi runs on your app or on its own triage: scheduled browser tests, app health, audits, user stories, the app blueprint, design tokens, content, and how well the AI graded, learned from and prompted each fix."
        helpHowToUse="Open a card to see that check's findings. A chip on the card shows the sidebar's live count or status for it; a Pro pill means the check needs a plan upgrade."
      />

      {CHECK_GROUPS.map((group) => {
        const meta = CHECK_SUB_GROUPS[group.id]
        return (
          <section key={group.id} aria-labelledby={`checks-${group.id}`} className="flex flex-col gap-2">
            <div>
              <h2 id={`checks-${group.id}`} className="text-sm font-semibold text-fg">
                {meta.title}
              </h2>
              <p className="text-xs text-fg-muted">{meta.hint}</p>
            </div>
            <ul className="grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
              {group.paths.map((path) => {
                const item = NAV_BY_PATH.get(path)
                if (!item) return null
                const Icon = item.icon
                const gated = !!item.requiresFeature && !has(item.requiresFeature) && !isSuperAdmin
                const status = navBadgeStatus(resolveNavBadge(path, navCounts, { criticalReports30d: 0 }))
                return (
                  <li key={path} className="min-w-0">
                    <Link
                      to={path}
                      className="block h-full rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
                      data-testid={`checks-card-${path.slice(1)}`}
                    >
                      <Card interactive className={`flex h-full flex-col gap-2 p-4 ${gated ? 'opacity-80' : ''}`}>
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 shrink-0 text-fg-secondary" />
                          <span className="truncate text-sm font-medium text-fg">{item.label}</span>
                          <span className="ml-auto flex shrink-0 items-center gap-1">
                            {gated && item.requiresFeature && <UpgradePill flag={item.requiresFeature} />}
                            {status && (
                              <Badge tone={CHIP_TONE[status.tone]} title={status.label}>
                                {status.count ?? status.label}
                              </Badge>
                            )}
                          </span>
                        </div>
                        <p className="text-xs leading-snug text-fg-muted">{item.description}</p>
                      </Card>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
