/**
 * FILE: apps/admin/src/components/AssistantConfigCard.tsx
 * PURPOSE: Console surface for the page-aware in-SDK assistant (Workstream E).
 *
 *   Lets an operator turn on the SDK "Ask" tab, author the app-knowledge corpus
 *   the assistant may cite, set a greeting + starter chips, and review recent
 *   assistant turns (audit + cost). Ease-of-setup first: the whole thing is one
 *   toggle to go live with sensible defaults; the knowledge editor + logs sit in
 *   a collapsed "Advanced" disclosure so the default view stays calm.
 *
 *   Security note surfaced to the user: the knowledge text is sent to the LLM,
 *   and the backend hard-rejects anything that looks like a secret (PUT returns
 *   SECRET_DETECTED). The assistant never reads user data, source, or env.
 */
import { useCallback, useEffect, useState } from 'react'
import { apiFetch, invalidateApiCache } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { Btn, Input, Textarea, Toggle, Callout } from './ui'

interface AssistantConfig {
  enabled: boolean
  label: string
  greeting: string | null
  suggestions: string[]
  knowledge: string
  knowledgeChars: number
  knowledgeCap: number
}

interface AssistantLogRow {
  id: string
  thread_id: string
  role: 'user' | 'assistant'
  content: string
  route: string | null
  model: string | null
  fallback_used: boolean | null
  cost_usd: number | null
  latency_ms: number | null
  created_at: string
}

export function AssistantConfigCard({ projectId }: { projectId: string }) {
  const toast = useToast()
  const [cfg, setCfg] = useState<AssistantConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [logs, setLogs] = useState<AssistantLogRow[] | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    void apiFetch<AssistantConfig>(`/v1/admin/projects/${projectId}/assistant`)
      .then((res) => {
        if (res.ok && res.data) setCfg(res.data)
      })
      .catch(() => {
        /* network already surfaced via apiFetch → Sentry; keep prior cfg */
      })
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => { load() }, [load])

  const patch = (partial: Partial<AssistantConfig>) =>
    setCfg((prev) => (prev ? { ...prev, ...partial } : prev))

  const save = useCallback(async () => {
    if (!cfg) return
    setSaving(true)
    const res = await apiFetch<{ updated: string[] }>(`/v1/admin/projects/${projectId}/assistant`, {
      method: 'PUT',
      body: JSON.stringify({
        enabled: cfg.enabled,
        label: cfg.label,
        greeting: cfg.greeting,
        suggestions: cfg.suggestions,
        knowledge: cfg.knowledge,
      }),
    })
    setSaving(false)
    if (res.ok) {
      invalidateApiCache(`/v1/admin/projects/${projectId}/assistant`)
      invalidateApiCache(`/v1/admin/projects/${projectId}/sdk-config`)
      toast.success('Assistant saved')
      load()
    } else {
      const code = (res.error as { code?: string } | undefined)?.code
      toast.error(
        code === 'SECRET_DETECTED'
          ? (res.error as { message?: string }).message ?? 'Knowledge text contains a secret'
          : 'Could not save assistant',
      )
    }
  }, [cfg, projectId, toast, load])

  const loadLogs = useCallback(() => {
    setLogsLoading(true)
    void apiFetch<{ messages: AssistantLogRow[] }>(`/v1/admin/projects/${projectId}/assistant/logs?limit=50`)
      .then((res) => { if (res.ok && res.data) setLogs(res.data.messages) })
      .catch(() => {
        /* ignore — logs are optional diagnostics */
      })
      .finally(() => setLogsLoading(false))
  }, [projectId])

  if (loading || !cfg) {
    return <div className="text-2xs text-fg-faint px-1 py-2">Loading assistant…</div>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-fg">Page-aware assistant</div>
          <div className="text-2xs text-fg-muted">
            Adds an “Ask” tab to the widget so users get answers about your app, grounded only in
            the page they’re on and the knowledge you write below.
          </div>
        </div>
        <Toggle
          ariaLabel="Enable assistant"
          checked={cfg.enabled}
          onChange={(v) => patch({ enabled: v })}
        />
      </div>

      {cfg.enabled && (
        <div className="space-y-3">
          <Input
            label="Tab label"
            value={cfg.label}
            maxLength={24}
            onChange={(e) => patch({ label: e.target.value })}
          />
          <Input
            label="Greeting (shown on an empty thread)"
            value={cfg.greeting ?? ''}
            maxLength={400}
            placeholder="Hi! Ask me anything about this page."
            onChange={(e) => patch({ greeting: e.target.value })}
          />
          <Input
            label="Starter questions (comma-separated, up to 6)"
            value={cfg.suggestions.join(', ')}
            onChange={(e) =>
              patch({
                suggestions: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .slice(0, 6),
              })
            }
          />

          <details
            className="border-t border-edge-subtle pt-3 group"
            open={advancedOpen}
            onToggle={(e) => {
              const open = (e.currentTarget as HTMLDetailsElement).open
              setAdvancedOpen(open)
              if (open && logs === null) loadLogs()
            }}
          >
            <summary className="cursor-pointer select-none list-none text-2xs font-medium text-fg-muted hover:text-fg">
              Advanced — knowledge &amp; logs
            </summary>

            <div className="mt-3 space-y-3">
              <div>
                <Textarea
                  label="App knowledge the assistant may cite"
                  value={cfg.knowledge}
                  rows={8}
                  maxLength={cfg.knowledgeCap}
                  placeholder={'Describe your features, pricing, common how-tos, FAQs…\nThis text is sent to the LLM — never paste secrets, keys, or source.'}
                  onChange={(e) => patch({ knowledge: e.target.value })}
                />
                <div className="text-3xs text-fg-faint mt-1">
                  {cfg.knowledge.length.toLocaleString()} / {cfg.knowledgeCap.toLocaleString()} chars ·
                  uses your project’s BYOK key · every turn is logged
                </div>
              </div>

              <Callout tone="neutral" label="Security">
                The assistant answers only from the current page context and this knowledge text. It
                has no access to user data, source code, or environment variables, and the save
                button rejects text that looks like a secret.
              </Callout>

              <div className="flex items-center justify-between gap-2">
                <div className="text-2xs font-medium text-fg-muted">Recent turns</div>
                <Btn variant="ghost" size="sm" loading={logsLoading} onClick={loadLogs}>
                  Refresh
                </Btn>
              </div>
              {logs && logs.length > 0 ? (
                <div className="space-y-1.5 max-h-64 overflow-auto">
                  {logs.map((m) => (
                    <div key={m.id} className="text-3xs border border-edge-subtle rounded-sm px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className={m.role === 'user' ? 'text-fg-muted' : 'text-fg'}>
                          {m.role === 'user' ? '🙋 user' : '🤖 assistant'}
                          {m.route ? ` · ${m.route}` : ''}
                        </span>
                        <span className="text-fg-faint">
                          {m.role === 'assistant' && m.model ? m.model : ''}
                          {m.latency_ms != null ? ` · ${m.latency_ms}ms` : ''}
                        </span>
                      </div>
                      <div className="text-fg-muted mt-0.5 line-clamp-2">{m.content}</div>
                    </div>
                  ))}
                </div>
              ) : logs ? (
                <div className="text-3xs text-fg-faint">No assistant activity yet.</div>
              ) : null}
            </div>
          </details>
        </div>
      )}

      <div className="flex justify-end">
        <Btn variant="primary" size="sm" loading={saving} onClick={save}>
          Save assistant
        </Btn>
      </div>
    </div>
  )
}
