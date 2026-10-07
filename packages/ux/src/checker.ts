// SPDX-License-Identifier: MIT
/**
 * The checker: a second model that reviews each kept step and may roll it
 * back (ADR 0021). It never keeps anything the measurements rejected.
 *
 * - A visible change is judged from crops of the changed area, before and
 *   after, shown twice with the order swapped. Vision judges are near random
 *   on small UI differences (arxiv 2510.08783) and flip with order (arxiv
 *   2305.17926), so a step is rolled back only when both orders prefer the
 *   original with at least medium confidence. Anything else keeps it.
 * - A change with nothing visible (motion, haptics, another screen) is
 *   reviewed from its diff and the step it was meant to make.
 *
 * Transports: Claude Code (`claude -p`, the person's own sign-in, read-only
 * tools) or the Anthropic API (ANTHROPIC_API_KEY).
 */

import Anthropic from '@anthropic-ai/sdk'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import type { ChangeRegion } from './image.js'
import { run } from './proc.js'

export type CheckerVia = 'claude-code' | 'anthropic-api'

export interface CheckerSpec {
  via: CheckerVia
  model: string
}

export const DEFAULT_CHECKER: CheckerSpec = { via: 'claude-code', model: 'claude-opus-5-5' }

export interface CheckerVote {
  /** Which capture the model preferred, after mapping its A/B answer back. */
  preferred: 'before' | 'after' | 'tie'
  confidence: 'low' | 'medium' | 'high'
  difference: string
  reason: string
}

export interface CheckerVerdict {
  model: string
  mode: 'visual' | 'code'
  /** revert = roll the step back; keep = no objection; unsure = keep, the votes disagreed or were weak. */
  verdict: 'keep' | 'revert' | 'unsure'
  summary: string
  votes: CheckerVote[]
  costUsd: number | null
  /** The review could not run; the step is kept on its measurements. */
  error?: string
}

/** Crop height cap: a vision model shrinks tall images until text is unreadable. */
const MAX_CROP_HEIGHT = 1400
const MAX_DIFF_CHARS = 20_000
const CONTEXT_ROWS = 120

/** Pure: one box around all changed areas, padded, within the image, at most MAX_CROP_HEIGHT tall. */
export function unionBox(regions: readonly ChangeRegion[], width: number, height: number): ChangeRegion {
  if (!regions.length) return { x: 0, y: 0, w: width, h: Math.min(height, MAX_CROP_HEIGHT) }
  const y0 = Math.min(...regions.map((r) => r.y))
  const y1 = Math.max(...regions.map((r) => r.y + r.h))
  // Full width, plus some rows above and below, keeps the change in its layout context.
  const y = Math.max(0, y0 - CONTEXT_ROWS)
  return { x: 0, y, w: width, h: Math.max(1, Math.min(y1 + CONTEXT_ROWS - y, MAX_CROP_HEIGHT, height - y)) }
}

function crop(png: Buffer, box: ChangeRegion): Buffer {
  const src = PNG.sync.read(png)
  const w = Math.min(box.w, src.width - box.x)
  const h = Math.min(box.h, src.height - box.y)
  const out = new PNG({ width: Math.max(1, w), height: Math.max(1, h) })
  out.data.fill(255)
  if (w > 0 && h > 0) PNG.bitblt(src, out, box.x, box.y, w, h, 0, 0)
  return PNG.sync.write(out)
}

/** Pure: the first JSON object in a model's text answer, or null. */
export function firstJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

const level = (v: unknown): CheckerVote['confidence'] => (v === 'high' || v === 'medium' ? v : 'low')

/** Pure: map an A/B answer back to before/after. `aIsBefore` is the order shown. */
export function toVote(answer: Record<string, unknown> | null, aIsBefore: boolean): CheckerVote | null {
  if (!answer) return null
  const v = answer.verdict
  if (v !== 'A' && v !== 'B' && v !== 'tie') return null
  return {
    preferred: v === 'tie' ? 'tie' : (v === 'A') === aIsBefore ? 'before' : 'after',
    confidence: level(answer.confidence),
    difference: String(answer.difference ?? '').slice(0, 400),
    reason: String(answer.reason ?? '').slice(0, 600),
  }
}

