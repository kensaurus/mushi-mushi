/**
 * FILE: apps/admin/src/components/portfolio/PortfolioFindings.tsx
 * PURPOSE: The Apps tab below the grid: problems shared by apps (2026-11-18 signal pass).
 *   - Fix once: a findings × apps matrix (FindingsMatrix) from 768 px of room; below that, one
 *     row per problem in the "Across your apps" layout (both are in the DOM, a container query
 *     picks one).
 *   - Round 2 (2026-11-18): Across your apps, SDK versions and Missing setups are rows of the
 *     SAME list (portfolioView.appProblemList), not three more cards: one card, worst first,
 *     one row per problem with a dot per app and one action. The per-app sentences ("yen-yen
 *     (app) has no version probe." …) are grouped by lib/groupAppFindings.
 * An empty list is one green mark (only when every part was read); a failed read is a red
 * line with the server's reason.
 *
 * Data: GET /v1/admin/orgs/:orgId/portfolio/findings (read by the page).
 */

import { useMemo, useState, type ReactNode } from 'react'
import { Callout, Section } from '../ui'
import { TimedLoading } from './TimedLoading'
import { PageLoadError } from '../PageLoadError'
import { StatusMark, StatusPill, type RunStatus } from '../signal/StatusMark'
import type { PageDataState } from '../../lib/usePageData'
import type { PortfolioFindingsResponse, PortfolioReadError } from '../../lib/portfolioTypes'
import { appProblemList } from './portfolioView'
import { FindingsMatrix, RowAction } from './FindingsMatrix'
import { AppIconChips, type IconFor } from './AppIconChips'

const SEV_STATUS: Record<'info' | 'warn' | 'error', { status: RunStatus; word: string }> = {
  error: { status: 'failed', word: 'Serious' },
  warn: { status: 'waiting', word: 'Look at' },
  info: { status: 'idle', word: 'Note' },
}

/** One grouped problem: mark, short title, count, app icons, one action. */
function GroupedRow({
  mark,
  title,
  detail,
  projectIds,
  iconFor,
  titleFor,
  action,
  testId,
}: {
  mark: { status: RunStatus; word: string }
  title: string
  detail?: string
  projectIds: readonly string[]
  iconFor: IconFor
  titleFor?: (projectId: string) => string
  action?: ReactNode
  testId: string
}) {
  const [open, setOpen] = useState(false)
  const expandable = detail != null && detail !== title
  return (
    <li className="ci-rise py-1" data-testid={testId}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <StatusMark status={mark.status} label={mark.word} />
        {expandable ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="min-w-0 truncate rounded-sm text-left text-xs font-semibold text-fg hover:underline focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
            title={detail}
          >
            {title}
          </button>
        ) : (
          <span className="min-w-0 truncate text-xs font-semibold text-fg">{title}</span>
        )}
        <span className="font-mono text-2xs font-bold text-fg-secondary tabular-nums" title={`${projectIds.length} apps`}>
          {projectIds.length}
          <span className="sr-only"> apps</span>
        </span>
        <AppIconChips projectIds={projectIds} iconFor={iconFor} titleFor={titleFor} />
        {action && <span className="ml-auto shrink-0">{action}</span>}
      </div>
      {expandable && open && <p className="mt-0.5 pl-5 text-xs text-fg-secondary">{detail}</p>}
    </li>
  )
}

function ReadFailed({ message }: { message: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold text-st-failed-ink" role="status">
      <StatusMark status="failed" />
      {message}
    </p>
  )
}

export function PortfolioFindings({
  findings,
  iconFor,
  appOrder,
}: {
  findings: PageDataState<PortfolioFindingsResponse>
  iconFor: IconFor
  /** The page's app order (worst first), so matrix columns line up with the grid. */
  appOrder: readonly string[]
}) {
  const data = findings.data
  // ONE list: Fix once, Across your apps, SDK versions and Missing setups, worst first (round 2).
  const rows = useMemo(() => (data ? appProblemList(data, (id) => iconFor(id).project_name) : []), [data, iconFor])

  if (findings.error) {
    return <PageLoadError error={findings.error} code={findings.errorCode} resource="shared problems" endpoint={findings.errorEndpoint} requestId={findings.requestId} onRetry={findings.reload} />
  }
  if (!data) {
    return (
      <TimedLoading
        waiting={findings.loading}
        text="Looking for problems shared across apps…"
        what="Fix once"
        onRetry={findings.reload}
        testId="portfolio-fix-once-not-checked"
      />
    )
  }
  const failed = (part: PortfolioReadError['part']) => data.readErrors.find((e) => e.part === part && e.kind === 'failed')
  const sdkFailed = failed('sdk')
  const holesFailed = failed('integrations')
  const otherErrors = data.readErrors.filter((e) => e !== sdkFailed && e !== holesFailed)
  const inOrder = (ids: readonly string[]) => appOrder.filter((id) => ids.includes(id)).concat(ids.filter((id) => !appOrder.includes(id)))
  return (
    <div className="flex flex-col gap-3">
      {otherErrors.length > 0 && <ReadErrorsCallout errors={otherErrors} />}
      <Section title="Fix once">
        {(sdkFailed || holesFailed) && (
          <div className="mb-2 flex flex-col gap-1">
            {sdkFailed && <ReadFailed message={sdkFailed.message} />}
            {holesFailed && <ReadFailed message={holesFailed.message} />}
          </div>
        )}
        {rows.length === 0 ? (
          // Green only when every part was read: a failed part is not "nothing to fix".
          sdkFailed || holesFailed ? null : <StatusPill status="passed" label="Nothing to fix across your apps" />
        ) : (
          // The matrix needs about 768 px; narrower (a phone, a split window) each problem is a
          // row with its app icons, so the buttons stay on screen (2026-11-18 preview at 390 px:
          // the matrix scrolled and every action sat off to the right). The container is this
          // wrapper, not an element carrying the @ classes itself.
          <div className="@container" data-testid="fix-once">
            <div className="hidden @3xl:block" data-testid="fix-once-wide">
              <FindingsMatrix rows={rows} appOrder={appOrder} iconFor={iconFor} />
            </div>
            <ul className="divide-y divide-edge-subtle @3xl:hidden" data-testid="fix-once-list">
              {rows.map((r) => (
                <GroupedRow
                  key={r.ruleId}
                  testId={`fix-once-item-${r.ruleId}`}
                  mark={SEV_STATUS[r.severity]}
                  title={r.title}
                  detail={r.gateLabel ? `${r.gateLabel}: ${r.explanation}` : r.explanation}
                  projectIds={inOrder(r.projectIds)}
                  iconFor={iconFor}
                  titleFor={r.appTitles ? (id) => r.appTitles?.[id] ?? iconFor(id).project_name : undefined}
                  action={<RowAction row={r} />}
                />
              ))}
            </ul>
          </div>
        )}
      </Section>
    </div>
  )
}

/** Reads the server could not finish: their columns are unknown, not empty or zero. */
export function ReadErrorsCallout({ errors }: { errors: PortfolioReadError[] }) {
  return (
    <Callout tone="warn" label="Some of this could not be read">
      <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs text-fg-secondary" role="status">
        {errors.map((e) => (
          <li key={`${e.part}:${e.kind}`}>{e.message}</li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-fg-muted">Cells that depend on these read "Could not read". Refresh in a minute.</p>
    </Callout>
  )
}
