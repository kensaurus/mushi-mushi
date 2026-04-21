/**
 * FILE: apps/admin/src/components/ConnectionStatus.tsx
 * PURPOSE: Reusable diagnostics component that checks backend connectivity.
 *          Tests Supabase REST, Auth, and Edge Functions health endpoints.
 *          Used on SetupGatePage, SettingsPage, and OnboardingPage.
 */

import { useState, useCallback } from 'react'
import { Btn } from './ui'
import {
  isCloudMode,
  RESOLVED_SUPABASE_URL as SUPABASE_URL,
  RESOLVED_SUPABASE_ANON_KEY as SUPABASE_ANON_KEY,
  RESOLVED_API_URL as API_URL,
} from '../lib/env'

interface Check {
  id: string
  label: string
  description: string
  status: 'pending' | 'running' | 'pass' | 'fail' | 'warn'
  detail?: string
  latencyMs?: number
}

const cloud = isCloudMode()

async function timedFetch(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; ms: number; body?: string }> {
  const t0 = performance.now()
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) })
    const ms = Math.round(performance.now() - t0)
    const body = await res.text().catch(() => '')
    return { ok: res.ok, status: res.status, ms, body }
  } catch (err) {
    const ms = Math.round(performance.now() - t0)
    return { ok: false, status: 0, ms, body: err instanceof Error ? err.message : 'Unknown error' }
  }
}

interface ConnectionStatusProps {
  compact?: boolean
  className?: string
}

export function ConnectionStatus({ compact, className = '' }: ConnectionStatusProps) {
  const backendLabel = cloud ? 'Mushi Mushi Cloud' : 'Supabase'
  const [checks, setChecks] = useState<Check[]>([
    { id: 'supabase', label: `${backendLabel} REST API`, description: 'Database and core services', status: 'pending' },
    { id: 'auth', label: 'Authentication (GoTrue)', description: 'Login and signup service', status: 'pending' },
    { id: 'edge', label: 'Edge Functions API', description: 'LLM pipeline and report ingest', status: 'pending' },
  ])
  const [running, setRunning] = useState(false)

  const update = useCallback((id: string, patch: Partial<Check>) => {
    setChecks((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }, [])

  const runChecks = useCallback(async () => {
    setRunning(true)
    setChecks((prev) => prev.map((c) => ({ ...c, status: 'running' as const, detail: undefined, latencyMs: undefined })))

    // Check 1: Supabase REST — any HTTP response (even 401) means the API is reachable
    update('supabase', { status: 'running' })
    const rest = await timedFetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    })
    const restReachable = rest.status > 0
    update('supabase', {
      status: restReachable ? 'pass' : 'fail',
      latencyMs: rest.ms,
      detail: restReachable ? `${rest.ms}ms` : `Unreachable — ${rest.body?.slice(0, 100)}`,
    })

    // Check 2: Auth (GoTrue)
    update('auth', { status: 'running' })
    const auth = await timedFetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY } : {},
    })
    const authReachable = auth.ok || auth.status === 401
    update('auth', {
      status: authReachable ? 'pass' : 'fail',
      latencyMs: auth.ms,
      detail: authReachable ? `${auth.ms}ms` : `HTTP ${auth.status || 'unreachable'} — ${auth.body?.slice(0, 100)}`,
    })

    // Check 3: Edge Functions health
    update('edge', { status: 'running' })
    const edge = await timedFetch(`${API_URL}/health`)
    if (edge.ok) {
      update('edge', { status: 'pass', latencyMs: edge.ms, detail: `${edge.ms}ms` })
    } else {
      const altEdge = await timedFetch(`${SUPABASE_URL}/functions/v1/api/health`)
      update('edge', {
        status: altEdge.ok ? 'pass' : 'fail',
        latencyMs: altEdge.ok ? altEdge.ms : edge.ms,
        detail: altEdge.ok
          ? `${altEdge.ms}ms (via fallback path)`
          : `HTTP ${edge.status || 'unreachable'} — Edge Functions may not be deployed. Run: npx supabase functions deploy api`,
      })
    }

    setRunning(false)
  }, [update])

  const allPassed = checks.every((c) => c.status === 'pass')
  const anyFailed = checks.some((c) => c.status === 'fail')
  const anyPending = checks.some((c) => c.status === 'pending')

  const statusIcon = (status: Check['status']) => {
    switch (status) {
      case 'pass': return <span className="text-ok">✓</span>
      case 'fail': return <span className="text-danger">✗</span>
      case 'warn': return <span className="text-warn">!</span>
      case 'running': return <span className="text-fg-faint animate-pulse">⋯</span>
      default: return <span className="text-fg-faint">○</span>
    }
  }

  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <span className={`inline-block w-2 h-2 rounded-full ${allPassed ? 'bg-ok' : anyFailed ? 'bg-danger' : anyPending ? 'bg-fg-faint' : 'bg-warn'}`} />
        <span className="text-2xs text-fg-muted">
          {anyPending ? 'Not checked' : allPassed ? 'All systems healthy' : 'Issues detected'}
        </span>
        <button
          type="button"
          onClick={runChecks}
          disabled={running}
          className="text-2xs text-brand hover:text-brand-hover disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1 focus-visible:ring-offset-surface rounded-sm motion-safe:transition-colors motion-safe:active:scale-[0.97]"
        >
          {running ? 'Checking…' : anyPending ? 'Run check' : 'Re-check'}
        </button>
      </div>
    )
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">
          {cloud ? 'Mushi Mushi Cloud' : 'Connection Health'}
        </h3>
        <Btn variant="ghost" size="sm" onClick={runChecks} disabled={running} loading={running}>
          {anyPending ? 'Run diagnostics' : 'Re-check'}
        </Btn>
      </div>

      <div className="space-y-2">
        {checks.map((check) => (
          <div key={check.id} className="flex items-start gap-2.5 bg-surface-raised/50 border border-edge-subtle rounded-sm px-3 py-2">
            <span className="mt-0.5 text-sm leading-none">{statusIcon(check.status)}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-fg">{check.label}</span>
                {check.latencyMs !== undefined && check.status === 'pass' && (
                  <span className="text-2xs font-mono text-fg-faint">{check.latencyMs}ms</span>
                )}
              </div>
              <p className="text-2xs text-fg-faint">{check.description}</p>
              {check.detail && check.status === 'fail' && (
                <p className="text-2xs text-danger mt-1 break-all">{check.detail}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {allPassed && (
        <p className="text-xs text-ok flex items-center gap-1.5">
          <span>✓</span> All systems are reachable and healthy
        </p>
      )}
    </div>
  )
}
