/**
 * BYOK setup checklist for Claude Code Agent — workflow YAML copy + GitHub
 * secrets the operator configures in their own repo (never in mushi-mushi).
 */

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { Btn, ErrorAlert } from '../ui'
import { IconCopy, IconExternalLink } from '../icons'

interface SetupPayload {
  workflowYaml: string
  workflowPath: string
  githubSecrets: Array<{ name: string; description: string }>
  mushiSupabaseUrl: string
  serviceRoleHint: string
}

interface Props {
  /** Show only after Anthropic key is saved (health probe can run). */
  configured: boolean
}

export function ClaudeCodeSetupPanel({ configured }: Props) {
  const [data, setData] = useState<SetupPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState<'yaml' | 'url' | null>(null)

  const load = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    const res = await apiFetch<SetupPayload>('/v1/admin/integrations/claude-code-agent/setup')
    setLoading(false)
    if (!res.ok) {
      setError(res.error?.message ?? 'Could not load setup instructions')
      return
    }
    setData(res.data ?? null)
  }, [configured])

  useEffect(() => {
    void load()
  }, [load])

  const copyText = async (text: string, kind: 'yaml' | 'url') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      setError('Clipboard unavailable — select and copy manually')
    }
  }

  if (!configured) {
    return (
      <p className="text-2xs text-fg-faint border-t border-edge-subtle px-3 py-2">
        Save your Anthropic API key above, then add the workflow and GitHub secrets below.
      </p>
    )
  }

  if (loading && !data) {
    return (
      <p className="text-2xs text-fg-faint border-t border-edge-subtle px-3 py-2 animate-pulse">
        Loading setup instructions…
      </p>
    )
  }

  if (error && !data) {
    return (
      <div className="border-t border-edge-subtle px-3 py-2">
        <ErrorAlert message={error} onRetry={() => void load()} />
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="border-t border-edge-subtle bg-surface-raised/30 px-3 py-3 space-y-3">
      <div>
        <h4 className="text-2xs font-semibold text-fg uppercase tracking-wide">Repo setup (BYOK)</h4>
        <p className="text-2xs text-fg-muted mt-1 leading-snug">
          Copy the workflow into your GitHub repo and add secrets there. Keys never ship in the
          public mushi-mushi repo or in workflow YAML committed to git.
        </p>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-2xs font-mono text-fg-secondary">{data.workflowPath}</span>
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => void copyText(data.workflowYaml, 'yaml')}
            className="shrink-0"
          >
            <IconCopy size={12} />
            {copied === 'yaml' ? 'Copied' : 'Copy workflow'}
          </Btn>
        </div>
        <pre className="max-h-40 overflow-auto rounded-sm border border-edge-subtle bg-surface p-2 text-2xs font-mono text-fg-muted">
          {data.workflowYaml.slice(0, 1200)}
          {data.workflowYaml.length > 1200 ? '\n…' : ''}
        </pre>
      </div>

      <div>
        <p className="text-2xs font-medium text-fg mb-1">GitHub Actions secrets (your repo)</p>
        <ul className="space-y-2">
          {data.githubSecrets.map((s) => (
            <li key={s.name} className="text-2xs">
              <code className="font-mono text-brand">{s.name}</code>
              <span className="text-fg-muted"> — {s.description}</span>
            </li>
          ))}
        </ul>
      </div>

      {data.mushiSupabaseUrl && (
        <div className="flex flex-wrap items-center gap-2 text-2xs">
          <span className="text-fg-muted">Dispatch callback URL (injected automatically):</span>
          <code className="font-mono text-fg-secondary truncate max-w-full">{data.mushiSupabaseUrl}</code>
          <Btn size="sm" variant="ghost" onClick={() => void copyText(data.mushiSupabaseUrl, 'url')}>
            <IconCopy size={12} />
            {copied === 'url' ? 'Copied' : 'Copy'}
          </Btn>
        </div>
      )}

      <p className="text-2xs text-fg-faint leading-snug">{data.serviceRoleHint}</p>

      <a
        href="https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions"
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 text-2xs text-brand hover:text-brand-hover"
      >
        GitHub secrets docs <IconExternalLink size={10} />
      </a>
    </div>
  )
}
