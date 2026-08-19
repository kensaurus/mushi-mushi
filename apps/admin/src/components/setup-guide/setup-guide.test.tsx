/**
 * FILE: apps/admin/src/components/setup-guide/setup-guide.test.tsx
 * PURPOSE: Contract tests for the docked setup guide.
 *
 * Three things are pinned here:
 *  1. Step-state derivation. "Blocked" is the only piece of logic this
 *     surface adds on top of the server checklist, and it must stay tied to
 *     the required chain the backend models — an over-eager gate would tell
 *     users they cannot do something they can.
 *  2. The view-state resolver. A guide that reappears after being dismissed,
 *     or that auto-expands on top of /onboarding's own wizard, is the exact
 *     failure mode this component exists to avoid.
 *  3. Accessibility wiring of the disclosure: aria-expanded/aria-controls on
 *     the launcher, a real in-DOM panel for aria-controls to point at, a
 *     labelled progressbar, per-step state as TEXT (not colour alone), and
 *     NO dialog/aria-modal (a focus trap here would be a bug, not a feature).
 *
 * renderToStaticMarkup like the other admin .tsx tests — no DOM-testing
 * dependency, per the narrow vitest surface in vitest.config.ts.
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { SetupGuidePanel } from './SetupGuidePanel'
import {
  buildSetupGuideModel,
  relativeTime,
  repoSlug,
  setupGuideSummary,
  NO_PROJECT_MODEL,
} from '../../lib/setupGuideSteps'
import { resolveSetupGuideView, shouldSuppressAutoExpand } from '../../lib/setupGuidePrefs'
import type { SetupProject, SetupStep, SetupStepId } from '../../lib/useSetupStatus'
import type { ProjectSnapshot } from '../../lib/projectSnapshotTypes'

const NOW = Date.parse('2026-08-19T12:00:00.000Z')

function step(
  id: SetupStepId,
  complete: boolean,
  required: boolean,
  extra: Partial<SetupStep> = {},
): SetupStep {
  return {
    id,
    label: `Label ${id}`,
    description: `Description ${id}`,
    complete,
    required,
    cta_to: '/onboarding',
    cta_label: 'Do it',
    ...extra,
  }
}

function project(steps: SetupStep[], extra: Partial<SetupProject> = {}): SetupProject {
  const required = steps.filter((s) => s.required)
  return {
    project_id: 'p1',
    project_name: 'Acme Web',
    project_slug: 'acme-web',
    created_at: '2026-08-18T12:00:00.000Z',
    steps,
    required_total: required.length,
    required_complete: required.filter((s) => s.complete).length,
    total: steps.length,
    complete: steps.filter((s) => s.complete).length,
    done: required.every((s) => s.complete),
    report_count: 0,
    fix_count: 0,
    merged_fix_count: 0,
    ...extra,
  }
}

/** The four required steps in backend order, with the first N complete. */
function requiredChain(completeCount: number): SetupStep[] {
  const ids: SetupStepId[] = [
    'project_created',
    'api_key_generated',
    'sdk_installed',
    'first_report_received',
  ]
  return ids.map((id, i) => step(id, i < completeCount, true))
}

