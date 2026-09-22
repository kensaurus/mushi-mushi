// mushi-ui: intentional overlay — not Modal/Drawer (reason: coach-mark tour with spotlight cutout and anchor-positioned tooltip)
/**
 * FILE: apps/admin/src/components/FirstRunTour.tsx
 * PURPOSE: Click-triggered coach-marks tour ("Take the 2-minute tour").
 *          Launched via `startFirstRunTour()` from the first-run dashboard
 *          and from the onboarding "See your first diagnosis" screen once
 *          the inline diagnosis has rendered. It never auto-launches: the
 *          GTM first-run pass (docs/plan-gtm.md, Workstream B §2d) found
 *          an unprompted overlay competed with the one thing a new user
 *          should do — send a test report.
 *
 *          Four stops with `data-tour-id` selectors so we never reach into
 *          component internals — anchors are explicit on the consuming
 *          components. Stops that need a report silently skip when the
 *          project has none; the `report-diagnosis` stop also needs a
 *          report id (passed by the caller) to know which detail page to
 *          open.
 *
 *          Homemade (no react-joyride dependency) so it inherits the dark
 *          theme tokens, requires no extra bundle, and lives ~250 lines.
 */

import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from './ProjectSwitcher'

type StopId = 'reports' | 'dispatch' | 'askMushi' | 'report-diagnosis'

interface Stop {
  id: StopId
  /** Route the tour navigates to before showing this stop. `exact` matches
   *  the pathname verbatim; `prefix` uses `pathname.startsWith`. The
   *  `report-diagnosis` stop substitutes the report id at runtime. */
  route: string
  match: 'exact' | 'prefix'
  /** CSS selector for the highlighted anchor. */
  anchor: string
  title: string
  body: string
  /** When true, skip this stop if the active project has zero reports. */
  requiresReports?: boolean
  /** When true, skip this stop unless the launcher passed a report id. */
  requiresReportId?: boolean
}

const STOPS: Stop[] = [
  {
    id: 'reports',
    route: '/reports',
    match: 'exact',
    anchor: '[data-tour-id="reports-row"]',
    title: 'Reports — proof for every bug',
    body: 'Each row carries a screenshot, console log, and reproduction steps. The diagnosis reads all three so you do not have to.',
    requiresReports: true,
  },
  {
    id: 'dispatch',
    route: '/reports',
    match: 'exact',
    anchor: '[data-tour-id="dispatch-fix-button"]',
    title: 'Open in your editor',
    body: 'Pull the fix context into Cursor, or dispatch an agent to draft a pull request you review before merging.',
    requiresReports: true,
  },
  {
    id: 'askMushi',
    route: '/dashboard',
    match: 'prefix',
    anchor: '[data-tour-id="ask-mushi-launcher"]',
    title: 'Ask Mushi — your AI guide',
    body: 'The glowing chat icon opens Ask Mushi. Ask how any page works, run /explain on the current route, or press Cmd/Ctrl+J from anywhere in the console.',
  },
  {
    id: 'report-diagnosis',
    route: '/reports/:id',
    match: 'exact',
    anchor: '[data-tour-id="report-diagnosis"]',
    title: 'The diagnosis',
    body: 'What broke and why, in plain English, with severity and the likely root cause. Every report your users file gets this read automatically.',
    requiresReports: true,
    requiresReportId: true,
  },
]

function resolveRoute(stop: Stop, reportId: string | null): string {
  return stop.route.replace(':id', reportId ?? '')
}

const STORAGE_KEY = 'mushi:tour-v1-completed'
const START_EVENT = 'mushi:tour-start'

export interface StartTourOptions {
  /** Report to open for the "diagnosis" stop. Omit to skip that stop. */
  reportId?: string | null
}

function readCompleted(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return true
  }
}

function writeCompleted(value: boolean) {
  if (typeof window === 'undefined') return
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, 'true')
    else window.localStorage.removeItem(STORAGE_KEY)
    window.dispatchEvent(new CustomEvent('mushi:tour-state', { detail: value }))
  } catch {
    /* localStorage unavailable */
  }
}

/**
 * Launch the tour from anywhere ("Take the 2-minute tour"). Dispatches a
 * window event so callers never need a ref to the mounted <FirstRunTour/>
 * in Layout. Passing `reportId` enables the "diagnosis" stop.
 */
