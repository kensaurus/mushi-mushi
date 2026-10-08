/**
 * FILE: apps/admin/src/components/ux-runs/UxCloudRunCard.tsx
 * PURPOSE: "Start a cloud run" (Plan 021 Phase 4). Asks GitHub to run the
 *          host's mushi-ux.yml workflow, which works through the app with a
 *          Cursor Cloud agent and syncs back here. The model list (with each
 *          model's own settings, e.g. effort and context) comes live from the
 *          project's Cursor key; the skills from the synced skills catalog.
 *          When Mushi cannot start the run, it shows the command to run.
 */

import { useMemo, useState } from 'react'
import { Btn, Callout, Card, CodeValue, Input, SelectField } from '../ui'
import { IconExternalLink, IconPlay } from '../icons'
import { apiFetchMutate } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'

interface Started {
  repo: string
  actions_url: string
}
interface Fallback {
  command: string
  template_url: string
}
interface CursorModel {
  id: string
  displayName?: string
  parameters?: Array<{ id: string; displayName?: string; values: Array<{ value: string; displayName?: string }> }>
}
interface CatalogSkill {
  slug: string
  title: string
  category: string
}

const OTHER = '__other'

export function UxCloudRunCard({ projectId, embedded = false }: { projectId: string; embedded?: boolean }) {
  const models = usePageData<{ models: CursorModel[] }>('/v1/admin/integrations/cursor/models')
  const catalog = usePageData<{ data: CatalogSkill[] }>('/v1/admin/skills?limit=200')
  const [modelId, setModelId] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [params, setParams] = useState<Record<string, string>>({})
  const [skill, setSkill] = useState('')
  const [screens, setScreens] = useState('5')
  const [busy, setBusy] = useState(false)
  const [started, setStarted] = useState<Started | null>(null)
  const [error, setError] = useState<{ message: string; fallback: Fallback | null } | null>(null)

  const list = models.data?.models ?? []
  const chosen = list.find((m) => m.id === modelId)
  const spec = useMemo(() => {
    const base = modelId === OTHER ? customModel.trim() : modelId
    if (!base) return null
    const q = Object.entries(params)
      .filter(([k, v]) => v && chosen?.parameters?.some((p) => p.id === k))
      .map(([k, v]) => `${k}=${v}`)
    return q.length ? `${base}?${q.join('&')}` : base
  }, [modelId, customModel, params, chosen])

  const skillGroups = useMemo(() => {
    const groups = new Map<string, CatalogSkill[]>()
    for (const s of catalog.data?.data ?? []) groups.set(s.category || 'Skills', [...(groups.get(s.category || 'Skills') ?? []), s])
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [catalog.data])

  async function start() {
    setBusy(true)
    setError(null)
    setStarted(null)
    const n = Math.min(20, Math.max(1, Number.parseInt(screens, 10) || 5))
    const res = await apiFetchMutate<Started & { fallback?: Fallback }>(`/v1/admin/projects/${projectId}/ux-runs/cloud`, {
      method: 'POST',
      body: JSON.stringify({ max_surfaces: n, ...(spec ? { model: spec } : {}), ...(skill ? { skill } : {}) }),
    })
    setBusy(false)
    if (res.ok && res.data) setStarted(res.data)
    else setError({ message: res.error?.message ?? 'Could not start the run.', fallback: res.data?.fallback ?? null })
  }

  // Embedded inside the start card it drops its own card chrome and heading.
  const Shell = embedded ? 'div' : Card
  return (
    <Shell className={embedded ? 'flex flex-col gap-3' : 'flex flex-col gap-3 p-4'}>
      <div>
        {!embedded && <h2 className="text-sm font-semibold text-fg">Run in the cloud</h2>}
        <p className="text-xs text-fg-secondary">
          Runs on your repo’s GitHub Actions with a Cursor Cloud agent and opens one draft PR. It sees your app signed
          out. Needs <code className="font-mono">.github/workflows/mushi-ux.yml</code>.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField label="Model" value={modelId} onChange={(e) => { setModelId(e.target.value); setParams({}) }}>
          <option value="">Cursor’s default</option>
          {list.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName && m.displayName !== m.id ? `${m.displayName} — ${m.id}` : m.id}
            </option>
          ))}
          <option value={OTHER}>Other model id…</option>
        </SelectField>
        {modelId === OTHER && <Input label="Model id" value={customModel} onChange={(e) => setCustomModel(e.target.value)} placeholder="grok-4.7" />}
        {(chosen?.parameters ?? []).map((p) => (
          <SelectField key={p.id} label={p.displayName ?? p.id} value={params[p.id] ?? ''} onChange={(e) => setParams((cur) => ({ ...cur, [p.id]: e.target.value }))}>
            <option value="">Default</option>
            {p.values.map((v) => (
              <option key={v.value} value={v.value}>{v.displayName ?? v.value}</option>
            ))}
          </SelectField>
        ))}
        <SelectField label="Skill" value={skill} onChange={(e) => setSkill(e.target.value)}>
          <option value="">None — built-in UX guidance</option>
          {skillGroups.map(([group, skills]) => (
            <optgroup key={group} label={group}>
              {skills.map((s) => (
                <option key={s.slug} value={s.slug}>{s.slug}</option>
              ))}
            </optgroup>
          ))}
        </SelectField>
        <Input label="Screens" type="number" min={1} max={20} value={screens} onChange={(e) => setScreens(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-2xs text-fg-muted">
          {models.error
            ? 'Add a Cursor key under Settings → AI keys to list your models; any id still works under “Other”.'
            : `model: ${spec ?? 'Cursor’s default'}${skill ? ` · skill: ${skill}` : ''}`}
        </p>
        <Btn size="sm" onClick={start} loading={busy} disabled={busy || (modelId === OTHER && !customModel.trim())} leadingIcon={<IconPlay />}>
          Start a cloud run
        </Btn>
      </div>
      {started && (
        <Callout tone="ok">
          Started on {started.repo}. It shows up here once the runner reaches the first screen.{' '}
          <a href={started.actions_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
            Watch it on GitHub <IconExternalLink className="h-3 w-3" />
          </a>
        </Callout>
      )}
      {error && (
        <Callout tone="warn">
          <p className="text-xs">{error.message}</p>
          {error.fallback && (
            <div className="mt-2 flex flex-col gap-1.5">
              <CodeValue value={error.fallback.command} />
              <a href={error.fallback.template_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-2xs underline">
                The workflow to add <IconExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </Callout>
      )}
    </Shell>
  )
}