describe('buildSetupGuideModel — step states', () => {
  it('blocks a required step whose prerequisite is incomplete, naming it', () => {
    const model = buildSetupGuideModel(project(requiredChain(1)), { now: NOW })
    const byId = new Map(model.steps.map((s) => [s.id, s]))

    expect(byId.get('api_key_generated')?.state).toBe('next')
    expect(byId.get('sdk_installed')?.state).toBe('blocked')
    expect(byId.get('sdk_installed')?.blockedBy).toBe('Label api_key_generated')
    expect(byId.get('sdk_installed')?.stateLabel).toContain('Label api_key_generated')
    expect(byId.get('first_report_received')?.state).toBe('blocked')
  })

  it('unblocks the chain one link at a time', () => {
    const model = buildSetupGuideModel(project(requiredChain(2)), { now: NOW })
    const byId = new Map(model.steps.map((s) => [s.id, s]))

    expect(byId.get('api_key_generated')?.state).toBe('done')
    expect(byId.get('sdk_installed')?.state).toBe('next')
    expect(byId.get('first_report_received')?.state).toBe('blocked')
    expect(model.nextStepId).toBe('sdk_installed')
  })

  it('never marks an optional step blocked — the real gate is preflight, which this surface does not fetch', () => {
    const steps = [
      ...requiredChain(1),
      step('github_connected', false, false),
      step('first_fix_dispatched', false, false),
      step('slack_connected', false, false),
    ]
    const model = buildSetupGuideModel(project(steps), { now: NOW })
    const optional = model.steps.filter((s) => !s.required)

    expect(optional).toHaveLength(3)
    expect(optional.every((s) => s.state === 'available')).toBe(true)
    expect(optional.every((s) => s.stateLabel === 'Optional')).toBe(true)
  })

  it('reports exactly one "next" step and drops it once required work is done', () => {
    const partial = buildSetupGuideModel(project(requiredChain(3)), { now: NOW })
    expect(partial.steps.filter((s) => s.state === 'next')).toHaveLength(1)

    const finished = buildSetupGuideModel(project(requiredChain(4)), { now: NOW })
    expect(finished.nextStepId).toBeNull()
    expect(finished.steps.filter((s) => s.state === 'next')).toHaveLength(0)
    expect(finished.allRequiredDone).toBe(true)
    expect(finished.percent).toBe(100)
  })

  it('counts required progress separately from optional progress', () => {
    const steps = [
      ...requiredChain(2),
      step('github_connected', true, false),
      step('slack_connected', false, false),
    ]
    const model = buildSetupGuideModel(project(steps), { now: NOW })

    expect(model.requiredComplete).toBe(2)
    expect(model.requiredTotal).toBe(4)
    expect(model.percent).toBe(50)
    expect(model.optionalComplete).toBe(1)
    expect(model.optionalTotal).toBe(2)
  })
})

describe('buildSetupGuideModel — evidence and destinations', () => {
  const snapshot: ProjectSnapshot = {
    id: 'p1',
    name: 'Acme Web',
    slug: 'acme-web',
    last_report_at: '2026-08-19T11:00:00.000Z',
    pdca_bottleneck: null,
    pdca_bottleneck_label: null,
    sdk_version: '2.3.1',
    primary_repo: { repo_url: 'https://github.com/acme/web', default_branch: 'main' },
    api_keys: [
      { is_active: true, revoked: false, last_seen_at: '2026-08-19T11:30:00.000Z' },
      { is_active: true, revoked: false, last_seen_at: null },
      { is_active: false, revoked: true, last_seen_at: null },
    ],
  }

  it('surfaces the connected repo, SDK heartbeat, key count and report counts', () => {
    const steps = [
      ...requiredChain(4),
      step('github_connected', true, false),
    ]
    steps[2] = step('sdk_installed', true, true, {
      diagnostic: {
        last_sdk_seen_at: '2026-08-19T11:45:00.000Z',
        last_sdk_origin: 'https://acme.example',
        last_sdk_user_agent: 'Mozilla/5.0',
        last_sdk_endpoint_host: 'api.mushi.dev',
      },
    })

    const model = buildSetupGuideModel(
      project(steps, { report_count: 12, indexed_file_count: 340 }),
      { snapshot, adminEndpointHost: 'api.mushi.dev', now: NOW },
    )
    const byId = new Map(model.steps.map((s) => [s.id, s]))
    const facts = (id: string) =>
      Object.fromEntries((byId.get(id)?.facts ?? []).map((f) => [f.label, f.value]))

    expect(facts('github_connected').Repository).toBe('acme/web')
    expect(facts('github_connected')['Default branch']).toBe('main')
    expect(facts('github_connected')['Files indexed']).toBe('340')
    expect(facts('sdk_installed').Version).toBe('v2.3.1')
    expect(facts('sdk_installed')['Last heartbeat']).toBe('15m ago')
    expect(facts('sdk_installed').Origin).toBe('https://acme.example')
    expect(facts('api_key_generated')['Active keys']).toBe('2')
    expect(facts('first_report_received').Reports).toBe('12')
    expect(facts('project_created').Project).toBe('Acme Web')
  })

  it('emits no facts for steps whose metadata is not in setup or projects', () => {
    const steps = [
      ...requiredChain(4),
      step('slack_connected', true, false),
      step('byok_anthropic', true, false),
      step('sentry_connected', true, false),
    ]
    const model = buildSetupGuideModel(project(steps), { snapshot, now: NOW })
    const byId = new Map(model.steps.map((s) => [s.id, s]))

    expect(byId.get('slack_connected')?.facts).toEqual([])
    expect(byId.get('byok_anthropic')?.facts).toEqual([])
    expect(byId.get('sentry_connected')?.facts).toEqual([])
  })

  it('points a completed step at the page holding its evidence, not at the how-to', () => {
    const steps = [...requiredChain(4), step('github_connected', true, false)]
    const model = buildSetupGuideModel(project(steps), { snapshot, now: NOW })
    const byId = new Map(model.steps.map((s) => [s.id, s]))

    expect(byId.get('first_report_received')?.to).toBe('/reports')
    expect(byId.get('github_connected')?.to).toBe('/integrations/config')
    expect(byId.get('sdk_installed')?.to).toBe('/connect')
  })

  it('keeps the backend CTA for incomplete steps and for unknown step ids', () => {
    const steps = [
      ...requiredChain(1),
      step('codebase_indexed', true, false, { cta_to: '/explore', cta_label: 'Run index' }),
    ]
    const model = buildSetupGuideModel(project(steps), { now: NOW })
    const byId = new Map(model.steps.map((s) => [s.id, s]))

    expect(byId.get('api_key_generated')?.to).toBe('/onboarding')
    expect(byId.get('api_key_generated')?.ctaLabel).toBe('Do it')
    expect(byId.get('codebase_indexed')?.to).toBe('/explore')
  })

  it('flags an SDK reporting to a different backend than the console reads', () => {
    const steps = requiredChain(4)
    steps[2] = step('sdk_installed', true, true, {
      diagnostic: {
        last_sdk_seen_at: '2026-08-19T11:45:00.000Z',
        last_sdk_origin: null,
        last_sdk_user_agent: null,
        last_sdk_endpoint_host: 'localhost:54321',
      },
    })
    const model = buildSetupGuideModel(project(steps), {
      adminEndpointHost: 'api.mushi.dev',
      now: NOW,
    })

    expect(model.hostMismatch).toEqual({ sdkHost: 'localhost:54321', adminHost: 'api.mushi.dev' })
  })

  it('falls back to a single create-project step before any project exists', () => {
    const model = buildSetupGuideModel(null, { hasAnyProject: false })
    expect(model).toBe(NO_PROJECT_MODEL)
    expect(model.steps).toHaveLength(1)
    expect(model.steps[0].state).toBe('next')
    expect(model.steps[0].to).toBe('/projects')
  })
})

