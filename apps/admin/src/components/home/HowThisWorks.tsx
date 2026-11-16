/**
 * FILE: apps/admin/src/components/home/HowThisWorks.tsx
 * PURPOSE: What Mushi does with a bug, in four plain steps, behind a one-line
 *          "How this works" disclosure.
 *
 *          The steps start open only for a brand-new app: no reports and no
 *          merged fix. A merged fix closes them even when the report count is
 *          still 0, so the four cards do not sit above Needs you. While the
 *          counts are unknown they stay closed, so a mature app never flashes
 *          the cards while setup is loading. Opening or closing is remembered
 *          per project in localStorage (same envelope as usePersistentState).
 *          A missing or unreadable value means "no choice yet", and the counts
 *          decide. Admin mode cannot do this: it is frozen to beginner.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DisclosurePanel } from '../ui'

const STEPS = [
  { title: 'A bug comes in', body: 'A user reports it from your app, or Mushi Mushi spots it on your live site or in your monitoring.', to: '/reports', link: 'Bug reports' },
  { title: 'Mushi Mushi explains it', body: 'You get a plain-English diagnosis: what broke, where, and how bad it is.', to: '/reports?status=open', link: 'Open bugs' },
  { title: 'An AI agent drafts the fix', body: 'A coding agent opens a pull request; a second model reviews it before anything merges.', to: '/fixes', link: 'Fixes' },
  { title: 'You ship it', body: 'Approved fixes ride a release train to your main branch, and Mushi Mushi checks the deploy went live.', to: '/pipeline', link: 'Pipeline' },
] as const

const STORAGE_VERSION = 1

function storageKey(projectId: string | null): string | null {
  return projectId ? `mushi:ui:${projectId}:home:how-this-works` : null
}

/** Stored choice, or null when the visitor has not chosen (or storage failed). */
function readChoice(projectId: string | null): boolean | null {
  const key = storageKey(projectId)
  if (!key || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (raw == null) return null
    const parsed = JSON.parse(raw) as { v?: unknown; value?: unknown } | null
    if (!parsed || typeof parsed !== 'object' || parsed.v !== STORAGE_VERSION || typeof parsed.value !== 'boolean') {
      return null
    }
    return parsed.value
  } catch {
    return null
  }
}

function writeChoice(projectId: string | null, open: boolean): void {
  const key = storageKey(projectId)
  if (!key || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify({ v: STORAGE_VERSION, value: open }))
  } catch {
    // Private mode or a full disk: the choice lasts for this view only.
  }
}

/** Open only when both counts are known and this app has not started the loop. */
export function howThisWorksStartsOpen(reportCount: number | null, mergedFixCount: number | null): boolean {
  if (reportCount == null || mergedFixCount == null) return false
  if (!Number.isFinite(reportCount) || !Number.isFinite(mergedFixCount)) return false
  return reportCount === 0 && mergedFixCount === 0
}

export function HowThisWorks({
  projectId,
  reportCount,
  mergedFixCount,
}: {
  projectId: string | null
  /** Null while setup has not resolved this app. */
  reportCount: number | null
  /** Null while setup has not resolved this app. A merged fix closes the steps. */
  mergedFixCount: number | null
}) {
  const startsOpen = howThisWorksStartsOpen(reportCount, mergedFixCount)
  const [scope, setScope] = useState(projectId)
  const [chosen, setChosen] = useState<boolean | null>(() => readChoice(projectId))

  // Switching apps must show that app's choice on this render, not the last one's.
  let seen = scope
  let choice = chosen
  if (seen !== projectId) {
    seen = projectId
    choice = readChoice(projectId)
    setScope(projectId)
    setChosen(choice)
  }

  const open = choice ?? startsOpen
  const setOpen = (next: boolean) => {
    setScope(projectId)
    setChosen(next)
    writeChoice(projectId, next)
  }

  return (
    <div data-testid="home-how-this-works">
      <DisclosurePanel title="How this works" open={open} onOpenChange={setOpen}>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="min-w-0">
              <p className="text-xs font-semibold text-fg">
                <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-subtle text-2xs text-brand-foreground">{i + 1}</span>
                {s.title}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">{s.body}</p>
              <Link to={s.to} className="mt-1 inline-block text-2xs text-link hover:underline">
                {s.link} →
              </Link>
            </li>
          ))}
        </ol>
      </DisclosurePanel>
    </div>
  )
}
