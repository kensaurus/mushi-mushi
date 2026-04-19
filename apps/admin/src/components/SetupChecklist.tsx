/**
 * FILE: apps/admin/src/components/SetupChecklist.tsx
 * PURPOSE: Reusable, DB-backed setup checklist primitive used in two modes:
 *            - mode="banner": collapsible card pinned to the top of the
 *              dashboard. Auto-expanded while required steps are incomplete;
 *              collapses to a single-line "Setup complete" pill once `done`.
 *            - mode="wizard": full-page list with inline CTAs, used by the
 *              `/onboarding` page.
 *
 *          Drives every "what should I configure first" surface in the admin so
 *          end users always see one canonical answer instead of guessing.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { SetupProject, SetupStep } from '../lib/useSetupStatus'

interface SetupChecklistProps {
  project: SetupProject
  mode: 'banner' | 'wizard'
  onRefresh?: () => void
}

export function SetupChecklist({ project, mode, onRefresh }: SetupChecklistProps) {
  const requiredDone = project.required_complete >= project.required_total
  const allDone = project.complete >= project.total
  const pct = Math.round((project.required_complete / Math.max(1, project.required_total)) * 100)

  if (mode === 'banner') {
    return (
      <BannerChecklist
        project={project}
        requiredDone={requiredDone}
        allDone={allDone}
        pct={pct}
        onRefresh={onRefresh}
      />
    )
  }

  return (
    <WizardChecklist
      project={project}
      requiredDone={requiredDone}
      pct={pct}
      onRefresh={onRefresh}
    />
  )
}

interface InternalProps {
  project: SetupProject
  requiredDone: boolean
  pct: number
  onRefresh?: () => void
}

function BannerChecklist({
  project,
  requiredDone,
  allDone,
  pct,
  onRefresh,
}: InternalProps & { allDone: boolean }) {
  // Default: collapsed when all steps are complete (so the banner shrinks to a
  // tiny pill once the user is fully set up); expanded otherwise.
  const [open, setOpen] = useState(!allDone)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`mb-4 inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-2xs motion-safe:transition-colors ${
          allDone
            ? 'border-ok/30 bg-ok-muted/15 text-ok'
            : 'border-warn/30 bg-warn/10 text-warn'
        } hover:brightness-110`}
        aria-label="Show setup checklist"
      >
        <span className="font-medium">
          {allDone ? '✓ Setup complete' : `Setup ${project.required_complete}/${project.required_total} required`}
        </span>
        <span className="text-3xs text-fg-muted">expand</span>
      </button>
    )
  }

  return (
    <div className={`mb-4 rounded-md border ${requiredDone ? 'border-ok/30 bg-ok-muted/10' : 'border-warn/30 bg-warn/5'}`}>
      <div className="flex items-center justify-between gap-3 border-b border-edge-subtle px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${requiredDone ? 'text-ok' : 'text-warn'}`}>
              {requiredDone ? 'Setup complete' : 'Finish setting up Mushi Mushi'}
            </span>
            <span className="text-3xs font-mono text-fg-muted">
              {project.complete}/{project.total} done · {pct}% required
            </span>
          </div>
          <p className="mt-0.5 text-3xs text-fg-muted truncate">
            {requiredDone
              ? 'Optional integrations below unlock auto-fix PRs and BYOK billing.'
              : `Project: ${project.project_name}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="text-3xs text-fg-muted hover:text-fg-secondary"
              aria-label="Refresh setup status"
            >
              Refresh
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-3xs text-fg-muted hover:text-fg-secondary"
            aria-label="Collapse setup checklist"
          >
            Hide
          </button>
        </div>
      </div>

      {/* progress bar */}
      <div className="px-3 pt-2">
        <div className="h-1 w-full overflow-hidden rounded-sm bg-surface-overlay">
          <div
            className={`h-full ${requiredDone ? 'bg-ok' : 'bg-warn'}`}
            style={{ width: `${Math.max(2, pct)}%` }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      </div>

      <ol className="space-y-1 p-3">
        {project.steps.map(step => (
          <ChecklistRow key={step.id} step={step} />
        ))}
      </ol>
    </div>
  )
}

