/**
 * Sanitized replay-derived signals for the dual-LLM air-gap.
 * Never passes raw DOM / user strings to Stage 2 — counts + buckets only.
 */

export interface ReplayEvidenceSummary {
  eventCount: number
  durationMs: number | null
  clickCount: number
  rageClickClusters: number
  deadTapCount: number
  lastInteractionKinds: string[]
}

type RrwebLikeEvent = { type?: number; timestamp?: number; data?: Record<string, unknown> }

/** rrweb IncrementalSnapshot + MouseInteraction source = 2, type Click = 2 */
const RRWEB_INCREMENTAL = 3
const MOUSE_INTERACTION_SOURCE = 2
const MOUSE_CLICK = 2

export function summarizeReplayEvents(raw: unknown): ReplayEvidenceSummary | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const events = raw as RrwebLikeEvent[]
  const firstTs = events.find((e) => typeof e.timestamp === 'number')?.timestamp ?? null
  const lastTs = [...events].reverse().find((e) => typeof e.timestamp === 'number')?.timestamp ?? null
  const durationMs = firstTs != null && lastTs != null ? Math.max(0, lastTs - firstTs) : null

  const clickTimestamps: number[] = []
  let deadTapCount = 0
  const kinds: string[] = []

  for (const e of events) {
    if (e.type === RRWEB_INCREMENTAL && e.data?.source === MOUSE_INTERACTION_SOURCE) {
      const interaction = e.data.type
      if (interaction === MOUSE_CLICK && typeof e.timestamp === 'number') {
        clickTimestamps.push(e.timestamp)
        kinds.push('click')
      }
    }
    if (e.data && typeof e.data === 'object' && (e.data as { deadTap?: boolean }).deadTap) {
      deadTapCount++
      kinds.push('dead_tap')
    }
  }

  // Rage-click heuristic: ≥3 clicks within 800ms window
  let rageClusters = 0
  for (let i = 0; i < clickTimestamps.length; i++) {
    const windowEnd = clickTimestamps[i]! + 800
    let count = 1
    for (let j = i + 1; j < clickTimestamps.length && clickTimestamps[j]! <= windowEnd; j++) count++
    if (count >= 3) {
      rageClusters++
      i += count - 1
    }
  }

  return {
    eventCount: events.length,
    durationMs,
    clickCount: clickTimestamps.length,
    rageClickClusters: rageClusters,
    deadTapCount,
    lastInteractionKinds: kinds.slice(-8),
  }
}
