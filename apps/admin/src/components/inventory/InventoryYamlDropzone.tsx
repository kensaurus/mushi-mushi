import { useState } from 'react'
import { Btn, ErrorAlert } from '../ui'

interface Props {
  onParsed?: (yaml: string) => void
  disabled?: boolean
}

export function InventoryYamlDropzone({ onParsed, disabled }: Props) {
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="rounded-md border border-dashed border-edge-subtle p-4 space-y-2">
      <p className="text-2xs text-fg-muted">
        Select a local <code>inventory.yaml</code> to preview — ingestion validates on the server.
      </p>
      <input
        type="file"
        accept=".yml,.yaml,text/yaml"
        disabled={disabled}
        className="text-2xs w-full"
        onChange={async (e) => {
          setErr(null)
          const file = e.target.files?.[0]
          if (!file) return
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
      {err && <ErrorAlert message={err} />}
      <Btn size="sm" variant="ghost" type="button" disabled={disabled} onClick={() => setErr(null)}>
        Clear
      </Btn>
    </div>
  )
}
