import { Link } from 'react-router-dom'
import { IconLink, IconExternalLink, IconArrowRight } from '../icons'
import type { DispatchState } from '../../lib/dispatchFix'
import type { ReportDetail } from './types'

interface RelatedLink {
  to: string
  label: string
  description: string
  external?: boolean
}

export function ReportRelatedFooter({ report, dispatchState }: { report: ReportDetail; dispatchState: DispatchState }) {
  const links: RelatedLink[] = []

  if (report.component) {
    links.push({
      to: `/reports?component=${encodeURIComponent(report.component)}`,
      label: 'Other reports for this component',
      description: `View all reports filed against ${report.component}.`,
    })
  }

  links.push({
    to: `/reports?reporter=${encodeURIComponent(report.reporter_token_hash)}`,
    label: 'This reporter\u2019s history',
    description: 'See every other report from the same reporter.',
  })

  links.push({
    to: '/graph',
    label: 'Open knowledge graph',
    description: 'Explore the dependency and regression graph for this project.',
  })

  if (report.status === 'fixing' || report.status === 'fixed' || dispatchState.status !== 'idle') {
    if (dispatchState.status === 'completed' && dispatchState.prUrl) {
      links.push({
        to: dispatchState.prUrl,
        label: 'View dispatched PR',
        description: 'Open the auto-generated pull request in your code host.',
        external: true,
      })
    } else {
      links.push({
        to: '/fixes',
        label: 'Auto-fix pipeline',
        description: 'Track the agentic fix attempts for this and other reports.',
      })
    }
  }

  return (
    <div className="mt-6">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-secondary mb-2">
        <IconLink /> Related
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {links.map((l) => (
          <RelatedLinkCard key={l.label} {...l} />
        ))}
      </div>
    </div>
  )
}

function RelatedLinkCard({ to, label, description, external }: RelatedLink) {
  const className = 'group block rounded-md border border-edge-subtle bg-surface-raised/40 px-3 py-2 hover:bg-surface-overlay hover:border-edge motion-safe:transition-colors'
  const inner = (
    <>
      <p className="text-xs font-medium text-fg-secondary group-hover:text-fg inline-flex items-center gap-1.5">
        {label}
        {external ? <IconExternalLink /> : <IconArrowRight />}
      </p>
      <p className="text-2xs text-fg-muted mt-0.5">{description}</p>
    </>
  )
  if (external) {
    return <a href={to} target="_blank" rel="noopener noreferrer" className={className}>{inner}</a>
  }
  return <Link to={to} className={className}>{inner}</Link>
}
