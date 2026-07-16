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
import { Card } from '../../components/ui'
import { Section, Btn, Input, Callout } from '../ui'
import { ConnectionStatus } from '../ConnectionStatus'
import { SettingsCard } from './SettingsPanelLayout'
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
    <Section title="Backend">
      <div className="space-y-4">
        {isOverridden && (
          <Callout tone="info" label="Runtime override active">
            Backend is configured from a saved localStorage preference, not the build-time .env.
            {' '}
            <button
              type="button"
              onClick={handleReset}
              className="underline text-accent-foreground hover:text-accent"
            >
              Reset to build defaults
            </button>
          </Callout>
        )}

        {/* Mode selector */}
        <div className="flex gap-2">
          <ModeCard
            active={draftMode === 'cloud'}
            onClick={() => setDraftMode('cloud')}
            title="Mushi Cloud"
            badge="Paid"
            description="Reports, classification, and the fix-worker run on Mushi Mushi Cloud. No Supabase setup required."
          />
          <ModeCard
            active={draftMode === 'self-hosted'}
            onClick={() => setDraftMode('self-hosted')}
            title="Self-hosted"
            badge="Free"
            description="Deploy the Mushi backend on your own Supabase project. Full BYOK — no vendor lock-in."
          />
        </div>

        {/* Self-hosted credentials form */}
        {draftMode === 'self-hosted' && (
          <Card  className="space-y-3 p-3">
            <p className="text-xs text-fg-muted">
              Point to your own Supabase project. These values replace{' '}
              <code className="font-mono text-2xs">VITE_SUPABASE_URL</code> /{' '}
              <code className="font-mono text-2xs">VITE_SUPABASE_ANON_KEY</code> at runtime.
            </p>
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
            <p className="text-2xs text-fg-faint">
              The anon key is public by design — it grants only RLS-gated access.
              The service-role key stays server-side in your edge function secrets.
            </p>
          </Card>
        )}

        {/* Cloud note */}
        {draftMode === 'cloud' && current.mode !== 'cloud' && (
          <Callout tone="warn" label="Switching to Cloud">
            Your reports will be sent to Mushi Cloud. Make sure you have a cloud account and
            the project credentials match.
          </Callout>
        )}

        <div className="flex items-center gap-2">
          <Btn
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={!isDirty}
          >
            Save and reload
          </Btn>
          {isDirty && (
            <span className="text-2xs text-fg-faint">Page reloads to apply the new backend URL.</span>
          )}
        </div>

        {/* Live health check for the current (not draft) backend */}
        <div className="pt-2">
          <p className="text-xs text-fg-muted mb-2">
            Current backend:{' '}
            <span className={`font-medium ${current.mode === 'cloud' ? 'text-brand' : 'text-ok'}`}>
              {current.mode === 'cloud' ? 'Mushi Cloud' : 'Self-hosted'}
            </span>
            {current.mode === 'self-hosted' && (
              <span className="text-2xs font-mono ml-1 text-fg-faint">({current.supabaseUrl})</span>
            )}
          </p>
          <SettingsCard className="p-4">
            <ConnectionStatus />
          </SettingsCard>
        </div>
      </div>
    </Section>
  )
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
      onClick={onClick}
      className={[
        'flex-1 rounded-md border p-3 text-left transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
        active
          ? 'border-brand bg-brand/6'
          : 'border-edge-subtle bg-surface-raised/40 hover:border-edge-strong hover:bg-surface-raised/70',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs font-semibold ${active ? 'text-brand' : 'text-fg'}`}>{title}</span>
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
      <p className="text-2xs text-fg-muted leading-relaxed">{description}</p>
    </button>
  )
}
