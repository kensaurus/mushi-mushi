/**
 * FILE: apps/admin/src/components/report-detail/KnownIssuesSection.tsx
 * PURPOSE: "Others who hit this" on the report detail page: GitHub and
 *          Stack Overflow results for the report's error, found once after
 *          classification when the project has a Firecrawl key
 *          (known-issues.ts), plus snippets attached from Research.
 *          Renders nothing when there are none.
 */

import { Section, Badge } from '../ui'
import { IconExternalLink, IconLink } from '../icons'
import type { ReportDetail } from './types'

type KnownIssue = NonNullable<ReportDetail['known_issues']>[number]

/** "github.com/supabase/realtime-js" style label for a result. */
function sourceLabel(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    const path = u.pathname.split('/').filter(Boolean).slice(0, 2).join('/')
    return host === 'github.com' && path ? `${host}/${path}` : host
  } catch {
    return url
  }
}

export function KnownIssuesSection({ issues }: { issues: KnownIssue[] | null | undefined }) {
  if (!issues || issues.length === 0) return null
  return (
    <Section title="Others who hit this" icon={<IconLink />}>
      <p className="text-2xs text-fg-faint leading-snug mb-2">
        Web results for this error. Check whether one already has the cause or a fix before digging in.
      </p>
      <ul className="space-y-2">
        {issues.map((issue) => (
          <li key={issue.id} className="min-w-0">
            <a
              href={issue.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-start gap-1 text-xs font-medium text-fg hover:underline wrap-break-word"
            >
              <span className="min-w-0">{issue.title || issue.url}</span>
              <IconExternalLink className="shrink-0 mt-0.5" aria-hidden />
            </a>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
              <span className="text-2xs text-fg-muted font-mono">{sourceLabel(issue.url)}</span>
              {issue.attached_by ? <Badge>Attached by hand</Badge> : null}
            </div>
            {issue.snippet ? (
              <p className="text-2xs text-fg-secondary leading-snug mt-0.5 line-clamp-3 wrap-break-word">
                {issue.snippet}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  )
}