/** Pure: the veto rule. Both orders must prefer the original, each with at least medium confidence. */
export function combineVotes(votes: CheckerVote[]): { verdict: CheckerVerdict['verdict']; summary: string } {
  const firm = (v: CheckerVote) => v.confidence !== 'low'
  if (votes.length >= 2 && votes.every((v) => v.preferred === 'before' && firm(v))) {
    return { verdict: 'revert', summary: `Both reviews preferred the original: ${votes[0].reason}` }
  }
  if (votes.length >= 2 && votes.every((v) => v.preferred === 'after')) {
    return { verdict: 'keep', summary: `Both reviews preferred the change: ${votes[0].reason}` }
  }
  return { verdict: 'unsure', summary: votes.length ? `The reviews disagreed or were unsure: ${votes.map((v) => v.preferred).join(' / ')}.` : 'No review answered.' }
}

const VISUAL_PROMPT = (step: string, screen: string) => `You review one small UI change made by a coding agent to the screen "${screen}".
The change it was asked to make: ${step}

Read the two images a.png and b.png in the current folder. They show the same area of the screen; one is before the change and one is after, in an order you are not told.
First describe the visible difference in one sentence. Then decide which is better for the person using this screen: clearer purpose and primary action, sensible visual weight, less noise, consistent with the rest of the screen, readable and tappable. If the difference is too small to matter, answer "tie".
Answer with ONLY this JSON: {"difference":"...","verdict":"A"|"B"|"tie","confidence":"low"|"medium"|"high","reason":"..."} where A is a.png and B is b.png.`

const CODE_PROMPT = (step: string, screen: string, diff: string) => `You review one small change a coding agent made to the screen "${screen}" of a web app. It changed nothing visible in a still screenshot, so judge it from the code.
The change it was asked to make: ${step}

The diff:
${diff}

Keep it when the diff makes that change (or a reasonable part of it) without breaking behaviour, accessibility or the design system. Revert it when it does nothing useful, does something else, or risks breaking the screen.
Answer with ONLY this JSON: {"verdict":"keep"|"revert","confidence":"low"|"medium"|"high","reason":"..."}`

interface Ask {
  text: string | null
  costUsd: number | null
  error?: string
}

/** One question to Claude Code, headless and read-only, in `cwd`. */
async function askClaudeCode(prompt: string, cwd: string, model: string, signal?: AbortSignal): Promise<Ask> {
  const args = ['-p', '--model', model, '--tools', 'Read', '--disallowedTools', 'mcp__*', '--permission-mode', 'dontAsk', '--max-turns', '4', '--no-session-persistence', '--output-format', 'json']
  let last: Ask = { text: null, costUsd: null, error: 'Claude Code did not run.' }
  // One retry: a call that failed in a second with no output (studio run on
  // glot.it, 2026-10-07) answered normally when repeated.
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (signal?.aborted) break
    const res = await run('claude', args, { cwd, stdin: prompt, shell: process.platform === 'win32', timeoutMs: 240_000, signal })
    if (res.timedOut) return { text: null, costUsd: null, error: 'Claude Code did not answer within 4 minutes.' }
    try {
      const j = JSON.parse(res.stdout) as { result?: unknown; total_cost_usd?: unknown; is_error?: unknown }
      if (!j.is_error) return { text: String(j.result ?? ''), costUsd: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : null }
      last = { text: null, costUsd: null, error: `Claude Code: ${String(j.result).slice(0, 300)}` }
    } catch {
      const said = `${res.stdout.trim().slice(0, 200)} ${res.tail.trim().slice(-300)}`.trim()
      last = { text: null, costUsd: null, error: `Claude Code exited ${res.exitCode}: ${said || 'no output on stdout or stderr'}` }
    }
    if (attempt === 1) await new Promise((r) => setTimeout(r, 5000))
  }
  return last
}

