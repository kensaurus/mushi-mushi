/**
 * FILE: apps/admin/src/components/report-detail/KnownIssuesSection.tsx
 * PURPOSE: "Others who hit this" on the report detail page: issues, merged
 *          PRs and answers for the report's error, found after
 *          classification when the project has a Firecrawl key
 *          (known-issues.ts), plus snippets attached from Research.
 *          "Search again" runs the lookup now. With no results yet, it shows
 *          only for a report that carries an error. The search is a per-project
 *          opt-in (default off); when it is off, a link to the setting replaces
 *          the button.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { KNOWN_ISSUES_SEARCH_HREF } from '../../lib/settingsTabs'
import { Section, Badge, Btn } from '../ui'
import { IconExternalLink, IconLink } from '../icons'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
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

/** Same test the server uses before spending a search (known-issues.ts). */
const EXCEPTION_NAME = /\b(?:[A-Za-z_$][\w$]*)?(?:Error|Exception)\b|\b[A-Z][A-Za-z]+(?:Termination|Crash|Panic)\b/

/** Does the report carry an error message worth searching for? */
function reportHasSearchableError(
  report: Pick<ReportDetail, 'description' | 'console_logs' | 'custom_metadata'>,
): boolean {
  if (report.custom_metadata?.source === 'sentry_webhook') {
    return EXCEPTION_NAME.test((report.description ?? '').split('\n')[0] ?? '')
  }
  // Like the server: only the FIRST error-level line is searched.
  const first = (report.console_logs ?? []).find((l) => l.level === 'error' && (l.message ?? '').trim())
  return Boolean(first && EXCEPTION_NAME.test(first.message))
}

/** Only http(s) links are rendered; anything else shows as text. */
function safeHref(url: string): string | undefined {
  return /^https?:\/\//i.test(url) ? url : undefined
}

interface LookupReply {
  attached: number
  skipped?: 'no_query' | 'disabled' | 'no_key' | 'already_attached' | 'recent' | 'error'
}

export function KnownIssuesSection({
  report,
  onReload,
  searchEnabled,
}: {
  report: Pick<ReportDetail, 'id' | 'known_issues' | 'description' | 'console_logs' | 'custom_metadata'>
  onReload: () => void
  /** project_settings.known_issues_search_enabled; null/undefined = unknown. */
  searchEnabled?: boolean | null
}) {
  const toast = useToast()
  const [searching, setSearching] = useState(false)
  const issues: KnownIssue[] = report.known_issues ?? []
  if (issues.length === 0 && !reportHasSearchableError(report)) return null

  async function searchAgain() {
    setSearching(true)
    let res: Awaited<ReturnType<typeof apiFetch<LookupReply>>>
    try {
      res = await apiFetch<LookupReply>(`/v1/admin/reports/${report.id}/known-issues`, { method: 'POST' })
    } finally {
      setSearching(false)
    }
    if (!res.ok) {
      toast.error(
        res.error?.code === 'FIRECRAWL_NOT_CONFIGURED'
          ? 'No Firecrawl key'
          : res.error?.code === 'KNOWN_ISSUES_SEARCH_OFF'
            ? 'Web search is off'
            : 'Search did not run',
        res.error?.message ?? 'Retry in a moment.',
      )
      return
    }
    const r = res.data
    const added = r?.attached ?? 0
    if (r?.skipped === 'no_query') toast.success('Nothing to search', "This report's error is too short or generic to search for.")
    else if (r?.skipped === 'recent') toast.success('Already searched', 'This error was searched in the last 10 minutes.')
    else if (added > 0) toast.success(`${added} new result${added === 1 ? '' : 's'}`, 'Added below.')
    else toast.success('No new results', 'Nothing new beyond what is already here.')
    onReload()
  }

  // Only an explicit "off" swaps the button for the setting link; unknown keeps it.
  const action = searchEnabled === false ? (
    <Link to={KNOWN_ISSUES_SEARCH_HREF} className="text-2xs underline text-fg-muted hover:text-fg-secondary shrink-0">
      Turn on web search in Settings
    </Link>
  ) : (
    <Btn size="sm" variant="ghost" type="button" loading={searching} onClick={() => void searchAgain()}>
      {issues.length > 0 ? 'Search again' : 'Search now'}
    </Btn>
  )

  if (issues.length === 0) {
    return (
      <Section title="Others who hit this" icon={<IconLink />}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-2xs text-fg-faint leading-snug min-w-0">
            Look for GitHub issues, merged fixes and answers about this error.
          </p>
          {action}
        </div>
      </Section>
    )
  }

  return (
    <Section title="Others who hit this" icon={<IconLink />}>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <p className="text-2xs text-fg-faint leading-snug min-w-0">
          Issues, merged fixes and answers about this error. Check whether one already has the cause or a fix before digging in.
        </p>
        {action}
      </div>
      <ul className="space-y-2">
        {issues.map((issue) => (
          <li key={issue.id} className="min-w-0">
            <a
              href={safeHref(issue.url)}
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
