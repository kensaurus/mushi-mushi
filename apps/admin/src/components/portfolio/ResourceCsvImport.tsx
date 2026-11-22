/**
 * ResourceCsvImport — the one-off CSV import of shared resources (Plan 019
 * Phase P2) for what no recipe or connector declares yet: domains, bundle
 * ids, a Supabase project two apps share. Owners and admins only (the route
 * checks the role too). Every refused row is counted; the first 50 are listed
 * with their line in the file, never swallowed.
 *
 * Data: POST /v1/ingest/recipe/csv  { organizationId, csv } → CsvImportResult
 */

import { useState } from 'react'
import { Btn, Callout } from '../ui'
import { apiFetchMutate } from '../../lib/supabase'

interface CsvImportResult {
  imported: number
  /** Every row that was not saved; `errors` lists only the first of them. */
  errorCount: number
  errors: string[]
  skippedOverLimit: number
}

/** The server's cap; checked here so a too-large file never makes a round trip. */
const CSV_MAX_BYTES = 256 * 1024

const CSV_EXAMPLE = 'kind,external_id,project,role\ndomain,glot.it,glot-it,site\nsupabase_project,abcd1234,yen-yen,backend'

/** One line for the result: what was saved and what was not. */
function describeCsvImport(r: CsvImportResult): { tone: 'ok' | 'warn'; text: string } {
  const saved = `Imported ${r.imported} row${r.imported === 1 ? '' : 's'}.`
  const parts = [saved]
  if (r.errorCount > 0) parts.push(`${r.errorCount} row${r.errorCount === 1 ? ' was' : 's were'} not saved.`)
  if (r.skippedOverLimit > 0) parts.push(`${r.skippedOverLimit} row${r.skippedOverLimit === 1 ? '' : 's'} past the 500-row limit ${r.skippedOverLimit === 1 ? 'was' : 'were'} skipped; import them in a second file.`)
  return { tone: r.errorCount > 0 || r.skippedOverLimit > 0 ? 'warn' : 'ok', text: parts.join(' ') }
}

interface Props {
  orgId: string
  /** Called after a request that saved at least one row, so the card re-reads the graph. */
  onImported: () => void
}

export function ResourceCsvImport({ orgId, onImported }: Props) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CsvImportResult | null>(null)

  const pick = async (f: File | undefined) => {
    setError(null)
    setResult(null)
    setFile(null)
    if (!f) return
    if (f.size > CSV_MAX_BYTES) {
      setError(`${f.name} is over 256 KB. Split it into smaller files.`)
      return
    }
    setFile({ name: f.name, text: await f.text() })
  }

  const submit = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await apiFetchMutate<CsvImportResult>('/v1/ingest/recipe/csv', {
        method: 'POST',
        body: JSON.stringify({ organizationId: orgId, csv: file.text }),
      })
      if (!res.ok || !res.data) {
        setError(res.error?.message ?? 'The CSV could not be imported.')
        return
      }
      setResult(res.data)
      setFile(null)
      if (res.data.imported > 0) onImported()
    } finally {
      setBusy(false)
    }
  }

  const summary = result ? describeCsvImport(result) : null
  return (
    // A plain row under a hairline, not a dashed box inside the card (2026-11-18 sweep).
    <div className="flex flex-col gap-2 border-t border-edge-subtle pt-2.5" data-testid="resource-csv-import">
      <p className="text-xs text-fg-secondary">
        Import resources from a CSV with the columns <code className="font-mono">kind, external_id, project</code> and,
        optionally, <code className="font-mono">role</code>. <code className="font-mono">project</code> is a project&apos;s
        id, slug or name in this team.
      </p>
      <details className="text-2xs text-fg-muted">
        <summary className="cursor-pointer">Example</summary>
        <pre className="mt-1 overflow-x-auto rounded-sm bg-surface-overlay p-2 font-mono">{CSV_EXAMPLE}</pre>
      </details>
      <div className="flex flex-wrap items-center gap-2">
        {/* A labelled picker, not the browser's "Choose File No file chosen" (round 3). */}
        <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-edge-subtle px-2 py-1 text-2xs font-medium text-fg-secondary hover:bg-surface-overlay focus-within:ring-2 focus-within:ring-brand/60">
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file of shared resources"
            disabled={busy}
            className="sr-only"
            onChange={(e) => {
              void pick(e.target.files?.[0])
              // Let the same file be picked again after a fix.
              e.target.value = ''
            }}
          />
          {file ? 'Choose another CSV' : 'Choose a CSV file'}
        </label>
        <Btn
          size="sm"
          variant={file ? 'primary' : 'ghost'}
          type="button"
          onClick={() => void submit()}
          disabled={!file || busy}
          loading={busy}
          title={file ? `Import ${file.name}` : 'Choose a CSV file first'}
        >
          Import CSV
        </Btn>
        {/* Why Import is off, said beside it instead of only in a tooltip. */}
        <span className="text-2xs text-fg-muted" data-testid="resource-csv-file">
          {file ? file.name : 'No file picked yet.'}
        </span>
      </div>
      {error && (
        <Callout tone="danger">
          <span role="status">{error}</span>
        </Callout>
      )}
      {summary && result && (
        <Callout tone={summary.tone}>
          <span role="status">{summary.text}</span>
          {result.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-2xs" aria-label="Rows that were not saved">
              {result.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
              {result.errorCount > result.errors.length && <li>… and {result.errorCount - result.errors.length} more</li>}
            </ul>
          )}
        </Callout>
      )}
    </div>
  )
}
