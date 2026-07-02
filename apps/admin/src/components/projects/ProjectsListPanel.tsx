/**
 * Your-projects tab body for Projects hub — folder rail + detail panel.
 */

import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Section,
  Card,
  Btn,
  EmptyState,
  Badge,
  Tooltip,
} from '../ui'
import {
  InlineProof,
  SignalChip,
} from '../report-detail/ReportSurface'
import { MigrationsInProgressCard } from '../migrations/MigrationsInProgressCard'
import { ProjectFolderTabRail } from './ProjectFolderTabRail'
import { ProjectBottleneckCard } from './ProjectBottleneckCard'
import { RevealedKeyCard } from '../RevealedKeyCard'
import { SdkInstallCard } from '../SdkInstallCard'
import { AssistantConfigCard } from '../AssistantConfigCard'
import { IdentitySecretCard } from '../IdentitySecretCard'
import { SdkHealthSummary } from '../SdkHealthSummary'
import { ConfigHelp } from '../ConfigHelp'
import { SdkVersionBadge } from '../SdkVersionBadge'
import { SdkUpgradeCTA } from '../SdkUpgradeCTA'
import { VerifySetupPanel } from '../VerifySetupPanel'
import { CodeInline } from '../CodePanel'
import { ProjectFavicon } from '../ProjectFavicon'
import { sdkOriginFromApiKeys } from '../../lib/resolveProjectDomain'
import { bottleneckDeepLink, bottleneckHumanHeadline } from '../../lib/pdcaBottleneck'
import { CHIP_TONE } from '../../lib/chipTone'
import { pluralize } from '../../lib/format'
import { useToast } from '../../lib/toast'
import { HeroPlugIntegration } from '../illustrations/HeroIllustrations'
import {
  IconCheck,
  IconClose,
  IconPencil,
  IconTrash,
  IconGit,
  IconExternalLink,
  IconStorage,
  IconReports,
  IconIntegrations,
  IconSettings,
  IconSend,
  IconKey,
  IconCopy,
  IconExplore,
  IconClock,
  IconUser,
  IconGauge,
  IconTerminal,
} from '../icons'
import {
  canDeleteProject,
  LINK_CHIP_CLASS,
  relativeTime,
  scopeBadgeTone,
  SCOPE_PRESETS,
  shortRepoLabel,
  indexHealth,
  INDEX_HEALTH_LABEL,
  INDEX_HEALTH_CHIP_TONE,
  type Project,
  type ScopePresetId,
} from './project-models'

export interface ProjectsListPanelProps {
  projects: Project[]
  activeProjectId: string | null
  selectedProject: Project | null
  adminHost: string | null
  busyProject: string | null
  revealedKeys: Record<string, { key: string; scopes: string[] }>
  sdkOpenOverride: Record<string, boolean>
  keyScopePreset: Record<string, ScopePresetId>
  renamingId: string | null
  renameDraft: string
  renamingProject: boolean
  pendingRevokeIds: Set<string>
  onGoToCreateTab: () => void
  onSelectProject: (projectId: string, name: string) => void
  onStartRename: (project: Project) => void
  onCancelRename: () => void
  onRenameDraftChange: (value: string) => void
  onSubmitRename: (projectId: string) => void
  onSendTestReport: (projectId: string, name: string) => void
  onGenerateKey: (projectId: string) => void
  onKeyScopePresetChange: (projectId: string, preset: ScopePresetId) => void
  onDismissRevealedKey: (projectId: string) => void
  onSdkOpenOverrideChange: (projectId: string, open: boolean) => void
  onRequestDelete: (project: Project) => void
  onRequestRevokeKey: (projectId: string, keyId: string, keyPrefix: string) => void
  onReload: () => void
}

