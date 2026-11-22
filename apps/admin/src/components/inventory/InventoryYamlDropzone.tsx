import { useRef, useState } from 'react'
import { Btn, ErrorAlert } from '../ui'

interface Props {
  onParsed?: (yaml: string) => void
  /** Clear drops the chosen file, so "Ingest selected file" cannot send it. */
  onCleared?: () => void
  disabled?: boolean
}

export function InventoryYamlDropzone({ onParsed, onCleared, disabled }: Props) {
  const [err, setErr] = useState<string | null>(null)
  // The picked file's name: Clear is off until there is one (round 3: an enabled Clear beside
  // the browser's "No file chosen").
  const [fileName, setFileName] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  return (
    <div className="rounded-md border border-dashed border-edge-subtle p-4 space-y-2">
      <p className="text-2xs text-fg-muted">
        Pick a local <code>inventory.yaml</code> to preview it; the server checks it when you save.
      </p>
      <div className="flex flex-wrap items-center gap-2">
      {/* A labelled picker, not the browser's "Choose File No file chosen". */}
      <label className={`relative inline-flex items-center rounded-sm border border-edge-subtle px-2 py-1 text-2xs font-medium text-fg-secondary focus-within:ring-2 focus-within:ring-brand/60 ${disabled ? 'opacity-50' : 'cursor-pointer hover:bg-surface-overlay'}`}>
      <input
        ref={inputRef}
        type="file"
        accept=".yml,.yaml,text/yaml"
        disabled={disabled}
        aria-label="inventory.yaml file"
        className="sr-only"
        onChange={async (e) => {
          setErr(null)
          const file = e.target.files?.[0]
          setFileName(file?.name ?? null)
          if (!file) {
            onCleared?.()
            return
          }
          const text = await file.text()
          if (text.length > 1_000_000) {
            setErr('File exceeds 1 MB limit.')
            return
          }
          // Light precheck only — the server validator is the source of
          // truth and accepts any YAML key order, document separators
          // (`---`), and BOM/whitespace prefaces. We previously gated on
          // "first non-comment line must start with schema_version",
          // which incorrectly rejected valid files written in any other
          // top-level key order or starting with `---`. Now we just look
          // for the token anywhere as a hint that this is plausibly an
          // inventory file before we hand it to the server.
          if (!/(^|\n)\s*schema_version\s*:/.test(text)) {
            setErr(
              'No `schema_version:` key found — this does not look like an inventory.yaml. The server validator will give a precise error if you proceed anyway.',
            )
            return
          }
          onParsed?.(text)
        }}
      />
        {fileName ? 'Choose another file' : 'Choose inventory.yaml'}
      </label>
      <span className="min-w-0 text-2xs text-fg-muted wrap-break-word" data-testid="inventory-yaml-file">{fileName ?? 'No file picked yet.'}</span>
      <Btn
        size="sm"
        variant="ghost"
        type="button"
        disabled={disabled || !fileName}
        title={fileName ? undefined : 'Nothing picked to clear'}
        onClick={() => {
          setErr(null)
          setFileName(null)
          if (inputRef.current) inputRef.current.value = ''
          onCleared?.()
        }}
      >
        Clear
      </Btn>
      </div>
      {err && <ErrorAlert message={err} />}
    </div>
  )
}
