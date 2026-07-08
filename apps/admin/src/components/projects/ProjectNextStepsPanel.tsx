/**
 * FILE: apps/admin/src/components/projects/ProjectNextStepsPanel.tsx
 * PURPOSE: "What does each project need from me?" — one row per project with
 *          a plain-English verdict and up to three linked actions. Renders on
 *          the Projects overview tab from data the page already fetched.
 */

import { Link } from 'react-router-dom'
import type { Project } from './project-models'
import { deriveProjectPlainStatus, type ProjectVerdictTone } from './projectNextSteps'
import { ProjectFavicon } from '../ProjectFavicon'
import { CHIP_TONE } from '../../lib/chipTone'

const TONE_CHIP: Record<ProjectVerdictTone, { label: string; className: string }> = {
  ok: { label: 'Healthy', className: CHIP_TONE.okSubtle },
  attention: { label: 'Needs you', className: CHIP_TONE.warnSubtle },
  inactive: { label: 'Not connected', className: CHIP_TONE.neutral },
}

export function ProjectNextStepsPanel({ projects }: { projects: Project[] }) {
  if (projects.length === 0) return null

  const rows = projects
    .map((p) => ({ project: p, status: deriveProjectPlainStatus(p) }))
    // Projects that need something float to the top; healthy ones collapse to
    // a single reassuring line at the bottom.
    .sort((a, b) => Number(a.status.steps.length === 0) - Number(b.status.steps.length === 0))

  return (
    <section
      aria-label="What each project needs next"
      className="rounded-lg border border-edge bg-surface-raised/40 p-4 space-y-3"
    >
      <div>
        <h3 className="text-sm font-semibold text-fg">What needs you, per project</h3>
        <p className="text-2xs text-fg-muted mt-0.5">
          Plain-English status for every connected project, with the exact next step.
        </p>
      </div>
      <ul className="space-y-2.5">
        {rows.map(({ project, status }) => {
          const chip = TONE_CHIP[status.tone]
          return (
            <li
              key={project.id}
              className="rounded-md border border-edge-subtle bg-surface-root/50 px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <ProjectFavicon
                  project_id={project.id}
                  project_name={project.name}
                  project_slug={project.slug}
                  sdk_origin={
                    project.api_keys.find((k) => k.last_seen_origin)?.last_seen_origin ?? null
                  }
                  repo_url={project.primary_repo?.repo_url ?? null}
                  size={14}
                />
                <span className="text-xs font-medium text-fg">{project.name}</span>
                <span
                  className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-3xs font-medium ${chip.className}`}
                >
                  {chip.label}
                </span>
              </div>
              <p className="mt-1 text-2xs text-fg-secondary">{status.verdict}</p>
              {status.steps.length > 0 && (
                <ol className="mt-1.5 space-y-1" aria-label={`Next steps for ${project.name}`}>
                  {status.steps.map((step, i) => (
                    <li key={step.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-2xs text-fg-faint tabular-nums">{i + 1}.</span>
                      <span className="text-2xs font-medium text-fg-secondary">{step.title}</span>
                      <span className="text-3xs text-fg-muted">{step.why}</span>
                      <Link
                        to={step.to}
                        className="text-2xs font-medium text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-colors whitespace-nowrap"
                      >
                        {step.ctaLabel} →
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