export function ProjectsListPanel({
  projects,
  activeProjectId,
  selectedProject,
  adminHost,
  busyProject,
  revealedKeys,
  sdkOpenOverride,
  keyScopePreset,
  renamingId,
  renameDraft,
  renamingProject,
  pendingRevokeIds,
  onGoToCreateTab,
  onSelectProject,
  onStartRename,
  onCancelRename,
  onRenameDraftChange,
  onSubmitRename,
  onSendTestReport,
  onGenerateKey,
  onKeyScopePresetChange,
  onDismissRevealedKey,
  onSdkOpenOverrideChange,
  onRequestDelete,
  onRequestRevokeKey,
  onReload,
}: ProjectsListPanelProps) {
  return (
  <Section title="Your projects">
    {activeProjectId && (
      <MigrationsInProgressCard
        projectId={activeProjectId}
        title="Migrations in this project"
      />
    )}

    {projects.length === 0 ? (
      <EmptyState
        icon={<HeroPlugIntegration />}
        title="No projects yet"
        description="Switch to the New project tab to create your first project — you'll get an API key for the SDK or REST endpoint."
        action={
          <Btn size="sm" onClick={() => onGoToCreateTab()}>
            New project
          </Btn>
        }
      />
    ) : (
      <div className="flex min-h-0 flex-col lg:flex-row lg:items-start lg:rounded-md lg:border lg:border-edge-subtle">
        <ProjectFolderTabRail
          projects={projects}
          activeId={selectedProject?.id ?? null}
          onSelect={onSelectProject}
        />
        <div
          className="min-w-0 flex-1 lg:border-l lg:border-edge-subtle lg:bg-surface-raised"
          role="tabpanel"
          aria-label={selectedProject ? `Details for ${selectedProject.name}` : 'Project details'}
        >
          {selectedProject && (() => {
      const project = selectedProject
      const isBusy = busyProject === project.id
      const revealed = revealedKeys[project.id]
      return (
        <Card key={project.id} className="overflow-hidden rounded-none border-0 p-0 shadow-none lg:min-h-full">
          <div className="flex flex-col gap-2 border-b border-edge-subtle bg-surface-raised px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                {renamingId === project.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      void onSubmitRename(project.id)
                    }}
                    className="flex items-center gap-1.5"
                  >
                    {/* Native <input> instead of the labelled <Input>
                        primitive because we're editing inline next
                        to the project header — a labelled field
                        would shove the row's metadata down a line
                        and break the scannable card silhouette. */}
                    <input
                      autoFocus
                      type="text"
                      value={renameDraft}
                      maxLength={120}
                      onChange={(e) => onRenameDraftChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          onCancelRename()
                        }
                      }}
                      disabled={renamingProject}
                      aria-label={`Rename ${project.name}`}
                      className="rounded-sm border border-edge bg-surface-root px-2 py-1 text-sm text-fg placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:opacity-60"
                    />
                    <Btn
                      type="submit"
                      size="sm"
                      disabled={
                        renamingProject ||
                        !renameDraft.trim() ||
                        renameDraft.trim() === project.name
                      }
                      loading={renamingProject}
                      aria-label="Save project name"
                      title="Save project name"
                      className="px-2"
                    >
                      <IconCheck />
                    </Btn>
                    <Btn
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={onCancelRename}
                      disabled={renamingProject}
                      aria-label="Cancel rename"
                      title="Cancel"
                      className="px-2"
                    >
                      <IconClose />
                    </Btn>
                  </form>
                ) : (
                  <div className="flex items-center gap-2 min-w-0">
                    <ProjectFavicon
                      project_id={project.id}
                      project_name={project.name}
                      project_slug={project.slug}
                      sdk_origin={sdkOriginFromApiKeys(project.api_keys)}
                      repo_url={project.primary_repo?.repo_url ?? null}
                      size={16}
                    />
                    <h3 className="truncate text-base font-semibold text-fg">{project.name}</h3>
                  </div>
                )}
                <span className="inline-flex items-center gap-1">
                  <span title="Reports, Fixes, Dashboard, and other pages are filtered to this project.">
                    <SignalChip tone="brand" className="normal-case tracking-normal">
                      Active
                    </SignalChip>
                  </span>
                  <ConfigHelp helpId="projects.active_project" />
                </span>
                <SignalChip tone="neutral" className="font-mono text-2xs">
                  {project.slug}
                </SignalChip>
                {project.pdca_bottleneck && project.pdca_bottleneck_label && (
                  <Link
                    to={bottleneckDeepLink(
                      project.pdca_bottleneck,
                      project.id,
                      project.pdca_bottleneck_label,
                    )}
                    className="inline-flex max-w-full min-w-0 items-center gap-1 truncate rounded-sm bg-warn-muted px-2 py-0.5 text-2xs font-medium text-warning-foreground hover:opacity-90 motion-safe:transition-opacity"
                    title={`${project.pdca_bottleneck_label} — open to fix`}
                  >
                    {bottleneckHumanHeadline({
                      stage: project.pdca_bottleneck,
                      label: project.pdca_bottleneck_label,
                      count: project.pdca_bottleneck_count,
                    })}
                  </Link>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1 sm:justify-end">
              {canDeleteProject(project) && renamingId !== project.id && (
                <Btn
                  variant="ghost"
                  size="sm"
                        onClick={() => onStartRename(project)}
                  disabled={isBusy || renamingProject}
                  aria-label={`Rename ${project.name}`}
                  title={`Rename ${project.name}. Doesn't change the project slug or any URLs.`}
                  className="px-2"
                >
                  <IconPencil />
                </Btn>
              )}
              <Tooltip content="Reports">
                <Link
                  to={`/reports?project=${project.id}`}
                  className={LINK_CHIP_CLASS}
                  aria-label={`Reports for ${project.name}`}
                >
                  <IconReports />
                </Link>
              </Tooltip>
              <Tooltip content="Integrations">
                <Link
                  to={`/integrations/config?project=${project.id}`}
                  className={LINK_CHIP_CLASS}
                  aria-label={`Integrations for ${project.name}`}
                >
                  <IconIntegrations />
                </Link>
              </Tooltip>
              <Tooltip content="Settings">
                <Link
                  to={`/settings?project=${project.id}`}
                  className={LINK_CHIP_CLASS}
                  aria-label={`Settings for ${project.name}`}
                >
                  <IconSettings />
                </Link>
              </Tooltip>
              <Tooltip content="Send test report (ingest only — does not mark SDK installed)">
                <Btn
                  variant="ghost"
                  size="sm"
                        onClick={() => onSendTestReport(project.id, project.name)}
                  disabled={isBusy}
                  aria-label={`Send test report for ${project.name}`}
                  className="px-2"
                >
                  <IconSend />
                </Btn>
              </Tooltip>
              <div className="flex items-center gap-1" data-testid={`mint-key-${project.id}`}>
                <label htmlFor={`key-scope-${project.id}`} className="sr-only">
                  API key scope for {project.name}
                </label>
                <ConfigHelp helpId="projects.api_key_scope" />
                <select
                  id={`key-scope-${project.id}`}
                  data-testid={`key-scope-${project.id}`}
                  className="text-2xs bg-surface-raised border border-edge rounded-sm px-2 py-1 text-fg-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
                  value={keyScopePreset[project.id] ?? 'sdk'}
                  onChange={(e) =>
                    onKeyScopePresetChange(project.id, e.target.value as ScopePresetId)
                  }
                  disabled={isBusy}
                  title={
                    SCOPE_PRESETS.find((p) => p.id === (keyScopePreset[project.id] ?? 'sdk'))
                      ?.hint
                  }
                >
                  {SCOPE_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <Tooltip content="Generate API key">
                  <Btn
                    variant="ghost"
                    size="sm"
                          onClick={() => onGenerateKey(project.id)}
                    disabled={isBusy}
                    loading={isBusy}
                    data-testid={`generate-key-${project.id}`}
                    aria-label={`Generate API key for ${project.name}`}
                    className="px-2"
                  >
                    <IconKey />
                  </Btn>
                </Tooltip>
              </div>
              {/* Destructive last in tab order on purpose. Gated to
                  org owner/admin (or legacy direct owner). Members and
                  viewers don't see the button at all so they can't
                  even attempt the action — backend mirrors this with
                  a 403, but hiding it is better UX than letting them
                  click and bounce. */}
              {canDeleteProject(project) && (
                <Btn
                  variant="ghost"
                  size="sm"
                  onClick={() => onRequestDelete(project)}
                  disabled={isBusy}
                  data-testid={`delete-project-${project.id}`}
                  aria-label={`Delete ${project.name}`}
                  // Inline danger tone — only flips on hover so the
                  // row's neutral chrome stays calm at rest.
                  className="px-2 text-fg-secondary hover:text-danger hover:bg-danger-muted/15 hover:border-danger/30"
                  title={`Delete ${project.name} and every report, key, and integration tied to it. You'll get an Undo window.`}
                >
                  <IconTrash />
                </Btn>
              )}
            </div>
          </div>

          <div className="space-y-3 px-3 py-3">
            <ProjectMetricsRail project={project} />
            <ProjectContextRail project={project} />
            {project.pdca_bottleneck && project.pdca_bottleneck_label && (
              <ProjectBottleneckCard
                projectId={project.id}
                stage={project.pdca_bottleneck}
                label={project.pdca_bottleneck_label}
                count={project.pdca_bottleneck_count}
                failedFixesPreview={project.failed_fixes_preview}
              />
            )}
          </div>

          {revealed && (
            <div className="px-3 pb-3">
              <RevealedKeyCard
                projectId={project.id}
                projectName={project.name}
                projectSlug={project.slug}
                apiKey={revealed.key}
                scopes={revealed.scopes}
                onDismiss={() =>
                  onDismissRevealedKey(project.id)
                }
              />
            </div>
          )}

          {/* SDK CONNECTIVITY HEALTH — primary diagnostic surface for
              "I generated a key 4 days ago, why am I seeing 0 reports?"
              Renders only when at least one key exists, since pre-key
              state already has the "Generate key" CTA above; before
              that the card would just say "no key" and double up. */}
          {project.api_keys.length > 0 && (
            <div className="px-3 pb-3 space-y-3">
              <SdkHealthSummary
                projectId={project.id}
                projectName={project.name}
                projectSlug={project.slug}
                apiKeys={project.api_keys}
                lastReportAt={project.last_report_at}
                adminHost={adminHost}
                reportCount={project.report_count}
                compact
                      onTestReportSent={onReload}
              />
              {project.sdk_status && project.sdk_version && (
                <SdkUpgradeCTA
                  status={project.sdk_status}
                  package_={project.sdk_package ?? null}
                  observedVersion={project.sdk_version}
                  latestVersion={project.sdk_latest_version ?? null}
                  stackLabel={project.slug}
                  compact
                  projectId={project.primary_repo ? project.id : null}
                />
              )}
              <VerifySetupPanel
                projectId={project.id}
                projectName={project.name}
                adminHost={adminHost}
                compact
              />
            </div>
          )}

          {project.api_keys.length > 0 && (() => {
            // Hide keys that are mid-revoke (in their undo window) so
            // the row reads as if the action already succeeded. The
            // active count likewise drops by the number of pending
            // revokes — otherwise the disclosure header lies about
            // how many keys are live.
            const visibleKeys = project.api_keys.filter(
              (k) => !pendingRevokeIds.has(`${project.id}:${k.id}`),
            )
            if (visibleKeys.length === 0) return null
            const visibleActiveCount = visibleKeys.filter(
              (k) => !k.revoked,
            ).length
            return (
              <details className="mx-3 mb-3 mt-0 border-t border-edge-subtle pt-2">
                <summary className="cursor-pointer select-none list-none">
                  <span title={`${visibleKeys.length} keys · ${visibleActiveCount} active`}>
                    <SignalChip tone="neutral" className="hover:text-fg">
                      Keys ({visibleActiveCount})
                    </SignalChip>
                  </span>
                </summary>
                <div className="mt-2 space-y-1">
                  {visibleKeys.map((key) => (
                    <div
                      key={key.id}
                      className="flex items-center justify-between text-2xs gap-2"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <SignalChip
                          tone={key.revoked ? 'neutral' : 'brand'}
                          className={`font-mono ${key.revoked ? 'line-through opacity-60' : ''}`}
                        >
                          {key.key_prefix}…
                        </SignalChip>
                        {(key.scopes ?? []).map((s) => (
                          <Badge key={s} className={scopeBadgeTone(s)}>
                            {s}
                          </Badge>
                        ))}
                        <InlineProof className="border-0 bg-transparent px-0 py-0 text-2xs">
                          created {relativeTime(key.created_at)}
                        </InlineProof>
                        {key.revoked && (
                          <Badge className="bg-surface-overlay text-fg-faint">revoked</Badge>
                        )}
                      </div>
                      {!key.revoked && (
                        <Btn
                          variant="ghost"
                          size="sm"
                          onClick={() => onRequestRevokeKey(project.id, key.id, key.key_prefix)}
                          aria-label={`Revoke key ${key.key_prefix}`}
                          title={`Revoke key starting with ${key.key_prefix}…. You'll get an Undo window.`}
                          className="px-2 text-fg-secondary hover:text-danger hover:bg-danger-muted/15"
                        >
                          <IconTrash />
                        </Btn>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )
          })()}

          {/* Per-project SDK CONFIGURATOR + install snippet. Stays
              collapsed by default so the row remains scannable when
              the user is just managing keys, but the disclosure
              header is now full-width with an icon + descriptive
              sub-line so the eye actually catches it (the previous
              tiny "SDK install snippet" link looked identical to
              the keys row above and was getting missed). */}
          {/* SDK configurator defaults open in the folder-tab panel.
              Override map clears when activeProjectId changes so tab
              switches reset manual collapse state. */}
          <details
            className="mt-3 border-t border-edge-subtle px-3 pt-3 group"
            data-testid={`sdk-configurator-${project.id}`}
            open={sdkOpenOverride[project.id] ?? true}
            onToggle={(e) => {
              const nextOpen = (e.currentTarget as HTMLDetailsElement).open
              onSdkOpenOverrideChange(project.id, nextOpen)
            }}
          >
            <summary className="cursor-pointer select-none list-none flex items-center justify-between gap-2 px-2 py-1.5 -mx-2 rounded-sm hover:bg-surface-overlay transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                <span aria-hidden="true" className="text-fg-muted text-xs">
                  {'\u{1F41B}'}
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-fg">
                    Preview, configure & install the SDK widget
                  </div>
                  <div className="text-2xs">
                    <InlineProof className="border-0 bg-transparent px-0 py-0">
                      Live mock preview · 4-corner position picker · theme · capture flags · auto-updating snippet
                    </InlineProof>
                  </div>
                </div>
              </div>
              <span
                aria-hidden="true"
                className="text-2xs text-fg-faint group-open:rotate-90 motion-safe:transition-transform"
              >
                ›
              </span>
            </summary>
            <div className="mt-3">
              {/* Pass `revealed?.key` so the snippet shows the real,
                  just-minted plaintext key instead of the `mushi_xxx`
                  placeholder. `revealed` is the same value the
                  RevealedKeyCard above uses, so the user can copy the
                  snippet without manually replacing a placeholder
                  whose actual value is sitting on screen literally
                  inches above. Once the user dismisses the reveal
                  (or reloads), `revealed` becomes undefined and the
                  card cleanly falls back to the placeholder — which
                  is what we want, since we don't persist plaintext. */}
              <SdkInstallCard projectId={project.id} projectSlug={project.slug} apiKey={revealed?.key} compact />
              <div className="mt-4 border-t border-edge-subtle pt-4">
                <AssistantConfigCard projectId={project.id} />
              </div>
              <div className="mt-4 border-t border-edge-subtle pt-4">
                <IdentitySecretCard projectId={project.id} projectSlug={project.slug} />
              </div>
            </div>
          </details>
        </Card>
      )
    })()}
        </div>
      </div>
    )}
  </Section>
  )
}

type MetricTone = 'reports' | 'keys' | 'members' | 'activity' | 'created' | 'sdk'

const METRIC_TONE: Record<
  MetricTone,
  { icon: string; value: string }
> = {
  reports: {
    icon: CHIP_TONE.infoSubtle,
    value: 'text-info',
  },
  keys: {
    icon: CHIP_TONE.warnSubtle,
    value: 'text-warn',
  },
  members: {
    icon: CHIP_TONE.brand,
    value: 'text-brand',
  },
  activity: {
    icon: CHIP_TONE.okSubtle,
    value: 'text-ok',
  },
  created: {
    icon: 'bg-surface-overlay text-fg-muted',
    value: 'text-fg',
  },
  sdk: {
    icon: CHIP_TONE.accentSubtle,
    value: 'text-fg',
  },
}

/** Compact KPI strip — one row, color-accent values, dividers between tiles. */
function ProjectMetricsRail({ project }: { project: Project }) {
  const hasSdk = project.sdk_status && project.sdk_status !== 'unknown'

  return (
    <div className="overflow-hidden rounded-md border border-edge-subtle bg-surface-raised">
      <div
        className={`grid grid-cols-2 gap-px bg-edge-subtle sm:grid-cols-3 ${
          hasSdk ? 'lg:grid-cols-6' : 'lg:grid-cols-5'
        }`}
      >
        <MetricTile
          tone="reports"
          icon={<IconReports className="h-3.5 w-3.5" />}
          label="Reports"
          value={project.report_count.toLocaleString()}
        />
        <MetricTile
          tone="keys"
          icon={<IconKey className="h-3.5 w-3.5" />}
          label="Keys"
          value={String(project.active_key_count)}
          hint="Active API keys"
        />
        <MetricTile
          tone="members"
          icon={<IconUser className="h-3.5 w-3.5" />}
          label="Members"
          value={String(project.member_count)}
        />
        <MetricTile
          tone="activity"
          icon={<IconClock className="h-3.5 w-3.5" />}
          label="Last report"
          value={relativeTime(project.last_report_at)}
          title={project.last_report_at ? new Date(project.last_report_at).toLocaleString() : 'No reports yet'}
        />
        <MetricTile
          tone="created"
          icon={<IconClock className="h-3.5 w-3.5" />}
          label="Created"
          value={new Date(project.created_at).toLocaleDateString()}
        />
        {hasSdk && (
          <MetricTile
            tone="sdk"
            icon={<IconGauge className="h-3.5 w-3.5" />}
            label="SDK"
            value={
              <SdkVersionBadge
                status={project.sdk_status!}
                package_={project.sdk_package ?? null}
                observedVersion={project.sdk_version ?? null}
                latestVersion={project.sdk_latest_version ?? null}
                deprecationMessage={project.sdk_deprecation_message ?? null}
                compact
              />
            }
            compactValue
          />
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 border-t border-edge-subtle bg-surface-overlay px-3 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-3">
        <span
          className="inline-flex shrink-0 items-center gap-1.5 text-2xs font-medium text-fg-muted"
          title="Paste as MUSHI_PROJECT_ID in .env.local or CI"
        >
          <IconTerminal className="h-4 w-4 text-fg-faint" />
          Project ID
        </span>
        <ProjectIdCopy projectId={project.id} />
      </div>
    </div>
  )
}

function MetricTile({
  tone,
  icon,
  label,
  value,
  hint,
  title,
  compactValue,
}: {
  tone: MetricTone
  icon: ReactNode
  label: string
  value: ReactNode
  hint?: string
  title?: string
  compactValue?: boolean
}) {
  const styles = METRIC_TONE[tone]
  return (
    <div
      className="flex min-w-0 flex-col gap-0.5 bg-surface-raised px-3 py-2.5"
      title={title ?? hint}
    >
      <div className="inline-flex min-w-0 items-center gap-1.5 text-2xs font-medium text-fg-muted">
        <span className={`inline-flex shrink-0 items-center justify-center rounded p-0.5 ${styles.icon}`}>
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </div>
      <div
        className={
          compactValue
            ? 'mt-0.5 min-w-0'
            : `truncate font-mono text-lg font-semibold tabular-nums leading-tight ${styles.value}`
        }
      >
        {value}
      </div>
    </div>
  )
}

/**
 * Per-project context rail — repo, index, trend, severity, and integrations
 * in one horizontal strip inside a ContainedBlock. Icon-led items use the
 * full card width instead of a left-piled grid of gray boxes.
 */
function ProjectContextRail({ project }: { project: Project }) {
  const repo = project.primary_repo
  const repoLabel = shortRepoLabel(repo?.repo_url ?? null)
  const sev = project.severity_breakdown_30d
  const sevTotal = sev?.total ?? 0
  const planTier = (project.plan_tier ?? '').trim()
  const region = (project.data_residency_region ?? '').trim()
  const indexedFiles = project.indexed_file_count ?? 0
  const extraRepos = (project.repos?.length ?? 0) - (repo ? 1 : 0)
  const trend = project.trend_7d
  const sentryConnected = !!project.sentry_connected
  const sentryReports = project.sentry_connected_reports_30d ?? 0
  // Trend chip is meaningful when there's been any meaningful traffic
  // — we hide it for the typical "no reports yet" case rather than
  // rendering a `flat 0 vs 0` chip that adds noise without signal.
  const showTrend =
    trend && (trend.last7d > 0 || trend.prev7d > 0) && trend.direction !== 'flat'

  const hasAnything =
    !!repo ||
    indexedFiles > 0 ||
    sevTotal > 0 ||
    planTier.length > 0 ||
    region.length > 0 ||
    showTrend ||
    sentryConnected
  if (!hasAnything) return null

  const health = repo ? indexHealth(repo) : null
  const indexHint = (() => {
    if (!repo) return undefined
    const lastIso = repo.last_indexed_at
    const attemptIso = repo.last_index_attempt_at
    if (health === 'failed') {
      const trimmed = (repo.last_index_error ?? '').slice(0, 220)
      return `Last index attempt failed${attemptIso ? ` (${relativeTime(attemptIso)})` : ''}.${
        trimmed ? `\n\n${trimmed}` : ''
      }`
    }
    if (health === 'off') return 'Indexing is disabled for this repo. Enable it in Settings to power codebase-aware triage and fix suggestions.'
    if (health === 'never') return 'Repo connected but no successful index pass yet. The first index runs in the background.'
    if (health === 'stale') return `Last successful index ${relativeTime(lastIso)}. Codebase-aware features may be using stale context.`
    return `Indexed ${relativeTime(lastIso)}.`
  })()

  return (
    <div className="overflow-hidden rounded-md border border-edge-subtle bg-surface-raised text-xs">
      {repo && repoLabel && (
        <ContextDetailRow label="Repository" icon={<IconGit className="h-4 w-4" />}>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {repo.repo_url ? (
                <a
                  href={repo.repo_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="truncate font-mono text-sm text-fg hover:underline"
                  title={`Open ${repoLabel} on GitHub`}
                >
                  {repoLabel}
                </a>
              ) : (
                <span className="truncate font-mono text-sm text-fg">{repoLabel}</span>
              )}
              {repo.repo_url && <IconExternalLink className="h-3.5 w-3.5 shrink-0 text-fg-faint" />}
            </span>
            {repo.default_branch && (
              <>
                <ContextDivider />
                <SignalChip tone="neutral" className="font-mono uppercase">
                  {repo.default_branch}
                </SignalChip>
              </>
            )}
            {health && (
              <>
                <ContextDivider />
                <span
                  title={
                    health === 'ok' && repo.last_indexed_at
                      ? `${indexHint ?? ''} · ${relativeTime(repo.last_indexed_at)}`
                      : indexHint
                  }
                >
                  <SignalChip tone={INDEX_HEALTH_CHIP_TONE[health]}>
                    {INDEX_HEALTH_LABEL[health]}
                  </SignalChip>
                </span>
              </>
            )}
            {extraRepos > 0 && (
              <>
                <ContextDivider />
                <span className="shrink-0 text-fg-muted">
                  +{extraRepos} {extraRepos === 1 ? 'repo' : 'repos'}
                </span>
              </>
            )}
            {repo.github_app_connected && (
              <>
                <ContextDivider />
                <SignalChip tone="info">GitHub</SignalChip>
              </>
            )}
          </div>
        </ContextDetailRow>
      )}

      {indexedFiles > 0 && (
        <ContextDetailRow label="Code index" icon={<IconStorage className="h-4 w-4" />}>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <span title={`${indexedFiles.toLocaleString()} indexed source files`}>
              <span className="font-mono text-sm text-fg">{indexedFiles.toLocaleString()}</span>{' '}
              <span className="text-fg-secondary">{pluralize(indexedFiles, 'file')}</span>
            </span>
            <ContextDivider />
            <Link
              to={`/explore?project=${project.id}`}
              className="inline-flex items-center gap-1 rounded-sm border border-edge-subtle bg-surface-overlay px-2 py-0.5 text-2xs text-fg-secondary transition-colors hover:border-edge hover:bg-surface-raised hover:text-fg"
              title="Open codebase atlas"
              onClick={(e) => e.stopPropagation()}
            >
              <IconExplore className="h-3 w-3" />
              Explore
            </Link>
          </div>
        </ContextDetailRow>
      )}

      {showTrend && trend && (
        <ContextDetailRow label="7-day trend" icon={<IconGauge className="h-4 w-4" />}>
          <span title={`${trend.last7d} reports last 7d vs ${trend.prev7d} prior week`}>
            <SignalChip
              tone={trend.direction === 'up' ? 'warn' : 'ok'}
              className="font-mono tabular-nums"
            >
              {trend.direction === 'up' ? '↑' : '↓'} {Math.abs(trend.delta)}
            </SignalChip>
          </span>
        </ContextDetailRow>
      )}

      {sevTotal > 0 && sev && (
        <ContextDetailRow label="Last 30 days" icon={<IconReports className="h-4 w-4" />}>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {sev.critical > 0 && (
              <span title={`${sev.critical} critical reports (30d)`}>
                <SignalChip tone="danger">Crit {sev.critical}</SignalChip>
              </span>
            )}
            {sev.major > 0 && (
              <span title={`${sev.major} major reports (30d)`}>
                <SignalChip tone="warn">Major {sev.major}</SignalChip>
              </span>
            )}
            {sev.minor > 0 && (
              <span title={`${sev.minor} minor reports (30d)`}>
                <SignalChip tone="info">Minor {sev.minor}</SignalChip>
              </span>
            )}
            {sev.trivial > 0 && (
              <span title={`${sev.trivial} trivial reports (30d)`}>
                <SignalChip tone="neutral">Low {sev.trivial}</SignalChip>
              </span>
            )}
          </div>
        </ContextDetailRow>
      )}

      {(planTier || region || sentryConnected) && (
        <ContextDetailRow label="Integrations" icon={<IconIntegrations className="h-4 w-4" />}>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {planTier && planTier !== 'free' && (
              <Badge className={`border border-brand/20 capitalize ${CHIP_TONE.brand}`}>
                {planTier}
              </Badge>
            )}
            {region && (
              <Badge className="border border-edge-subtle bg-surface-overlay uppercase text-fg-muted">
                {region}
              </Badge>
            )}
            {sentryConnected && (
              <Badge
                className={`inline-flex items-center gap-1 border border-accent/30 ${CHIP_TONE.accentSubtle}`}
                title={
                  sentryReports > 0
                    ? `${sentryReports} report${sentryReports === 1 ? '' : 's'} with Sentry trace in the last 30 days`
                    : 'Sentry SDK detected on the host app'
                }
              >
                Sentry
              </Badge>
            )}
          </div>
        </ContextDetailRow>
      )}
    </div>
  )
}

function ContextDivider() {
  return <span className="hidden h-4 w-px shrink-0 bg-edge-subtle sm:inline-block" aria-hidden />
}

function ContextDetailRow({
  label,
  icon,
  children,
}: {
  label: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid grid-cols-1 gap-2 border-t border-edge-subtle px-3 py-2.5 first:border-t-0 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:items-center sm:gap-4">
      <div className="inline-flex min-w-0 items-center gap-2 text-2xs font-semibold text-fg-muted">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-overlay text-fg-muted">
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </div>
      <div className="min-w-0 text-fg-secondary">{children}</div>
    </div>
  )
}

function ProjectIdCopy({ projectId }: { projectId: string }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(projectId)
      setCopied(true)
      toast.success('Project ID copied — paste it as MUSHI_PROJECT_ID.')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Clipboard blocked — select the ID and copy manually.')
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm transition-colors group hover:opacity-95"
      title="Copy project ID — paste as MUSHI_PROJECT_ID in .env.local or .cursor/mcp.json"
      data-testid={`project-id-chip-${projectId}`}
      aria-label={`Copy project ID: ${projectId}`}
    >
      <CodeInline className="min-w-0 max-w-full cursor-pointer break-all group-hover:border-edge">
        <span className="tabular-nums">{projectId}</span>
      </CodeInline>
      <span className="shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" aria-hidden="true">
        {copied
          ? <IconCheck className="h-2.5 w-2.5 text-ok" />
          : <IconCopy className="h-2.5 w-2.5 text-fg-faint" />
        }
      </span>
    </button>
  )
}
