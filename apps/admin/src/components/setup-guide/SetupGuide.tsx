/**
 * FILE: apps/admin/src/components/setup-guide/SetupGuide.tsx
 * PURPOSE: The persistent, dismissible setup guide docked into the app shell.
 *
 *          WHY THIS EXISTS. Every setup surface in the console was route-gated:
 *          <SetupChecklist mode="banner"> only renders on /dashboard,
 *          mode="wizard" only on /onboarding, the four components/onboarding/*
 *          panels only on /onboarding, and <NextBestAction> returns null unless
 *          the user is in beginner/quickstart mode (and null again on / and
 *          /onboarding). <FirstRunTour> is a one-shot product tour, not a
 *          tracker. So the moment a user navigated away from those two routes,
 *          nothing in the console told them what was still missing or what was
 *          already connected. This mounts once in the shell and follows them.
 *
 *          It is a surfacing layer, not a fourth checklist: the steps, labels,
 *          required flags and CTAs are the server-built ones from
 *          /v1/admin/setup (activation-setup-builder.ts).
 *
 *          Self-contained by design — it reads its own hooks exactly like
 *          <FirstRunTour> does, so the mount in Layout.tsx is a bare element
 *          that survives any refactor of that file.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useSetupStatus } from '../../lib/useSetupStatus'
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
