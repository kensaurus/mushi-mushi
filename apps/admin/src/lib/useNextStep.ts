/**
 * FILE: apps/admin/src/lib/useNextStep.ts
 * PURPOSE: The one source of "what should I do next?" behind <NextStep>.
 *
 *          Plan 021 Phase 3 replaced seven separate nudges (NextBestAction,
 *          QuickstartMegaCta, SetupNudge, the dashboard checklist banner, the
 *          onboarding lanes' top-priority link, …) with one component fed by
 *          this hook. It invents no rules. It picks between three existing
 *          sources:
 *            - `loop`: computeNextAction (lib/nextBestAction.ts): real work
 *              first, then setup gaps, then "all clear". Drives the layout
 *              banner and the dashboard card.
 *            - `prerequisites`: the per-page blocker check SetupNudge did: no
 *              project, else the first incomplete step the page needs.
 *            - `setup`: nextSetupStepId (lib/setupGuideSteps.ts), the step a
 *              setup list marks "Do this next".
 *
 *          One voice per screen. A surface that is showing a next step claims
 *          the slot in a small refcounted store, and the layout banner stands
 *          down:
 *            - `page`: an inline blocker or the dashboard card is on screen.
 *            - `overlay`: the first-run tour is running.
 *            - `setup`: a setup checklist with a "Do this next" row is on
 *              screen. The loop sources then name real work only
 *              (NbaOptions.setupGuideOpen).
 *          The docked setup guide (read from setupGuidePrefs) and a running
 *          tour are guided flows: while either is open the banner and the
 *          card stand down entirely. Inline blockers stay: they are the
 *          page's empty state, not chrome.
 *          Refcounted because one page can mount several inline slots
 *          (Releases and Storage mount three).
 */

import { useLayoutEffect, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useAdminMode } from './mode'
import { computeNextAction, type NbaAction, type NbaTone } from './nextBestAction'
import { usePostureHasStatusBanner } from './postureChromeStore'
import { isSetupGuideOpen, useSetupGuideView } from './setupGuidePrefs'
import { nextSetupStepId } from './setupGuideSteps'
import { useNavCounts } from './useNavCounts'
import { useSetupStatus, type SetupProject, type SetupStepId, type UseSetupStatusResult } from './useSetupStatus'

/**
 * What a page needs before it can show data. `project` is a virtual blocker:
 * the page itself checked "no active project selected in the header" and wrote
 * its own empty copy, so it never maps to a setup step.
 */
export type SetupBlocker = SetupStepId | 'project'

export interface NextStepModel {
  tone: NbaTone
  /** Verb-led headline. */
  title: string
  /** One sentence on why it matters now. */
  why?: string
  cta: NbaAction['cta']
}

export type NextStepSource =
  | { kind: 'loop'; placement: 'layout' | 'page' }
  | { kind: 'prerequisites'; requires: readonly SetupBlocker[] }
  | { kind: 'setup'; project: SetupProject | null }

export interface UseNextStepResult {
  step: NextStepModel | null
  /** Setup step id the step points at (setup source only). */
  stepId: string | null
  /** Project an inline "send test report" CTA fires against. */
  projectId: string | null
  /** Setup status has not loaded yet: render nothing rather than guess. */
  loading: boolean
}

/* ── single-voice slot ─────────────────────────────────────────────────── */

type Claim = 'page' | 'overlay' | 'setup'

const claimCounts: Record<Claim, number> = { page: 0, overlay: 0, setup: 0 }
let claimSnapshot: Readonly<Record<Claim, boolean>> = { page: false, overlay: false, setup: false }
const claimListeners = new Set<() => void>()

function adjustClaim(kind: Claim, delta: 1 | -1) {
  claimCounts[kind] = Math.max(0, claimCounts[kind] + delta)
  const held = claimCounts[kind] > 0
  if (claimSnapshot[kind] === held) return
  claimSnapshot = { ...claimSnapshot, [kind]: held }
  for (const listener of claimListeners) listener()
}