function WizardChecklist({ project, requiredDone, pct }: InternalProps) {
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-edge-subtle bg-surface-raised/30 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-fg">
            {requiredDone ? 'You\u2019re set up' : 'Setup progress'}
          </span>
          <span className="text-3xs font-mono text-fg-muted">
            {project.required_complete}/{project.required_total} required · {pct}%
          </span>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-sm bg-surface-overlay">
          <div
            className={`h-full ${requiredDone ? 'bg-ok' : 'bg-brand'}`}
            style={{ width: `${Math.max(2, pct)}%` }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      </div>

      <ol className="space-y-2">
        {project.steps.map(step => (
          <li key={step.id}>
            <ChecklistCard step={step} />
          </li>
        ))}
      </ol>
    </div>
  )
}

function ChecklistRow({ step }: { step: SetupStep }) {
  return (
    <li className="flex items-start gap-2.5 rounded-sm px-1.5 py-1 hover:bg-surface-overlay/40 motion-safe:transition-colors">
      <StepIcon complete={step.complete} required={step.required} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-xs ${step.complete ? 'text-fg-secondary line-through' : 'text-fg'}`}>
            {step.label}
          </span>
          {!step.required && (
            <span className="rounded-sm border border-edge-subtle bg-surface-raised px-1 py-0.5 text-3xs text-fg-faint uppercase tracking-wider">
              optional
            </span>
          )}
        </div>
        <p className="text-3xs text-fg-muted truncate">{step.description}</p>
      </div>
      {!step.complete && (
        <Link
          to={step.cta_to}
          className="shrink-0 text-2xs text-brand hover:text-brand-hover"
        >
          {step.cta_label} →
        </Link>
      )}
    </li>
  )
}

function ChecklistCard({ step }: { step: SetupStep }) {
  return (
    <div className={`rounded-md border p-3 ${
      step.complete
        ? 'border-ok/30 bg-ok-muted/10'
        : step.required
          ? 'border-brand/30 bg-brand/5'
          : 'border-edge-subtle bg-surface-raised/30'
    }`}>
      <div className="flex items-start gap-3">
        <StepIcon complete={step.complete} required={step.required} large />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className={`text-sm font-medium ${step.complete ? 'text-fg-secondary' : 'text-fg'}`}>
              {step.label}
            </h4>
            {!step.required && (
              <span className="rounded-sm border border-edge-subtle bg-surface-raised px-1 py-0.5 text-3xs text-fg-faint uppercase tracking-wider">
                optional
              </span>
            )}
            {step.complete && (
              <span className="rounded-sm bg-ok/15 px-1.5 py-0.5 text-3xs text-ok uppercase tracking-wider">
                done
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-fg-muted">{step.description}</p>
        </div>
        {!step.complete && (
          <Link
            to={step.cta_to}
            className="shrink-0 inline-flex items-center gap-1 rounded-sm bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg hover:bg-brand-hover motion-safe:transition-colors"
          >
            {step.cta_label}
          </Link>
        )}
      </div>
    </div>
  )
}

function StepIcon({ complete, required, large }: { complete: boolean; required: boolean; large?: boolean }) {
  const size = large ? 'h-5 w-5 text-xs' : 'h-4 w-4 text-2xs'
  if (complete) {
    return (
      <span className={`${size} mt-0.5 inline-flex items-center justify-center rounded-full bg-ok text-ok-fg shrink-0`}>
        ✓
      </span>
    )
  }
  return (
    <span
      className={`${size} mt-0.5 inline-flex items-center justify-center rounded-full border ${required ? 'border-brand text-brand' : 'border-edge text-fg-faint'} shrink-0`}
    >
      ○
    </span>
  )
}
