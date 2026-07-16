/**
 * FILE: apps/admin/src/components/qa-coverage/CreateStoryModal.tsx
 * PURPOSE: Modal form for creating a new QA coverage story.
 */

import { useState } from 'react'
import { Btn, Input, SelectField, Textarea } from '../ui'
import { Modal } from '../Modal'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { cronExpression, url } from '../../lib/validators'

const SCHEDULE_PRESETS = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily at midnight UTC', value: '0 0 * * *' },
  { label: 'Daily at 9 AM UTC', value: '0 9 * * *' },
  { label: 'Weekly (Mon 9 AM UTC)', value: '0 9 * * 1' },
  { label: 'Custom cron…', value: 'custom' },
]

const PROVIDER_EXPLAINERS: Record<string, string> = {
  firecrawl_actions: 'Runs in Firecrawl cloud — no browser setup needed. Add a Firecrawl API key under Settings → API Keys.',
  browserbase: 'Runs in a Browserbase cloud Chromium instance — add a Browserbase API key under Settings → API Keys.',
  local: 'Runs on your machine via the Mushi CLI (`mushi qa run`). Not schedulable from the cloud — use for local dev only.',
}

export interface CreateStoryModalProps {
  projectId: string
  onClose: () => void
  onCreated: () => void
}

export function CreateStoryModal({ projectId, onClose, onCreated }: CreateStoryModalProps) {
  const { success: toastSuccess, error: toastError } = useToast()
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [targetUrl, setTargetUrl] = useState('')
  const [provider, setProvider] = useState<'local' | 'browserbase' | 'firecrawl_actions'>('firecrawl_actions')
  const [schedulePreset, setSchedulePreset] = useState(SCHEDULE_PRESETS[0].value)
  const [customCron, setCustomCron] = useState('')
  const [saving, setSaving] = useState(false)

  const scheduleCron = schedulePreset === 'custom' ? customCron : schedulePreset

  async function handleCreate() {
    if (!name.trim()) {
      toastError('Name is required')
      return
    }
    if (!targetUrl.trim() && provider !== 'local') {
      toastError('Target URL is required so the runner knows which page to test.')
      return
    }
    if (targetUrl.trim()) {
      const urlErr = url({ optional: false })(targetUrl.trim())
      if (urlErr) {
        toastError(urlErr.message)
        return
      }
    }
    if (schedulePreset === 'custom') {
      const cronErr = cronExpression({ optional: false })(customCron.trim())
      if (cronErr) {
        toastError(cronErr.message)
        return
      }
    }
    setSaving(true)
    const res = await apiFetch(`/v1/admin/projects/${projectId}/qa-stories`, {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        prompt: prompt.trim() || null,
        target_url: targetUrl.trim() || null,
        browser_provider: provider,
        schedule_cron: scheduleCron || '0 * * * *',
      }),
    })
    setSaving(false)
    if (res.ok) {
      toastSuccess('QA story created')
      onCreated()
      onClose()
    } else {
      toastError((res as { error?: { message?: string } }).error?.message ?? 'Failed to create story')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New QA story"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Btn variant="cancel" size="sm" onClick={onClose}>Cancel</Btn>
          <Btn size="sm" onClick={handleCreate} disabled={saving || !name.trim()}>
            {saving ? 'Creating…' : 'Create story'}
          </Btn>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        <p className="text-2xs text-fg-muted">Runs on schedule and on demand. Failures send a Slack notification (if configured) and appear in run history.</p>

        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
          placeholder="e.g. Pricing page shows all 4 tiers…"
          name="qa-story-name"
          autoComplete="off"
        />

        <div>
          <Input
            label={provider !== 'local' ? 'Target URL *' : 'Target URL'}
            type="url"
            inputMode="url"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://yourapp.com/pricing"
            name="qa-story-target-url"
            autoComplete="off"
            className="font-mono"
            validate={provider !== 'local' ? url({ optional: false }) : url({ optional: true })}
          />
          <p className="mt-1 text-2xs text-fg-faint">The URL the runner will navigate to before verifying your prompt.</p>
        </div>

        <Textarea
          label="Prompt — describe what to verify"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="The pricing page should show 4 tiers, each with a CTA button and a price…"
          name="qa-story-prompt"
          autoComplete="off"
          className="resize-none"
        />

        <div>
          <SelectField
            label="Browser provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as typeof provider)}
          >
            <option value="firecrawl_actions">Firecrawl Actions (recommended)</option>
            <option value="browserbase">Browserbase</option>
            <option value="local">Local Playwright (CLI only)</option>
          </SelectField>
          {PROVIDER_EXPLAINERS[provider] && (
            <p className="mt-1 text-2xs text-fg-faint">{PROVIDER_EXPLAINERS[provider]}</p>
          )}
        </div>

        <div>
          <SelectField
            label="Run schedule"
            value={schedulePreset}
            onChange={(e) => setSchedulePreset(e.target.value)}
          >
            {SCHEDULE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </SelectField>
          {schedulePreset === 'custom' && (
            <Input
              label="Custom cron"
              value={customCron}
              onChange={(e) => setCustomCron(e.target.value)}
              placeholder="*/30 * * * * (every 30 minutes)…"
              name="qa-story-cron"
              autoComplete="off"
              spellCheck={false}
              className="mt-2 font-mono"
              validate={cronExpression({ optional: false })}
            />
          )}
        </div>
      </div>
    </Modal>
  )
}
