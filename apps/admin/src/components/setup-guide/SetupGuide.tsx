/**
 * FILE: apps/admin/src/components/setup-guide/SetupGuide.tsx
 * PURPOSE: The persistent, dismissible setup guide docked into the app shell.
 *
 *          WHY THIS EXISTS. Every setup surface in the console was route-gated:
 *          <SetupChecklist> only renders on the empty dashboard and
 *          /onboarding, the components/onboarding/* panels only on
 *          /onboarding, and the <NextStep> banner names one step at a time
 *          and only in Quick/Beginner mode. <FirstRunTour> is a one-shot
 *          product tour, not a tracker. So the moment a user navigated away
 *          from those routes, nothing in the console told them what was still
 *          missing or what was already connected. This mounts once in the
 *          shell and follows them.
 *
 *          It is a surfacing layer, not another checklist: the steps, labels,
 *          required flags and CTAs are the server-built ones from
 *          /v1/admin/setup (activation-setup-builder.ts), and its "Do this
 *          next" step is nextSetupStepId, the rule every setup list shares.
 *          While it is open the NextStep banner names real work only.
 *
 *          Self-contained by design — it reads its own hooks exactly like
 *          <FirstRunTour> does, so the mount in Layout.tsx is a bare element
 *          that survives any refactor of that file.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { invalidateSetupStatus, SETUP_STEPS, useSetupStatus } from '../../lib/useSetupStatus'
import { useRealtimeReload } from '../../lib/realtime'
import { useProjectSnapshots } from '../../lib/useProjectSnapshots'
import { useActiveProjectId } from '../ProjectSwitcher'
import { buildSetupGuideModel } from '../../lib/setupGuideSteps'
import {
  resolveSetupGuideView,
  shouldSuppressAutoExpand,
  useSetupGuideView,
} from '../../lib/setupGuidePrefs'
import { SetupGuidePanel } from './SetupGuidePanel'

/** Auth-shell routes where chrome is deliberately absent. */
const HIDDEN_PREFIXES = ['/login', '/signup', '/reset-password', '/invite', '/cli-auth', '/mcp-auth']

/** Fallback setup polls per awaiting project (30s apart = 5 minutes). */
const SETUP_POLL_MAX = 10

export function SetupGuide() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const snapshots = useProjectSnapshots()
  const [storedView, setStoredView] = useSetupGuideView()

  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const previousView = useRef<string | null>(null)

  const model = useMemo(
    () =>
      buildSetupGuideModel(setup.activeProject, {
        snapshot: setup.activeProject
          ? snapshots.byId.get(setup.activeProject.project_id) ?? null
          : null,
        adminEndpointHost: setup.data?.admin_endpoint_host ?? null,
        hasAnyProject: setup.hasAnyProject,
      }),
    [setup.activeProject, setup.data?.admin_endpoint_host, setup.hasAnyProject, snapshots.byId],
  )

  const view = resolveSetupGuideView(storedView, {
    requiredComplete: model.allRequiredDone,
    suppressAutoExpand: shouldSuppressAutoExpand(pathname),
  })

  // While the guide is on screen and the first report is still outstanding,
  // watch for it to land so the guide (and every other setup surface) moves
  // on without a page reload. Off once the step completes or the guide is
  // hidden, so steady-state sessions hold no channel.
  const guideOnScreen = !!user && view !== 'dismissed' && !HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))
  const awaitingProjectId =
    guideOnScreen && setup.activeProject && setup.isStepIncomplete(SETUP_STEPS.firstReportReceived)
      ? setup.activeProject.project_id
      : null
  const { channelState } = useRealtimeReload(
    [{ table: 'reports', event: 'INSERT', filter: `project_id=eq.${awaitingProjectId ?? ''}` }],
    invalidateSetupStatus,
    { debounceMs: 1000, enabled: !!awaitingProjectId },
  )
  // Realtime can be blocked (proxy, extension). Fall back to a slow, bounded
  // poll: SETUP_POLL_MAX checks (5 minutes) per project per mount, which
  // covers "just sent a test report" without polling a never-connected
  // project from every open tab forever.
  useEffect(() => {
    if (!awaitingProjectId || channelState === 'live') return
    let left = SETUP_POLL_MAX
    const t = setInterval(() => {
      if (document.hidden) return
      invalidateSetupStatus()
      if (--left <= 0) clearInterval(t)
    }, 30_000)
    return () => clearInterval(t)
  }, [awaitingProjectId, channelState])

  const expand = useCallback(() => setStoredView('expanded'), [setStoredView])
  const minimize = useCallback(() => setStoredView('minimized'), [setStoredView])
  const dismiss = useCallback(() => setStoredView('dismissed'), [setStoredView])

  // Focus follows the disclosure: opening moves focus into the panel heading,
  // closing hands it back to the launcher. No trap — Tab leaves the panel and
  // continues through the page, which is the point of a non-modal dock.
  useEffect(() => {
    const previous = previousView.current
    previousView.current = view
    if (previous === null) return
    if (previous !== 'expanded' && view === 'expanded') {
      headingRef.current?.focus()
    } else if (previous === 'expanded' && view === 'minimized') {
      // The dock is a single global affordance, so a document query is the
      // cheapest correct handle — no wrapper element in the shell's flex row.
      document
        .querySelector<HTMLButtonElement>('[data-setup-guide-launcher="true"]')
        ?.focus()
    }
  }, [view])

  // Escape closes the panel to a pill. Bound only while expanded so it never
  // competes with the focus-mode Escape handler in Layout or with any modal.
  useEffect(() => {
    if (view !== 'expanded') return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      minimize()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, minimize])

  if (!user) return null
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null
  if (view === 'dismissed') return null
  // Nothing useful to say until the checklist has loaded once.
  if (setup.loading || model.steps.length === 0) return null
  // Fully finished — required and optional. The dock retires itself instead of
  // becoming permanent chrome; "Show setup guide" on /onboarding brings it
  // back for anyone who wants to re-read what is connected.
  const fullyComplete = model.allRequiredDone && model.optionalComplete >= model.optionalTotal
  if (fullyComplete && storedView !== 'expanded') return null

  return (
    <SetupGuidePanel
      ref={headingRef}
      model={model}
      view={view}
      onExpand={expand}
      onMinimize={minimize}
      onDismiss={dismiss}
    />
  )
}
