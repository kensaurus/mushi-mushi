/**
 * FILE: apps/admin/src/components/projects/ProjectFolderTabRail.tsx
 * PURPOSE: Folder-style project picker for the Projects list tab — vertical
 *          tabs on desktop (Finder-like), horizontal scroll chips on compact.
 */

import { Link } from 'react-router-dom'
import { Badge } from '../ui'
import { SignalChip } from '../report-detail/ReportSurface'
import { ProjectFavicon } from '../ProjectFavicon'
import { sdkOriginFromApiKeys } from '../../lib/resolveProjectDomain'
import {
  bottleneckDeepLink,
  bottleneckHumanHeadline,
} from '../../lib/pdcaBottleneck'
import type { PdcaStageId } from '../../lib/pdca'
import type { SdkStatus } from '../SdkVersionBadge'
import { CHIP_TONE } from '../../lib/chipTone'
import {
  HEARTBEAT_HINT,
  HEARTBEAT_LABEL,
  heartbeatStateFromKeys,
  type HeartbeatState,
} from '../../lib/heartbeat'

export interface ProjectFolderTabItem {
  id: string
  name: string
  slug: string
  report_count: number
  active_key_count: number
  member_count?: number
  last_report_at?: string | null
  indexed_file_count?: number
  plan_tier?: string | null
  primary_repo?: { repo_url: string | null; default_branch?: string | null } | null
  trend_7d?: { direction: 'up' | 'down' | 'flat'; delta: number; last7d?: number }
  api_keys: Array<{
    last_seen_at?: string | null
    last_seen_origin?: string | null
    is_active?: boolean
    revoked?: boolean
  }>
  sdk_status?: SdkStatus
  sdk_version?: string | null
  sdk_package?: string | null
  pdca_bottleneck?: PdcaStageId | null
  pdca_bottleneck_label?: string | null
  pdca_bottleneck_count?: number | null
  severity_breakdown_30d?: { critical: number }
}

interface ProjectFolderTabRailProps {
  projects: readonly ProjectFolderTabItem[]
  activeId: string | null
  onSelect: (projectId: string, name: string) => void
}

/**
 * Connectivity is a recency question, not a boolean one. This used to be
 * `some(key => Boolean(key.last_seen_at))`, which reported a project whose SDK
 * last checked in six months ago as identical to one that checked in a minute
 * ago. See lib/heartbeat.ts for the window definitions.
 */
function projectHeartbeat(project: ProjectFolderTabItem): HeartbeatState {
  return heartbeatStateFromKeys(project.api_keys)
}

function shortRepoLabel(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const trimmed = u.pathname.replace(/^\/+/, '').replace(/\.git$/, '')
    return trimmed || u.host
  } catch {
    return url
  }
}

