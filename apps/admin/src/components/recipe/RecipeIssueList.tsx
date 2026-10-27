/**
 * FILE: apps/admin/src/components/recipe/RecipeIssueList.tsx
 * PURPOSE: info / warn / error list for manifest validation errors and design
 *          token issues. Severity is a labelled badge (text, not colour only).
 *          File paths sit on their own line and wrap: a long path used to
 *          overflow and get clipped on a phone-width page (390px).
 */

import { useState } from 'react'
import { FindingSeverityBadge } from '../ui'
import type { RecipeIssue } from '../../lib/recipeTypes'

const SEVERITY_ORDER: Record<string, number> = { error: 0, warn: 1, info: 2 }

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
                <FindingSeverityBadge severity={list[0]!.severity} />
                <span className="font-mono">{code}</span>
                <span>× {list.length}</span>
              </p>
            ) : null}
            <ul className="flex flex-col gap-1.5">
              {shown.map((issue, i) => {
                const where = [issue.file, issue.path].filter(Boolean).join(' · ')
                return (
                  <li key={`${issue.code}:${i}`} className="flex flex-wrap items-start gap-x-2 gap-y-0.5 text-xs">
                    <FindingSeverityBadge severity={issue.severity} />
                    <span className="min-w-0 flex-1 wrap-break-word text-fg-secondary">{issue.message}</span>
                    <span className="shrink-0 font-mono text-2xs text-fg-faint">{issue.code}</span>
                    {where && (
                      <span className="min-w-0 basis-full wrap-break-word font-mono text-2xs text-fg-faint">{where}</span>
                    )}
                  </li>
                )
              })}
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
