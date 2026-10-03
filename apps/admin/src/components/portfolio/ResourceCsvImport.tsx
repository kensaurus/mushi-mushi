/**
 * ResourceCsvImport — the one-off CSV import of shared resources (Plan 019
 * Phase P2) for what no recipe or connector declares yet: domains, bundle
 * ids, a Supabase project two apps share. Owners and admins only (the route
 * checks the role too). Row-level errors are listed, never swallowed.
 *
 * Data: POST /v1/ingest/recipe/csv  { organizationId, csv } → CsvImportResult
 */

import { useState } from 'react'
import { Btn, Callout } from '../ui'
import { apiFetchMutate } from '../../lib/supabase'

export interface CsvImportResult {
  imported: number
  errors: string[]
  skippedOverLimit: number
}

/** The server's cap; checked here so a too-large file never makes a round trip. */
export const CSV_MAX_BYTES = 256 * 1024

export const CSV_EXAMPLE = 'kind,external_id,project,role\ndomain,glot.it,glot-it,site\nsupabase_project,abcd1234,yen-yen,backend'

/** One line for the result: what was saved and what was not. */
export function describeCsvImport(r: CsvImportResult): { tone: 'ok' | 'warn'; text: string } {
  const saved = `Imported ${r.imported} row${r.imported === 1 ? '' : 's'}.`
  const parts = [saved]
  if (r.errors.length > 0) parts.push(`${r.errors.length} row${r.errors.length === 1 ? ' was' : 's were'} not saved.`)
  if (r.skippedOverLimit > 0) parts.push(`${r.skippedOverLimit} row${r.skippedOverLimit === 1 ? '' : 's'} past the 500-row limit ${r.skippedOverLimit === 1 ? 'was' : 'were'} skipped; import them in a second file.`)
  return { tone: r.errors.length > 0 || r.skippedOverLimit > 0 ? 'warn' : 'ok', text: parts.join(' ') }
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
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-edge-subtle p-3">
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
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV file of shared resources"
          disabled={busy}
          className="min-w-0 text-2xs"
          onChange={(e) => {
            void pick(e.target.files?.[0])
            // Let the same file be picked again after a fix.
            e.target.value = ''
          }}
        />
        <Btn
          size="sm"
          variant="primary"
          type="button"
          onClick={() => void submit()}
          disabled={!file || busy}
          loading={busy}
          title={file ? `Import ${file.name}` : 'Choose a CSV file first'}
        >
          Import CSV
        </Btn>
        {file && <span className="text-2xs text-fg-muted">{file.name}</span>}
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
            </ul>
          )}
        </Callout>
      )}
    </div>
  )
}