function relativeShort(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 86_400_000) return `${Math.max(1, Math.floor(ms / 3_600_000))}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

function projectStatusDot(project: ProjectFolderTabItem): string {
  const critical = project.severity_breakdown_30d?.critical ?? 0
  if (critical > 0) return 'bg-danger'
  if (project.sdk_status === 'deprecated' || project.sdk_status === 'outdated') return 'bg-warn'

  switch (projectHeartbeat(project)) {
    case 'fresh':
      return 'bg-ok'
    case 'stale':
      return 'bg-warn'
    case 'dead':
    case 'never':
      return 'bg-fg-faint'
    case 'unknown':
      break
  }

  // Payload carried no `api_keys` field at all — fall back to the legacy
  // report-count read rather than inventing a connectivity verdict.
  if (project.report_count > 0) return 'bg-warn'
  if (project.active_key_count > 0) return 'bg-warn'
  return 'bg-fg-faint'
}

function faviconSource(project: ProjectFolderTabItem) {
  return {
    project_id: project.id,
    project_name: project.name,
    project_slug: project.slug,
    sdk_origin: sdkOriginFromApiKeys(project.api_keys),
    repo_url: project.primary_repo?.repo_url ?? null,
  }
}

function ProjectMetaRow({ project }: { project: ProjectFolderTabItem }) {
  const critical = project.severity_breakdown_30d?.critical ?? 0
  const heartbeat = projectHeartbeat(project)
  const repoLabel = shortRepoLabel(project.primary_repo?.repo_url ?? null)
  const trend = project.trend_7d
  const showTrend =
    trend && trend.direction !== 'flat' && (trend.last7d ?? 0) + Math.abs(trend.delta) > 0

  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      {repoLabel ? (
        <span className="truncate font-mono text-3xs text-fg-muted" title={repoLabel}>
          {repoLabel}
        </span>
      ) : null}
      {project.indexed_file_count != null && project.indexed_file_count > 0 ? (
        <span className="text-3xs text-fg-muted tabular-nums">{project.indexed_file_count} idx</span>
      ) : null}
      {project.plan_tier ? (
        <Badge className="bg-surface-overlay text-fg-muted border border-edge-subtle text-3xs px-1 py-0 capitalize">
          {project.plan_tier}
        </Badge>
      ) : null}
      {project.sdk_version && project.sdk_status && project.sdk_status !== 'unknown' ? (
        <span className="font-mono text-2xs text-fg-muted">v{project.sdk_version}</span>
      ) : null}
      {showTrend && trend ? (
        <SignalChip
          tone={trend.direction === 'up' ? 'warn' : 'ok'}
          className="text-3xs normal-case tracking-normal tabular-nums"
        >
          {trend.direction === 'up' ? '+' : '−'}
          {Math.abs(trend.delta)} 7d
        </SignalChip>
      ) : null}
      {critical > 0 ? (
        <Badge className={`${CHIP_TONE.dangerSubtle} text-3xs px-1 py-0`}>
          {critical} critical
        </Badge>
      ) : null}
      {/* Previously gated on `active_key_count > 0`, which silenced the chip
          for projects with zero active keys — the single most disconnected
          state there is. Those now warn loudest. */}
      {heartbeat !== 'fresh' && heartbeat !== 'unknown' ? (
        <SignalChip
          tone="warn"
          className="text-3xs normal-case tracking-normal"
          title={HEARTBEAT_HINT[heartbeat]}
        >
          {HEARTBEAT_LABEL[heartbeat]}
        </SignalChip>
      ) : null}
      {project.pdca_bottleneck && project.pdca_bottleneck_label ? (
        <Link
          to={bottleneckDeepLink(
            project.pdca_bottleneck,
            project.id,
            project.pdca_bottleneck_label,
          )}
          onClick={(e) => e.stopPropagation()}
          className="truncate text-3xs font-medium text-warn hover:underline underline-offset-2"
          title={project.pdca_bottleneck_label}
        >
          {bottleneckHumanHeadline({
            stage: project.pdca_bottleneck,
            label: project.pdca_bottleneck_label,
            count: project.pdca_bottleneck_count,
          })}
        </Link>
      ) : null}
    </span>
  )
}

function FolderTabButton({
  project,
  isActive,
  onSelect,
  layout,
}: {
  project: ProjectFolderTabItem
  isActive: boolean
  onSelect: (projectId: string, name: string) => void
  layout: 'vertical' | 'horizontal'
}) {
  const dot = projectStatusDot(project)
  const source = faviconSource(project)
  const lastReport = relativeShort(project.last_report_at)

  if (layout === 'horizontal') {
    return (
      <button
        type="button"
        aria-current={isActive ? 'true' : undefined}
        onClick={() => onSelect(project.id, project.name)}
        className={[
          'inline-flex shrink-0 max-w-56 items-center gap-2 rounded-md border px-2.5 py-2 text-left',
          'motion-safe:transition-[transform,opacity]',
          isActive
            ? 'border-brand/50 bg-surface-raised ring-1 ring-brand/25 shadow-sm'
            : 'border-edge-subtle bg-surface-raised hover:border-edge hover:bg-surface-overlay',
        ].join(' ')}
        title={project.name}
      >
        <ProjectFavicon {...source} size={14} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-fg">{project.name}</span>
          <ProjectMetaRow project={project} />
        </span>
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`}
        />
      </button>
    )
  }

  return (
    <button
      type="button"
      aria-current={isActive ? 'true' : undefined}
      onClick={() => onSelect(project.id, project.name)}
      className={[
        'group flex w-full min-w-0 items-start gap-2 rounded-l-md px-2.5 py-2.5 text-left',
        'motion-safe:transition-[transform,opacity]',
        isActive
          ? 'relative z-10 -mr-px border border-brand/25 border-r-0 border-l-[3px] border-l-brand bg-surface-raised shadow-sm'
          : 'border border-transparent border-l-[3px] border-l-transparent hover:bg-surface-overlay',
      ].join(' ')}
      title={project.name}
    >
      <ProjectFavicon {...source} size={16} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-fg">{project.name}</span>
        <span className="mt-0.5 block truncate font-mono text-2xs text-fg-muted">{project.slug}</span>
        <span className="mt-1 inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs text-fg-secondary">
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
          <span className="tabular-nums">{project.report_count.toLocaleString()} reports</span>
          {project.member_count != null && project.member_count > 0 ? (
            <>
              <span className="text-fg-faint">·</span>
              <span className="tabular-nums">{project.member_count} member{project.member_count === 1 ? '' : 's'}</span>
            </>
          ) : null}
          {lastReport ? (
            <>
              <span className="text-fg-faint">·</span>
              <span>{lastReport}</span>
            </>
          ) : null}
        </span>
        <ProjectMetaRow project={project} />
      </span>
    </button>
  )
}

export function ProjectFolderTabRail({ projects, activeId, onSelect }: ProjectFolderTabRailProps) {
  if (projects.length === 0) return null

  return (
    <>
      <nav
        aria-label="Projects"
        className="flex gap-1.5 overflow-x-auto pb-2 lg:hidden"
      >
        {projects.map((project) => (
          <FolderTabButton
            key={project.id}
            project={project}
            isActive={project.id === activeId}
            onSelect={onSelect}
            layout="horizontal"
          />
        ))}
      </nav>

      {/* mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas) */}
      <div className="hidden shrink-0 lg:sticky lg:top-3 lg:z-10 lg:block lg:max-h-[calc(100dvh-5.5rem)] lg:w-56 lg:self-start lg:overflow-y-auto lg:overscroll-y-contain">
        <nav
          aria-label="Projects"
          className="flex flex-col gap-0.5 border-r border-edge-subtle bg-surface-root/50 p-1.5"
        >
          <p className="px-2 pb-1 pt-0.5 text-2xs font-semibold text-fg-muted">
            Projects
          </p>
          {projects.map((project) => (
            <FolderTabButton
              key={project.id}
              project={project}
              isActive={project.id === activeId}
              onSelect={onSelect}
              layout="vertical"
            />
          ))}
        </nav>
      </div>
    </>
  )
}
