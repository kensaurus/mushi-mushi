/**
 * FILE: apps/admin/src/components/iterate/NewRunForm.tsx
 * PURPOSE: Queue a new PDCA producer/critic run for the active project.
 */

import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { Card, Btn, Input } from '../ui'
import { IconIterate } from '../icons'
import { MODEL_OPTIONS, PERSONA_OPTIONS } from './types'

interface Props {
  projectId: string | null
  projectName: string | null
  onCreated: () => void
}

export function NewRunForm({ projectId, projectName, onCreated }: Props) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    target_url: '',
    goal: 'Improve UX: fix visual hierarchy, reduce cognitive load, improve scannability.',
    iterations_target: 5,
    primary_model: 'claude-sonnet-4-6',
    judge_model: 'claude-sonnet-4-6',
    persona: 'nng-heuristic',
    target_score: 0.75,
  })

  const set = (k: string, v: string | number) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.target_url.trim()) {
      toast.error('Target URL is required')
      return
    }
    if (!projectId) {
      toast.error('Select a project first')
      return
    }
    setLoading(true)
    try {
      const res = await apiFetch('/v1/admin/pdca', {
        method: 'POST',
        body: JSON.stringify({ ...form, project_id: projectId }),
      })
      if (!res.ok) throw new Error(res.error?.message ?? 'Failed to queue run')
      toast.success('Run queued — switch to Runs and click Trigger to start immediately.')
      onCreated()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="max-w-2xl space-y-5 p-6">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-fg">Queue a PDCA run</h2>
        <p className="text-2xs text-fg-muted text-pretty">
          The runner fetches the target URL, loops producer → critic until the target score is met or max
          iterations{projectName ? ` for ${projectName}` : ''}.
        </p>
      </div>

      <div className="grid gap-4">
        <Input
          label="Target URL"
          value={form.target_url}
          onChange={(e) => set('target_url', e.target.value)}
          placeholder="https://yourapp.com/dashboard"
          className="font-mono text-sm"
        />

        <label className="block space-y-1">
          <span className="text-2xs font-medium text-fg-secondary">Goal / instructions</span>
          <textarea
            value={form.goal}
            onChange={(e) => set('goal', e.target.value)}
            rows={3}
            className="block w-full rounded-md border border-edge-subtle bg-surface px-3 py-2 text-sm shadow-sm placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Max iterations"
            type="number"
            min={1}
            max={20}
            value={String(form.iterations_target)}
            onChange={(e) => set('iterations_target', parseInt(e.target.value, 10) || 5)}
          />
          <Input
            label="Target score (0–1)"
            type="number"
            step={0.05}
            min={0}
            max={1}
            value={String(form.target_score)}
            onChange={(e) => set('target_score', parseFloat(e.target.value) || 0.75)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="block space-y-1">
            <span className="text-2xs font-medium text-fg-secondary">Producer model</span>
            <select
              value={form.primary_model}
              onChange={(e) => set('primary_model', e.target.value)}
              className="block w-full rounded-md border border-edge-subtle bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-2xs font-medium text-fg-secondary">Judge model</span>
            <select
              value={form.judge_model}
              onChange={(e) => set('judge_model', e.target.value)}
              className="block w-full rounded-md border border-edge-subtle bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-2xs font-medium text-fg-secondary">Critic persona</span>
          <select
            value={form.persona}
            onChange={(e) => set('persona', e.target.value)}
            className="block w-full rounded-md border border-edge-subtle bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            {PERSONA_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>
      </div>

      <Btn
        variant="primary"
        onClick={() => void submit()}
        loading={loading}
        disabled={!projectId}
        leadingIcon={<IconIterate className="h-3.5 w-3.5" aria-hidden="true" />}
        className="w-full sm:w-auto"
      >
        Queue run
      </Btn>
    </Card>
  )
}
