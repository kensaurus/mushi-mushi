'use client'

/**
 * FILE: apps/docs/components/MigrationChecklist.tsx
 * PURPOSE: Interactive per-step checklist embedded inside a migration guide.
 *
 *   <MigrationChecklist
 *     id="cordova-to-capacitor"
 *     steps={[
 *       { id: 'init',    label: 'npx cap init' },
 *       { id: 'platforms', label: 'Add iOS + Android platforms' },
 *       ...
 *     ]}
 *   />
 *
 * BEHAVIOUR
 *   - Anonymous-first: progress persists to `localStorage` under
 *     `mushi:migration:<id>:steps` as a JSON array of completed step IDs.
 *     Zero-config; works offline; never asks for sign-in.
 *   - Stable across SSR: state hydrates from `localStorage` inside
 *     `useEffect`, so the server-rendered output stays consistent and React
 *     does not warn about hydration mismatches.
 *   - Accessible: each row is a real `<label>` wrapping a checkbox so screen
 *     readers announce state changes correctly. Bulk actions live in a
 *     keyboard-reachable toolbar.
 *   - Opt-in cloud sync: the footer `<SyncCta>` opens an admin popup auth
 *     bridge (apps/docs/lib/migrationProgress.ts → openAdminAuthBridge).
 *     The popup hands back a short-lived JWT via postMessage; the docs
 *     never store a refresh token. Sync NEVER blocks local checklist use
 *     — every checkbox keeps working when the bridge is closed, expired,
 *     or the user is offline.
 *
 * NOT in scope here:
 *   - Reordering steps. Steps are positional + ID'd so authors can rename a
 *     step's label without losing user progress, but reordering is a content
 *     decision — we don't try to merge old completion state into new
 *     positions.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  clearRemoteProgress,
  fetchRemoteProgress,
  getDocsAuthSession,
  mergeProgress,
  openAdminAuthBridge,
  pushProgress,
  signOutDocs,
  type DocsAuthSession,
} from '../lib/migrationProgress'

export interface MigrationStep {
  /** Stable identifier — used as the localStorage key entry. Once shipped,
   *  treat as part of the public API: renaming an ID resets that step's
   *  progress for every user. */
  id: string
  /** Plain text or rich JSX shown next to the checkbox. */
  label: ReactNode
  /** Optional sub-content (code block, callout, link list) rendered below
   *  the label when the step is expanded — see `defaultOpen`. */
  content?: ReactNode
  /** When true, the step counts as informational and is ignored from
   *  progress totals. Use sparingly (e.g. "read this section" reminders). */
  optional?: boolean
}

export interface MigrationChecklistProps {
  /** Stable guide identifier — must match the slug under
   *  apps/docs/content/migrations/. Used as the localStorage namespace. */
  id: string
  steps: MigrationStep[]
  /** When true, every step's `content` is shown by default. Defaults to
   *  false (collapsed) so the page reads as a TOC, not a wall of text. */
  defaultOpen?: boolean
}

const STORAGE_PREFIX = 'mushi:migration:'

/** Read-modify-write helpers that no-op on the server and survive private
 *  mode / quota errors. We never let a localStorage hiccup take down the
 *  page — the worst case is an unsaved checkbox toggle. */
function safeRead(id: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${id}:steps`)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is string => typeof v === 'string'))
  } catch {
    return new Set()
  }
}

function safeWrite(id: string, completed: Set<string>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${id}:steps`,
      JSON.stringify(Array.from(completed)),
    )
  } catch {
    /* Quota exceeded / private mode — silently degrade. */
  }
}

/** Cross-tab sync. If the user has the same guide open in two tabs and ticks
 *  a box in one, the other reflects it. We listen to `storage` events for
 *  our prefix only. */
