// SPDX-License-Identifier: MIT
/**
 * The cheap, objective keep-or-revert decision after one agent run. It only
 * uses measurements (probes, pixel diff, files changed), never a model's
 * taste: an edit that makes any measured problem worse is rolled back, and an
 * edit with no visible effect is not worth a commit. Taste is the judge's job
 * (judge.ts), and the judge never auto-accepts.
 */

import { CLS_GOOD, probePenalty } from './probes.js'
import type { ProbeResult } from './types.js'

/** Below this share of changed pixels an edit counts as invisible. */
const MIN_VISIBLE_RATIO = 0.0005

export interface VerdictInput {
  filesChanged: number
  before: Record<string, ProbeResult>
  /** Null when the after-capture failed (page broke, axe failed, timeout). */
  after: Record<string, ProbeResult> | null
  pixelRatios: Record<string, number>
}

export interface Verdict {
  outcome: 'accepted' | 'rejected' | 'no_change' | 'capture_failed'
  reason: string
}

/**
 * The agent's own last message, from stream-json / json output (Cursor and
 * Claude Code both end with {"type":"result","result":"…"}), or null.
 */
export function agentFinalMessage(stdout: string): string | null {
  let last: string | null = null
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('{')) continue
    try {
      const j = JSON.parse(line) as { type?: string; result?: unknown }
      if (j.type === 'result' && typeof j.result === 'string' && j.result.trim()) last = j.result.trim()
    } catch {
      /* not JSON */
    }
  }
  return last
}

/**
 * Everything the agent wrote as messages, newlines kept, in order. For a run
 * stopped before its final result (a planning pass that ran out of time).
 * Reads Cursor and Claude Code stream-json `assistant` events.
 */
export function assistantText(stdout: string): string {
  const out: string[] = []
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('{')) continue
    try {
      const j = JSON.parse(line) as { type?: string; model_call_id?: unknown; message?: { content?: unknown } }
      if (j.type !== 'assistant' || j.model_call_id !== undefined || !Array.isArray(j.message?.content)) continue
      for (const c of j.message.content as Array<{ type?: string; text?: unknown }>) {
        if (c.type === 'text' && typeof c.text === 'string') out.push(c.text)
      }
    } catch {
      /* not JSON */
    }
  }
  return out.join('\n')
}

/** The agent said its tools were blocked or it could not read the prompt: it never really ran. */
const AGENT_BLOCKED_RE = /\b(could ?n[o'’]t|can ?not|cannot|unable to) (read|open|access|run|use)\b|\bhooks?\b.*\b(fail|error|block)|\b(blocked|stopped) before\b/i

/**
 * Pure: an edit-less attempt explained by the agent's own words. A blocked
 * agent is a failure, not "no change needed" (glot.it, 2026-10-06: Cursor's
 * hooks failed and every file read was refused, yet the screen showed as fine).
 */
export function explainNoEdit(final: string | null): { outcome: 'no_change' | 'agent_failed'; reason: string } {
  if (!final) return { outcome: 'no_change', reason: 'The agent made no edits.' }
  const said = final.length > 400 ? `…${final.slice(-400)}` : final
  if (AGENT_BLOCKED_RE.test(final)) return { outcome: 'agent_failed', reason: `The agent could not work on the screen: ${said}` }
  return { outcome: 'no_change', reason: `The agent made no edits: ${said}` }
}

/**
 * True when an after-shot's layout shift crossed the "good" line and rose:
 * worth one more look, because a dev server that just hot-reloaded shifts
 * on its own (glot.it /chat: 0.025 → 0.14 and 0.043 → 0.118, 2026-10-06).
 */
export function clsNeedsSecondLook(before: Record<string, ProbeResult>, after: Record<string, ProbeResult>): boolean {
  return Object.entries(after).some(([vp, now]) => now.cls > CLS_GOOD && now.cls > (before[vp]?.cls ?? 0))
}

/** The steadier of two readings per viewport: a real shift shows up both times. */
export function steadierCls(first: Record<string, ProbeResult>, second: Record<string, ProbeResult>): Record<string, ProbeResult> {
  return Object.fromEntries(
    Object.entries(first).map(([vp, p]) => [vp, second[vp] ? { ...p, cls: Math.min(p.cls, second[vp].cls) } : p]),
  )
}

/** Which measurements got worse, in words, so a rollback says what to fix. */
function whatRose(before: ProbeResult, now: ProbeResult): string[] {
  const out: string[] = []
  if (now.smallTargets > before.smallTargets) out.push(`tap targets under 24 px ${before.smallTargets} → ${now.smallTargets}`)
  if (now.cls > CLS_GOOD && now.cls > before.cls) out.push(`layout shift ${before.cls} → ${now.cls}`)
  const was = new Map(before.axe.map((v) => [v.id, v.count]))
  for (const v of now.axe) {
    if (v.count > (was.get(v.id) ?? 0)) out.push(`${v.id} ${was.get(v.id) ?? 0} → ${v.count} element(s)`)
  }
  return out
}

export function decide(input: VerdictInput): Verdict {
  if (input.filesChanged === 0) return { outcome: 'no_change', reason: 'The agent made no edits.' }
  if (!input.after) {
    return { outcome: 'capture_failed', reason: 'The screen could not be captured after the edit (it may no longer render).' }
  }
  const after = input.after
  const worse: string[] = []
  const summary: string[] = []
  for (const [vp, before] of Object.entries(input.before)) {
    const now = after[vp]
    if (!now) {
      worse.push(`${vp}: no capture after the edit`)
      continue
    }
    const pb = probePenalty(before)
    const pa = probePenalty(now)
    summary.push(`${vp} ${pb}→${pa}`)
    if (now.consoleErrors.length > before.consoleErrors.length) {
      worse.push(`${vp}: new console error "${now.consoleErrors[now.consoleErrors.length - 1]}"`)
    }
    if (now.overflowX && !before.overflowX) worse.push(`${vp}: the page now scrolls sideways`)
    const beforeIds = new Set(before.axe.map((v) => v.id))
    const newRules = now.axe.filter((v) => !beforeIds.has(v.id)).map((v) => v.id)
    if (newRules.length) worse.push(`${vp}: new accessibility violations ${newRules.join(', ')}`)
    if (pa > pb && worse.length === 0) {
      const rose = whatRose(before, now)
      worse.push(`${vp}: ${rose.length ? rose.join(', ') : 'measured problems rose'} (problem score ${pb} → ${pa})`)
    }
  }
  if (worse.length) return { outcome: 'rejected', reason: `Rolled back: ${worse.join('; ')}.` }
  const maxRatio = Math.max(0, ...Object.values(input.pixelRatios))
  if (maxRatio < MIN_VISIBLE_RATIO) {
    return { outcome: 'no_change', reason: `The edits changed ${input.filesChanged} file(s) but nothing visible on this screen.` }
  }
  return {
    outcome: 'accepted',
    reason: `Kept: problem score ${summary.join(', ')}; ${(maxRatio * 100).toFixed(1)}% of pixels changed.`,
  }
}