/** One question to the Anthropic API, with the images inline. */
async function askApi(prompt: string, images: Buffer[], model: string, client: Anthropic): Promise<Ask> {
  try {
    const msg = await client.messages.create({
      model,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            ...images.flatMap((png, i) => [
              { type: 'text' as const, text: i === 0 ? 'a.png:' : 'b.png:' },
              { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: png.toString('base64') } },
            ]),
            { type: 'text', text: prompt },
          ],
        },
      ],
    })
    return { text: msg.content.map((b) => (b.type === 'text' ? b.text : '')).join(''), costUsd: null }
  } catch (err) {
    return { text: null, costUsd: null, error: `Anthropic API: ${(err as Error).message.slice(0, 200)}` }
  }
}

export interface CheckStepInput {
  /** Run directory; review files go under checker/. */
  dir: string
  /** A unique name for this step's review files. */
  name: string
  screen: string
  step: string
  /** null: nothing visible changed, review the diff instead. */
  visual: { before: Buffer; after: Buffer; regions: ChangeRegion[] } | null
  diff: string
  spec: CheckerSpec
  signal?: AbortSignal
  client?: Anthropic
  /** Deterministic order for tests. */
  random?: () => number
}

export async function checkStep(input: CheckStepInput): Promise<CheckerVerdict> {
  const { spec } = input
  const base = join(input.dir, 'checker', input.name)
  const fail = (mode: CheckerVerdict['mode'], error: string): CheckerVerdict => ({ model: spec.model, mode, verdict: 'unsure', summary: '', votes: [], costUsd: null, error })
  let cost = 0
  const ask = async (prompt: string, cwd: string, images: Buffer[]): Promise<Ask> => {
    const a = spec.via === 'claude-code' ? await askClaudeCode(prompt, cwd, spec.model, input.signal) : await askApi(prompt, images, spec.model, input.client ?? new Anthropic())
    if (a.costUsd) cost += a.costUsd
    return a
  }

  if (!input.visual) {
    const diff = input.diff.slice(0, MAX_DIFF_CHARS)
    mkdirSync(base, { recursive: true })
    const a = await ask(CODE_PROMPT(input.step, input.screen, diff), base, [])
    if (a.error || !a.text) return fail('code', a.error ?? 'No answer.')
    const j = firstJson(a.text)
    if (!j || (j.verdict !== 'keep' && j.verdict !== 'revert')) return fail('code', 'The answer was not the expected JSON.')
    const confidence = level(j.confidence)
    const reason = String(j.reason ?? '').slice(0, 600)
    const verdict = j.verdict === 'revert' && confidence !== 'low' ? 'revert' : j.verdict === 'keep' ? 'keep' : 'unsure'
    return { model: spec.model, mode: 'code', verdict, summary: reason, votes: [{ preferred: j.verdict === 'keep' ? 'after' : 'before', confidence, difference: '', reason }], costUsd: cost || null }
  }

  const { before, after, regions } = input.visual
  const size = PNG.sync.read(before)
  const box = unionBox(regions, size.width, size.height)
  const b = crop(before, box)
  const a = crop(after, box)
  const firstIsBefore = (input.random ?? Math.random)() < 0.5
  const votes: CheckerVote[] = []
  for (const aIsBefore of [firstIsBefore, !firstIsBefore]) {
    const cwd = join(base, aIsBefore ? 'order-1' : 'order-2')
    mkdirSync(cwd, { recursive: true })
    const [imgA, imgB] = aIsBefore ? [b, a] : [a, b]
    writeFileSync(join(cwd, 'a.png'), imgA)
    writeFileSync(join(cwd, 'b.png'), imgB)
    const res = await ask(VISUAL_PROMPT(input.step, input.screen), cwd, [imgA, imgB])
    if (res.error || !res.text) return fail('visual', res.error ?? 'No answer.')
    const vote = toVote(firstJson(res.text), aIsBefore)
    if (!vote) return fail('visual', 'The answer was not the expected JSON.')
    votes.push(vote)
  }
  const { verdict, summary } = combineVotes(votes)
  return { model: spec.model, mode: 'visual', verdict, summary, votes, costUsd: cost || null }
}
