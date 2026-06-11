/**
 * Dual-track setup verification: ingest 4/4 (SDK pipeline) vs dispatch 4/4
 * (auto-fix readiness). Surfaces CLI + MCP commands operators can paste.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Card, Btn, Badge, ErrorAlert } from './ui'
import { ContainedBlock, SignalChip } from './report-detail/ReportSurface'
import { CodeInline } from './CodePanel'
import { apiFetch } from '../lib/supabase'
import { useSetupStatus, SETUP_STEPS } from '../lib/useSetupStatus'
import { IconCheck, IconTerminal, IconCopy } from './icons'

interface PreflightCheck {
  key: string
  ready: boolean
  label: string
  hint: string
  fixHref: string
}

interface VerifySetupPanelProps {
  projectId: string
  projectName: string
  adminHost?: string | null
  compact?: boolean
}

export function VerifySetupPanel({ projectId, projectName, adminHost, compact = false }: VerifySetupPanelProps) {
  const location = useLocation()
  const onCopilotPage = location.pathname.startsWith('/setup-copilot')
  const setup = useSetupStatus(projectId)
  const project = setup.data?.projects.find((p) => p.project_id === projectId)
  const [dispatchLoading, setDispatchLoading] = useState(false)
  const [dispatchError, setDispatchError] = useState<string | null>(null)
  const [dispatchChecks, setDispatchChecks] = useState<PreflightCheck[] | null>(null)
  const [dispatchReady, setDispatchReady] = useState<boolean | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const requiredSteps = project?.steps.filter((s) => s.required) ?? []
  const ingestComplete = project?.done ?? false
  const ingestRatio = project
    ? `${project.required_complete}/${project.required_total}`
    : '—'

  // The panel is reused across project switches without remounting — reset
  // preflight state so project A's results never render under project B, and
  // tag in-flight requests so a late response for A can't overwrite B's view.
  const requestSeqRef = useRef(0)
  useEffect(() => {
    requestSeqRef.current += 1
    setDispatchChecks(null)
    setDispatchReady(null)
    setDispatchError(null)
    setDispatchLoading(false)
  }, [projectId])

  const runDispatchCheck = useCallback(async () => {
    const seq = ++requestSeqRef.current
    setDispatchLoading(true)
    setDispatchError(null)
    try {
      const res = await apiFetch<{ ready: boolean; checks: PreflightCheck[] }>(
        `/v1/admin/projects/${projectId}/preflight`,
      )
      if (seq !== requestSeqRef.current) return
      if (!res.ok || !res.data) {
        setDispatchError(res.error?.message ?? 'Preflight check failed')
        return
      }
      setDispatchChecks(res.data.checks)
      setDispatchReady(res.data.ready)
    } catch (err) {
      if (seq !== requestSeqRef.current) return
      setDispatchError(err instanceof Error ? err.message : 'Preflight check failed')
    } finally {
      if (seq === requestSeqRef.current) setDispatchLoading(false)
    }
  }, [projectId])

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  const copyCmd = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(null), 2000)
    } catch { /* ignore */ }
  }

  const cliIngest = 'mushi doctor --ingest'
  const cliDispatch = 'mushi doctor --server'
  const mcpIngest = 'ingest_setup_check'
  const mcpDispatch = 'setup_check'

  if (!project && setup.loading) {
    return (
      <Card className={compact ? 'p-3' : 'p-4'}>
        <p className="text-xs text-fg-muted">Loading setup status…</p>
      </Card>
    )
  }

  return (
    <Card className={`space-y-4 ${compact ? 'p-3' : 'p-5'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-fg">Verify setup</h3>
          <p className="text-xs text-fg-muted mt-0.5">
            Two tracks for <span className="font-medium text-fg">{projectName}</span> — ingest (banner + reports) and dispatch (auto-fix).
          </p>
        </div>
        {!onCopilotPage && (
          <Link to={`/setup-copilot?project=${projectId}`} className="text-xs text-accent hover:underline">
            Open Setup Copilot →
          </Link>
        )}
      </div>

      {/* Ingest track */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <SignalChip tone={ingestComplete ? 'ok' : 'warn'}>
            Ingest {ingestRatio}
          </SignalChip>
          {adminHost && (
            <span className="text-2xs text-fg-muted font-mono">admin @ {adminHost}</span>
          )}
        </div>
        <ul className="space-y-1.5">
          {requiredSteps.map((step) => (
            <li key={step.id} className="flex items-start gap-2 text-xs">
              <span className={step.complete ? 'text-ok' : 'text-fg-muted'} aria-hidden>
                {step.complete ? <IconCheck className="h-3.5 w-3.5" /> : '○'}
              </span>
              <span className={step.complete ? 'text-fg' : 'text-fg-muted'}>{step.label}</span>
              {!step.complete && step.id === SETUP_STEPS.sdkInstalled && step.diagnostic?.last_sdk_endpoint_host && (
                <Badge className="text-2xs ml-1">seen @ {step.diagnostic.last_sdk_endpoint_host}</Badge>
              )}
            </li>
          ))}
        </ul>
        <ContainedBlock tone="muted" className="flex flex-wrap items-center gap-2 justify-between">
          <div className="space-y-1 min-w-0">
            <p className="text-2xs text-fg-muted flex items-center gap-1">
              <IconTerminal className="h-3 w-3" aria-hidden /> CLI
            </p>
            <CodeInline>{cliIngest}</CodeInline>
            <p className="text-2xs text-fg-muted">MCP: <code className="font-mono">{mcpIngest}</code></p>
          </div>
          <Btn size="sm" variant="ghost" onClick={() => void copyCmd(cliIngest, 'ingest')}>
            <IconCopy className="h-3.5 w-3.5" aria-hidden />
            {copied === 'ingest' ? 'Copied' : 'Copy'}
          </Btn>
        </ContainedBlock>
      </section>

      {/* Dispatch track */}
      <section className="space-y-2 border-t border-edge-subtle pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <SignalChip tone={dispatchReady === true ? 'ok' : dispatchReady === false ? 'warn' : 'neutral'}>
            Dispatch {dispatchChecks ? `${dispatchChecks.filter((c) => c.ready).length}/${dispatchChecks.length}` : '—'}
          </SignalChip>
          <Btn size="sm" variant="primary" loading={dispatchLoading} onClick={() => void runDispatchCheck()}>
            Run dispatch preflight
          </Btn>
        </div>
        {dispatchError && <ErrorAlert title="Preflight failed" message={dispatchError} />}
        {dispatchChecks && (
          <ul className="space-y-1.5">
            {dispatchChecks.map((c) => (
              <li key={c.key} className="flex items-start gap-2 text-xs">
                <span className={c.ready ? 'text-ok' : 'text-fg-muted'} aria-hidden>
                  {c.ready ? <IconCheck className="h-3.5 w-3.5" /> : '○'}
                </span>
                <span className="min-w-0">
                  <span className={c.ready ? 'text-fg' : 'text-fg-muted'}>{c.label}</span>
                  {!c.ready && <span className="block text-2xs text-fg-muted mt-0.5">{c.hint}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <ContainedBlock tone="muted" className="flex flex-wrap items-center gap-2 justify-between">
          <div className="space-y-1 min-w-0">
            <p className="text-2xs text-fg-muted flex items-center gap-1">
              <IconTerminal className="h-3 w-3" aria-hidden /> CLI
            </p>
            <CodeInline>{cliDispatch}</CodeInline>
            <p className="text-2xs text-fg-muted">MCP: <code className="font-mono">{mcpDispatch}</code></p>
          </div>
          <Btn size="sm" variant="ghost" onClick={() => void copyCmd(cliDispatch, 'dispatch')}>
            <IconCopy className="h-3.5 w-3.5" aria-hidden />
            {copied === 'dispatch' ? 'Copied' : 'Copy'}
          </Btn>
        </ContainedBlock>
      </section>
    </Card>
  )
}