function useStorageSync(id: string, onChange: (next: Set<string>) => void) {
  useEffect(() => {
    const key = `${STORAGE_PREFIX}${id}:steps`
    const handler = (e: StorageEvent) => {
      if (e.key !== key) return
      onChange(safeRead(id))
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [id, onChange])
}

export function MigrationChecklist({ id, steps, defaultOpen = false }: MigrationChecklistProps) {
  const [completed, setCompleted] = useState<Set<string>>(() => new Set())
  const [openIds, setOpenIds] = useState<Set<string>>(() =>
    defaultOpen ? new Set(steps.map((s) => s.id)) : new Set(),
  )
  const [hydrated, setHydrated] = useState(false)
  const initialReadDone = useRef(false)
  const allStepIds = useMemo(() => steps.map((s) => s.id), [steps])

  // Hydrate from localStorage AFTER mount to keep SSR markup stable.
  useEffect(() => {
    if (initialReadDone.current) return
    initialReadDone.current = true
    setCompleted(safeRead(id))
    setHydrated(true)
  }, [id])

  useStorageSync(id, setCompleted)

  const requiredSteps = useMemo(() => steps.filter((s) => !s.optional), [steps])
  const requiredDone = useMemo(
    () => requiredSteps.filter((s) => completed.has(s.id)).length,
    [requiredSteps, completed],
  )
  const total = requiredSteps.length
  const pct = total === 0 ? 0 : Math.round((requiredDone / total) * 100)

  const requiredStepIds = useMemo(() => requiredSteps.map((s) => s.id), [requiredSteps])

  // ── opt-in cloud sync ─────────────────────────────────────────────────
  const sync = useMigrationProgressSync({
    guideSlug: id,
    knownStepIds: allStepIds,
    requiredStepIds,
    requiredStepCount: total,
    completed,
    onMerged: useCallback(
      (mergedIds: string[]) => {
        // Apply the union of local + remote to local state AND localStorage,
        // so the merge survives a refresh even before the next push.
        const next = new Set(mergedIds)
        setCompleted(next)
        safeWrite(id, next)
      },
      [id],
    ),
  })

  const toggle = useCallback(
    (stepId: string) => {
      setCompleted((prev) => {
        const next = new Set(prev)
        if (next.has(stepId)) next.delete(stepId)
        else next.add(stepId)
        safeWrite(id, next)
        sync.scheduleSync(next)
        return next
      })
    },
    [id, sync],
  )

  const toggleOpen = useCallback((stepId: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    /* Cancel BEFORE the confirm() blocks the event loop. If the user
     * toggled a step within the last 600ms, scheduleSync queued a PUT that
     * is timing-due during the modal block; once the modal returns the
     * timer fires and lands AFTER our DELETE, silently re-creating the
     * row with the pre-reset step set. Cancelling first removes that race
     * window entirely. */
    sync.cancelPendingSync()
    if (typeof window !== 'undefined') {
      const ok = window.confirm('Reset progress for this migration?')
      if (!ok) return
    }
    setCompleted(new Set())
    safeWrite(id, new Set())
    void sync.clearRemote()
  }, [id, sync])

  const markAll = useCallback(() => {
    /* Same race as `reset` (a stale PUT for a partial set could land after
     * our full-set PUT and walk back the user's "mark all" intent).
     * Cancel any pending debounce before scheduling the fresh push. */
    sync.cancelPendingSync()
    const all = new Set(steps.map((s) => s.id))
    setCompleted(all)
    safeWrite(id, all)
    sync.scheduleSync(all)
  }, [id, steps, sync])

  const allDone = hydrated && total > 0 && requiredDone === total

  return (
    <section
      aria-label="Migration checklist"
      className="my-6 overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-white/60 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900/60">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-neutral-200 bg-white text-xs font-semibold dark:border-neutral-700 dark:bg-neutral-900"
          >
            {hydrated ? `${requiredDone}` : '–'}
          </span>
          <div className="text-sm">
            <div className="font-medium text-neutral-900 dark:text-neutral-100">
              Migration checklist
            </div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              {hydrated
                ? allDone
                  ? 'All required steps complete'
                  : `${requiredDone} of ${total} required steps complete (saved in this browser)`
                : `${total} required steps`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={markAll}
            disabled={!hydrated || allDone}
            className="rounded-md px-2 py-1 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            Mark all
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={!hydrated || requiredDone === 0}
            className="rounded-md px-2 py-1 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            Reset
          </button>
        </div>
      </header>

      {/* Progress bar */}
      <div className="h-1 w-full bg-neutral-200 dark:bg-neutral-800">
        <div
          className="h-full bg-emerald-500 transition-all duration-300 ease-out dark:bg-emerald-400"
          style={{ width: `${hydrated ? pct : 0}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Migration ${pct}% complete`}
        />
      </div>

      <ol className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {steps.map((step, index) => {
          const isDone = completed.has(step.id)
          const isOpen = openIds.has(step.id)
          const hasContent = step.content !== undefined
          return (
            <li key={step.id} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <label className="mt-0.5 flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={isDone}
                    onChange={() => toggle(step.id)}
                    className="h-4 w-4 cursor-pointer rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500 dark:border-neutral-600 dark:bg-neutral-800"
                    aria-label={`Mark step ${index + 1} complete`}
                  />
                </label>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span
                      className={`font-mono text-[10px] uppercase tracking-[0.18em] ${
                        isDone ? 'text-emerald-700 dark:text-emerald-400' : 'text-neutral-500 dark:text-neutral-400'
                      }`}
                    >
                      Step {String(index + 1).padStart(2, '0')}
                    </span>
                    {step.optional && (
                      <span className="rounded-full border border-neutral-300 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                        optional
                      </span>
                    )}
                  </div>
                  <div
                    className={`mt-0.5 text-sm ${
                      isDone
                        ? 'text-neutral-500 line-through dark:text-neutral-500'
                        : 'text-neutral-900 dark:text-neutral-100'
                    }`}
                  >
                    {step.label}
                  </div>
                  {hasContent && isOpen && (
                    <div className="mt-2 rounded-md border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
                      {step.content}
                    </div>
                  )}
                </div>
                {hasContent && (
                  <button
                    type="button"
                    onClick={() => toggleOpen(step.id)}
                    aria-expanded={isOpen}
                    aria-label={isOpen ? 'Hide step details' : 'Show step details'}
                    className="ml-2 self-start rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      aria-hidden
                      className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    >
                      <path
                        d="M3 5l4 4 4-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      <SyncCta
        hydrated={hydrated}
        hasProgress={requiredDone > 0}
        sync={sync}
      />
    </section>
  )
}

/* ── Cloud-sync hook ────────────────────────────────────────────────────
 * Quiet by design. Reasoning per NN/g #1 (visibility of system status):
 *  - Idle / signed-out → footer reads "Saved in this browser. Sign in to
 *    sync to your Mushi account."
 *  - Syncing → footer reads "Syncing…" and the action is disabled.
 *  - Synced → footer reads "Synced just now / 2m ago" with a discreet
 *    Sign out link.
 *  - Error → footer reads the failure plus a Retry; the checklist itself
 *    keeps working off localStorage so the user is never blocked.
 * Anonymous users with zero progress see no sync UI at all (NN/g #8). */

type SyncState =
  | { status: 'idle'; session: null }
  | { status: 'signing-in'; session: null }
  | { status: 'syncing'; session: DocsAuthSession; lastSyncedAt: number | null }
  | { status: 'synced'; session: DocsAuthSession; lastSyncedAt: number }
  | { status: 'error'; session: DocsAuthSession | null; message: string; lastSyncedAt: number | null }

interface SyncApi {
  state: SyncState
  signIn: () => void
  signOut: () => void
  scheduleSync: (next: Set<string>) => void
  /** Discard any debounced push that hasn't fired yet. The caller MUST
   *  invoke this before doing a destructive remote write (Reset → DELETE,
   *  Mark all → fresh PUT) — otherwise an in-flight 600ms timer can land
   *  AFTER the destructive op and silently re-create / overwrite the row
   *  with the pre-action checked-step set. */
  cancelPendingSync: () => void
  clearRemote: () => Promise<void>
}

interface UseMigrationProgressSyncArgs {
  guideSlug: string
  knownStepIds: readonly string[]
  /** Required (non-optional) step IDs. Used by `countRequiredDone` to
   *  compute `completedRequiredCount` directly from a step-id set instead
   *  of from the parent's `requiredDone` derived value — necessary for
   *  the initial-sync push where `setCompleted` has fired but React
   *  hasn't re-rendered yet, so the parent's count would still hold the
   *  pre-merge total. Same reasoning applies to back-to-back toggles
   *  inside the 600ms debounce window. */
  requiredStepIds: readonly string[]
  requiredStepCount: number
  completed: Set<string>
  onMerged: (mergedIds: string[]) => void
}

/** Count how many of `mergedIds` are also in `requiredStepIds`. Pure
 *  function so the initial-sync push and the debounced push can both read
 *  from the SAME source of truth (the merged step-id list) instead of from
 *  a stale React ref that hasn't caught up to the latest setCompleted. */
function countRequiredDone(
  mergedIds: readonly string[],
  requiredStepIds: readonly string[],
): number {
  if (requiredStepIds.length === 0) return 0
  const required = new Set(requiredStepIds)
  let n = 0
  for (const id of mergedIds) if (required.has(id)) n += 1
  return n
}

function useMigrationProgressSync(args: UseMigrationProgressSyncArgs): SyncApi {
  const {
    guideSlug,
    knownStepIds,
    requiredStepIds,
    requiredStepCount,
    completed,
    onMerged,
  } = args
  // Read the persisted session once; keying initial UI off this lets a
  // returning user see "Syncing…" instead of the misleading "Synced just
  // now" the previous initial state produced (lastSyncedAt was null but
  // the status was 'synced'). The initial-fetch effect below promotes
  // state to 'synced' once the first round-trip actually completes.
  const [state, setState] = useState<SyncState>(() => {
    const initialSession = getDocsAuthSession()
    if (initialSession) {
      return { status: 'syncing', session: initialSession, lastSyncedAt: null }
    }
    return { status: 'idle', session: null }
  })
  const knownStepIdsRef = useRef(knownStepIds)
  knownStepIdsRef.current = knownStepIds
  const requiredStepIdsRef = useRef(requiredStepIds)
  requiredStepIdsRef.current = requiredStepIds
  const onMergedRef = useRef(onMerged)
  onMergedRef.current = onMerged
  const completedRef = useRef(completed)
  completedRef.current = completed
  const requiredStepCountRef = useRef(requiredStepCount)
  requiredStepCountRef.current = requiredStepCount
  const pendingSync = useRef<number | null>(null)

  // React to auth changes (sign-in popup, sign-out, expiry).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => {
      const session = getDocsAuthSession()
      /* Same reasoning as the signIn callback below: a fresh session is
       * NOT a fresh sync. The `mushi:docs:auth-change` event fires from
       * `persistDocsAuthSession` and `signOutDocs` in
       * apps/docs/lib/migrationProgress.ts — both of which run BEFORE any
       * data round-trip. Lighting up "Synced just now" here would lie to
       * the user; the initial-fetch effect below will promote 'syncing'
       * to 'synced' once a real round-trip lands. */
      setState(
        session
          ? { status: 'syncing', session, lastSyncedAt: null }
          : { status: 'idle', session: null },
      )
    }
    window.addEventListener('mushi:docs:auth-change', handler)
    return () => window.removeEventListener('mushi:docs:auth-change', handler)
  }, [])

  // First fetch + merge on session ready.
  const initialFetchedFor = useRef<string | null>(null)
  useEffect(() => {
    const session = state.session
    if (!session) {
      initialFetchedFor.current = null
      return
    }
    const fetchKey = `${session.accessToken}:${guideSlug}`
    if (initialFetchedFor.current === fetchKey) return
    initialFetchedFor.current = fetchKey

    void (async () => {
      try {
        // Build the syncing state explicitly. A `...prev` spread off an
        // 'idle' or 'signing-in' variant would omit the required
        // `lastSyncedAt` field; the `as SyncState` cast would silently
        // hide the missing field at the type layer.
        setState((prev) => ({
          status: 'syncing',
          session,
          lastSyncedAt: prev.status === 'synced' ? prev.lastSyncedAt : null,
        }))
        const remote = await fetchRemoteProgress(session, guideSlug)
        const merge = mergeProgress(
          knownStepIdsRef.current,
          Array.from(completedRef.current),
          remote?.completedStepIds ?? null,
        )
        if (merge.localChanged) onMergedRef.current(merge.merged)
        if (merge.remoteIsBehind) {
          /* Derive the count from `merge.merged` directly. We CANNOT use
           * the parent component's `requiredDone` (or a ref shadowing it)
           * here: the onMerged callback above just queued a `setCompleted`,
           * but React won't re-render (and therefore won't refresh the
           * parent's derived `requiredDone`) until after this async block
           * returns. Reading any ref tracking that value would send a
           * count lower than the merged-step set actually warrants —
           * leaving the admin in-progress card under-reporting until the
           * user's next toggle triggers a fresh push. */
          await pushProgress(session, {
            guideSlug,
            completedStepIds: merge.merged,
            requiredStepCount: requiredStepCountRef.current,
            completedRequiredCount: countRequiredDone(
              merge.merged,
              requiredStepIdsRef.current,
            ),
          })
        }
        setState({ status: 'synced', session, lastSyncedAt: Date.now() })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sync failed'
        setState((prev) => ({
          status: 'error',
          session: prev.session,
          message,
          lastSyncedAt: prev.status === 'synced' ? prev.lastSyncedAt : null,
        }))
      }
    })()
  }, [guideSlug, state.session])

  // Debounced push on subsequent toggles.
  const scheduleSync = useCallback(
    (next: Set<string>) => {
      const session = getDocsAuthSession()
      if (!session) return
      if (pendingSync.current) window.clearTimeout(pendingSync.current)
      pendingSync.current = window.setTimeout(() => {
        pendingSync.current = null
        void (async () => {
          try {
            setState((prev) => ({
              status: 'syncing',
              session,
              lastSyncedAt: prev.status === 'synced' ? prev.lastSyncedAt : null,
            }))
            /* Filter to known steps and derive the required-done count from
             * the SAME filtered list. This kills two bugs at once:
             *   1. Stale value: a ref tracking the parent's `requiredDone`
             *      would lag the latest toggle while React renders, so
             *      back-to-back toggles could push a count for the wrong
             *      revision of the step set.
             *   2. Drift: if the user's local set has a stale step ID we
             *      no longer know about, filtering it out here keeps the
             *      pushed count consistent with what we actually send. */
            const filteredCompleted = Array.from(next).filter((id) =>
              knownStepIdsRef.current.includes(id),
            )
            await pushProgress(session, {
              guideSlug,
              completedStepIds: filteredCompleted,
              requiredStepCount: requiredStepCountRef.current,
              completedRequiredCount: countRequiredDone(
                filteredCompleted,
                requiredStepIdsRef.current,
              ),
            })
            setState({ status: 'synced', session, lastSyncedAt: Date.now() })
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Sync failed'
            setState((prev) => ({
              status: 'error',
              session: prev.session,
              message,
              lastSyncedAt: prev.status === 'synced' ? prev.lastSyncedAt : null,
            }))
          }
        })()
      }, 600)
    },
    [guideSlug],
  )

  const cancelPendingSync = useCallback(() => {
    if (pendingSync.current !== null) {
      window.clearTimeout(pendingSync.current)
      pendingSync.current = null
    }
  }, [])

  const signIn = useCallback(() => {
    setState({ status: 'signing-in', session: null })
    void openAdminAuthBridge()
      .then((session) => {
        /* Land on 'syncing' (NOT 'synced') the moment the bridge resolves.
         * We have a session but the initial fetch + merge + push round-trip
         * hasn't happened yet — the effect at `useEffect([state.session])`
         * below will run on the next tick and walk through 'syncing' →
         * 'synced'. If we set 'synced' here the SyncCta footer briefly
         * shows "Synced just now" with `Date.now()` BEFORE any data has
         * actually been confirmed in sync, then flickers to "Syncing…"
         * once the effect overrides it. Mirrors the initial-state branch
         * at line ~451 which uses 'syncing' for the same reason. */
        setState({ status: 'syncing', session, lastSyncedAt: null })
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Sign-in cancelled'
        setState({ status: 'error', session: null, message, lastSyncedAt: null })
      })
  }, [])

  const signOut = useCallback(() => {
    signOutDocs()
    setState({ status: 'idle', session: null })
  }, [])

  const clearRemote = useCallback(async () => {
    const session = getDocsAuthSession()
    if (!session) return
    try {
      await clearRemoteProgress(session, guideSlug)
    } catch {
      /* clearing the local copy already happened; surfacing this is noisy */
    }
  }, [guideSlug])

  return { state, signIn, signOut, scheduleSync, cancelPendingSync, clearRemote }
}

function relativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp
  if (diffMs < 0) return 'just now'
  const seconds = Math.round(diffMs / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function SyncCta({
  hydrated,
  hasProgress,
  sync,
}: {
  hydrated: boolean
  hasProgress: boolean
  sync: SyncApi
}) {
  // Re-render every minute so "synced 2m ago" stays accurate without
  // needing a global ticker. Cheap and only runs when the row is mounted.
  const [, force] = useState(0)
  useEffect(() => {
    if (sync.state.status !== 'synced') return
    const t = window.setInterval(() => force((n) => n + 1), 60_000)
    return () => window.clearInterval(t)
  }, [sync.state.status])

  if (!hydrated) return null
  // Anonymous reader with zero progress → no chrome at all.
  if (!hasProgress && sync.state.status === 'idle') return null

  const baseRow =
    'flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 bg-white/40 px-4 py-2 text-[11px] text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400'

  const linkClass =
    'font-medium text-emerald-700 hover:underline disabled:cursor-wait disabled:opacity-60 dark:text-emerald-400'

  switch (sync.state.status) {
    case 'idle':
      return (
        <footer className={baseRow}>
          <span>Saved in this browser only.</span>
          <button type="button" onClick={sync.signIn} className={linkClass}>
            Sign in to sync
          </button>
        </footer>
      )
    case 'signing-in':
      return (
        <footer className={baseRow}>
          <span>Opening Mushi sign-in…</span>
          <button type="button" disabled className={linkClass}>
            Sign in to sync
          </button>
        </footer>
      )
    case 'syncing':
      return (
        <footer className={baseRow}>
          <span>Syncing…</span>
          <span className="opacity-60">{sync.state.session.email ?? 'Mushi account'}</span>
        </footer>
      )
    case 'synced': {
      const when = sync.state.lastSyncedAt ? relativeTime(sync.state.lastSyncedAt) : 'just now'
      return (
        <footer className={baseRow}>
          <span>
            Synced {when}
            {sync.state.session.email ? (
              <>
                {' '}as <span className="opacity-80">{sync.state.session.email}</span>
              </>
            ) : null}
          </span>
          <button type="button" onClick={sync.signOut} className={linkClass}>
            Sign out
          </button>
        </footer>
      )
    }
    case 'error':
      return (
        <footer className={baseRow}>
          <span className="text-amber-700 dark:text-amber-400">{sync.state.message}</span>
          <button type="button" onClick={sync.signIn} className={linkClass}>
            {sync.state.session ? 'Retry' : 'Sign in to sync'}
          </button>
        </footer>
      )
  }
}
