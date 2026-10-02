/**
 * FILE: apps/admin/src/components/integrations/SentryImportPanel.tsx
 * PURPOSE: "Import from Sentry" on the Sentry card. The webhook only sees
 *          issues that fire after it is wired up; this pulls existing ones
 *          (by id / short id, or the newest unresolved) into the report queue
 *          through POST /v1/admin/projects/:id/sentry/import.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetchMutate } from '../../lib/supabase'
import { useActiveProjectId } from '../ProjectSwitcher'
import { Btn, ErrorAlert, Input } from '../ui'
import { parseIssueIdInput, sentryImportBody, SENTRY_IMPORT_MAX } from '../../lib/sentryImport'

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
}

const OUTCOME_LABEL: Record<string, string> = {
  created: 'New report',
  linked: 'Already in Mushi',
  deduped: 'Already in Mushi',
  ignored: 'Skipped (no title)',
  error: 'Not imported',
}

export function SentryImportPanel() {
  const projectId = useActiveProjectId()
  const [ids, setIds] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResponse | null>(null)

  const parsed = parseIssueIdInput(ids)
  const tooMany = parsed.length > SENTRY_IMPORT_MAX

  const runImport = async () => {
    if (!projectId || tooMany) return
    setRunning(true)
    setError(null)
    const res = await apiFetchMutate<ImportResponse>(`/v1/admin/projects/${projectId}/sentry/import`, {
      method: 'POST',
      body: JSON.stringify(sentryImportBody(parsed)),
    })
    setRunning(false)
    if (!res.ok || !res.data) {
      setError(res.error?.message ?? 'Import failed')
      return
    }
    setResult(res.data)
  }

  return (
    <div className="border-t border-edge-subtle px-3 py-2 space-y-2">
      <div className="text-xs font-medium text-fg">Import existing Sentry issues</div>
      <p className="text-2xs text-fg-faint leading-snug">
        Alerts only reach Mushi after the webhook is set up. Paste issue ids or short ids (up to 10), or leave
        it empty to pull the 5 newest unresolved issues from this project&apos;s Sentry project.
      </p>
      <div className="flex items-end gap-2">
        <div className="flex-1 min-w-0">
          <Input
            aria-label="Sentry issue ids"
            placeholder="WEB-12, WEB-13"
            value={ids}
            onChange={(e) => setIds(e.target.value)}
            error={tooMany ? `At most ${SENTRY_IMPORT_MAX} issues per import` : undefined}
          />
        </div>
        <Btn size="sm" onClick={() => void runImport()} loading={running} disabled={!projectId || tooMany}>
          {parsed.length > 0 ? `Import ${parsed.length}` : 'Import newest 5'}
        </Btn>
      </div>
      {error && <ErrorAlert title="Import failed" message={error} />}
      {result && (
        <div className="space-y-1">
          <p className="text-2xs text-fg-secondary">
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
        </div>
      )}
    </div>
  )
}