export function startFirstRunTour(opts: StartTourOptions = {}) {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent<StartTourOptions>(START_EVENT, { detail: opts }))
  } catch {
    /* CustomEvent unavailable — tour is a nicety, never load-bearing */
  }
}

/** /onboarding footer: clear the "don't show again" flag and start over. */
export function restartFirstRunTour(opts: StartTourOptions = {}) {
  writeCompleted(false)
  startFirstRunTour(opts)
}

export function FirstRunTour() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)

  const [, setCompleted] = useState<boolean>(() => readCompleted())
  const [stopIdx, setStopIdx] = useState<number>(0)
  const [running, setRunning] = useState<boolean>(false)
  const [reportId, setReportId] = useState<string | null>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)

  // Listen for cross-tab completion + explicit start requests. The tour is
  // click-triggered only — there is no auto-launch effect on purpose.
  useEffect(() => {
    function onState(e: Event) {
      const detail = (e as CustomEvent<boolean>).detail
      setCompleted(detail === true)
      if (detail === false) {
        setStopIdx(0)
        setRunning(false)
      }
    }
    function onStart(e: Event) {
      if (!user) return
      const detail = (e as CustomEvent<StartTourOptions | undefined>).detail
      setReportId(detail?.reportId ?? null)
      setStopIdx(0)
      setRunning(true)
    }
    window.addEventListener('mushi:tour-state', onState)
    window.addEventListener(START_EVENT, onStart)
    return () => {
      window.removeEventListener('mushi:tour-state', onState)
      window.removeEventListener(START_EVENT, onStart)
    }
  }, [user])

  // Stops that need a report skip when the project has none — unless the
  // launcher handed us a fresh report id (the S2 screen does, right after
  // the diagnosis renders and before the setup status has refetched).
  const hasReports = (setup.activeProject?.report_count ?? 0) > 0 || Boolean(reportId)
  const visibleStops = STOPS.filter((s) => {
    if (s.requiresReportId && !reportId) return false
    if (s.requiresReports && !hasReports) return false
    return true
  })
  const stop = running ? visibleStops[stopIdx] : null

  // Auto-navigate to the route that hosts the current stop's anchor.
  useEffect(() => {
    if (!stop) return
    const target = resolveRoute(stop, reportId)
    const onRoute = stop.match === 'exact' ? pathname === target : pathname.startsWith(target)
    if (!onRoute) navigate(target)
  }, [stop, pathname, navigate, reportId])

  // Measure anchor position; retry briefly because anchors may mount after
  // a route change. Updates on resize + scroll for a stable spotlight.
  useEffect(() => {
    if (!stop) {
      setRect(null)
      return
    }
    let cancelled = false
    let attempts = 0

    function measure() {
      if (cancelled) return
      const el = document.querySelector(stop!.anchor) as HTMLElement | null
      if (!el) {
        attempts += 1
        if (attempts < 30) {
          window.setTimeout(measure, 200)
        } else {
          setRect(null)
        }
        return
      }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      const next = el.getBoundingClientRect()
      setRect(next)
    }

    measure()
    function onResize() {
      const el = document.querySelector(stop!.anchor) as HTMLElement | null
      if (el) setRect(el.getBoundingClientRect())
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, true)
    return () => {
      cancelled = true
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
    }
  }, [stop, pathname])

  const finish = useCallback(() => {
    writeCompleted(true)
    setCompleted(true)
    setRunning(false)
    setStopIdx(0)
  }, [])

  const next = useCallback(() => {
    if (stopIdx + 1 >= visibleStops.length) {
      finish()
    } else {
      setStopIdx(stopIdx + 1)
    }
  }, [stopIdx, visibleStops.length, finish])

  const back = useCallback(() => {
    setStopIdx(Math.max(0, stopIdx - 1))
  }, [stopIdx])

  // Esc to skip. Bound only while running.
  useEffect(() => {
    if (!running) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') finish()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      else if (e.key === 'ArrowLeft') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running, finish, next, back])

  if (!running || !stop) return null

  const PADDING = 8
  const TIP_W = 320
  const tipPos = computeTipPosition(rect, PADDING, TIP_W)
  const isLast = stopIdx + 1 >= visibleStops.length

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none" aria-live="polite">
      <SpotlightOverlay rect={rect} padding={PADDING} onSkip={finish} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={stop.title}
        className="absolute pointer-events-auto rounded-xl border border-edge bg-surface-raised shadow-raised motion-safe:animate-mushi-fade-in"
        style={{
          width: `${TIP_W}px`,
          top: `${tipPos.top}px`,
          left: `${tipPos.left}px`,
        }}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-edge/60">
          <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-brand/12 text-brand border border-brand/28 text-2xs font-bold">
            {stopIdx + 1}
          </span>
          <span className="text-2xs text-fg-muted font-medium uppercase tracking-wider">
            Tour · {stopIdx + 1} of {visibleStops.length}
          </span>
          <button
            type="button"
            onClick={finish}
            className="ml-auto text-fg-faint hover:text-fg text-xs px-1 py-0.5 rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/50"
            aria-label="Skip tour"
          >
            ✕
          </button>
        </div>
        <div className="px-3 py-2.5">
          <h3 className="text-sm font-semibold text-fg">{stop.title}</h3>
          <p className="mt-1 text-xs text-fg-secondary leading-relaxed">{stop.body}</p>
        </div>
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-edge/60">
          <button
            type="button"
            onClick={finish}
            className="text-2xs text-fg-faint hover:text-fg-muted underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/50 rounded-sm"
          >
            Don't show again
          </button>
          <div className="flex items-center gap-1.5">
            {stopIdx > 0 && (
              <button
                type="button"
                onClick={back}
                className="px-2 py-1 text-2xs rounded-sm border border-edge text-fg-secondary hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/50"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className="px-2.5 py-1 text-2xs rounded-sm bg-brand text-brand-fg hover:bg-brand-hover motion-safe:active:scale-[0.97] motion-safe:duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
            >
              {isLast ? 'Got it' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Renders the dim background with a transparent rectangle around the
 * highlighted anchor. Pure visual primitive; click anywhere outside the
 * cutout dismisses the tour.
 */
function SpotlightOverlay({
  rect,
  padding,
  onSkip,
}: {
  rect: DOMRect | null
  padding: number
  onSkip: () => void
}) {
  // Fallback: no anchor visible → solid dim with no cutout.
  if (!rect) {
    return (
      <button
        type="button"
        onClick={onSkip}
        aria-label="Skip tour"
        className="absolute inset-0 bg-overlay/80 backdrop-blur-[1px] pointer-events-auto cursor-default"
      />
    )
  }

  const x = Math.max(0, rect.left - padding)
  const y = Math.max(0, rect.top - padding)
  const w = rect.width + padding * 2
  const h = rect.height + padding * 2

  return (
    <>
      <button
        type="button"
        onClick={onSkip}
        aria-label="Skip tour"
        className="absolute inset-0 bg-overlay/75 backdrop-blur-[1px] pointer-events-auto cursor-default"
        style={{
          clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${y}px, ${x}px ${y}px, ${x}px ${y + h}px, ${x + w}px ${y + h}px, ${x + w}px ${y}px, 0 ${y}px)`,
        }}
      />
      <div
        aria-hidden="true"
        className="absolute rounded-md ring-2 ring-brand/70 shadow-[0_0_0_4px_rgba(0,0,0,0.3)] mushi-pulse pointer-events-none"
        style={{ top: `${y}px`, left: `${x}px`, width: `${w}px`, height: `${h}px` }}
      />
    </>
  )
}

/** Picks a tooltip position that doesn't clip the viewport. Prefers
 *  bottom-anchored, falls back to top-anchored, then to centered. */
function computeTipPosition(
  rect: DOMRect | null,
  padding: number,
  tipWidth: number,
): { top: number; left: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const margin = 12
  const tipHeight = 200

  if (!rect) {
    return { top: vh / 2 - tipHeight / 2, left: vw / 2 - tipWidth / 2 }
  }

  const anchorBottom = rect.bottom + padding
  const anchorTop = rect.top - padding
  const wantsBottom = anchorBottom + tipHeight + margin <= vh
  const top = wantsBottom ? anchorBottom + margin : Math.max(margin, anchorTop - tipHeight - margin)

  let left = rect.left + rect.width / 2 - tipWidth / 2
  left = Math.max(margin, Math.min(vw - tipWidth - margin, left))

  return { top, left }
}