function subscribeClaims(listener: () => void) {
  claimListeners.add(listener)
  return () => {
    claimListeners.delete(listener)
  }
}

const getClaims = () => claimSnapshot

/**
 * Hold the "next step" slot while `active`. Released on unmount. A layout
 * effect, so the banner yields in the same frame instead of flashing first.
 */
export function useClaimNextStep(kind: Claim, active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return
    adjustClaim(kind, 1)
    return () => adjustClaim(kind, -1)
  }, [kind, active])
}

/* ── derivation ────────────────────────────────────────────────────────── */

const SIGNED_OUT_PREFIXES = ['/login', '/recovery', '/reset-password']

function prerequisiteStep(setup: UseSetupStatusResult, requires: readonly SetupBlocker[]): NextStepModel | null {
  if (!setup.hasAnyProject) {
    return {
      tone: 'plan',
      title: 'Create your first project to get started',
      why: 'A project groups all bug reports from one application.',
      cta: { kind: 'link', to: '/onboarding', label: 'Open setup wizard' },
    }
  }
  for (const id of requires) {
    // The page already evaluated `project` and wrote its own empty copy.
    if (id === 'project') continue
    const step = setup.getStep(id)
    if (!step || step.complete) continue
    return {
      tone: 'plan',
      title: step.label,
      why: step.description,
      cta: { kind: 'link', to: step.cta_to, label: step.cta_label },
    }
  }
  return null
}

function setupListStep(project: SetupProject | null): { step: NextStepModel | null; stepId: string | null } {
  const stepId = nextSetupStepId(project)
  const step = stepId ? project?.steps.find((s) => s.id === stepId) ?? null : null
  if (!step) return { step: null, stepId: null }
  return {
    stepId,
    step: {
      tone: 'plan',
      title: step.label,
      why: step.description,
      cta: { kind: 'link', to: step.cta_to, label: step.cta_label },
    },
  }
}

/**
 * The next step for one surface. Every hook runs on every render; the source
 * only picks which result is returned.
 */
export function useNextStep(source: NextStepSource): UseNextStepResult {
  const { pathname } = useLocation()
  const { isBeginner, isQuickstart } = useAdminMode()
  const postureHasStatusBanner = usePostureHasStatusBanner()
  const claims = useSyncExternalStore(subscribeClaims, getClaims, getClaims)
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const work = useNavCounts()
  const [guideView] = useSetupGuideView()

  const projectId = setup.activeProject?.project_id ?? null

  if (source.kind === 'setup') {
    return { ...setupListStep(source.project), projectId: source.project?.project_id ?? projectId, loading: false }
  }

  const none: UseNextStepResult = { step: null, stepId: null, projectId, loading: setup.loading }
  if (setup.loading) return none

  if (source.kind === 'prerequisites') {
    return { ...none, step: prerequisiteStep(setup, source.requires) }
  }

  // Loop: Quick and Beginner only. Advanced keeps PageHero and the pipeline
  // ribbon (lib/chromePosture.ts: the posture strips never co-render).
  if (!isBeginner && !isQuickstart) return none
  if (SIGNED_OUT_PREFIXES.some((p) => pathname.startsWith(p))) return none
  // A status banner on PagePosture already carries this route's next step.
  if (postureHasStatusBanner) return none
  if (claims.overlay) return none
  if (source.placement === 'layout' && claims.page) return none

  // The docked setup guide is a guided flow with its own "Do this next": while
  // it is open the banner and card stand down entirely, like for the tour.
  const project = setup.activeProject
  if (project && isSetupGuideOpen(guideView, project.required_complete >= project.required_total, pathname)) {
    return none
  }
  // A setup checklist on the page lists the setup steps: name real work only.
  const action = computeNextAction(setup, work, pathname, { setupGuideOpen: claims.setup })
  return { ...none, step: action }
}
