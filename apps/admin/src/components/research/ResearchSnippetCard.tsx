/**
 * FILE: apps/admin/src/components/research/ResearchSnippetCard.tsx
 * PURPOSE: Single Firecrawl result with attach-to-report affordance.
 */

import { Link } from 'react-router-dom'
import { Card, Btn, Input, Badge } from '../ui'
import type { Snippet } from './types'
import { CHIP_TONE } from '../../lib/chipTone'

interface Props {
  snippet: Snippet
  attachValue: string
  onAttachValueChange: (value: string) => void
  onAttach: () => void
}

export function ResearchSnippetCard({ snippet, attachValue, onAttachValueChange, onAttach }: Props) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <a
            href={snippet.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-sm font-medium text-brand hover:underline"
          >
            {snippet.title ?? snippet.url}
          </a>
          <div className="truncate font-mono text-3xs text-fg-faint">{snippet.url}</div>
        </div>
        {snippet.attached_to_report_id ? (
          <Badge className={`shrink-0 ${CHIP_TONE.okSubtle}`}>Attached</Badge>
        ) : (
          <Badge className="shrink-0 bg-surface-raised text-fg-muted">Unattached</Badge>
        )}
      </div>

      {snippet.snippet && (
        <p className="mb-3 line-clamp-4 text-2xs leading-relaxed text-fg-secondary">{snippet.snippet}</p>
      )}

      {snippet.attached_to_report_id ? (
        <div className="flex flex-wrap items-center gap-2 text-2xs text-fg-muted">
          <span>Linked to report</span>
          <Link
            to={`/reports/${snippet.attached_to_report_id}`}
            className="font-mono text-brand hover:underline"
          >
            {snippet.attached_to_report_id.slice(0, 8)}…
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            type="text"
            value={attachValue}
            onChange={(e) => onAttachValueChange(e.target.value)}
            placeholder="Report UUID from Reports page"
            className="flex-1 font-mono text-2xs"
            label="Attach to report"
          />
          <Btn size="sm" variant="primary" onClick={onAttach} className="shrink-0 sm:self-end">
            Attach evidence
          </Btn>
        </div>
      )}
    </Card>
  )
}
