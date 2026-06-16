/**
 * FILE: apps/admin/src/components/projects/ProjectFolderTabRail.tsx
 * PURPOSE: Folder-style project picker for the Projects list tab — vertical
 *          tabs on desktop (Finder-like), horizontal scroll chips on compact.
 */

import { ProjectFavicon } from '../ProjectFavicon'
import { sdkOriginFromApiKeys } from '../../lib/resolveProjectDomain'

export interface ProjectFolderTabItem {
  id: string
  name: string
  slug: string
  report_count: number
  active_key_count: number
  api_keys: Array<{
    last_seen_at?: string | null
    last_seen_origin?: string | null
    is_active?: boolean
    revoked?: boolean
  }>
}

interface ProjectFolderTabRailProps {
  projects: readonly ProjectFolderTabItem[]
  activeId: string | null
  onSelect: (projectId: string, name: string) => void
}

function projectStatusDot(project: ProjectFolderTabItem): string {
  if (project.report_count > 0) return 'bg-ok'
  if (project.active_key_count > 0) return 'bg-warn'
  return 'bg-fg-faint'
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

  if (layout === 'horizontal') {
    return (
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        onClick={() => onSelect(project.id, project.name)}
        className={[
          'inline-flex shrink-0 max-w-[14rem] items-center gap-2 rounded-md border px-2.5 py-2 text-left',
          'motion-safe:transition-[background-color,border-color,box-shadow]',
          isActive
            ? 'border-brand/50 bg-surface-raised ring-1 ring-brand/25 shadow-sm'
            : 'border-edge-subtle bg-surface-raised hover:border-edge hover:bg-surface-overlay',
        ].join(' ')}
        title={project.name}
      >
        <ProjectFavicon
          project_id={project.id}
          project_name={project.name}
          project_slug={project.slug}
          sdk_origin={sdkOriginFromApiKeys(project.api_keys)}
          size={14}
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg">{project.name}</span>
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
      role="tab"
      aria-selected={isActive}
      onClick={() => onSelect(project.id, project.name)}
      className={[
        'group flex w-full min-w-0 items-start gap-2 rounded-l-md px-2.5 py-2.5 text-left',
        'motion-safe:transition-[background-color,border-color,box-shadow]',
        isActive
          ? 'relative z-10 -mr-px border border-brand/25 border-r-0 border-l-[3px] border-l-brand bg-surface-raised shadow-sm'
          : 'border border-transparent border-l-[3px] border-l-transparent hover:bg-surface-overlay',
      ].join(' ')}
      title={project.name}
    >
      <ProjectFavicon
        project_id={project.id}
        project_name={project.name}
        project_slug={project.slug}
        sdk_origin={sdkOriginFromApiKeys(project.api_keys)}
        size={16}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-fg">{project.name}</span>
        <span className="mt-0.5 block truncate font-mono text-2xs text-fg-muted">{project.slug}</span>
        <span className="mt-1 inline-flex items-center gap-1.5 text-2xs text-fg-secondary">
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
          <span className="tabular-nums">{project.report_count.toLocaleString()}</span> reports
        </span>
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
        role="tablist"
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

      <div className="hidden shrink-0 lg:sticky lg:top-3 lg:z-10 lg:block lg:max-h-[calc(100dvh-5.5rem)] lg:w-56 lg:self-start lg:overflow-y-auto lg:overscroll-y-contain">
        <nav
          aria-label="Projects"
          className="flex flex-col gap-0.5 border-r border-edge-subtle bg-surface-root/50 p-1.5"
          role="tablist"
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
