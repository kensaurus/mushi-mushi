/**
 * FILE: apps/admin/src/pages/CreditsPage.tsx
 * PURPOSE: /credits, "Spend credits": every way Mushi can spend a key's
 *          expiring credits on finding and fixing bugs, on one page, each
 *          with a switch. Cursor: spend-down (ADR 0028) and review
 *          follow-ups (ADR 0032). Firecrawl: the live-site watch of every
 *          app (ADR 0024), with what it will use before the balance resets.
 *          Detailed forms stay where they were (Settings, Inventory); this
 *          page answers "is anything spending them, and on what?".
 */

import { Link } from 'react-router-dom'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PageLoadError } from '../components/PageLoadError'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { Callout, Section } from '../components/ui'
import { LINK_ACCENT } from '../lib/chipTone'
import { IconCost } from '../components/icons'
import { CursorLevers } from '../components/credits/CursorLevers'
import { FirecrawlLevers, type FirecrawlBalance } from '../components/credits/FirecrawlLevers'
import { SkillRunsCard } from '../components/credits/SkillRunsCard'
import { usePageData } from '../lib/usePageData'
import { usePublishPageContext } from '../lib/pageContext'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { useNow } from '../lib/useNow'
import { expiryLabel } from '../lib/creditPlan'
import type { SpendDownResponse } from '../components/settings/spendDown'
import type { ReviewFollowupsResponse } from '../components/settings/reviewFollowups'

interface CreditsResponse {
  keys: Array<{
    id: string
    provider: string
    credits:
      | { kind: 'credits'; remaining: number | null; limit: number | null; periodEnd: string | null }
      | { kind: string }
  }>
}

/** The first Firecrawl key that reported a balance (the pool's first pick). */
export function firecrawlBalance(data: CreditsResponse | null | undefined): FirecrawlBalance | null {
  for (const k of data?.keys ?? []) {
    if (k.provider !== 'firecrawl' || k.credits.kind !== 'credits') continue
    const c = k.credits as { remaining: number | null; limit: number | null; periodEnd: string | null }
    return { remaining: c.remaining, limit: c.limit, periodEnd: c.periodEnd }
  }
  return null
}

export function CreditsPage() {
  const now = new Date(useNow(60_000))
  const credits = usePageData<CreditsResponse>('/v1/admin/byok/credits')
  const spendDown = usePageData<SpendDownResponse>('/v1/admin/byok/spend-down')
  const followups = usePageData<ReviewFollowupsResponse | null>('/v1/admin/byok/review-followups')
  const projects = usePageData<{ projects?: Array<{ id: string; name: string }> }>('/v1/admin/projects')

  const balance = firecrawlBalance(credits.data)
  const cursorKeys = spendDown.data?.keys ?? []
  usePublishPageContext({
    route: '/credits',
    title: 'Spend credits',
    summary: `${cursorKeys.filter((k) => k.enabled).length} of ${cursorKeys.length} Cursor keys spending down${balance?.remaining != null ? ` · ${balance.remaining.toLocaleString()} Firecrawl credits left` : ''}`,
    questions: ['Are my expiring credits being used?', 'What will go unused?', 'How do I turn on more ways to spend them?'],
  })

  const error = spendDown.error ?? credits.error
  // The one-line answer the page opens with: is anything spending what expires soonest?
  const soonest = [...cursorKeys].filter((k) => k.creditsExpireAt).sort((a, b) => String(a.creditsExpireAt).localeCompare(String(b.creditsExpireAt)))[0]
  const idleKeys = cursorKeys.filter((k) => k.creditsExpireAt && !k.enabled)
  const posture = !spendDown.data
    ? null
    : idleKeys.length > 0
      ? { tone: 'warn' as const, text: `${idleKeys.length} Cursor key${idleKeys.length === 1 ? ' has' : 's have'} an expiry date but spend-down is off. Turn it on below so the credits fix bugs.` }
      : soonest
        ? { tone: 'info' as const, text: `Spend-down is on for every Cursor key with an expiry date; the soonest ${expiryLabel(soonest.creditsExpireAt, now) ?? 'expires soon'}.` }
        : null
  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-credits">
      <PageHeaderBar
        title="Spend credits"
        icon={<IconCost />}
        description="Credits that expire, and every way Mushi can spend them finding and fixing your bugs."
        helpTitle="About Spend credits"
        helpWhatIsIt="Cursor and Firecrawl credits that lapse at the end of a period are worth more spent. This page lists each place Mushi can spend them on your apps, with a switch for each: Cursor fixes open bugs, answers review findings and runs skills that improve an app round by round; Firecrawl checks your live sites for broken pages that become bug reports."
        helpHowToUse="Turn on what you want, top to bottom. Every fix still opens a draft pull request for you to review, inside each app's auto-fix limits. The full settings for each switch are linked from its row."
      />
      <PagePosture
        slots={[
          {
            id: 'credits-status',
            priority: POSTURE_PRIORITY.status,
            show: posture != null,
            children: posture ? (
              <Callout tone={posture.tone} label="Expiring credits">
                {posture.text}
              </Callout>
            ) : null,
          },
        ]}
      />
      {error && <PageLoadError error={error} resource="credit settings" endpoint="/v1/admin/byok/spend-down" onRetry={() => { spendDown.reload(); credits.reload() }} />}

      <Section title="Cursor: fix bugs">
        {spendDown.loading && !spendDown.data && <p className="text-xs text-fg-muted">Reading your Cursor keys…</p>}
        <CursorLevers
          spendDown={spendDown.data ?? null}
          followups={followups.data ?? null}
          now={now}
          onChanged={() => {
            spendDown.reload()
            followups.reload()
          }}
        />
      </Section>

      <Section title="Cursor: improve your apps with skills">
        <SkillRunsCard projects={projects.data ? (projects.data.projects ?? []) : null} />
      </Section>

      <Section title="Firecrawl: find bugs on your live sites">
        <FirecrawlLevers balance={balance} projects={projects.data ? (projects.data.projects ?? []) : null} now={now} />
      </Section>

      <p className="text-xs text-fg-muted">
        Fixes these levers open: <Link className={LINK_ACCENT} to="/fixes">Fixes</Link>, and the ones Opus already approved under{' '}
        <Link className={LINK_ACCENT} to="/fixes?status=review_merge">Opus: merge</Link>.
      </p>
    </div>
  )
}
