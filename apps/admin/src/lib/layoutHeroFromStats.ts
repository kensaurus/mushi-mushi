/**
 * Enriches layout-level PageHero fallbacks with live nav-meta / slice data.
 * Keeps static route copy in Layout.tsx; this file supplies metrics, severity,
 * actionable Act tiles, and calm idle copy when nothing needs doing.
 */

import type { PageHeroDecide, PageHeroVerify } from '../components/PageHero'
import type { PageAction } from '../components/PageActionBar'
import type { HeroSeverity } from '../components/hero-flow/heroFlow.data'
import type { NavCounts } from './useNavCounts'
import { computeNextBestAction } from './useNextBestAction'
import type { PageHeroSnapshot } from './pageHeroSnapshot'

export interface LayoutHeroFallback {
  title: string
  kicker: string
  scope: string
  decide: PageHeroDecide
  verify: PageHeroVerify
}

export interface HeroActIdle {
  label: string
  metric?: string
  summary: string
}

export interface ResolvedLayoutHero extends LayoutHeroFallback {
  act: PageAction | null
  actIdle?: HeroActIdle
}

function mergeDecide(base: PageHeroDecide, patch: Partial<PageHeroDecide>): PageHeroDecide {
  return { ...base, ...patch }
}

function mergeVerify(base: PageHeroVerify, patch: Partial<PageHeroVerify>): PageHeroVerify {
  return { ...base, ...patch }
}

function idle(label: string, summary: string, metric?: string): HeroActIdle {
  return { label, summary, metric }
}

