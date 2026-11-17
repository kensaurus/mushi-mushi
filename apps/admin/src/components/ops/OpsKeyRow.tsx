/**
 * FILE: apps/admin/src/components/ops/OpsKeyRow.tsx
 * PURPOSE: Projects → "Ops key" (docs/execplans/ops-hub-slack.md §5): mint the
 *          server-side key an app uses to send its payments, releases and
 *          alerts to the Ops hub (scope ops:write only). The key shows once,
 *          with copy-ready lines for a Supabase secret and a GitHub secret.
 *
 * Data: POST /v1/admin/projects/:id/ops-key
 */

import { useState } from 'react'
import { Btn, CopyButton } from '../ui'
import { IconKey } from '../icons'
import { apiFetchMutate } from '../../lib/supabase'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import { useToast } from '../../lib/toast'
import { docsUrl } from '../../lib/docsUrl'
import { LINK_ACCENT } from '../../lib/chipTone'
import type { OpsKeyMinted } from '../../lib/opsTypes'

/** The lines to run once, with the key filled in. */
export function opsKeySnippets(key: string, apiUrl: string): Array<{ label: string; text: string }> {
  return [
    { label: 'Supabase Edge Function secrets', text: `supabase secrets set MUSHI_OPS_KEY=${key} MUSHI_API_URL=${apiUrl}` },
    { label: 'GitHub Actions secrets', text: `gh secret set MUSHI_OPS_KEY --body "${key}"\ngh variable set MUSHI_API_URL --body "${apiUrl}"` },
    {
      label: 'Send one event (from your server)',
      text: `curl -X POST "$MUSHI_API_URL/v1/ops/events" -H "X-Mushi-Api-Key: $MUSHI_OPS_KEY" -H "Content-Type: application/json" -d '{"category":"releases","kind":"deploy.succeeded","title":"Deployed v1.0.0"}'`,
    },
  ]
}

export function OpsKeyRow({ projectId, projectName }: { projectId: string; projectName: string }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [minted, setMinted] = useState<OpsKeyMinted | null>(null)

  async function mint() {
    setBusy(true)
    const res = await apiFetchMutate<OpsKeyMinted>(`/v1/admin/projects/${encodeURIComponent(projectId)}/ops-key`, { method: 'POST' })
    setBusy(false)
    if (!res.ok || !res.data) {
      toast.error('Ops key not created', res.error?.message)
      return
    }
    setMinted(res.data)
  }

  return (
    <div className="mx-3 mb-3 space-y-2 rounded-md border border-edge-subtle px-3 py-2" data-testid={`ops-key-${projectId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-xs text-fg-secondary">
          <span className="font-semibold text-fg">Ops key</span> · lets {projectName}'s server send payments, releases and alerts to Ops and your team's Slack. Server only: a web page cannot use it.{' '}
          <a href={docsUrl('/integrations/ops-hub#connect-an-app')} target="_blank" rel="noopener noreferrer" className={`font-medium ${LINK_ACCENT}`}>
            How ↗
          </a>
        </p>
        <Btn size="sm" variant="ghost" onClick={() => void mint()} loading={busy} leadingIcon={<IconKey size={12} />} aria-label={`Create an ops key for ${projectName}`} title="Create a new ops:write key. It is shown once.">
          Create ops key
        </Btn>
      </div>
      {minted && (
        <div className="space-y-2" data-testid={`ops-key-revealed-${projectId}`}>
          <p className="text-2xs font-semibold text-warn-foreground">▲ Shown once. Copy it into your server's secrets now; Mushi Mushi keeps only its hash.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-xs bg-surface-overlay px-2 py-1 font-mono text-2xs text-fg">{minted.key}</code>
            <CopyButton value={minted.key} label="Copy ops key" />
          </div>
          {opsKeySnippets(minted.key, RESOLVED_EXTERNAL_API_URL).map((s) => (
            <div key={s.label} className="space-y-0.5">
              <p className="text-2xs font-semibold text-fg-secondary">{s.label}</p>
              <div className="flex items-start gap-2">
                <pre className="min-w-0 flex-1 overflow-x-auto rounded-xs bg-surface-overlay px-2 py-1 font-mono text-2xs text-fg">{s.text}</pre>
                <CopyButton value={s.text} label={`Copy: ${s.label}`} />
              </div>
            </div>
          ))}
          <Btn size="sm" variant="ghost" onClick={() => setMinted(null)}>
            Done, hide the key
          </Btn>
        </div>
      )}
    </div>
  )
}
