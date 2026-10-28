/**
 * FILE: apps/admin/src/components/research/ResearchSnippetCard.tsx
 * PURPOSE: Single Firecrawl result with "Attach to bug": the bug is picked
 *          by its title (ReportPicker), never by a pasted id (console
 *          journeys 2026-10-27). The picker opens on demand, so a page of
 *          results does not read the bug list once per result.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Btn, Badge } from '../ui'
import { ReportPicker, type PickableReport } from '../reports/ReportPicker'
import type { Snippet } from './types'
import { CHIP_TONE } from '../../lib/chipTone'

interface Props {
  snippet: Snippet
  /** Saves the finding on the picked bug; resolves true when it was attached. */
  onAttach: (report: PickableReport) => Promise<boolean>
}

export function ResearchSnippetCard({ snippet, onAttach }: Props) {
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<PickableReport | null>(null)
  const [busy, setBusy] = useState(false)

  const attach = async () => {
    if (!picked) return
    setBusy(true)
    const ok = await onAttach(picked)
    setBusy(false)
    if (ok) {
      setPicking(false)
      setPicked(null)
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <a
            href={snippet.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-sm font-medium text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity"
          >
            {snippet.title ?? snippet.url}
          </a>
          <div className="truncate font-mono text-3xs text-fg-faint">{snippet.url}</div>
        </div>
        {snippet.attached_to_report_id ? (
          <Badge className={`shrink-0 ${CHIP_TONE.okSubtle}`}>Attached</Badge>
        ) : (
          <Badge className="shrink-0 bg-surface-raised text-fg-muted">Not attached</Badge>
        )}
      </div>

      {snippet.snippet && (
        <p className="mb-3 line-clamp-4 text-2xs leading-relaxed text-fg-secondary">{snippet.snippet}</p>
      )}

      {snippet.attached_to_report_id ? (
        <div className="flex flex-wrap items-center gap-2 text-2xs text-fg-muted">
          <span>Saved on bug</span>
          <Link
            to={`/reports/${snippet.attached_to_report_id}`}
            className="font-mono text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity"
          >
            {snippet.attached_to_report_id.slice(0, 8)}…
          </Link>
        </div>
      ) : !picking ? (
        <Btn size="sm" variant="ghost" onClick={() => setPicking(true)}>
          Attach to bug
        </Btn>
      ) : (
        <div className="space-y-2" data-testid="research-attach">
          <ReportPicker label="Which bug does this help?" value={picked} onChange={setPicked} disabled={busy} />
          <div className="flex flex-wrap items-center gap-2">
            <Btn size="sm" variant="primary" onClick={() => void attach()} disabled={!picked} loading={busy}>
              Attach to this bug
            </Btn>
            <Btn
              size="sm"
              variant="ghost"
              onClick={() => {
                setPicking(false)
                setPicked(null)
              }}
              disabled={busy}
            >
              Cancel
            </Btn>
          </div>
        </div>
      )}
    </Card>
  )
}