describe('formatters', () => {
  it('formats relative time in compact units', () => {
    expect(relativeTime(null)).toBeNull()
    expect(relativeTime('not-a-date')).toBeNull()
    expect(relativeTime('2026-08-19T11:59:40.000Z', NOW)).toBe('just now')
    expect(relativeTime('2026-08-19T11:30:00.000Z', NOW)).toBe('30m ago')
    expect(relativeTime('2026-08-19T06:00:00.000Z', NOW)).toBe('6h ago')
    expect(relativeTime('2026-08-14T12:00:00.000Z', NOW)).toBe('5d ago')
  })

  it('reduces a repo url to owner/name', () => {
    expect(repoSlug('https://github.com/acme/web')).toBe('acme/web')
    expect(repoSlug('https://github.com/acme/web.git')).toBe('acme/web')
    expect(repoSlug('acme/web')).toBe('acme/web')
    expect(repoSlug(null)).toBeNull()
    expect(repoSlug('')).toBeNull()
  })

  it('summarises required progress, then optional progress', () => {
    expect(setupGuideSummary(buildSetupGuideModel(project(requiredChain(2)), { now: NOW }))).toBe(
      'Setup 2/4',
    )
    const finished = buildSetupGuideModel(
      project([...requiredChain(4), step('slack_connected', false, false)]),
      { now: NOW },
    )
    expect(setupGuideSummary(finished)).toBe('Setup done · 0/1 extras')
  })
})

