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
 *   - Forward-compatible: a `<SyncCta>` placeholder hangs off the bottom
 *     toolbar; Phase 2 swaps it for a real "Sign in to sync" button without
 *     touching the checklist itself.
 *
 * NOT in scope here:
 *   - Server sync. That's Phase 2 of the Migration Hub plan and lives in
 *     `useMigrationProgressSync()` (to be added).
 *   - Reordering steps. Steps are positional + ID'd so authors can rename a
 *     step's label without losing user progress, but reordering is a content
 *     decision — we don't try to merge old completion state into new
 *     positions.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

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

  const toggle = useCallback(
    (stepId: string) => {
      setCompleted((prev) => {
        const next = new Set(prev)
        if (next.has(stepId)) next.delete(stepId)
        else next.add(stepId)
        safeWrite(id, next)
        return next
      })
    },
    [id],
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
    if (typeof window !== 'undefined') {
      const ok = window.confirm('Reset progress for this migration?')
      if (!ok) return
    }
    setCompleted(new Set())
    safeWrite(id, new Set())
  }, [id])

  const markAll = useCallback(() => {
    const all = new Set(steps.map((s) => s.id))
    setCompleted(all)
    safeWrite(id, all)
  }, [id, steps])

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

      <SyncCta hydrated={hydrated} hasProgress={requiredDone > 0} />
    </section>
  )
}

/* ── Sync placeholder ───────────────────────────────────────────────────
 * Phase 2 turns this into a real "Sign in to sync to your Mushi account"
 * button (popup OAuth back to the admin console + postMessage). For now
 * we only render a hint so authors don't have to update every guide later.
 *
 * Hidden when the user has zero progress, to avoid nagging anonymous
 * readers who are just skimming the doc. */

function SyncCta({ hydrated, hasProgress }: { hydrated: boolean; hasProgress: boolean }) {
  if (!hydrated || !hasProgress) return null
  return (
    <footer className="border-t border-neutral-200 bg-white/40 px-4 py-2 text-[11px] text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400">
      Progress is saved in this browser only.{' '}
      <span aria-hidden className="opacity-50">
        Sync to your Mushi account — coming soon.
      </span>
    </footer>
  )
}
