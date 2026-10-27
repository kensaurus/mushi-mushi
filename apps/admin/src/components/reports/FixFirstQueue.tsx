/**
 * FILE: apps/admin/src/components/reports/FixFirstQueue.tsx
 * PURPOSE: The top of Bugs: the five open bugs to fix first (lib/fixFirst),
 *          each with its severity, how many people it reached and how long
 *          ago, and "Open the worst" as the page's one main button. The list
 *          below stays sorted however the person chose.
 *
 * Data: GET /v1/admin/reports?status=open (the newest 200 open reports).
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime, Section } from '../ui'
import { IconAlertTriangle } from '../icons'
import { usePageData } from '../../lib/usePageData'
import { fixFirstOrder, peopleHit } from '../../lib/fixFirst'
import { severityTrafficBg, severityTrafficLabel } from '../../lib/severityTraffic'
import { pluralize } from '../../lib/format'
import type { ReportRow } from './types'

const OPEN_PATH = '/v1/admin/reports?status=open&sort=created_at&dir=desc&limit=200'

function title(r: ReportRow): string {
  return (r.title ?? r.summary ?? r.description ?? '').trim() || 'Untitled report'
}

export function FixFirstQueue({ scope }: { scope: 'project' | 'enumeration' }) {
  const { data } = usePageData<{ reports: ReportRow[]; total: number }>(OPEN_PATH, { deps: [scope], scope })
  const reports = data?.reports ?? []
  const top = fixFirstOrder(reports)
  if (top.length === 0) return null
  const onTheWay = reports.filter((r) => r.status === 'fixing').length

  return (
    <Section
      title="Fix first"
      id="reports-fix-first"
      icon={<IconAlertTriangle />}
      action={
        <Btn size="sm" variant="primary" to={`/reports/${top[0].id}`} data-testid="reports-open-worst">
          Open the worst
        </Btn>
      }
    >
      <p className="mb-2 text-2xs text-fg-muted">
        Open bugs ranked by severity and how many people they reached.
        {onTheWay > 0 ? ` ${onTheWay} more already ${pluralize(onTheWay, 'has', 'have')} a fix on the way.` : ''}
      </p>
      <ol className="divide-y divide-edge-subtle" data-testid="reports-fix-first">
        {top.map((r, i) => {
          const people = peopleHit(r)
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5" data-testid={`reports-fix-first-${r.id}`}>
              <span className="w-4 shrink-0 text-right font-mono text-2xs tabular-nums text-fg-faint">{i + 1}</span>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-2xs text-fg-secondary">
                <span aria-hidden className={`h-2 w-2 rounded-full ${severityTrafficBg(r.severity) ?? 'bg-fg-faint'}`} />
                {severityTrafficLabel(r.severity) ?? 'Not rated'}
              </span>
              <Link to={`/reports/${r.id}`} className="min-w-0 flex-1 basis-48 wrap-break-word text-xs font-medium text-fg hover:underline">
                {title(r)}
              </Link>
              <span className="shrink-0 text-2xs tabular-nums text-fg-muted">
                {people} {pluralize(people, 'person', 'people')} · <RelativeTime value={r.created_at} />
              </span>
            </li>
          )
        })}
      </ol>
    </Section>
  )
}