function enrichByPath(pathname: string, counts: NavCounts): {
  decide?: Partial<PageHeroDecide>
  verify?: Partial<PageHeroVerify>
  act?: PageAction | null
  actIdle?: HeroActIdle
} {
  const { slices } = counts

  switch (pathname) {
    case '/dashboard': {
      const d = slices.dashboard
      const backlog = d?.openBacklog ?? counts.untriagedBacklog
      const failed = d?.fixesFailed ?? counts.fixesFailed
      const inFlight = d?.fixesInProgress ?? counts.fixesInFlight
      const integrations = d?.integrationIssues ?? counts.healthIssues
      const severity: HeroSeverity =
        failed > 0 || integrations > 0 ? 'crit' : backlog > 0 ? 'warn' : 'ok'
      return {
        decide: {
          label: failed > 0 ? 'Fix pipeline blocked' : backlog > 0 ? 'Triage backlog' : 'Loop healthy',
          metric: `${backlog} new · ${inFlight} fixing · ${failed} failed`,
          summary:
            failed > 0
              ? `${failed} fix ${failed === 1 ? 'run' : 'runs'} failed — open Fixes before dispatching more.`
              : backlog > 0
                ? `${backlog} report${backlog === 1 ? '' : 's'} waiting over an hour for triage.`
                : integrations > 0
                  ? `${integrations} integration${integrations === 1 ? '' : 's'} failing health checks.`
                  : 'No open bottlenecks on the dashboard right now.',
          severity,
        },
        act:
          failed > 0
            ? {
                tone: 'do',
                title: `Review ${failed} failed fix${failed === 1 ? '' : 'es'}`,
                reason: 'CI or agent errors block the merge loop until you inspect them.',
                primary: { kind: 'link', to: '/fixes?status=failed', label: 'Open failures' },
              }
            : backlog > 0
              ? {
                  tone: 'check',
                  title: `Triage ${backlog} stale report${backlog === 1 ? '' : 's'}`,
                  reason: 'Reports idle >1h never reach auto-fix.',
                  primary: { kind: 'link', to: '/reports?status=new', label: 'Open queue' },
                }
              : null,
        actIdle: idle('Nothing queued', 'New reports and fix webhooks refresh this strip.', '0 actions'),
      }
    }

    case '/organization/members': {
      const mc = counts.memberCount ?? 0
      const inactive = counts.membersInactiveCount
      const pending = counts.pendingInvites
      const expiring = counts.membersExpiringInvites
      const atCap = counts.membersAtSeatCap
      const severity: HeroSeverity =
        atCap ? 'crit' : inactive >= 3 ? 'warn' : pending > 0 ? 'info' : 'ok'
      return {
        decide: {
          label: atCap ? 'Seat cap reached' : inactive >= 3 ? 'Inactive seats' : 'Team roster',
          metric: `${mc} member${mc === 1 ? '' : 's'} · ${inactive} inactive · ${pending} pending`,
          summary: atCap
            ? 'You cannot invite more people until you upgrade or remove seats on Billing.'
            : inactive >= 3
              ? `${inactive} seats inactive (>30d or never signed in) — audit before adding roles.`
              : pending > 0
                ? `${pending} invite${pending === 1 ? '' : 's'} awaiting acceptance.`
                : `${mc} teammate${mc === 1 ? '' : 's'} on this org — roles control access, not billing on unlimited plans.`,
          severity,
        },
        act: atCap
          ? {
              tone: 'do',
              title: 'Upgrade for more seats',
              reason: 'Pending invites also count toward the cap.',
              primary: { kind: 'link', to: '/billing', label: 'Open billing' },
            }
          : inactive >= 3
            ? {
                tone: 'check',
                title: `Audit ${inactive} inactive seats`,
                reason: 'Toggle “Show inactive only” on Roster to reclaim coasting access.',
                primary: { kind: 'link', to: '/organization/members?tab=roster', label: 'Open roster' },
              }
            : pending > 0
              ? {
                  tone: 'plan',
                  title: `Follow up on ${pending} pending invite${pending === 1 ? '' : 's'}`,
                  reason: 'Resend or copy the accept link if email delivery failed.',
                  primary: { kind: 'link', to: '/organization/members?tab=invites', label: 'Open invites' },
                }
              : null,
        actIdle: idle(
          'Roster clear',
          pending === 0 && inactive === 0
            ? 'Everyone active — no invites waiting.'
            : 'No urgent roster actions right now.',
          `${pending} pending · ${inactive} inactive`,
        ),
        verify: {
          label: 'Invite deliverability',
          detail:
            expiring > 0
              ? `${expiring} invite${expiring === 1 ? '' : 's'} expiring within 7 days`
              : pending > 0
                ? `${pending} pending — check opened / not-opened on Invites tab`
                : 'No pending invites',
          to:
            pending > 0 || expiring > 0
              ? '/organization/members?tab=invites'
              : '/organization/members?tab=roster',
        },
      }
    }

    case '/projects': {
      const attention = counts.projectsNeedingAttention
      const total = counts.projectCount
      return {
        decide: {
          label: attention > 0 ? 'Setup gaps' : 'Projects healthy',
          metric: `${total} project${total === 1 ? '' : 's'} · ${attention} need attention`,
          summary:
            attention > 0
              ? `${counts.neverIngestedCount} never ingested · ${counts.staleKeyCount} stale SDK keys.`
              : 'Every project has recent ingest and active keys.',
          severity: attention > 0 ? 'warn' : 'ok',
        },
        act:
          attention > 0
            ? {
                tone: 'do',
                title: `Fix ${attention} project setup gap${attention === 1 ? '' : 's'}`,
                reason: 'Missing ingest or stale keys hide bugs from the loop.',
                primary: { kind: 'link', to: '/projects', label: 'Open projects' },
              }
            : null,
        actIdle: idle('All projects ingesting', 'Switch active project from the header chip.', `${total} total`),
      }
    }

    case '/code-health': {
      const ch = slices.codeHealth
      const errors = ch?.errorCount ?? 0
      const warns = ch?.warnCount ?? 0
      const gods = ch?.godFileCount ?? 0
      return {
        decide: {
          label: errors > 0 ? 'CI health errors' : warns > 0 ? 'Warnings open' : 'Bundle + LOC clean',
          metric: `${errors} err · ${warns} warn · ${gods} god-file${gods === 1 ? '' : 's'}`,
          summary:
            errors > 0
              ? `${errors} error-level finding${errors === 1 ? '' : 's'} from the latest CI push.`
              : warns > 0
                ? `${warns} warning${warns === 1 ? '' : 's'} — bundle budget or LOC threshold breached.`
                : gods > 0
                  ? `${gods} file${gods === 1 ? '' : 's'} over the 2,000 LOC budget.`
                  : 'Latest CI ingest shows no open code-health findings.',
          severity: errors > 0 ? 'crit' : warns > 0 || gods > 0 ? 'warn' : 'ok',
        },
        act:
          errors + warns + gods > 0
            ? {
                tone: 'check',
                title: `Review ${errors + warns + gods} finding${errors + warns + gods === 1 ? '' : 's'}`,
                reason: 'God-files and bundle spikes regress fix velocity.',
                primary: { kind: 'link', to: '/code-health', label: 'Open findings' },
              }
            : null,
        actIdle: idle('CI clean', 'Push to main refreshes bundle + LOC metrics.', ch?.hasRun ? 'Last run OK' : 'Awaiting CI'),
      }
    }

    case '/qa-coverage': {
      const qa = slices.qaCoverage
      const failing = qa?.failingStories ?? 0
      const pending = qa?.pendingRuns ?? 0
      const total = qa?.totalStories ?? 0
      return {
        decide: {
          label: failing > 0 ? 'Stories failing' : pending > 0 ? 'Runs in flight' : 'QA healthy',
          metric: `${failing} fail · ${pending} running · ${total} stories`,
          summary:
            failing > 0
              ? `${failing} scheduled stor${failing === 1 ? 'y' : 'ies'} below 80% pass rate (24h).`
              : pending > 0
                ? `${pending} run${pending === 1 ? '' : 's'} queued or executing now.`
                : total > 0
                  ? `${total} approved stor${total === 1 ? 'y' : 'ies'} — no failures in the last day.`
                  : 'No QA stories yet — generate from Discovery or Reports.',
          severity: failing > 0 ? 'crit' : pending > 0 ? 'info' : 'ok',
        },
        act:
          failing > 0
            ? {
                tone: 'check',
                title: `Open ${failing} failing QA stor${failing === 1 ? 'y' : 'ies'}`,
                reason: 'Screenshots and assertion diffs live in the run drawer.',
                primary: { kind: 'link', to: '/qa-coverage?status=fail', label: 'View failures' },
              }
            : pending > 0
              ? {
                  tone: 'plan',
                  title: `${pending} run${pending === 1 ? '' : 's'} in progress`,
                  reason: 'Wait for completion or open the story drawer for live status.',
                  primary: { kind: 'link', to: '/qa-coverage', label: 'Open QA Coverage' },
                }
              : null,
        actIdle: idle('Pass rate OK', 'Hourly cron matches story schedules.', `${total} stories`),
      }
    }

    case '/lessons': {
      const l = slices.lessons
      const promote = l?.readyToPromote ?? 0
      const critical = l?.criticalLessons ?? 0
      const active = l?.activeLessons ?? 0
      return {
        decide: {
          label: critical > 0 ? 'Critical lessons' : promote > 0 ? 'Ready to promote' : 'Memory healthy',
          metric: `${active} active · ${promote} promote · ${critical} critical`,
          summary:
            critical > 0
              ? `${critical} high-severity lesson${critical === 1 ? '' : 's'} need review before merge.`
              : promote > 0
                ? `${promote} cluster${promote === 1 ? '' : 's'} scored ready for promotion.`
                : `${active} active rule${active === 1 ? '' : 's'} feeding classify + fix prompts.`,
          severity: critical > 0 ? 'crit' : promote > 0 ? 'warn' : 'ok',
        },
        act:
          promote > 0
            ? {
                tone: 'do',
                title: `Promote ${promote} lesson cluster${promote === 1 ? '' : 's'}`,
                reason: 'Promotion writes rules into the live classifier corpus.',
                primary: { kind: 'link', to: '/lessons?tab=clusters', label: 'Open clusters' },
              }
            : critical > 0
              ? {
                  tone: 'check',
                  title: `Review ${critical} critical lesson${critical === 1 ? '' : 's'}`,
                  primary: { kind: 'link', to: '/lessons', label: 'Open lessons' },
                }
              : null,
        actIdle: idle('No promotions queued', 'Query Sim previews which rules fire on a diff.', `${active} active`),
      }
    }

    case '/drift': {
      const d = slices.drift
      const open = d?.openFindings ?? 0
      const crit = d?.criticalOpen ?? 0
      return {
        decide: {
          label: crit > 0 ? 'Critical drift' : open > 0 ? 'Open findings' : 'Contracts aligned',
          metric: `${open} open · ${crit} critical`,
          summary:
            crit > 0
              ? `${crit} critical contract gap${crit === 1 ? '' : 's'} — users may hit 404s or schema errors.`
              : open > 0
                ? `${open} OpenAPI / inventory / DB mismatch${open === 1 ? '' : 'es'} to triage.`
                : 'Latest walker snapshot shows no open drift findings.',
          severity: crit > 0 ? 'crit' : open > 0 ? 'warn' : 'ok',
        },
        act:
          open > 0
            ? {
                tone: 'check',
                title: `Triage ${open} drift finding${open === 1 ? '' : 's'}`,
                primary: { kind: 'link', to: '/drift?status=open', label: 'Open findings' },
              }
            : null,
        actIdle: idle('Schema in sync', 'Nightly walker refreshes edge counts.', '0 open'),
      }
    }

    case '/anomalies': {
      const a = slices.anomalies
      const open = a?.openAnomalies ?? 0
      const regressions = a?.releaseRegressionOpen ?? 0
      return {
        decide: {
          label: regressions > 0 ? 'Release regression' : open > 0 ? 'Anomalies open' : 'Metrics nominal',
          metric: `${open} open · ${regressions} release`,
          summary:
            regressions > 0
              ? `${regressions} release-linked regression${regressions === 1 ? '' : 's'} need triage.`
              : open > 0
                ? `${open} detector hit${open === 1 ? '' : 's'} above baseline.`
                : 'No open anomalies in the current window.',
          severity: regressions > 0 ? 'crit' : open > 0 ? 'warn' : 'ok',
        },
        act:
          open > 0
            ? {
                tone: 'check',
                title: `Review ${open} anomal${open === 1 ? 'y' : 'ies'}`,
                primary: { kind: 'link', to: '/anomalies?status=open', label: 'Open list' },
              }
            : null,
        actIdle: idle('Detectors quiet', 'Ingest timeseries drive the next run.', '0 open'),
      }
    }

    case '/experiments': {
      const e = slices.experiments
      const drafts = e?.draftsReadyToLaunch ?? 0
      const running = e?.runningCount ?? 0
      const winners = e?.winnersFound ?? 0
      return {
        decide: {
          label: drafts > 0 ? 'Drafts ready' : winners > 0 ? 'Winners found' : running > 0 ? 'Tests running' : 'No experiments',
          metric: `${running} live · ${drafts} draft · ${winners} winner${winners === 1 ? '' : 's'}`,
          summary:
            drafts > 0
              ? `${drafts} draft${drafts === 1 ? '' : 's'} passed validation — ready to launch.`
              : winners > 0
                ? `${winners} variant${winners === 1 ? '' : 's'} crossed significance — review before shipping.`
                : running > 0
                  ? `${running} experiment${running === 1 ? '' : 's'} collecting data now.`
                  : 'Create an A/B test when you have a hypothesis to validate.',
          severity: winners > 0 ? 'warn' : drafts > 0 ? 'info' : 'neutral',
        },
        act:
          drafts > 0
            ? {
                tone: 'do',
                title: `Launch ${drafts} experiment draft${drafts === 1 ? '' : 's'}`,
                primary: { kind: 'link', to: '/experiments?status=draft', label: 'Review drafts' },
              }
            : winners > 0
              ? {
                  tone: 'check',
                  title: `Review ${winners} winner${winners === 1 ? '' : 's'}`,
                  primary: { kind: 'link', to: '/experiments', label: 'Open experiments' },
                }
              : null,
        actIdle: idle('No launches pending', 'mSPRT significance updates on each ingest.', `${running} running`),
      }
    }

    case '/releases': {
      const r = slices.releases
      const drafts = r?.draftCount ?? 0
      const credits = r?.creditsPending ?? 0
      return {
        decide: {
          label: credits > 0 ? 'Credits pending' : drafts > 0 ? 'Draft releases' : 'Release pipeline',
          metric: `${drafts} draft · ${credits} credit${credits === 1 ? '' : 's'}`,
          summary:
            credits > 0
              ? `${credits} reporter credit${credits === 1 ? '' : 's'} awaiting publish approval.`
              : drafts > 0
                ? `${drafts} AI-drafted release${drafts === 1 ? '' : 's'} ready for edit.`
                : 'Changelog pipeline idle — fixed reports feed the next draft.',
          severity: credits > 0 ? 'warn' : drafts > 0 ? 'info' : 'ok',
        },
        act:
          credits > 0
            ? {
                tone: 'do',
                title: `Publish ${credits} pending credit${credits === 1 ? '' : 's'}`,
                primary: { kind: 'link', to: '/releases', label: 'Open releases' },
              }
            : null,
        actIdle: idle('Nothing to publish', 'Credits stamp when a release ships.', `${r?.totalReleases ?? 0} total`),
      }
    }

    case '/intelligence': {
      const i = slices.intelligence
      const pending = i?.pendingFindings ?? 0
      const failed = i?.failedJobCount ?? 0
      const active = i?.activeJobCount ?? 0
      return {
        decide: {
          label: failed > 0 ? 'Digest job failed' : pending > 0 ? 'Findings open' : 'Intelligence current',
          metric: `${pending} finding · ${active} job · ${failed} fail`,
          summary:
            failed > 0
              ? `${failed} weekly digest job${failed === 1 ? '' : 's'} failed — check Pipeline tab.`
              : pending > 0
                ? `${pending} modernization finding${pending === 1 ? '' : 's'} awaiting review.`
                : 'Latest digest narrative is up to date.',
          severity: failed > 0 ? 'crit' : pending > 0 ? 'warn' : 'ok',
        },
        act: computeNextBestAction({
          scope: 'intelligence',
          lastDigestHoursAgo: null,
          topCategory: null,
          weekReports: i?.reportCount ?? 0,
        }),
        actIdle: idle('Digest idle', 'Cron generates the weekly narrative.', `${i?.reportCount ?? 0} reports/wk`),
      }
    }

    case '/repo': {
      const r = slices.repo
      const prs = r?.prOpen ?? counts.prsOpen
      const ciFailed = r?.ciFailed ?? 0
      return {
        decide: {
          label: ciFailed > 0 ? 'CI failing' : prs > 0 ? 'PRs open' : 'Repo clean',
          metric: `${prs} PR · ${ciFailed} CI fail`,
          summary:
            ciFailed > 0
              ? `${ciFailed} branch${ciFailed === 1 ? '' : 'es'} with failing checks.`
              : prs > 0
                ? `${prs} open PR${prs === 1 ? '' : 's'} awaiting review or merge.`
                : 'No open PRs or failing checks on connected repos.',
          severity: ciFailed > 0 ? 'crit' : prs > 0 ? 'info' : 'ok',
        },
        act: computeNextBestAction({
          scope: 'repo',
          reposWithoutIndex: 0,
          staleIndexHoursAgo: null,
        }),
        actIdle: idle('Nothing to merge', 'Fix-worker opens draft PRs automatically.', `${prs} open PRs`),
      }
    }

    case '/prompt-lab': {
      const p = slices.promptLab
      const untested = p?.untestedAbCount ?? 0
      const ready = p?.promoteReadyCount ?? 0
      return {
        decide: {
          label: ready > 0 ? 'Promote ready' : untested > 0 ? 'Untested prompts' : 'Prompt lab',
          metric: `${p?.totalPrompts ?? 0} prompts · ${untested} untested`,
          summary:
            ready > 0
              ? `${ready} candidate${ready === 1 ? '' : 's'} beat the active prompt in eval.`
              : untested > 0
                ? `${untested} A/B variant${untested === 1 ? '' : 's'} lack scored runs.`
                : 'Active and candidate prompts aligned with latest evals.',
          severity: ready > 0 ? 'warn' : untested > 0 ? 'info' : 'ok',
        },
        act: computeNextBestAction({
          scope: 'prompt-lab',
          draftCount: 0,
          untestedDrafts: untested,
          lastRunHoursAgo: null,
        }),
        actIdle: idle('Evals current', 'Scored runs confirm prompt quality.', `${p?.abTestingCount ?? 0} A/B live`),
      }
    }

    case '/mcp': {
      const m = slices.mcp
      const never = m?.neverConnectedCount ?? 0
      const mismatch = m?.endpointMismatch ?? false
      return {
        decide: {
          label: mismatch ? 'Endpoint mismatch' : never > 0 ? 'Keys never connected' : 'MCP ready',
          metric: `${m?.mcpReadKeyCount ?? 0} keys · ${never} silent`,
          summary: mismatch
            ? 'SDK endpoint env does not match this console — agents will fail handshake.'
            : never > 0
              ? `${never} key${never === 1 ? '' : 's'} minted but never saw an MCP heartbeat.`
              : 'Agent keys connected and endpoint matches.',
          severity: mismatch ? 'crit' : never > 0 ? 'warn' : 'ok',
        },
        act: computeNextBestAction({
          scope: 'mcp',
          unconfiguredClients: never,
          expiringKeysIn7Days: 0,
        }),
        actIdle: idle('Agents connected', 'Heartbeats update on each tool call.', `${m?.mcpReadKeyCount ?? 0} keys`),
      }
    }

    case '/marketplace': {
      const m = slices.marketplace
      const failing = m?.failingPlugins ?? 0
      const never = m?.neverDeliveredPlugins ?? 0
      return {
        decide: {
          label: failing > 0 ? 'Plugins failing' : never > 0 ? 'Never delivered' : 'Marketplace healthy',
          metric: `${m?.installedActive ?? 0} active · ${failing} fail`,
          summary:
            failing > 0
              ? `${failing} plugin${failing === 1 ? '' : 's'} returning delivery errors.`
              : never > 0
                ? `${never} install${never === 1 ? '' : 's'} never received a webhook POST.`
                : `${m?.installedActive ?? 0} plugin${(m?.installedActive ?? 0) === 1 ? '' : 's'} delivering normally.`,
          severity: failing > 0 ? 'crit' : never > 0 ? 'warn' : 'ok',
        },
        act: computeNextBestAction({
          scope: 'marketplace',
          installableUpdates: 0,
          disabledPlugins: failing,
        }),
        actIdle: idle('Deliveries OK', 'Signed POST log captures latency + status.', `${m?.deliveriesFailed ?? 0} failed 24h`),
      }
    }

    case '/notifications': {
      const unread = counts.notificationsUnread
      return {
        decide: {
          label: unread > 0 ? 'Unread backlog' : 'Inbox clear',
          metric: `${unread} unread`,
          summary:
            unread > 0
              ? `${unread} reporter notification${unread === 1 ? '' : 's'} not yet opened.`
              : 'All reporter notifications read.',
          severity: unread > 0 ? 'info' : 'ok',
        },
        act: computeNextBestAction({
          scope: 'notifications',
          unreadCritical: 0,
          totalUnread: unread,
        }),
        actIdle: idle('Inbox clear', 'Unread rows may mean the SDK stopped polling.', `${unread} unread`),
      }
    }

    case '/billing': {
      const b = slices.billing
      const pastDue = b?.pastDueProjects ?? 0
      const over = b?.overQuota ?? false
      const approaching = b?.approachingQuota ?? false
      return {
        decide: {
          label: pastDue > 0 ? 'Past due' : over ? 'Over quota' : approaching ? 'Near limit' : 'Billing current',
          metric: `${pastDue} past due${over ? ' · over quota' : approaching ? ' · near cap' : ''}`,
          summary:
            pastDue > 0
              ? `${pastDue} project${pastDue === 1 ? '' : 's'} with failed Stripe payment.`
              : over
                ? 'At least one project exceeded a plan limit.'
                : approaching
                  ? 'Usage is within 90% of a quota cap — review before the next cycle.'
                  : 'Plan, usage, and invoices match Stripe.',
          severity: pastDue > 0 || over ? 'crit' : approaching ? 'warn' : 'ok',
        },
        act: computeNextBestAction({
          scope: 'billing',
          pastDueInvoices: pastDue,
          projectedOverrunPct: approaching ? 90 : null,
        }),
        actIdle: idle('No billing actions', 'Usage meters refresh daily from Stripe.', 'Current'),
      }
    }

    case '/settings': {
      const s = slices.settings
      const failing = s?.byokKeysFailing ?? 0
      const untested = s?.byokKeysUntested ?? 0
      return {
        decide: {
          label: failing > 0 ? 'BYOK failing' : untested > 0 ? 'Keys untested' : 'Settings healthy',
          metric: `${s?.byokKeysConfigured ?? 0} keys · ${failing} fail`,
          summary:
            failing > 0
              ? `${failing} BYOK key${failing === 1 ? '' : 's'} failed the last probe.`
              : untested > 0
                ? `${untested} key${untested === 1 ? '' : 's'} saved but never tested.`
                : `Slack ${s?.slackConfigured ? 'on' : 'off'} · GitHub repo ${s?.githubRepoConfigured ? 'linked' : 'missing'}.`,
          severity: failing > 0 ? 'crit' : untested > 0 ? 'warn' : 'ok',
        },
        act:
          failing > 0
            ? {
                tone: 'do',
                title: `Fix ${failing} failing BYOK key${failing === 1 ? '' : 's'}`,
                primary: { kind: 'link', to: '/settings?tab=keys', label: 'Open keys' },
              }
            : untested > 0
              ? {
                  tone: 'plan',
                  title: `Test ${untested} saved key${untested === 1 ? '' : 's'}`,
                  primary: { kind: 'link', to: '/settings?tab=keys', label: 'Run probe' },
                }
              : null,
        actIdle: idle('Runtime configured', 'Health tab sends a test report after saves.', `${s?.byokKeysConfigured ?? 0} keys`),
      }
    }

    case '/rewards': {
      const r = slices.rewards
      const disputes = r?.openDisputesCount ?? 0
      const webhooks = r?.webhooksFailing ?? 0
      return {
        decide: {
          label: webhooks > 0 ? 'Webhooks failing' : disputes > 0 ? 'Open disputes' : 'Rewards loop',
          metric: `${r?.activeContributors30d ?? 0} contributors · ${disputes} dispute`,
          summary:
            webhooks > 0
              ? `${webhooks} reward webhook${webhooks === 1 ? '' : 's'} returning errors.`
              : disputes > 0
                ? `${disputes} payout dispute${disputes === 1 ? '' : 's'} need operator review.`
                : `${r?.activeContributors30d ?? 0} active contributor${(r?.activeContributors30d ?? 0) === 1 ? '' : 's'} in the last 30 days.`,
          severity: webhooks > 0 ? 'crit' : disputes > 0 ? 'warn' : 'ok',
        },
        act:
          webhooks > 0
            ? {
                tone: 'do',
                title: `Fix ${webhooks} failing webhook${webhooks === 1 ? '' : 's'}`,
                primary: { kind: 'link', to: '/rewards?tab=webhooks', label: 'Open webhooks' },
              }
            : disputes > 0
              ? {
                  tone: 'check',
                  title: `Review ${disputes} dispute${disputes === 1 ? '' : 's'}`,
                  primary: { kind: 'link', to: '/rewards?tab=disputes', label: 'Open disputes' },
                }
              : null,
        actIdle: idle('Economy stable', 'Points award on submit + triage automatically.', `${r?.activeContributors30d ?? 0} active`),
      }
    }

    case '/cost': {
      const c = slices.costs
      const failed = c?.failedCalls24h ?? 0
      const spike = c?.spendSpike24h ?? false
      return {
        decide: {
          label: spike ? 'Spend spike' : failed > 0 ? 'LLM errors' : 'Spend nominal',
          metric: c ? `$${c.spend24hUsd.toFixed(2)} / 24h · ${c.calls24h} calls` : '—',
          summary:
            spike
              ? '24h spend jumped vs the prior window — check top operations.'
              : failed > 0
                ? `${failed} LLM invocation${failed === 1 ? '' : 's'} failed in the last day.`
                : 'Spend and error rate within normal bounds.',
          severity: spike ? 'warn' : failed > 0 ? 'crit' : 'ok',
        },
        act:
          failed > 0
            ? {
                tone: 'check',
                title: `Inspect ${failed} failed LLM call${failed === 1 ? '' : 's'}`,
                primary: { kind: 'link', to: '/cost?tab=log', label: 'Open log' },
              }
            : spike
              ? {
                  tone: 'plan',
                  title: 'Review spend spike',
                  primary: { kind: 'link', to: '/cost', label: 'Open cost' },
                }
              : null,
        actIdle: idle('Spend stable', 'BYOK keys bill your provider directly.', c ? `${c.calls24h} calls/24h` : undefined),
      }
    }

    case '/sso': {
      const s = slices.sso
      const failed = s?.failedCount ?? 0
      const pending = s?.pendingCount ?? 0
      return {
        decide: {
          label: failed > 0 ? 'SSO failures' : pending > 0 ? 'Manual steps' : 'SSO healthy',
          metric: `${failed} fail · ${pending} pending`,
          summary:
            failed > 0
              ? `${failed} SSO login${failed === 1 ? '' : 's'} failed recently — check IdP config.`
              : pending > 0
                ? `${pending} domain${pending === 1 ? '' : 's'} awaiting manual verification.`
                : s?.ssoEntitlement
                  ? 'Enterprise SSO entitlement active.'
                  : 'SSO requires Enterprise — upgrade on Billing.',
          severity: failed > 0 ? 'crit' : pending > 0 ? 'warn' : 'ok',
        },
        act:
          failed > 0
            ? {
                tone: 'do',
                title: `Debug ${failed} SSO failure${failed === 1 ? '' : 's'}`,
                primary: { kind: 'link', to: '/sso?tab=audit', label: 'Open audit log' },
              }
            : pending > 0
              ? {
                  tone: 'plan',
                  title: `Complete ${pending} pending step${pending === 1 ? '' : 's'}`,
                  primary: { kind: 'link', to: '/sso', label: 'Open SSO' },
                }
              : null,
        actIdle: idle('SSO idle', 'Audit log captures every login attempt.', `${failed} failures`),
      }
    }

    case '/research': {
      const r = slices.research
      const unattached = r?.unattachedSnippets ?? 0
      return {
        decide: {
          label: unattached > 0 ? 'Unattached snippets' : 'Research corpus',
          metric: `${r?.sessions ?? 0} sessions · ${unattached} loose`,
          summary:
            unattached > 0
              ? `${unattached} snippet${unattached === 1 ? '' : 's'} not linked to a report or story.`
              : `${r?.sessions ?? 0} research session${(r?.sessions ?? 0) === 1 ? '' : 's'} captured.`,
          severity: unattached > 0 ? 'info' : 'ok',
        },
        act:
          unattached > 0
            ? {
                tone: 'plan',
                title: `Attach ${unattached} snippet${unattached === 1 ? '' : 's'}`,
                primary: { kind: 'link', to: '/research', label: 'Open research' },
              }
            : null,
        actIdle: idle('Corpus tidy', 'Firecrawl sessions ingest on demand.', `${r?.sessions ?? 0} sessions`),
      }
    }

    case '/iterate': {
      const it = slices.iterate
      const failed = it?.failed ?? 0
      const queued = it?.queued ?? 0
      return {
        decide: {
          label: failed > 0 ? 'PDCA failures' : queued > 0 ? 'Runs queued' : 'Iterate idle',
          metric: `${it?.running ?? 0} run · ${failed} fail · ${queued} queue`,
          summary:
            failed > 0
              ? `${failed} PDCA run${failed === 1 ? '' : 's'} failed — open Iterate for stack traces.`
              : queued > 0
                ? `${queued} improvement run${queued === 1 ? '' : 's'} waiting for a worker slot.`
                : 'No queued or failed PDCA iterations.',
          severity: failed > 0 ? 'crit' : queued > 0 ? 'info' : 'ok',
        },
        act:
          failed > 0
            ? {
                tone: 'check',
                title: `Review ${failed} failed run${failed === 1 ? '' : 's'}`,
                primary: { kind: 'link', to: '/iterate?status=failed', label: 'Open failures' },
              }
            : null,
        actIdle: idle('PDCA quiet', 'QA failures enqueue improve runs automatically.', `${it?.total ?? 0} total`),
      }
    }

    case '/skills': {
      const sk = slices.skills
      const failed = sk?.failedRuns ?? 0
      const awaiting = sk?.awaitingCheckin ?? 0
      return {
        decide: {
          label: failed > 0 ? 'Pipeline failures' : awaiting > 0 ? 'Awaiting check-in' : 'Skills catalog',
          metric: `${sk?.catalogTotal ?? 0} skills · ${sk?.activeRuns ?? 0} live`,
          summary:
            failed > 0
              ? `${failed} skill pipeline step${failed === 1 ? '' : 's'} failed.`
              : awaiting > 0
                ? `${awaiting} cloud step${awaiting === 1 ? '' : 's'} waiting for operator check-in.`
                : `${sk?.catalogTotal ?? 0} synced skills in catalog.`,
          severity: failed > 0 ? 'crit' : awaiting > 0 ? 'warn' : 'ok',
        },
        act:
          awaiting > 0
            ? {
                tone: 'do',
                title: `Check in ${awaiting} pipeline step${awaiting === 1 ? '' : 's'}`,
                primary: { kind: 'link', to: '/skills?tab=pipelines', label: 'Open pipelines' },
              }
            : failed > 0
              ? {
                  tone: 'check',
                  title: `Review ${failed} failed step${failed === 1 ? '' : 's'}`,
                  primary: { kind: 'link', to: '/skills?tab=pipelines', label: 'Open pipelines' },
                }
              : null,
        actIdle: idle('No pipelines running', 'Daily skill-sync refreshes the catalog.', `${sk?.catalogTotal ?? 0} skills`),
      }
    }

    default:
      return {}
  }
}

