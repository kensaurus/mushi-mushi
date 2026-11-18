/**
 * FILE: apps/admin/src/components/portfolio/PortfolioFindings.tsx
 * PURPOSE: The Apps tab below the grid: problems shared by apps (2026-11-18 signal pass).
 *   - Fix once: a findings × apps matrix (FindingsMatrix).
 *   - Across your apps, SDK versions, Missing setups: one row per problem with the icons of
 *     the apps it is open in and one action, instead of the same sentence once per app
 *     ("yen-yen (app) has no version probe.", "glot.it (app) has no version probe." …).
 *     The grouping is lib/groupAppFindings.
 * An empty list is a green mark, a failed read is a red one with the server's reason.
 *
 * Data: GET /v1/admin/orgs/:orgId/portfolio/findings (read by the page).
 */

import { useMemo, useState, type ReactNode } from 'react'
import { Btn, Callout, Loading, Section } from '../ui'
import { PageLoadError } from '../PageLoadError'
import { StatusMark, StatusPill, type RunStatus } from '../signal/StatusMark'
import type { PageDataState } from '../../lib/usePageData'
import type { PortfolioFindingsResponse, PortfolioReadError } from '../../lib/portfolioTypes'
import { fixOnceRows, groupAcrossApps, groupHoles, groupSdkSkew } from '../../lib/groupAppFindings'
import { findingGroupTitle } from './portfolioView'
import { FindingsMatrix } from './FindingsMatrix'
import { AppIconChips, CopyFixButton, type IconFor } from './AppIconChips'

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
  const nameOf = (id: string) => iconFor(id).project_name
  const matrix = useMemo(() => (data ? fixOnceRows(data.groups, findingGroupTitle) : []), [data])
  const across = useMemo(() => (data ? groupAcrossApps(data.crossProject, (id) => iconFor(id).project_name) : []), [data, iconFor])
  const sdk = useMemo(() => (data ? groupSdkSkew(data.sdkSkew) : []), [data])
  const holes = useMemo(() => (data ? groupHoles(data.holes) : []), [data])

  if (findings.loading && !data) return <Loading text="Looking for problems shared across apps…" />
  if (findings.error) {
    return <PageLoadError error={findings.error} code={findings.errorCode} resource="shared problems" endpoint={findings.errorEndpoint} requestId={findings.requestId} onRetry={findings.reload} />
  }
  if (!data) return null
  const failed = (part: PortfolioReadError['part']) => data.readErrors.find((e) => e.part === part && e.kind === 'failed')
  const sdkFailed = failed('sdk')
  const holesFailed = failed('integrations')
  return (
    <div className="flex flex-col gap-3">
      {data.readErrors.length > 0 && <ReadErrorsCallout errors={data.readErrors} />}
      <Section title="Fix once">
        {matrix.length === 0 ? (
          <StatusPill status="passed" label="Nothing open in 2+ apps" />
        ) : (
          <FindingsMatrix rows={matrix} appOrder={appOrder} iconFor={iconFor} />
        )}
      </Section>
      {across.length > 0 && (
        <Section title="Across your apps">
          <ul className="divide-y divide-edge-subtle" data-testid="across-apps">
            {across.map((g) => (
              <GroupedRow
                key={g.key}
                testId={`across-row-${g.ruleId}`}
                mark={SEV_STATUS[g.severity]}
                title={g.title}
                detail={g.detail}
                projectIds={g.projectIds}
                iconFor={iconFor}
                action={g.fix ? <CopyFixButton label={g.action} prompt={g.fix} apps={g.projectIds.length} /> : undefined}
              />
            ))}
          </ul>
        </Section>
      )}
      <Section title="Mushi Mushi SDK versions">
        {sdkFailed ? (
          <ReadFailed message={sdkFailed.message} />
        ) : sdk.length === 0 ? (
          <StatusPill status="passed" label="All on the latest SDK" />
        ) : (
          <ul className="divide-y divide-edge-subtle" data-testid="sdk-versions">
            {sdk.map((g) => {
              const versionOf = new Map(g.apps.map((a) => [a.projectId, a]))
              return (
                <GroupedRow
                  key={g.key}
                  testId={`sdk-row-${g.status}`}
                  mark={g.status === 'behind' ? { status: 'waiting', word: 'Behind' } : { status: 'idle', word: 'Unknown' }}
                  title={g.pkg ? `${g.pkg} · ${g.title}` : g.title}
                  projectIds={g.apps.map((a) => a.projectId)}
                  iconFor={iconFor}
                  titleFor={(id) => {
                    const a = versionOf.get(id)
                    return a?.version ? `${nameOf(id)} · on ${a.version}` : `${nameOf(id)} · ${a?.reason ?? ''}`.trim()
                  }}
                  action={g.status === 'behind' ? <Btn size="sm" variant="ghost" to="/connect">Upgrade</Btn> : undefined}
                />
              )
            })}
          </ul>
        )}
      </Section>
      <Section title="Missing setups">
        {holesFailed ? (
          <ReadFailed message={holesFailed.message} />
        ) : holes.length === 0 ? (
          <StatusPill status="passed" label="Nothing missing" />
        ) : (
          <ul className="divide-y divide-edge-subtle" data-testid="missing-setups">
            {holes.map((h) => (
              <GroupedRow
                key={h.integration}
                testId={`hole-row-${h.integration}`}
                mark={{ status: 'idle', word: 'Missing' }}
                title={h.title}
                detail={h.detail}
                projectIds={h.projectIds}
                iconFor={iconFor}
                action={<Btn size="sm" variant="ghost" to="/integrations">Connect</Btn>}
              />
            ))}
          </ul>
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
