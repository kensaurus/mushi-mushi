/**
 * Setup Copilot — guided ingest + dispatch verification with copy-paste CLI blocks.
 */

import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { Section, Card, Btn } from '../components/ui'
import { VerifySetupPanel } from '../components/VerifySetupPanel'
import { SdkHealthSummary } from '../components/SdkHealthSummary'
import { SdkUpgradeCTA } from '../components/SdkUpgradeCTA'
import { SdkVersionBadge, type SdkStatus } from '../components/SdkVersionBadge'
import { CodeInline } from '../components/CodePanel'
import { useSetupStatus } from '../lib/useSetupStatus'
import { usePageData } from '../lib/usePageData'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { mushiEnvVarsForProjectSlug, isExpoReporterProject } from '../lib/projectMushiEnv'
import { SetupCopilotReadout } from '../components/setup-copilot/SetupCopilotReadout'
import { ContainedBlock } from '../components/report-detail/ReportSurface'
import { usePublishPageContext } from '../lib/pageContext'

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
  const initialProjectId = projectParam ?? activeId ?? null
  const setup = useSetupStatus(initialProjectId)
  const projectId = initialProjectId ?? setup.activeProject?.project_id ?? null

  const {
    data: projectsPayload,
    error: projectsError,
    reload,
  } = usePageData<{ projects: ProjectRow[] }>('/v1/admin/projects')

  const projectRow = useMemo(
    () => projectsPayload?.projects?.find((p) => p.id === projectId) ?? null,
    [projectsPayload, projectId],
  )

  const setupProject = setup.data?.projects.find((p) => p.project_id === projectId)
  const env = mushiEnvVarsForProjectSlug(projectRow?.slug ?? setupProject?.project_slug)

  const connectCmd =
    'mushi connect --api-key <key> --project-id <uuid> --endpoint <url> --wait'

  const pageSummary = useMemo(() => {
    if (!projectId) return 'Select a project'
    const { required_complete, required_total } = setup.selectors
    const sdkLive = Boolean(
      projectRow?.api_keys?.some((k) => k.is_active && k.last_seen_at),
    )
    const parts: string[] = []
    if (required_total > 0) {
      parts.push(`Ingest ${required_complete}/${required_total}`)
    }
    parts.push(sdkLive ? 'SDK live' : 'SDK pending')
    if (projectRow) {
      const n = projectRow.report_count
      parts.push(`${n} report${n === 1 ? '' : 's'}`)
    }
    return parts.join(' · ')
  }, [projectId, setup.selectors, projectRow])

  usePublishPageContext({
    route: '/setup-copilot',
    title: 'Setup copilot',
    summary: pageSummary,
    filters: projectId ? { project_id: projectId } : undefined,
  })

  return (
    <div className="space-y-6 pb-10">
      <PageHeaderBar
        title="Setup Copilot"
        description="Wire the SDK, confirm heartbeat traffic, then verify dispatch readiness — without guessing which checklist applies."
        helpTitle="About Setup Copilot"
        helpWhatIsIt="Guided ingest and dispatch verification with copy-paste CLI blocks for the active project."
        helpUseCases={[
          'Connect credentials and wait for SDK heartbeat',
          'Copy the canonical SDK install snippet from Onboarding',
          'Verify ingest and dispatch readiness in one place',
        ]}
        helpHowToUse="Select a project, paste connect credentials, open the SDK wizard, then run Verify Setup for both ingest and dispatch tracks."
      >
        <Link to="/projects">
          <Btn variant="ghost" size="sm">← Projects</Btn>
        </Link>
      </PageHeaderBar>

      <nav
        aria-label="Setup funnel"
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-fg-muted"
      >
        <Link to="/onboarding" className="text-brand hover:underline">
          Setup wizard
        </Link>
        <span aria-hidden="true">·</span>
        <Link to={projectId ? `/connect?project=${projectId}` : '/connect'} className="text-brand hover:underline">
          Connect hub
        </Link>
        <span aria-hidden="true">·</span>
        <Link to="/inbox" className="text-brand hover:underline">
          Action Inbox
        </Link>
      </nav>

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
          <PagePosture
            slots={[
              {
                priority: POSTURE_PRIORITY.guide,
                children: (
                  <SetupCopilotReadout
                    projectId={projectRow.id}
                    projectName={projectRow.name}
                    projectSlug={projectRow.slug}
                    reportCount={projectRow.report_count}
                    sdkConnected={Boolean(
                      projectRow.api_keys?.some((k) => k.is_active && k.last_seen_at),
                    )}
                    connectCmd={connectCmd}
                  />
                ),
              },
            ]}
          />

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

          <Section title="2b · CI &amp; store builds">
            <p className="text-xs text-fg-muted mb-3">
              Reporter SDK keys for TestFlight / Play builds vs Code Health ingest — different secrets.
            </p>
            <Card className="p-5 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <ContainedBlock tone="ok">
                  <p className="text-xs font-semibold text-fg mb-2">Reporter (in-app feedback band)</p>
                  <ul className="text-2xs text-fg-muted space-y-1.5 list-disc pl-4">
                    <li>
                      Local: <code className="font-mono">{env.envFileHint ?? '.env.local'}</code>
                    </li>
                    <li>
                      Vars: <code className="font-mono">{env.projectIdVar}</code>,{' '}
                      <code className="font-mono">{env.apiKeyVar}</code>
                      {env.endpointVar ? (
                        <>, <code className="font-mono">{env.endpointVar}</code></>
                      ) : null}
                    </li>
                    {env.ciVars ? (
                      <li>
                        GitHub:{' '}
                        <code className="font-mono">{env.ciVars.projectId.name}</code> (var),{' '}
                        <code className="font-mono">{env.ciVars.apiKey.name}</code> (secret)
                      </li>
                    ) : null}
                    <li>Rebuild store apps after changing — EXPO_PUBLIC_* is compile-time.</li>
                  </ul>
                </ContainedBlock>
                <ContainedBlock tone="muted">
                  <p className="text-xs font-semibold text-fg mb-2">Ingest (Code Health CI only)</p>
                  <ul className="text-2xs text-fg-muted space-y-1.5 list-disc pl-4">
                    <li>
                      GitHub secret: <code className="font-mono">MUSHI_INGEST_KEY</code>
                    </li>
                    <li>
                      API URL: <code className="font-mono">MUSHI_API_URL</code>
                    </li>
                    <li>Does not enable the in-app band — metrics POST /v1/ingest/metrics only.</li>
                    <li>
                      Setup: <code className="font-mono">node scripts/setup-yen-yen-ingest-secrets.mjs</code>
                    </li>
                  </ul>
                </ContainedBlock>
              </div>
              {(env.ciVars && isExpoReporterProject(projectRow.slug)) ? (
                <ContainedBlock tone="warn">
                  <p className="text-2xs text-fg-muted">
                    Automate reporter GitHub vars:{' '}
                    <code className="font-mono">node scripts/setup-yen-yen-reporter-secrets.mjs</code>
                    {' '}from the mushi-mushi repo (reads yen-yen <code className="font-mono">apps/mobile/.env.local</code>).
                  </p>
                </ContainedBlock>
              ) : null}
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