/** Live hero enrichment for a route — shared by Layout nav-meta and page stats publishers. */
export function buildHeroEnrichment(pathname: string, counts: NavCounts) {
  return enrichByPath(pathname, counts)
}

export function buildHeroSnapshotFromCounts(
  pathname: string,
  counts: NavCounts,
): PageHeroSnapshot | null {
  const enrichment = enrichByPath(pathname, counts)
  if (Object.keys(enrichment).length === 0) return null
  return { route: pathname, ...enrichment }
}

/** Merge static Layout fallback with live counts when nav-meta is ready. */
export function resolveLayoutHero(
  pathname: string,
  fallback: LayoutHeroFallback | null | undefined,
  counts: NavCounts,
  pageSnapshot?: PageHeroSnapshot | null,
): ResolvedLayoutHero | null {
  if (!fallback) return null

  const patch = counts.ready ? enrichByPath(pathname, counts) : {}
  const page =
    pageSnapshot?.route === pathname
      ? pageSnapshot
      : null

  const decide = mergeDecide(fallback.decide, {
    ...(patch.decide ?? {}),
    ...(page?.decide ?? {}),
  })
  const verify = mergeVerify(fallback.verify, {
    ...(patch.verify ?? {}),
    ...(page?.verify ?? {}),
  })

  const act =
    page && 'act' in page && page.act !== undefined
      ? page.act
      : patch.act !== undefined
        ? patch.act
        : null

  const actIdle = page?.actIdle ?? patch.actIdle

  return {
    ...fallback,
    decide,
    verify,
    act,
    actIdle,
  }
}
