/**
 * FILE: apps/admin/src/components/WhatsNew.tsx
 * PURPOSE: "What's new" popover sourced from /changelog.json. Shows an
 *          unread dot when the newest entry is younger than the
 *          `lastSeenAt` timestamp in localStorage, and clears it on open.
 *
 *          Pattern choice: JSON file shipped with the admin bundle, not
 *          a database table. Changelog content is a release concern and
 *          lives in code so the person writing the release note (usually
 *          whoever merged the PR) gets to craft the copy in the same
 *          diff as the feature. Zero migrations, zero runtime cost.
 */

import { useCallback, useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Badge } from './ui'

interface ChangelogHighlight {
  tone: 'feature' | 'fix' | 'breaking' | 'note'
  text: string
}

interface ChangelogEntry {
  id: string
  date: string
  title: string
  summary?: string
  highlights?: ChangelogHighlight[]
}

interface ChangelogFile {
  entries: ChangelogEntry[]
}

const STORAGE_KEY = 'mushi:whats-new:last-seen:v1'

function readLastSeen(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeLastSeen(date: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, date)
  } catch {
    // ignore
  }
}

const TONE_BADGE: Record<ChangelogHighlight['tone'], string> = {
  feature:  'bg-brand/15 text-brand border border-brand/30',
  fix:      'bg-ok-muted text-ok border border-ok/30',
  breaking: 'bg-danger/15 text-danger border border-danger/30',
  note:     'bg-surface-overlay text-fg-secondary border border-edge/60',
}

const TONE_LABEL: Record<ChangelogHighlight['tone'], string> = {
  feature: 'New',
  fix: 'Fix',
  breaking: 'Breaking',
  note: 'Note',
}

export function useWhatsNew() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([])
  const [lastSeen, setLastSeen] = useState<string | null>(() => readLastSeen())
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Resolve against Vite's BASE_URL so the demo, hosted under a
    // sub-path (e.g. https://kensaur.us/mushi-mushi/), still finds the
    // file. A bare leading-slash path would 404 there because it would
    // resolve to https://kensaur.us/changelog.json instead of
    // https://kensaur.us/mushi-mushi/changelog.json.
    const base = (import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '')
    // Cache-bust with a short TTL query so a freshly-deployed bundle is
    // still fetched even if the browser aggressively caches static JSON.
    fetch(`${base}/changelog.json?ts=${Math.floor(Date.now() / 60000)}`, { cache: 'force-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: ChangelogFile | null) => {
        if (cancelled || !j || !Array.isArray(j.entries)) return
        // Sort newest-first defensively so "unread" detection and
        // the modal order stay correct even if the JSON file is
        // appended to in publish order instead of prepended.
        const sorted = [...j.entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
        setEntries(sorted)
      })
      .catch(() => {
        // Changelog is purely informational — a failed fetch shouldn't
        // break the app shell. Dot just won't show.
      })
    return () => { cancelled = true }
  }, [])

  const newest = entries[0]?.date ?? null
  const hasUnread = Boolean(newest && (!lastSeen || newest > lastSeen))

  const openPanel = useCallback(() => {
    setOpen(true)
    if (newest) {
      writeLastSeen(newest)
      setLastSeen(newest)
    }
  }, [newest])

  const closePanel = useCallback(() => setOpen(false), [])

  return { entries, hasUnread, open, openPanel, closePanel, newest }
}

export function WhatsNewModal({
  open,
  onClose,
  entries,
}: {
  open: boolean
  onClose: () => void
  entries: ChangelogEntry[]
}) {
  return (
    <Modal open={open} onClose={onClose} title="What's new" size="lg">
      {entries.length === 0 ? (
        <p className="text-xs text-fg-muted">No release notes yet.</p>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => (
            <section key={entry.id} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-semibold text-fg">{entry.title}</h3>
                <span className="text-2xs font-mono text-fg-faint tabular-nums">{entry.date}</span>
              </div>
              {entry.summary && (
                <p className="text-xs text-fg-secondary leading-relaxed">{entry.summary}</p>
              )}
              {entry.highlights && entry.highlights.length > 0 && (
                <ul className="space-y-1.5">
                  {entry.highlights.map((h, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <Badge className={`${TONE_BADGE[h.tone]} shrink-0 text-2xs`}>
                        {TONE_LABEL[h.tone]}
                      </Badge>
                      <span className="text-xs text-fg-secondary leading-relaxed">{h.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </Modal>
  )
}
