/**
 * FILE: apps/admin/src/components/query/QueryStatusBanner.tsx
 * PURPOSE: NL query health — errors, freshness, saved prompts, schema drift.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import type { QueryStats, QueryTabId } from './types'

interface Props {
  stats: QueryStats
  onTab?: (tab: QueryTabId) => void
  onViewErrors?: () => void
}

export function QueryStatusBanner({ stats, onTab, onViewErrors }: Props) {
  const projectLabel = stats.projectName ?? 'active project'

  if (!stats.projectId) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">No project selected</p>
            <p className="text-2xs text-fg-muted">
              Queries are scoped per project — pick an app in the header switcher before asking questions.
            </p>
          </div>
        </div>
        <Link to="/projects">
          <Btn size="sm" variant="ghost">Go to Projects</Btn>
        </Link>
      </div>
    )
  }

  if (stats.schemaDegraded) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">Query history schema pending</p>
            <p className="text-2xs text-fg-muted">
              Saved pins and team queries need a DB migration — POST /query still works; history sidebar may be empty.
            </p>
          </div>
        </div>
        <Link to="/health">
          <Btn size="sm" variant="ghost">Check migrations</Btn>
        </Link>
      </div>
    )
  }

  if (stats.errors24h > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {stats.errors24h} failed run{stats.errors24h === 1 ? '' : 's'} in the last 24h on {projectLabel}
            </p>
            <p className="text-2xs text-fg-muted break-words">
              {stats.lastRunError?.slice(0, 140) ?? 'Check SQL syntax or tighten your NL prompt — every failure is logged.'}
            </p>
          </div>
        </div>
        {onViewErrors ? (
          <Btn size="sm" variant="ghost" onClick={onViewErrors}>
            View recent
          </Btn>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('history')}>
            Open history
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.runs24h === 0 && stats.savedCount === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">No queries yet on {projectLabel}</p>
            <p className="text-2xs text-fg-muted">
              Ask your first question in natural language or switch to Raw SQL — results are read-only and sandboxed.
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('ask')}>
            Ask a question
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.savedCount === 0 && stats.runs24h > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">{stats.runs24h} run{stats.runs24h === 1 ? '' : 's'} today — nothing pinned</p>
            <p className="text-2xs text-fg-muted">
              Star a useful query on History so teammates can rerun it from the Team tab.
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('history')}>
            Pin a query
          </Btn>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">
            {stats.savedCount} saved · {stats.runs24h} run{stats.runs24h === 1 ? '' : 's'} in 24h on {projectLabel}
          </p>
          <p className="text-2xs text-fg-muted">
            {stats.teamSavedCount > 0 ? (
              <>{stats.teamSavedCount} teammate pin{stats.teamSavedCount === 1 ? '' : 's'} · </>
            ) : null}
            {stats.lastRunAt ? (
              <>last run <RelativeTime value={stats.lastRunAt} /></>
            ) : (
              'Ready for ad-hoc analytics'
            )}
            {stats.avgLatencyMs != null ? <> · ~{stats.avgLatencyMs}ms avg</> : null}
          </p>
        </div>
      </div>
      {onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('ask')}>
          New query
        </Btn>
      ) : null}
    </div>
  )
}

