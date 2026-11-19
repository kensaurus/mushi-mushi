/**
 * FILE: apps/admin/src/components/design/DesignFindingsByFile.tsx
 * PURPOSE: The hard-coded styles the drift check found, one row per file (owner, 2026-11-19):
 *          the file, its count as a bar, the kinds of problem in plain words, and a "copy fix
 *          prompt" for that file; "Copy fix prompt for all files" in the header. A row opens to
 *          its findings (line, value → the token to use). Files past the first twelve sit
 *          behind "Show N more".
 */

import { useState } from 'react'
import { Section } from '../ui'
import { BarCell } from '../signal/BarCell'
import { StatusGlyph } from '../signal/StatusGlyph'
import { CopyPromptButton } from '../gates/CopyFixPromptButton'
import type { DevianceFinding } from '../../lib/recipeTypes'
import { ruleLabel } from './designTokens'
import { allFilesFixPrompt, fileFixPrompt, groupFindingsByFile, type FileGroup } from './designFindings'

const SHOWN = 12

export function DesignFindingsByFile({
  findings,
  total,
  emptyText,
}: {
  findings: readonly DevianceFinding[]
  /** True count from the scan; the stored rows can be fewer. */
  total: number | null
  emptyText: string
}) {
  const [all, setAll] = useState(false)
  const groups = groupFindingsByFile(findings)
  const max = Math.max(1, ...groups.map((g) => g.findings.length))
  const shown = all ? groups : groups.slice(0, SHOWN)
  const capped = total != null && total > findings.length
  return (
    <Section
      title="Hard-coded styles by file"
      action={groups.length > 0 ? <CopyPromptButton text={allFilesFixPrompt(groups)} label="Copy fix prompt for all files" testId="design-fix-all" /> : undefined}
    >
      {groups.length === 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-fg-secondary">
          <StatusGlyph tone="off" />
          {emptyText}
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-1.5" data-testid="design-findings-by-file">
          {capped && (
            <p className="text-2xs text-fg-muted">
              Showing the {findings.length.toLocaleString()} stored of {total!.toLocaleString()} found; fix these and run the check again for the rest.
            </p>
          )}
          <ul className="flex flex-col divide-y divide-edge-subtle">
            {shown.map((g) => (
              <FileRow key={g.file} g={g} max={max} />
            ))}
          </ul>
          {groups.length > SHOWN && (
            <button type="button" className="self-start text-2xs text-fg-secondary underline hover:text-fg" onClick={() => setAll((v) => !v)}>
              {all ? 'Show fewer' : `Show ${groups.length - SHOWN} more files`}
            </button>
          )}
        </div>
      )}
    </Section>
  )
}

function FileRow({ g, max }: { g: FileGroup; max: number }) {
  return (
    <li className="flex items-start gap-2 py-1" data-testid="design-file-row">
      <details className="min-w-0 flex-1">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 [&::-webkit-details-marker]:hidden">
          <StatusGlyph tone={g.errors > 0 ? 'danger' : 'warn'} label={g.errors > 0 ? 'Has errors' : 'Warnings'} />
          <span className="min-w-0 flex-1 basis-48 truncate font-mono text-xs font-bold text-fg" title={g.file}>{g.file}</span>
          <BarCell value={g.findings.length} max={max} tone={g.errors > 0 ? 'danger' : 'warn'} text={g.findings.length} widthClass="w-20" />
          <span className="hidden min-w-0 truncate text-2xs text-fg-secondary sm:inline sm:max-w-64">
            {g.rules.map((r) => `${ruleLabel(r.rule)} ×${r.count}`).join(' · ')}
          </span>
        </summary>
        <ul className="mt-1 mb-1 flex flex-col gap-0.5 border-l-2 border-edge-subtle pl-2.5">
          {g.findings.map((f, i) => (
            <li key={f.id ?? `${f.rule_id}:${f.line}:${i}`} className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span className="w-12 shrink-0 font-mono text-2xs text-fg-muted tabular-nums">{f.line != null ? `:${f.line}` : '—'}</span>
              <span className="text-fg-secondary">{ruleLabel(f.rule_id)}</span>
              {f.value && <span className="font-mono font-bold text-fg">{f.value}</span>}
              {f.suggestion && (
                <span className="text-2xs text-fg-secondary">
                  → use <span className="font-mono font-semibold text-ok-foreground">{f.suggestion.cssVar ?? f.suggestion.token}</span>
                  {f.suggestion.value ? <span className="font-mono"> ({f.suggestion.value})</span> : null}
                </span>
              )}
            </li>
          ))}
        </ul>
      </details>
      {/* Beside the row, not inside its summary: a click on it copies, it never opens the row. */}
      <span className="shrink-0">
        <CopyPromptButton text={fileFixPrompt(g)} label="Copy fix prompt" testId="design-file-fix" />
      </span>
    </li>
  )
}
