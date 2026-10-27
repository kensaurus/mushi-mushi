/**
 * FILE: apps/admin/src/components/pipeline/WorkerKeyForm.tsx
 * PURPOSE: "Create a worker key": the apps a local worker may serve and a
 *          label, then the key once, with the install command that reads it
 *          from stdin. The key (scope worker:run) can take reports and record
 *          their fixes; it cannot merge, change settings or read keys.
 */

import { useState } from 'react'
import { Btn, Callout, Checkbox, CodeValue, Input } from '../ui'
import { createWorkerKey } from '../../lib/workers'

interface Props {
  projects: Array<{ id: string; name: string }>
  onCreated?: () => void
}

export function WorkerKeyForm({ projects, onCreated }: Props) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(projects.length === 1 ? [projects[0]!.id] : []))
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [key, setKey] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    const res = await createWorkerKey([...chosen], label.trim() || 'host')
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setKey(res.key)
    onCreated?.()
  }

  if (key) {
    return (
      <div className="space-y-2" data-testid="worker-key-created">
        <Callout tone="warn" label="Shown once">
          Copy this key now. Mushi keeps only its hash, so it cannot show it again.
        </Callout>
        <CodeValue value={key} />
        <p className="text-xs text-fg-muted">On the machine, paste it into the install (it is read from stdin, so it stays out of your shell history):</p>
        <CodeValue value="mushi worker install --key-stdin --lane my-app --project <app id> --repo-dir ~/src/my-app" multiline />
      </div>
    )
  }

  return (
    <div className="space-y-2" data-testid="worker-key-form">
      <p className="text-xs text-fg-muted">The apps this worker may fix:</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {projects.map((p) => (
          <Checkbox
            key={p.id}
            label={p.name}
            checked={chosen.has(p.id)}
            onChange={(on) =>
              setChosen((prev) => {
                const next = new Set(prev)
                if (on) next.add(p.id)
                else next.delete(p.id)
                return next
              })
            }
          />
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <Input id="worker-key-label-input" label="Machine name" placeholder="for example: alienware-wsl" value={label} maxLength={48} onChange={(e) => setLabel(e.target.value)} data-testid="worker-key-label" />
        </div>
        <Btn size="sm" variant="primary" loading={busy} disabled={chosen.size === 0} onClick={() => void submit()} data-testid="worker-key-create">
          Create worker key
        </Btn>
      </div>
      {error && (
        <p className="text-xs text-danger-foreground" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
