/**
 * FILE: apps/admin/src/components/settings/BackendModePanel.tsx
 * PURPOSE: Let operators choose between Mushi Cloud (paid/gated) and a
 *          self-hosted Supabase instance (free / BYOK). Persists the choice
 *          to localStorage and reloads so all RESOLVED_* constants take effect.
 *
 * Design decisions:
 *  - Cloud = future paid plan; gate behind the `self_hosted` billing flag
 *    (inverted: if self_hosted is not included on the current plan, cloud is
 *    the only option — the feature is "Mushi Cloud paid features").
 *  - Self-hosted = free; anyone can run their own Supabase stack.
 *  - Switching reloads the page (necessary because RESOLVED_* are computed
 *    once at module load time in env.ts).
 */

import { useState } from 'react'
import { Btn, Input, Callout } from '../ui'
import {
  checkEnv,
  saveAndApplyInstanceConfig,
  clearStoredInstanceConfig,
  getStoredInstanceConfig,
  CLOUD_SUPABASE_URL,
  type InstanceMode,
} from '../../lib/env'
import { CHIP_TONE } from '../../lib/chipTone'

export function BackendModePanel() {
  const current = checkEnv()
  const stored = getStoredInstanceConfig()
  const isOverridden = stored !== null

  const [draftMode, setDraftMode] = useState<InstanceMode>(current.mode)
  const [draftUrl, setDraftUrl] = useState(
    current.mode === 'self-hosted' && current.supabaseUrl !== CLOUD_SUPABASE_URL
      ? current.supabaseUrl
      : '',
  )
  const [draftKey, setDraftKey] = useState(
    current.mode === 'self-hosted' ? current.supabaseAnonKey : '',
  )
  const [urlErr, setUrlErr] = useState('')
  const [keyErr, setKeyErr] = useState('')

  function validate(): boolean {
    let ok = true
    if (draftMode === 'self-hosted') {
      if (!draftUrl.trim().startsWith('https://')) {
        setUrlErr('Enter a valid https:// Supabase project URL')
        ok = false
      } else {
        setUrlErr('')
      }
      if (!draftKey.trim()) {
        setKeyErr('Anon key is required for self-hosted mode')
        ok = false
      } else {
        setKeyErr('')
      }
    }
    return ok
  }

  function handleSave() {
    if (!validate()) return
    saveAndApplyInstanceConfig({
      mode: draftMode,
      supabaseUrl: draftMode === 'self-hosted' ? draftUrl.trim() : undefined,
      supabaseAnonKey: draftMode === 'self-hosted' ? draftKey.trim() : undefined,
    })
  }

  function handleReset() {
    clearStoredInstanceConfig()
  }

  const isDirty =
    draftMode !== current.mode ||
    (draftMode === 'self-hosted' &&
      (draftUrl !== (current.supabaseUrl ?? '') || draftKey !== (current.supabaseAnonKey ?? '')))

  return (
    <div className="space-y-3">
      {isOverridden && (
        <Callout tone="info" label="Saved in this browser">
          This browser uses a backend you picked here, not the one the console was built with.{' '}
          <button
            type="button"
            onClick={handleReset}
            className="underline text-accent-foreground hover:text-accent"
          >
            Go back to the default
          </button>
        </Callout>
      )}

      <div className="flex flex-col gap-2 sm:flex-row" role="radiogroup" aria-label="Where your data is stored">
        <ModeCard
          active={draftMode === 'cloud'}
          onClick={() => setDraftMode('cloud')}
          title="Mushi Cloud"
          badge="Paid"
          description="Reports, triage and fixes run on Mushi's servers. Nothing to set up."
        />
        <ModeCard
          active={draftMode === 'self-hosted'}
          onClick={() => setDraftMode('self-hosted')}
          title="Self-hosted"
          badge="Free"
          description="Run the Mushi backend on your own Supabase project."
        />
      </div>

      {draftMode === 'self-hosted' && (
        <div className="space-y-3">
          <Input
            label="Supabase project URL"
            placeholder="https://xxxx.supabase.co"
            value={draftUrl}
            onChange={e => setDraftUrl(e.target.value)}
            error={urlErr}
          />
          <Input
            label="Supabase anon key"
            placeholder="eyJhbGci..."
            value={draftKey}
            onChange={e => setDraftKey(e.target.value)}
            error={keyErr}
          />
          <p className="text-xs text-fg-muted">
            The anon key is meant to be public; your data stays behind row-level security. The service-role key stays in your
            edge function secrets.
          </p>
        </div>
      )}

      {draftMode === 'cloud' && current.mode !== 'cloud' && (
        <Callout tone="warn" label="Switching to Mushi Cloud">
          New reports go to Mushi Cloud. Make sure you have a Cloud account for this project first.
        </Callout>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Btn variant="primary" size="sm" onClick={handleSave} disabled={!isDirty}>
          Save and reload
        </Btn>
        {isDirty && <span className="text-xs text-fg-muted">The page reloads to use the new backend.</span>}
      </div>
    </div>
  )
}

/** "Mushi Cloud" or "Self-hosted (https://…)", for the row status line. */
export function currentBackendLabel(): string {
  const current = checkEnv()
  return current.mode === 'cloud' ? 'Mushi Cloud' : `Self-hosted (${current.supabaseUrl})`
}

interface ModeCardProps {
  active: boolean
  onClick: () => void
  title: string
  badge: string
  description: string
}

function ModeCard({ active, onClick, title, badge, description }: ModeCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={[
        'flex-1 rounded-md border p-3 text-left transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
        active
          ? 'border-brand bg-brand/6'
          : 'border-edge-subtle bg-surface-raised/40 hover:border-edge-strong hover:bg-surface-raised/70',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-sm font-semibold ${active ? 'text-brand' : 'text-fg'}`}>{title}</span>
        <span
          className={[
            'inline-flex items-center rounded-full px-1.5 py-0.5 text-2xs font-medium',
            badge === 'Free'
              ? CHIP_TONE.okSubtle
              : 'bg-brand/12 text-brand border border-brand/28',
          ].join(' ')}
        >
          {badge}
        </span>
        {active && (
          <span className="ml-auto inline-flex h-4 w-4 items-center justify-center rounded-full bg-brand text-brand-fg text-2xs">
            ✓
          </span>
        )}
      </div>
      <p className="text-sm text-fg-muted leading-relaxed">{description}</p>
    </button>
  )
}
