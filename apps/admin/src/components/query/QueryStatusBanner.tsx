/**
 * FILE: apps/admin/src/components/query/QueryStatusBanner.tsx
 * PURPOSE: NL query health — errors, freshness, saved prompts, schema drift.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import { StatusBannerShell } from '../StatusBannerShell'
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
      <StatusBannerShell
        tone="warn"
        title="No project selected"
        subtitle="Queries are scoped per project — pick an app in the header switcher before asking questions."
        action={
          <Link to="/projects">
            <Btn size="sm" variant="ghost">Go to Projects</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.schemaDegraded) {
    return (
      <StatusBannerShell
        tone="warn"
        title="Query history schema pending"
        subtitle="Saved pins and team queries need a DB migration — POST /query still works; history sidebar may be empty."
        action={
          <Link to="/health">
            <Btn size="sm" variant="ghost">Check migrations</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.errors24h > 0) {
    return (
      <StatusBannerShell
        tone="danger"
        title={`${stats.errors24h} failed run${stats.errors24h === 1 ? '' : 's'} in the last 24h on ${projectLabel}`}
        subtitle={
          <span className="break-words">
            {stats.lastRunError?.slice(0, 140) ?? 'Check SQL syntax or tighten your NL prompt — every failure is logged.'}
          </span>
        }
        action={
          onViewErrors ? (
            <Btn size="sm" variant="ghost" onClick={onViewErrors}>
              View recent
            </Btn>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('history')}>
              Open history
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.runs24h === 0 && stats.savedCount === 0) {
    return (
      <StatusBannerShell
        tone="info"
        title={`No queries yet on ${projectLabel}`}
        subtitle="Ask your first question in natural language or switch to Raw SQL — results are read-only and sandboxed."
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('ask')}>
              Ask a question
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.savedCount === 0 && stats.runs24h > 0) {
    return (
      <StatusBannerShell
        tone="info"
        title={`${stats.runs24h} run${stats.runs24h === 1 ? '' : 's'} today — nothing pinned`}
        subtitle="Star a useful query on History so teammates can rerun it from the Team tab."
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('history')}>
              Pin a query
            </Btn>
          ) : null
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={`${stats.savedCount} saved · ${stats.runs24h} run${stats.runs24h === 1 ? '' : 's'} in 24h on ${projectLabel}`}
      subtitle={
        <>
          {stats.teamSavedCount > 0 ? (
            <>{stats.teamSavedCount} teammate pin{stats.teamSavedCount === 1 ? '' : 's'} · </>
          ) : null}
          {stats.lastRunAt ? (
            <>last run <RelativeTime value={stats.lastRunAt} /></>
          ) : (
            'Ready for ad-hoc analytics'
          )}
          {stats.avgLatencyMs != null ? <> · ~{stats.avgLatencyMs}ms avg</> : null}
        </>
      }
      action={
        onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('ask')}>
            New query
          </Btn>
        ) : null
      }
    />
  )
}
