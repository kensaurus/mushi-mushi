import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { apiErrorMessage } from '../../lib/humanizeApiError'
import { Btn, Card } from '../ui'

interface ScopeSettings {
  scope_paths: string[] | null
  exclude_globs: string[] | null
  output_language: string
}

interface AnalyzeJob {
  id: string
  status: string
  plan?: { node_count?: number; edge_count?: number }
  error?: string | null
}

interface Props {
  projectId: string
  /** The saved scope after each load and save, so the readout above agrees. */
  onScopeChange?: (scopePaths: string[]) => void
}

/** 30 polls x 2 s: after this the job is still running, not "done". */
const ANALYZE_POLLS = 30

export function ExploreIndexScopePanel({ projectId, onScopeChange }: Props) {
  const [scopePaths, setScopePaths] = useState('')
  const [excludeGlobs, setExcludeGlobs] = useState('')
  const [outputLanguage, setOutputLanguage] = useState('en')
  const [saving, setSaving] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [job, setJob] = useState<AnalyzeJob | null>(null)
  const [saved, setSaved] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'danger' | 'muted'; text: string } | null>(null)

  const loadSettings = useCallback(async () => {
    if (!projectId) return
    const res = await apiFetch<ScopeSettings>(`/v1/admin/projects/${projectId}/codebase/settings`)
    if (!res.ok || !res.data) {
      setNotice({ tone: 'danger', text: apiErrorMessage(res.error, 'Could not load the index scope. Reload the page.') })
      return
    }
    onScopeChange?.(res.data.scope_paths ?? [])
    setScopePaths((res.data.scope_paths ?? []).join('\n'))
    setExcludeGlobs((res.data.exclude_globs ?? []).join('\n'))
    setOutputLanguage(res.data.output_language ?? 'en')
  }, [projectId, onScopeChange])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const saveSettings = useCallback(async () => {
    if (!projectId) return
    setSaving(true)
    setSaved(false)
    setNotice(null)
    const scopeArr = scopePaths
      .split(/[\n,]/)
      .map((p) => p.trim())
      .filter(Boolean)
    const excludeArr = excludeGlobs
      .split(/[\n,]/)
      .map((p) => p.trim())
      .filter(Boolean)
    const res = await apiFetch<ScopeSettings>(`/v1/admin/projects/${projectId}/codebase/settings`, {
      method: 'PATCH',
      body: JSON.stringify({
        scope_paths: scopeArr.length ? scopeArr : null,
        exclude_globs: excludeArr.length ? excludeArr : null,
        output_language: outputLanguage.trim() || 'en',
      }),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      onScopeChange?.(res.data?.scope_paths ?? scopeArr)
    } else {
      setNotice({ tone: 'danger', text: apiErrorMessage(res.error, 'Could not save the scope. Try again.') })
    }
  }, [projectId, scopePaths, excludeGlobs, outputLanguage, onScopeChange])

  const reanalyze = useCallback(async () => {
    if (!projectId) return
    setAnalyzing(true)
    setJob(null)
    setNotice(null)
    const res = await apiFetch<{ job_id: string; status: string }>(
      `/v1/admin/projects/${projectId}/codebase/analyze`,
      { method: 'POST', body: JSON.stringify({}) },
    )
    if (!res.ok || !res.data?.job_id) {
      setAnalyzing(false)
      setNotice({ tone: 'danger', text: apiErrorMessage(res.error, 'Could not start the analysis. Try again.') })
      return
    }
    const jobId = res.data.job_id
    let finished = false
    for (let i = 0; i < ANALYZE_POLLS; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const poll = await apiFetch<AnalyzeJob>(
        `/v1/admin/projects/${projectId}/codebase/analyze/${jobId}`,
      )
      if (poll.ok && poll.data) {
        setJob(poll.data)
        if (poll.data.status === 'completed' || poll.data.status === 'failed') {
          finished = true
          break
        }
      }
    }
    setAnalyzing(false)
    if (!finished) {
      setNotice({
        tone: 'muted',
        text: 'Still running after a minute. It keeps going in the background; check back with Re-fetch stats.',
      })
    }
  }, [projectId])

  return (
    <Card className="p-4 space-y-3">
      <p className="text-sm font-medium text-fg">Index scope &amp; analyze</p>
      <p className="text-2xs text-fg-muted">
        Limit indexing and RAG to specific folders. Leave scope empty for the whole repo.
      </p>
      <label className="block space-y-1">
        <span className="text-2xs uppercase tracking-wider text-fg-faint">Scope paths</span>
        <textarea
          value={scopePaths}
          onChange={(e) => setScopePaths(e.target.value)}
          placeholder="packages/web&#10;apps/admin"
          rows={3}
          className="w-full text-2xs font-mono rounded border border-edge-subtle bg-surface-raised px-2 py-1.5"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-2xs uppercase tracking-wider text-fg-faint">Exclude globs</span>
        <textarea
          value={excludeGlobs}
          onChange={(e) => setExcludeGlobs(e.target.value)}
          placeholder="**/generated/**&#10;**/*.test.ts"
          rows={2}
          className="w-full text-2xs font-mono rounded border border-edge-subtle bg-surface-raised px-2 py-1.5"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-2xs uppercase tracking-wider text-fg-faint">LLM output language</span>
        <input
          value={outputLanguage}
          onChange={(e) => setOutputLanguage(e.target.value)}
          placeholder="en"
          className="w-24 text-sm rounded-md border border-edge-subtle bg-surface-raised px-3 py-2"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Btn size="sm" variant="primary" loading={saving} onClick={() => void saveSettings()}>
          Save scope
        </Btn>
        <Btn size="sm" variant="ghost" loading={analyzing} onClick={() => void reanalyze()}>
          Re-analyze graph
        </Btn>
        {saved && <span className="text-2xs text-ok self-center">Saved</span>}
      </div>
      {notice && (
        <p className={`text-2xs ${notice.tone === 'danger' ? 'text-danger' : 'text-fg-muted'}`} role="status">
          {notice.text}
        </p>
      )}
      {job && (
        <p className="text-2xs text-fg-muted">
          Job {job.status}
          {job.plan?.node_count != null ? ` · ${job.plan.node_count} nodes` : ''}
          {job.error ? ` · ${job.error}` : ''}
        </p>
      )}
    </Card>
  )
}
