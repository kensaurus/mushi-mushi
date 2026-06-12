/**
 * FILE: apps/admin/src/components/ProjectSetupProgress.tsx
 * PURPOSE: Single-row setup progress for project switcher — segmented bar,
 *          report count, and required/optional tallies in one compact line.
 */

import type { SetupProject } from '../lib/useSetupStatus'
import { buildProjectSetupTooltip } from '../lib/projectMetaTooltips'
import {
  optionalSetupSteps,
  requiredSetupPercent,
  requiredSetupSteps,
  REQUIRED_STEP_SHORT_LABEL,
  nextRequiredSetupStep,
} from '../lib/setupProgress'
import { MetricTooltipContent, Tooltip } from './ui'

interface ProjectSetupProgressProps {
  project: SetupProject
}

export function ProjectSetupProgress({ project }: ProjectSetupProgressProps) {
  const required = requiredSetupSteps(project)
  const optional = optionalSetupSteps(project)
  const optionalDone = optional.filter((s) => s.complete).length
  const requiredDone = project.required_complete >= project.required_total
  const pct = requiredSetupPercent(project)
  const next = nextRequiredSetupStep(project)

  return (
    <Tooltip
      content={<MetricTooltipContent data={buildProjectSetupTooltip(project)} />}
      side="left"
      nowrap={false}
      portal
    >
      <div
        className="mt-0.5 flex min-w-0 cursor-help items-center gap-1.5"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${project.report_count} reports · ${project.required_complete} of ${project.required_total} required setup steps complete${next ? ` · next: ${next.label}` : ''}`}
      >
        <span className="shrink-0 text-3xs tabular-nums text-fg-faint">
          {project.report_count} {project.report_count === 1 ? 'report' : 'reports'}
        </span>

        <div className="flex h-1 min-w-[2.75rem] flex-1 gap-px">
          {required.map((step) => {
            const isNext = step.id === next?.id
            const short =
              REQUIRED_STEP_SHORT_LABEL[step.id] ?? step.label.split(' ')[0] ?? step.id
            return (
              <span
                key={step.id}
                title={`${short}${step.complete ? ' ✓' : isNext ? ' — next' : ''}`}
                className={`min-w-0 flex-1 rounded-[1px] motion-safe:transition-colors ${
                  step.complete
                    ? 'bg-ok'
                    : isNext
                      ? 'bg-warn/50 ring-1 ring-inset ring-warn/40'
                      : 'bg-surface-overlay'
                }`}
              />
            )
          })}
        </div>

        <span
          className={`shrink-0 text-3xs font-medium tabular-nums leading-none ${
            requiredDone ? 'text-ok' : 'text-fg-muted'
          }`}
        >
          {project.required_complete}/{project.required_total}
        </span>

        {optional.length > 0 && (
          <span
            className="shrink-0 text-3xs tabular-nums leading-none text-fg-faint"
            title={`${optionalDone} of ${optional.length} optional integrations wired`}
          >
            +{optionalDone}
          </span>
        )}
      </div>
    </Tooltip>
  )
}