describe('resolveSetupGuideView', () => {
  it('opens on first sight while required setup is unfinished', () => {
    expect(
      resolveSetupGuideView(null, { requiredComplete: false, suppressAutoExpand: false }),
    ).toBe('expanded')
  })

  it('opens as a pill once required setup is finished', () => {
    expect(
      resolveSetupGuideView(null, { requiredComplete: true, suppressAutoExpand: false }),
    ).toBe('minimized')
  })

  it('does not auto-open on routes that already render the checklist', () => {
    expect(
      resolveSetupGuideView(null, { requiredComplete: false, suppressAutoExpand: true }),
    ).toBe('minimized')
  })

  it('suppresses only the wizard route — the dashboard is where a new user lands', () => {
    expect(shouldSuppressAutoExpand('/onboarding')).toBe(true)
    expect(shouldSuppressAutoExpand('/onboarding/cli')).toBe(true)
    // Regression guard: adding /dashboard here would mean the guide never
    // opens by itself for a first-time user, since DashboardPage sends the
    // project-less case to /onboarding and everyone else starts here.
    expect(shouldSuppressAutoExpand('/dashboard')).toBe(false)
    expect(shouldSuppressAutoExpand('/reports')).toBe(false)
  })

  it('opens on the dashboard for a first-time user with unfinished required setup', () => {
    expect(
      resolveSetupGuideView(null, {
        requiredComplete: false,
        suppressAutoExpand: shouldSuppressAutoExpand('/dashboard'),
      }),
    ).toBe('expanded')
  })

  it('re-opens on /onboarding when the user asks for it back after dismissing', () => {
    // openSetupGuide() stores 'expanded'; suppression must not swallow it, or
    // the "Show setup guide" button would look broken on the page it lives on.
    expect(
      resolveSetupGuideView('expanded', {
        requiredComplete: true,
        suppressAutoExpand: shouldSuppressAutoExpand('/onboarding'),
      }),
    ).toBe('expanded')
  })

  it('always honours a stored choice, including on suppressed routes', () => {
    expect(
      resolveSetupGuideView('expanded', { requiredComplete: true, suppressAutoExpand: true }),
    ).toBe('expanded')
    expect(
      resolveSetupGuideView('dismissed', { requiredComplete: false, suppressAutoExpand: false }),
    ).toBe('dismissed')
    expect(
      resolveSetupGuideView('minimized', { requiredComplete: false, suppressAutoExpand: false }),
    ).toBe('minimized')
  })
})

describe('SetupGuidePanel — accessibility wiring', () => {
  const model = buildSetupGuideModel(
    project([...requiredChain(2), step('slack_connected', false, false)], { report_count: 0 }),
    { now: NOW },
  )

  function render(view: 'expanded' | 'minimized') {
    return renderToStaticMarkup(
      <MemoryRouter>
        <SetupGuidePanel
          model={model}
          view={view}
          onExpand={() => {}}
          onMinimize={() => {}}
          onDismiss={() => {}}
        />
      </MemoryRouter>,
    )
  }

  it('is a disclosure, never a modal dialog — a focus trap here would block the page it describes', () => {
    const html = render('expanded')
    expect(html).not.toContain('aria-modal')
    expect(html).not.toContain('role="dialog"')
  })

  it('wires aria-expanded/aria-controls to a panel that is always in the DOM', () => {
    const minimized = render('minimized')
    expect(minimized).toContain('aria-expanded="false"')
    expect(minimized).toContain('aria-controls="setup-guide-panel"')
    expect(minimized).toContain('id="setup-guide-panel"')
    expect(minimized).toContain('hidden=""')

    const expanded = render('expanded')
    expect(expanded).toContain('aria-expanded="true"')
    expect(expanded).toContain('aria-controls="setup-guide-panel"')
    expect(expanded).not.toContain('hidden=""')
  })

  it('names the panel from a focusable heading', () => {
    const html = render('expanded')
    expect(html).toContain('aria-labelledby="setup-guide-heading"')
    expect(html).toContain('id="setup-guide-heading"')
    expect(html).toContain('tabindex="-1"')
  })

  it('exposes progress as a labelled progressbar, not just a coloured bar', () => {
    const html = render('expanded')
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="50"')
    expect(html).toContain('aria-label="2 of 4 required steps complete"')
  })

  it('states every step status in text, so state never rests on colour alone', () => {
    const html = render('expanded')
    expect(html).toContain('Done')
    expect(html).toContain('Do this next')
    expect(html).toContain('Waiting on')
    expect(html).toContain('Optional')
  })

  it('keeps completed steps clickable so users can go see what is connected', () => {
    const html = render('expanded')
    expect(html).toContain('data-step-id="project_created"')
    expect(html).toContain('href="/projects"')
    expect(html).toContain('data-step-state="done"')
    expect(html).toContain('data-step-state="blocked"')
  })

  it('offers a way out from both states', () => {
    expect(render('minimized')).toContain('aria-label="Hide the setup guide"')
    expect(render('expanded')).toContain('aria-label="Minimize the setup guide"')
    expect(render('expanded')).toContain('Hide this guide')
  })
})
