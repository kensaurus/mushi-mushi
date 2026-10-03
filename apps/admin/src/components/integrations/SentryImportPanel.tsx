/**
 * FILE: apps/admin/src/components/integrations/SentryImportPanel.tsx
 * PURPOSE: "Import from Sentry" on the Sentry card. The webhook only sees
 *          issues that fire after it is wired up; this pulls existing ones
 *          (by id / short id, or a search of one configured Sentry project,
 *          optionally limited to the last N days and walked page by page)
 *          into the report queue through POST /v1/admin/projects/:id/sentry/import.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetchMutate } from '../../lib/supabase'
import { useActiveProjectId } from '../ProjectSwitcher'
import { Btn, ErrorAlert, Input, SelectField } from '../ui'
import {
  parseIssueIdInput,
  sentryImportBody,
  sentrySearchBody,
  SENTRY_IMPORT_MAX,
  SENTRY_IMPORT_NEWEST,
  SENTRY_SINCE_DAYS_OPTIONS,
  type SentrySearchParams,
} from '../../lib/sentryImport'

interface ImportItem {
  input: string
  issueId: string | null
  shortId: string | null
  outcome: string
  reportId: string | null
  error?: string
}

interface ImportResponse {
  items: ImportItem[]
  created: Array<string | null>
  linked: Array<string | null>
  failed: number
  indexing: { queued: boolean; paths: number }
  sentryProject?: string | null
  nextCursor?: string | null
}

const OUTCOME_LABEL: Record<string, string> = {
  created: 'New report',
  linked: 'Already in Mushi',
  deduped: 'Already in Mushi',
  ignored: 'Skipped (no title)',
  error: 'Not imported',
}

interface Props {
  /** The project's Sentry project slugs, primary first (sentryProjectsFromConfig). */
  sentryProjects: string[]
}

export function SentryImportPanel({ sentryProjects }: Props) {
  const projectId = useActiveProjectId()
  const [ids, setIds] = useState('')
  const [sentryProject, setSentryProject] = useState('')
  const [sinceDays, setSinceDays] = useState(0)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResponse | null>(null)
  // The search the shown page came from, so "Load next page" repeats it exactly.
  const [lastSearch, setLastSearch] = useState<SentrySearchParams | null>(null)
  const [page, setPage] = useState(1)

  const parsed = parseIssueIdInput(ids)
  const tooMany = parsed.length > SENTRY_IMPORT_MAX
  const searching = parsed.length === 0
  const chosenProject = sentryProject || sentryProjects[0] || ''
  const searchParams: SentrySearchParams = {
    ...(sentryProjects.length > 1 && chosenProject ? { sentryProject: chosenProject } : {}),
    ...(sinceDays > 0 ? { sinceDays } : {}),
  }

  const post = async (body: object, search: SentrySearchParams | null, nextPage: number) => {
    if (!projectId) return
    setRunning(true)
    setError(null)
    const res = await apiFetchMutate<ImportResponse>(`/v1/admin/projects/${projectId}/sentry/import`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    setRunning(false)
    if (!res.ok || !res.data) {
      setError(res.error?.message ?? 'Import failed')
      return
    }
    setResult(res.data)
    setLastSearch(search)
    setPage(nextPage)
  }

  const runImport = () => {
    if (tooMany) return
    if (searching) void post(sentrySearchBody(searchParams), searchParams, 1)
    else void post(sentryImportBody(parsed), null, 1)
  }

  const loadNextPage = () => {
    if (!lastSearch || !result?.nextCursor) return
    void post(sentrySearchBody(lastSearch, result.nextCursor), lastSearch, page + 1)
  }

  const importLabel = !searching
    ? `Import ${parsed.length}`
    : sinceDays > 0
      ? `Import ${SENTRY_IMPORT_MAX} seen in ${sinceDays}d`
      : `Import newest ${SENTRY_IMPORT_NEWEST}`

  return (
    <div className="border-t border-edge-subtle px-3 py-2 space-y-2">
      <div className="text-xs font-medium text-fg">Import existing Sentry issues</div>
      <p className="text-2xs text-fg-faint leading-snug">
        Alerts only reach Mushi after the webhook is set up. Paste issue ids or short ids (up to 10), or leave it
        empty to search a Sentry project for unresolved issues. A backlog comes in pages of {SENTRY_IMPORT_MAX};
        importing again is safe, issues already in Mushi are linked, not duplicated.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-48">
          <Input
            aria-label="Sentry issue ids"
            placeholder="WEB-12, WEB-13"
            value={ids}
            onChange={(e) => setIds(e.target.value)}
            error={tooMany ? `At most ${SENTRY_IMPORT_MAX} issues per import` : undefined}
          />
        </div>
        {searching && sentryProjects.length > 1 ? (
          <div className="w-40">
            <SelectField
              aria-label="Sentry project"
              value={chosenProject}
              onChange={(e) => setSentryProject(e.target.value)}
            >
              {sentryProjects.map((slug) => (
                <option key={slug} value={slug}>
                  {slug}
                </option>
              ))}
            </SelectField>
          </div>
        ) : null}
        {searching ? (
          <div className="w-36">
            <SelectField
              aria-label="Seen in"
              value={String(sinceDays)}
              onChange={(e) => setSinceDays(Number(e.target.value))}
            >
              {SENTRY_SINCE_DAYS_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? 'Any time' : `Seen in last ${d} days`}
                </option>
              ))}
            </SelectField>
          </div>
        ) : null}
        <Btn size="sm" onClick={runImport} loading={running} disabled={!projectId || tooMany}>
          {importLabel}
        </Btn>
      </div>
      {error && <ErrorAlert title="Import failed" message={error} />}
      {result && (
        <div className="space-y-1">
          <p className="text-2xs text-fg-secondary">
            {lastSearch ? `Page ${page}${result.sentryProject ? ` of ${result.sentryProject}` : ''}: ` : ''}
            {result.created.length} new · {result.linked.length} already in Mushi · {result.failed} not imported
            {result.indexing.queued ? ` · indexing ${result.indexing.paths} stack file(s)` : ''}
          </p>
          <ul className="space-y-0.5">
            {result.items.map((item) => (
              <li key={`${item.input}-${item.issueId ?? 'none'}`} className="text-2xs flex items-center gap-2 min-w-0">
                <span className="font-mono text-fg-secondary shrink-0">{item.shortId ?? item.input}</span>
                <span className={item.outcome === 'error' ? 'text-danger' : 'text-fg-faint'}>
                  {OUTCOME_LABEL[item.outcome] ?? item.outcome}
                </span>
                {item.reportId ? (
                  <Link to={`/reports/${item.reportId}`} className="text-accent hover:underline shrink-0">
                    Open report
                  </Link>
                ) : null}
                {item.error ? <span className="text-fg-faint truncate">{item.error}</span> : null}
              </li>
            ))}
          </ul>
          {lastSearch && result.nextCursor ? (
            <Btn size="sm" variant="ghost" onClick={loadNextPage} loading={running} disabled={running}>
              Load next page
            </Btn>
          ) : lastSearch ? (
            <p className="text-2xs text-fg-faint">That was the last page of this search.</p>
          ) : null}
        </div>
      )}
    </div>
  )
}
