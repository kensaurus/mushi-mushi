/**
 * FILE: apps/admin/src/components/recipe/RecipeIssueList.tsx
 * PURPOSE: info / warn / error list for manifest validation errors and design
 *          token issues. Severity is a labelled badge (text, not colour only).
 */

import { useState } from 'react'
import { Badge } from '../ui'
import type { RecipeIssue } from '../../lib/recipeTypes'

const SEVERITY_ORDER: Record<string, number> = { error: 0, warn: 1, info: 2 }

function SeverityBadge({ severity }: { severity: unknown }) {
  if (severity === 'error') return <Badge tone="dangerSubtle">Error</Badge>
  if (severity === 'warn') return <Badge tone="warnSubtle">Warning</Badge>
  return <Badge tone="neutral">Info</Badge>
}

/** Issues shown per code before "Show all": one code repeated 300 times made a 9,000 px wall. */
const PER_CODE = 5

export function RecipeIssueList({ issues, empty }: { issues: RecipeIssue[]; empty?: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  if (issues.length === 0) {
    return empty ? <p className="text-xs text-fg-muted">{empty}</p> : null
  }
  const sorted = [...issues].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3),
  )
  const groups = new Map<string, RecipeIssue[]>()
  for (const issue of sorted) groups.set(issue.code, [...(groups.get(issue.code) ?? []), issue])
  return (
    <div className="flex flex-col gap-3">
      {[...groups.entries()].map(([code, list]) => {
        const shown = open.has(code) ? list : list.slice(0, PER_CODE)
        return (
          <div key={code} className="flex flex-col gap-1.5">
            {groups.size > 1 || list.length > PER_CODE ? (
              <p className="flex items-center gap-2 text-2xs text-fg-muted">
                <SeverityBadge severity={list[0]!.severity} />
                <span className="font-mono">{code}</span>
                <span>× {list.length}</span>
              </p>
            ) : null}
            <ul className="flex flex-col gap-1.5">
              {shown.map((issue, i) => (
                <li key={`${issue.code}:${i}`} className="flex flex-wrap items-start gap-2 text-xs">
                  <SeverityBadge severity={issue.severity} />
                  <span className="min-w-0 flex-1 text-fg-secondary">
                    {issue.message}
                    {(issue.file || issue.path) && (
                      <span className="ml-1 font-mono text-2xs text-fg-faint">
                        {[issue.file, issue.path].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-2xs text-fg-faint">{issue.code}</span>
                </li>
              ))}
            </ul>
            {list.length > PER_CODE && (
              <button
                type="button"
                className="self-start text-2xs text-fg-muted underline hover:text-fg"
                onClick={() => setOpen((prev) => {
                  const next = new Set(prev)
                  if (next.has(code)) next.delete(code)
                  else next.add(code)
                  return next
                })}
              >
                {open.has(code) ? 'Show fewer' : `Show all ${list.length}`}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
