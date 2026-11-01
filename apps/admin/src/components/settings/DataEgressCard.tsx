/**
 * FILE: apps/admin/src/components/settings/DataEgressCard.tsx
 * PURPOSE: Settings → Security → "Data egress" (Plan 023, ADR 0034). Shows
 *          whether the server runs local-only, the hosts it may reach, the
 *          requests it refused (by host and day), what each integration
 *          would reach, and a self-test that tries well-known cloud hosts
 *          from the server and reports each outcome.
 *
 *          GET  /v1/admin/egress/status   (console or mcp:read; MCP
 *               get_egress_status, CLI `mushi local status`)
 *          POST /v1/admin/egress/selftest (non-viewers; MCP
 *               run_egress_selftest, CLI `mushi local verify`)
 *
 *          A viewer gets 403 on the self-test, a repeat run 429; both read
 *          as a sentence, not a code (dataEgress.ts).
 */

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { CHIP_TONE } from '../../lib/chipTone'
import { Btn, Callout, ErrorAlert } from '../ui'
import { IconGlobe, IconNetwork, IconShield, IconShieldCheck } from '../icons'
import { SettingsList, SettingsRow } from './SettingsRow'
import {
  EGRESS_OUTCOME_LABEL,
  denialRows,
  egressErrorText,
  integrationVerdict,
  selftestSentence,
  type EgressSelftest,
  type EgressStatus,
} from './dataEgress'

const TH = 'px-2 py-1.5 text-left text-2xs font-semibold text-fg-muted'
const TD = 'px-2 py-1.5 align-top text-xs text-fg-secondary'
const VERDICT_TONE = {
  ok: CHIP_TONE.okSubtle,
  warn: CHIP_TONE.warnSubtle,
  danger: CHIP_TONE.dangerSubtle,
  neutral: CHIP_TONE.neutral,
} as const

