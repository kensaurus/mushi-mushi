// SPDX-License-Identifier: MIT
/**
 * Final review by a different model: for each screen the loop changed, one
 * pairwise comparison of the original against the kept version, per
 * viewport, grounded in the repo's design tokens and the measured probe
 * deltas.
 *
 * Why pairwise and evidence-bound: open-ended screenshot critique is mostly
 * wrong (Baymard measured an 80% error rate for GPT-4 UX audits; UICrit found
 * 13% of zero-shot critiques valid). Asking "which is better, and point at
 * where" is a narrower question, every claim must carry a bounding box, and
 * the two images are shown in random order so the model cannot learn that
 * "the second one is the new one".
 *
 * The judge advises; it never reverts or keeps anything. Runs on the
 * person's own Anthropic credentials.
 */

import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { cropTop } from './image.js'
import type { SurfaceState } from './state.js'
import type { ProbeResult } from './types.js'

export const DEFAULT_JUDGE_MODEL = 'claude-opus-5-5'
const MAX_DESIGN_CHARS = 16_000

const Box = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
})

const Claim = z.object({
  image: z.enum(['A', 'B']),
  box: Box,
  what: z.string(),
  why: z.string(),
})

const JudgeOutput = z.object({
  preferred: z.enum(['A', 'B', 'tie']),
  confidence: z.enum(['low', 'medium', 'high']),
  summary: z.string(),
  better: z.array(Claim),
  worse: z.array(Claim),
  design_system_breaks: z.array(
    Claim.extend({
      token_or_rule: z.string(),
    }),
  ),
})
type JudgeOutputT = z.infer<typeof JudgeOutput>

export interface JudgeClaim {
  /** Which capture the claim points at, after un-shuffling. */
  image: 'before' | 'after'
  box: { x: number; y: number; width: number; height: number }
  what: string
  why: string
  tokenOrRule?: string
}

export interface JudgeVerdict {
  viewport: string
  model: string
  preferred: 'before' | 'after' | 'tie'
  confidence: 'low' | 'medium' | 'high'
  summary: string
  better: JudgeClaim[]
  worse: JudgeClaim[]
  designBreaks: JudgeClaim[]
  /** Claims dropped because their box fell outside the image. */
  droppedClaims: number
  /** Set when the model declined or the call failed; no verdict then. */
  error?: string
}

const RUBRIC = `You review UI changes for a solo developer. You will see two screenshots of the same screen, labelled A and B, in random order. One is the original and one was edited by a coding agent. You are not told which is which.

Decide which one is better for the person using this screen, judged on:
1. Clarity: is the screen's purpose and primary action obvious within a few seconds?
2. Hierarchy: does visual weight (size, colour, position) match importance?
3. Density: is there less noise (duplicated info, wordy copy, competing calls to action) without losing needed information?
4. Consistency with the design system given below (tokens, spacing scale, type scale, components). Ignore taste that the design system does not support.
5. Accessibility you can see: contrast, text size, target size, focus or state indicators.

Measured numbers for both images are provided (accessibility violations, sideways scroll, small tap targets, console errors). Treat them as facts; do not contradict them.

Rules for claims:
- Every claim points at a region with a box in that image's pixel coordinates (origin top-left).
- Only claim what is visible in the screenshots. Do not guess about interactions, data, or other screens.
- Prefer few, specific claims over many generic ones. Generic advice ("make it responsive", "add more whitespace") is not a claim.
- If the two are equally good, or the difference is too small to matter, answer "tie".
- "design_system_breaks" lists places in either image that visibly break the given tokens or rules; name the token or rule.`

export interface JudgeOptions {
  dir: string
  repoRoot: string
  designFiles: string[]
  model?: string
  client?: Anthropic
  /** Deterministic order for tests; defaults to Math.random. */
  random?: () => number
}

function designContext(repoRoot: string, files: string[]): string {
  let out = ''
  for (const f of files) {
    if (out.length >= MAX_DESIGN_CHARS) break
    try {
      const text = readFileSync(join(repoRoot, f), 'utf8')
      out += `\n--- ${f} ---\n${text.slice(0, MAX_DESIGN_CHARS - out.length)}\n`
    } catch {
      /* unreadable file: skip */
    }
  }
  return out || '(No design-system files found. Judge consistency against the rest of the screen.)'
}

function probeLine(label: string, p: ProbeResult): string {
  const axe = p.axe.map((v) => `${v.id}×${v.count}`).join(', ') || 'none'
  return `${label}: accessibility violations ${axe}; sideways scroll ${p.overflowX ? 'yes' : 'no'}; small tap targets ${p.smallTargets}; console errors ${p.consoleErrors.length}; layout shift ${p.cls}`
}

