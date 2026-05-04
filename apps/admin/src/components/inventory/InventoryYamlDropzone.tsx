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
          const firstContentLine = text
            .split(/\r?\n/)
            .map((l) => l.trim())
            .find((l) => l.length > 0 && !l.startsWith('#'))
          if (!firstContentLine?.startsWith('schema_version')) {
            setErr('Expected schema_version on the first non-comment line of inventory.yaml')
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