function Chip({ tone, children }: { tone: keyof typeof VERDICT_TONE; children: string }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 text-2xs ${VERDICT_TONE[tone]}`}>{children}</span>
}

export function DataEgressCard({ projectId, id }: { projectId: string | null; id?: string }) {
  const [status, setStatus] = useState<EgressStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [test, setTest] = useState<EgressSelftest | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    const res = await apiFetch<EgressStatus>('/v1/admin/egress/status', { cache: 'no-store' })
    if (!res.ok || !res.data) {
      setLoadError(egressErrorText(res.error, 'status'))
      return
    }
    setStatus(res.data)
  }, [])

  useEffect(() => {
    setStatus(null)
    setTest(null)
    setTestError(null)
    void load()
  }, [load, projectId])

  async function runSelftest() {
    setRunning(true)
    setTestError(null)
    const res = await apiFetch<EgressSelftest>('/v1/admin/egress/selftest', { method: 'POST' })
    setRunning(false)
    if (!res.ok || !res.data) {
      setTest(null)
      setTestError(egressErrorText(res.error, 'selftest'))
      return
    }
    setTest(res.data)
    // The run itself adds refusals to the log below.
    void load()
  }

  const rows = status ? denialRows(status.denials) : []

  return (
    <SettingsList
      id={id}
      title="Data egress"
      description="Where this stack can send your bug data, and a test that proves nothing else gets out."
    >
      {loadError ? (
        <div className="py-3">
          <ErrorAlert title="Data egress" message={loadError} onRetry={() => void load()} />
        </div>
      ) : null}
      {!status && !loadError ? <p className="py-3 text-sm text-fg-muted">Loading the egress status…</p> : null}

      {status ? (
        <>
          <SettingsRow
            icon={<IconShield size={16} />}
            title="Local-only mode"
            purpose="When it is on, the server refuses every request to a host that is not on the list below, and records it."
            status={
              status.localOnly
                ? { state: 'working', label: 'On', detail: 'Only the hosts below can be reached.' }
                : {
                    state: 'not_connected',
                    label: 'Off',
                    detail: 'Integrations you turn on can reach their services. Set MUSHI_LOCAL_ONLY=1 on the server to refuse the rest.',
                  }
            }
          />

          <SettingsRow icon={<IconGlobe size={16} />} title="Allowed hosts">
            {status.allowlist.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Allowed hosts">
                {status.allowlist.map((host) => (
                  <li key={host}>
                    <code className={`rounded px-1.5 py-0.5 text-2xs ${CHIP_TONE.neutral}`}>{host}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">
                {status.localOnly
                  ? 'None. Apart from this stack and your private network, nothing can be reached.'
                  : 'None listed. The list only applies when local-only mode is on.'}
              </p>
            )}
          </SettingsRow>

          <SettingsRow icon={<IconNetwork size={16} />} title="Refused requests">
            {rows.length === 0 ? (
              <p className="text-sm text-fg-muted">No refused requests recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-md border-collapse" aria-label="Refused requests by host and day">
                  <thead className="border-b border-edge-subtle">
                    <tr>
                      <th className={TH}>Host</th>
                      <th className={TH}>Day (UTC)</th>
                      <th className={`${TH} text-right`}>Refused</th>
                      <th className={TH}>From</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={`${row.day}:${row.host}`} className="border-b border-edge-subtle/50">
                        <td className={`${TD} font-mono text-fg`}>{row.host}</td>
                        <td className={TD}>{row.day}</td>
                        <td className={`${TD} text-right tabular-nums`}>{row.count}</td>
                        <td className={TD}>{row.callers.join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SettingsRow>

          <SettingsRow
            icon={<IconGlobe size={16} />}
            title="What each integration would reach"
            purpose="Every service Mushi can talk to, where it would send data, and what happens to that request now."
          >
            {status.integrations.length === 0 ? (
              <p className="text-sm text-fg-muted">No integrations reported.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-lg border-collapse" aria-label="Integrations and where they send data">
                  <thead className="border-b border-edge-subtle">
                    <tr>
                      <th className={TH}>Integration</th>
                      <th className={TH}>Sends to</th>
                      <th className={TH}>Now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.integrations.map((row) => {
                      const verdict = integrationVerdict(row, status.localOnly)
                      return (
                        <tr key={row.id} className="border-b border-edge-subtle/50">
                          <td className={`${TD} text-fg`}>
                            {row.label}
                            {row.note ? <span className="mt-0.5 block text-2xs text-fg-muted">{row.note}</span> : null}
                          </td>
                          <td className={`${TD} font-mono`}>{row.destination}</td>
                          <td className={TD}>
                            <Chip tone={verdict.tone}>{verdict.label}</Chip>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SettingsRow>
        </>
      ) : null}

      <SettingsRow
        icon={<IconShieldCheck size={16} />}
        title="Self-test"
        purpose={
          <>
            The server tries to reach well-known cloud hosts (Anthropic, OpenAI, Ollama, Sentry, GitHub, npm). Every
            attempt must be refused. From a terminal: <code>mushi local verify</code>.
          </>
        }
        action={
          <Btn variant="primary" size="sm" loading={running} onClick={() => void runSelftest()}>
            Run self-test
          </Btn>
        }
      >
        {testError ? (
          <Callout tone="danger" label="Self-test">
            {testError}
          </Callout>
        ) : null}
        {test ? (
          <div className="space-y-2" data-testid="egress-selftest-result">
            <Callout tone={test.passed ? 'ok' : 'danger'} label={test.passed ? 'Passed' : 'Failed'}>
              {selftestSentence(test)}
            </Callout>
            <ul className="space-y-1" aria-label="Self-test results">
              {test.results.map((r) => (
                <li key={r.host} className="flex flex-wrap items-center gap-2 text-xs">
                  <code className="font-mono text-fg">{r.host}</code>
                  <Chip tone={r.outcome === 'reachable' ? 'danger' : 'ok'}>{EGRESS_OUTCOME_LABEL[r.outcome]}</Chip>
                  <span className="tabular-nums text-fg-muted">{Math.round(r.ms)} ms</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </SettingsRow>
    </SettingsList>
  )
}
