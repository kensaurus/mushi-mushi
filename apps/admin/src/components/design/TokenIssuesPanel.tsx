/**
 * FILE: apps/admin/src/components/design/TokenIssuesPanel.tsx
 * PURPOSE: What is wrong in the token files themselves (owner, 2026-11-19). Real problems
 *          (errors and warnings: invalid JSON, a missing alias, a token defined twice) are
 *          listed. Format notes (a token written in an older DTCG form; it still works) fold
 *          into one row: "67 token format notes · not breaking", with one prompt that
 *          rewrites them all, opening to the counts per kind in plain words.
 */

import { Section } from '../ui'
import { StatusGlyph } from '../signal/StatusGlyph'
import { BarCell } from '../signal/BarCell'
import { CopyPromptButton } from '../gates/CopyFixPromptButton'
import type { RecipeIssue } from '../../lib/recipeTypes'
import { RecipeIssueList } from '../recipe/RecipeIssueList'
import { isFormatNote } from '../recipe/recipeIssueLabels'
import { formatNoteGroups, formatNotesPrompt } from './designFindings'

export function TokenIssuesPanel({ issues }: { issues: readonly RecipeIssue[] }) {
  const notes = issues.filter(isFormatNote)
  const problems = issues.filter((i) => !isFormatNote(i))
  if (issues.length === 0) return null
  const kinds = formatNoteGroups(notes)
  const max = Math.max(1, ...kinds.map((k) => k.count))
  return (
    <Section title="Token files" action={<span className="text-2xs text-fg-muted">{problems.length > 0 ? `${problems.length} to fix` : 'nothing broken'}</span>}>
      <div className="flex flex-col gap-2" data-testid="token-issues">
        {problems.length > 0 && <RecipeIssueList issues={problems} />}
        {notes.length > 0 && (
          <div className="flex items-start gap-2 rounded-sm border border-edge-subtle px-2.5 py-1.5" data-testid="token-format-notes">
            <details className="min-w-0 flex-1">
              <summary className="cursor-pointer text-xs text-fg-secondary hover:text-fg">
                <StatusGlyph tone="off" className="mr-1 inline" />
                <span className="font-semibold text-fg">{notes.length.toLocaleString()} token format note{notes.length === 1 ? '' : 's'}</span>
                <span> · not breaking: written in an older format, still read correctly</span>
              </summary>
              <ul className="mt-1.5 flex flex-col gap-1">
                {kinds.map((k) => (
                  <li key={k.code} className="flex items-center justify-between gap-2 text-xs" title={k.code}>
                    <span className="text-fg">{k.label}</span>
                    <BarCell value={k.count} max={max} tone="neutral" text={k.count} widthClass="w-20" />
                  </li>
                ))}
              </ul>
              <details className="mt-1.5">
                <summary className="cursor-pointer text-2xs text-fg-muted hover:text-fg">Every note</summary>
                <div className="mt-1">
                  <RecipeIssueList issues={notes} />
                </div>
              </details>
            </details>
            <span className="shrink-0">
              <CopyPromptButton text={formatNotesPrompt(notes)} label="Fix all (prompt)" title="Copy a prompt that rewrites these tokens in the current format, values unchanged" testId="token-notes-fix" />
            </span>
          </div>
        )}
      </div>
    </Section>
  )
}
