/**
 * Setup Copilot — guided ingest + dispatch verification with copy-paste CLI blocks.
 */

import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader, Section, Card, Btn } from '../components/ui'
import { VerifySetupPanel } from '../components/VerifySetupPanel'
import { SdkHealthSummary } from '../components/SdkHealthSummary'
import { SdkUpgradeCTA } from '../components/SdkUpgradeCTA'
import { SdkVersionBadge, type SdkStatus } from '../components/SdkVersionBadge'
import { CodeInline } from '../components/CodePanel'
import { useSetupStatus } from '../lib/useSetupStatus'
import { usePageData } from '../lib/usePageData'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { mushiEnvVarsForProjectSlug } from '../lib/projectMushiEnv'
import { ContainedBlock } from '../components/report-detail/ReportSurface'

interface ProjectRow {
  id: string
  name: string
  slug: string
  report_count: number
  last_report_at: string | null
  admin_host: string | null
  api_keys: Array<{
    id: string
    key_prefix: string
    label?: string | null
    is_active: boolean
    created_at: string
    last_seen_at?: string | null
    last_seen_origin?: string | null
    last_seen_user_agent?: string | null
    last_seen_endpoint_host?: string | null
  }>
  sdk_version?: {
    status: SdkStatus
    package: string | null
    observed_version: string | null
    latest_version: string | null
  } | null
}

export function SetupCopilotPage() {
  const [params] = useSearchParams()
  const activeId = useActiveProjectId()
  const projectParam = params.get('project')
  const setup = useSetupStatus()

  const {
    data: projectsPayload,
    error: projectsError,
    reload,
  } = usePageData<{ projects: ProjectRow[] }>('/v1/admin/projects')

  const projectId = projectParam ?? activeId ?? setup.activeProject?.project_id ?? null

  const projectRow = useMemo(
    () => projectsPayload?.projects?.find((p) => p.id === projectId) ?? null,
    [projectsPayload, projectId],
  )

  const setupProject = setup.data?.projects.find((p) => p.project_id === projectId)
  const env = mushiEnvVarsForProjectSlug(projectRow?.slug ?? setupProject?.project_slug)

  const connectCmd =
    'mushi connect --api-key <key> --project-id <uuid> --endpoint <url> --wait'

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="Setup Copilot"
        description="Wire the SDK, confirm heartbeat traffic, then verify dispatch readiness — without guessing which checklist applies."
      >
        <Link to="/projects">
          <Btn variant="ghost" size="sm">← Projects</Btn>
        </Link>
      </PageHeader>

      {!projectId && (
        <Card className="p-5">
          <p className="text-sm text-fg-muted">Select a project from the switcher or open Copilot from a project card.</p>
          <Link to="/projects" className="text-xs text-accent underline mt-2 inline-block">Go to Projects</Link>
        </Card>
      )}

      {projectId && !projectRow && !projectsPayload && !projectsError && (
        <Card className="p-5">
          <p className="text-xs text-fg-muted">Loading project details…</p>
        </Card>
      )}

      {projectId && !projectRow && !projectsPayload && projectsError && (
        <Card className="p-5">
          <p className="text-sm text-fg-muted">Could not load projects: {projectsError}</p>
          <button type="button" onClick={() => void reload()} className="text-xs text-accent underline mt-2 inline-block">
            Retry
          </button>
        </Card>
      )}

      {projectId && !projectRow && projectsPayload && (
        <Card className="p-5">
          <p className="text-sm text-fg-muted">
            Project not found — it may have been deleted, or the link is stale.
          </p>
          <Link to="/projects" className="text-xs text-accent underline mt-2 inline-block">
            Go to Projects
          </Link>
        </Card>
      )}

      {projectId && projectRow && (
        <>
          <Section title="1 · Connect credentials">
            <p className="text-xs text-fg-muted mb-3">Save keys locally and wait for the SDK heartbeat.</p>
            <Card className="p-5 space-y-3">
              <p className="text-xs text-fg-muted">
                Paste into your <strong>{env.stackLabel}</strong> repo ({env.envFileHint ?? '.env.local'}):
                {' '}
                <code className="font-mono text-2xs">{env.projectIdVar}</code> +{' '}
                <code className="font-mono text-2xs">{env.apiKeyVar}</code>
              </p>
              <ContainedBlock tone="muted">
                <CodeInline>{connectCmd}</CodeInline>
              </ContainedBlock>
              <p className="text-2xs text-fg-muted">
                Or run <CodeInline>mushi init</CodeInline> / <CodeInline>mushi upgrade</CodeInline> in the consumer repo after installing the snippet.
              </p>
            </Card>
          </Section>

          <Section title="2 · Install snippet">
            <p className="text-xs text-fg-muted mb-3">
              Use the canonical{' '}
              <Link to={`/onboarding?tab=sdk&project=${projectId}`} className="text-accent underline">
                Onboarding → SDK tab
              </Link>{' '}
              for the live configurator, connection status chip, and copy-paste snippet.
            </p>
            <Card className="p-4">
              <Link to={`/onboarding?tab=sdk&project=${projectId}`}>
                <Btn variant="primary" size="sm">Open SDK install wizard →</Btn>
              </Link>
            </Card>
          </Section>

          <Section title="3 · SDK health">
            <p className="text-xs text-fg-muted mb-3">Heartbeat vs admin host — catches wrong-endpoint installs.</p>
            <SdkHealthSummary
              projectId={projectId}
              projectName={projectRow.name}
              projectSlug={projectRow.slug}
              apiKeys={projectRow.api_keys}
              lastReportAt={projectRow.last_report_at}
              adminHost={projectRow.admin_host}
              reportCount={projectRow.report_count}
              onTestReportSent={() => void reload()}
            />
            {projectRow.sdk_version && (
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <SdkVersionBadge
                  status={projectRow.sdk_version.status}
                  package_={projectRow.sdk_version.package}
                  observedVersion={projectRow.sdk_version.observed_version}
                  latestVersion={projectRow.sdk_version.latest_version}
                />
                <SdkUpgradeCTA
                  status={projectRow.sdk_version.status}
                  package_={projectRow.sdk_version.package}
                  observedVersion={projectRow.sdk_version.observed_version}
                  latestVersion={projectRow.sdk_version.latest_version}
                  stackLabel={env.stackLabel}
                  compact
                  projectId={projectId}
                />
              </div>
            )}
          </Section>

          <Section title="4 · Verify both tracks">
            <p className="text-xs text-fg-muted mb-3">Ingest 4/4 and dispatch 4/4 — different gates, both documented.</p>
            <VerifySetupPanel
              projectId={projectId}
              projectName={projectRow.name}
              adminHost={projectRow.admin_host}
            />
          </Section>
        </>
      )}
    </div>
  )
}
