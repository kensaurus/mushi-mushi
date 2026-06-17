'use client'

import { useEffect, useState } from 'react'

const VISITOR_KEY = 'mushi_roadmap_visitor'
const VOTED_KEY = 'mushi_roadmap_voted'

/** Stable per-browser visitor id so anonymous toggle votes are attributable. */
function getVisitorId(): string {
  try {
    let id = localStorage.getItem(VISITOR_KEY)
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `v_${Date.now()}_${Math.random().toString(36).slice(2)}`
      localStorage.setItem(VISITOR_KEY, id)
    }
    return id
  } catch {
    // Private mode / storage disabled — fall back to an ephemeral id. The
    // backend still hashes + dedups it, votes just won't persist across reloads.
    return `v_${Date.now()}_${Math.random().toString(36).slice(2)}`
  }
}

function readVotedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(VOTED_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

function persistVotedSet(set: Set<string>): void {
  try {
    localStorage.setItem(VOTED_KEY, JSON.stringify([...set]))
  } catch {
    // ignore — storage best-effort
  }
}

interface VoteButtonProps {
  apiUrl: string
  slug: string
  requestId: string
  initialVoteCount: number
}

export function VoteButton({ apiUrl, slug, requestId, initialVoteCount }: VoteButtonProps) {
  const [voted, setVoted] = useState(false)
  const [count, setCount] = useState(initialVoteCount)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    setVoted(readVotedSet().has(requestId))
  }, [requestId])

  async function handleVote() {
    if (pending || !apiUrl) return
    setPending(true)

    // Optimistic toggle.
    const nextVoted = !voted
    setVoted(nextVoted)
    setCount((c) => Math.max(0, c + (nextVoted ? 1 : -1)))

    try {
      const res = await fetch(`${apiUrl}/v1/public/roadmap/${slug}/${requestId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId: getVisitorId() }),
      })
      if (!res.ok) throw new Error(`vote failed: ${res.status}`)
      const data = (await res.json()) as { voted?: boolean }
      // Reconcile with the server's authoritative toggle result.
      const serverVoted = typeof data.voted === 'boolean' ? data.voted : nextVoted
      if (serverVoted !== nextVoted) {
        setVoted(serverVoted)
        setCount((c) => Math.max(0, c + (serverVoted ? 1 : -1) - (nextVoted ? 1 : -1)))
      }
      const set = readVotedSet()
      if (serverVoted) set.add(requestId)
      else set.delete(requestId)
      persistVotedSet(set)
    } catch {
      // Roll back the optimistic update on failure.
      setVoted(voted)
      setCount((c) => Math.max(0, c + (nextVoted ? -1 : 1)))
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleVote}
      disabled={pending}
      aria-pressed={voted}
      aria-label={voted ? 'Remove your vote' : 'Vote for this feature'}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium motion-safe:transition-colors disabled:opacity-60 ${
        voted
          ? 'border border-[color-mix(in_oklch,var(--mushi-vermillion)_45%,var(--mushi-rule))] bg-[var(--mushi-vermillion-wash)] text-[var(--mushi-vermillion)] hover:opacity-90'
          : 'testers-cta'
      }`}
      data-vote-id={requestId}
    >
      <span aria-hidden>▲</span>
      <span className="tabular-nums">{count}</span>
    </button>
  )
}
