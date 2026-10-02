/**
 * FILE: apps/admin/src/components/recipe/RecipeIssueList.tsx
 * PURPOSE: info / warn / error list for manifest validation errors and design
 *          token issues. Severity is a labelled badge (text, not colour only).
 */

import { Badge } from '../ui'
import type { RecipeIssue } from '../../lib/recipeTypes'

const SEVERITY_ORDER: Record<string, number> = { error: 0, warn: 1, info: 2 }

function SeverityBadge({ severity }: { severity: unknown }) {
  if (severity === 'error') return <Badge tone="dangerSubtle">Error</Badge>
  if (severity === 'warn') return <Badge tone="warnSubtle">Warning</Badge>
  return <Badge tone="neutral">Info</Badge>
}

export function RecipeIssueList({ issues, empty }: { issues: RecipeIssue[]; empty?: string }) {
  if (issues.length === 0) {
    return empty ? <p className="text-xs text-fg-muted">{empty}</p> : null
  }
  const sorted = [...issues].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3),
  )
  return (
    <ul className="flex flex-col gap-1.5">
      {sorted.map((issue, i) => (
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
  )
}