function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** Pure: map the shuffled A/B answer back to before/after and drop out-of-image claims. */
export function unshuffle(
  out: JudgeOutputT,
  aIsBefore: boolean,
  sizes: { A: { width: number; height: number }; B: { width: number; height: number } },
  viewport: string,
  model: string,
): JudgeVerdict {
  const side = (img: 'A' | 'B'): 'before' | 'after' => ((img === 'A') === aIsBefore ? 'before' : 'after')
  let dropped = 0
  const keep = (c: z.infer<typeof Claim> & { token_or_rule?: string }): JudgeClaim[] => {
    const size = sizes[c.image]
    const inside =
      c.box.width > 0 &&
      c.box.height > 0 &&
      c.box.x >= 0 &&
      c.box.y >= 0 &&
      c.box.x + c.box.width <= size.width + 2 &&
      c.box.y + c.box.height <= size.height + 2
    if (!inside) {
      dropped++
      return []
    }
    return [{ image: side(c.image), box: c.box, what: c.what, why: c.why, tokenOrRule: c.token_or_rule }]
  }
  return {
    viewport,
    model,
    preferred: out.preferred === 'tie' ? 'tie' : side(out.preferred),
    confidence: out.confidence,
    summary: out.summary,
    better: out.better.flatMap(keep),
    worse: out.worse.flatMap(keep),
    designBreaks: out.design_system_breaks.flatMap(keep),
    droppedClaims: dropped,
  }
}

/** Judge one screen at one viewport: its baseline against its last kept capture. */
export async function judgeSurface(s: SurfaceState, viewport: string, opts: JudgeOptions): Promise<JudgeVerdict | null> {
  const kept = [...s.iterations].reverse().find((i) => i.outcome === 'accepted' && i.after[viewport])
  const before = s.baseline[viewport]
  if (!kept || !before) return null
  const after = kept.after[viewport]
  const model = opts.model ?? DEFAULT_JUDGE_MODEL
  const client = opts.client ?? new Anthropic()

  const beforePng = readFileSync(join(opts.dir, before.png))
  const width = pngSize(beforePng).width
  const maxHeight = Math.round(width * (viewport === 'mobile' ? 2.5 : 1.25))
  const bImg = cropTop(beforePng, maxHeight)
  const aImg = cropTop(readFileSync(join(opts.dir, after.png)), maxHeight)
  const aIsBefore = (opts.random ?? Math.random)() < 0.5
  const [imgA, imgB] = aIsBefore ? [bImg, aImg] : [aImg, bImg]
  const [probeA, probeB] = aIsBefore ? [before.probes, after.probes] : [after.probes, before.probes]

  const image = (png: Buffer): Anthropic.Beta.BetaImageBlockParam => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') },
  })

  try {
    const response = await client.beta.messages.parse({
      model,
      max_tokens: 16_000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: betaZodOutputFormat(JudgeOutput) },
      system: [
        { type: 'text', text: RUBRIC },
        {
          type: 'text',
          text: `Design system of this repository:\n${designContext(opts.repoRoot, opts.designFiles)}`,
          // Same rubric + tokens for every screen in the run: cache the prefix.
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `Screen: ${s.surface.label} (${s.surface.path}), ${viewport} viewport.` },
            { type: 'text', text: 'Image A:' },
            image(imgA),
            { type: 'text', text: 'Image B:' },
            image(imgB),
            { type: 'text', text: `${probeLine('A', probeA)}\n${probeLine('B', probeB)}\n\nWhich is better, A or B?` },
          ],
        },
      ],
    })
    if (response.stop_reason === 'refusal') {
      return failed(viewport, model, `The model declined (${response.stop_details?.category ?? 'no category'}).`)
    }
    const parsed = response.parsed_output
    if (!parsed) return failed(viewport, model, `No structured answer (stop reason ${response.stop_reason}).`)
    return unshuffle(parsed, aIsBefore, { A: pngSize(imgA), B: pngSize(imgB) }, viewport, response.model)
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return failed(viewport, model, 'No valid Anthropic credentials. Set ANTHROPIC_API_KEY or run `ant auth login`.')
    }
    if (err instanceof Anthropic.RateLimitError) return failed(viewport, model, 'Rate limited by the Anthropic API.')
    if (err instanceof Anthropic.APIError) return failed(viewport, model, `Anthropic API error ${err.status}: ${err.message}`)
    throw err
  }
}

function failed(viewport: string, model: string, error: string): JudgeVerdict {
  return {
    viewport,
    model,
    preferred: 'tie',
    confidence: 'low',
    summary: '',
    better: [],
    worse: [],
    designBreaks: [],
    droppedClaims: 0,
    error,
  }
}
