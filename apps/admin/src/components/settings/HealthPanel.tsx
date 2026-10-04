/**
 * FILE: apps/admin/src/components/settings/HealthPanel.tsx
 * PURPOSE: Settings → SDK & connection (the debug-logging list under it is
 *          DevToolsPanel). Rows:
 *            Send a test bug        the whole path, end to end
 *            Connection to Mushi    can this browser reach the backend
 *            Where your data lives  Mushi Cloud or your own Supabase
 *            Install the widget     per-framework install snippet
 *            API address            the URL your SDK sends reports to
 */

import { useState } from 'react'
import { useSendTestReport } from '../../lib/useSendTestReport'
import { Btn, CopyButton } from '../ui'
import { IconBolt, IconGlobe, IconHealth, IconStorage, IconTerminal } from '../icons'
import { RESOLVED_API_URL } from '../../lib/env'
import { relativeTime } from '../../lib/setupGuideSteps'
import { usePersistentState } from '../../lib/usePersistentState'
import { SdkInstallCard } from '../SdkInstallCard'
import { ConnectionStatus as BackendDiagnostics } from '../ConnectionStatus'
import { BackendModePanel, currentBackendLabel } from './BackendModePanel'
import { SettingsList, SettingsRow, type RowStatusValue } from './SettingsRow'

interface HealthPanelProps {
  projectId: string
  projectName?: string | null
  projectSlug?: string | null
}

export function HealthPanel({ projectId, projectName, projectSlug }: HealthPanelProps) {
  const project = { id: projectId, name: projectName ?? 'this project' }
  const [showChecks, setShowChecks] = usePersistentState('settings:health:checks-open', false, {
    projectId,
    validate: (v): v is boolean => typeof v === 'boolean',
  })
  const [showBackend, setShowBackend] = usePersistentState('settings:health:backend-open', false, {
    projectId,
    validate: (v): v is boolean => typeof v === 'boolean',
  })

  return (
    <>
      <SettingsList
        title="Check the connection"
        description={`Check that bug reports from ${project.name} reach Mushi and come out the other end.`}
      >
        <QuickTestRow project={project} />

        <SettingsRow
          icon={<IconHealth size={16} />}
          title="Connection to Mushi"
          purpose="Checks that this browser can reach the database, sign-in and report services."
          status={<BackendDiagnostics compact />}
          action={
            <Btn size="sm" variant="ghost" aria-expanded={showChecks} onClick={() => setShowChecks(!showChecks)}>
              {showChecks ? 'Hide each check' : 'Show each check'}
            </Btn>
          }
        >
          {showChecks ? <BackendDiagnostics /> : null}
        </SettingsRow>

        <SettingsRow
          icon={<IconStorage size={16} />}
          title="Where your data lives"
          purpose={`Now: ${currentBackendLabel()}. Change it only if you run your own Mushi backend.`}
          action={
            <Btn size="sm" variant="ghost" aria-expanded={showBackend} onClick={() => setShowBackend(!showBackend)}>
              {showBackend ? 'Cancel' : 'Change'}
            </Btn>
          }
        >
          {showBackend ? <BackendModePanel /> : null}
        </SettingsRow>
      </SettingsList>

      <SettingsList title="Install the bug widget" description="Add the Mushi SDK to your app so people can report bugs.">
        <SettingsRow
          icon={<IconTerminal size={16} />}
          title="Install command and setup code"
          purpose="Pick your framework and copy the two snippets. They already contain this project's id."
        >
          <SdkInstallCard projectId={project.id} projectSlug={projectSlug} embedded />
        </SettingsRow>
        <SettingsRow
          icon={<IconGlobe size={16} />}
          title="API address"
          purpose="Where the SDK sends reports. Only needed if you configure the SDK by hand."
          status={<code className="break-all font-mono text-sm text-fg-secondary">{RESOLVED_API_URL}</code>}
          action={<CopyButton value={RESOLVED_API_URL} label="Copy address" />}
        />
      </SettingsList>
    </>
  )
}

function QuickTestRow({ project }: { project: { id: string; name: string } }) {
  const sendTestReport = useSendTestReport()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; detail: string; at: string } | null>(null)

  async function runTest() {
    setRunning(true)
    const res = await sendTestReport(project.id)
    setRunning(false)
    setResult(
      res.ok
        ? { ok: true, detail: `A test report reached ${res.projectName}.`, at: new Date().toISOString() }
        : { ok: false, detail: res.message, at: new Date().toISOString() },
    )
  }

  const status: RowStatusValue = running
    ? { state: 'checking', label: 'Sending…', detail: 'Sending a test report.' }
    : !result
      ? { state: 'checking', detail: 'Send one to see the whole path work.' }
      : result.ok
        ? { state: 'working', detail: `${result.detail} Checked ${relativeTime(result.at) ?? 'just now'}.` }
        : { state: 'attention', detail: result.detail }

  return (
    <SettingsRow
      icon={<IconBolt size={16} />}
      title="Send a test bug"
      purpose="Sends a test report through the same path your users' reports take, including triage and your alerts."
      status={status}
      action={
        <Btn size="sm" variant="primary" onClick={() => void runTest()} loading={running}>
          {result ? 'Send another' : 'Send test bug'}
        </Btn>
      }
    />
  )
}
