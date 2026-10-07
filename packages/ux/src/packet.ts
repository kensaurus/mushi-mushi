// SPDX-License-Identifier: MIT
/**
 * The instructions one agent run gets, written to `.mushi-ux/PROMPT.md` in
 * the worktree: which screen, its screenshots, the measured problems, where
 * the design system lives, the skill to apply, and what not to touch.
 *
 * File paths only for the design system: the agent reads what it needs, and
 * the packet stays small enough for weaker, short-context models.
 */

import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { CLS_GOOD } from './probes.js'
import type { ProbeResult, Surface } from './types.js'

const MAX_PACKET_CHARS = 24_000
const MAX_SKILL_CHARS = 12_000

const DEFAULT_GUIDANCE = `Improve this one screen's UI and UX. In order of priority:
1. Fix every measured problem listed below (accessibility violations, sideways scrolling, tap targets under 24×24 px, console errors).
2. Make the primary action obvious: one clear call to action, visual hierarchy that matches importance.
3. Cut noise: shorter copy, group related controls, remove duplicated information, use icons and colour to carry meaning where text is long.
4. Spacing and alignment on the design system's scale; readable line length; consistent type sizes.
5. The mobile screenshot must work as well as the desktop one.`

const GUARDRAILS = `Rules:
- Change only what this screen needs. Shared components and design tokens affect every other screen; edit them only when the fix truly belongs there, and say so in your final message.
- Use the existing design tokens, components and icon set. Do not add dependencies.
- Do not change data fetching, API calls, auth, routing, state management or tests.
- Do not run the dev server, install packages, or commit. The tool reviews and commits your edits.
- Do not modify anything under .mushi-ux/. Read only the screenshots and skill files you are pointed to.
- Do not read or change node_modules or the framework's own code. A problem that comes from there is not yours to fix: say so and move on.
- If the screen is already good, make no edits and say why.`

export interface PacketInput {
  surface: Surface
  iteration: number
  /** Screenshot paths relative to the worktree, per viewport name. */
  shots: Record<string, string>
  probes: Record<string, ProbeResult>
  designFiles: string[]
  skillText: string | null
  /** Worktree-relative folder holding the skill's files (SKILL.md, references/). */
  skillDir?: string | null
  /** Why the previous attempt on this screen was rejected, if it was. */
  previousRejection: string | null
  /** Minutes the agent has before it is stopped; shapes the work plan. */
  timeBudgetMin?: number | null
  /** Repo-relative files that render this screen (routes.ts screenFiles); empty when unknown. */
  entryFiles?: string[]
  /** Steps mode: the one plan step this attempt makes. */
  step?: { text: string; index: number; total: number; done: string[] } | null
}

/** A step should touch this many files at most; more is rolled back as too big. */
export const MAX_STEP_FILES = 6
/** Steps planned per screen at most. */
export const MAX_PLAN_STEPS = 5

/**
 * Steps mode, the planning pass: look, list small separate improvements,
 * edit nothing. Small steps measure cleanly and one bad step costs only
 * itself, where a whole-screen pass lost entire 15-minute attempts on
 * glot.it (2026-10-06).
 */
export function buildPlanPacket(input: Omit<PacketInput, 'step' | 'iteration' | 'previousRejection'>, maxSteps: number): string {
  const { surface } = input
  const findings = Object.entries(input.probes).flatMap(([vp, p]) => describeProbes(vp, p))
  const sections = [
    `# UX plan — ${surface.label}`,
    `Screen: \`${surface.path}\` (${surface.kind}). Plan only: do not edit any file except \`.mushi-ux/PLAN.md\`.`,
    input.timeBudgetMin ? `## Time\nYou have ${input.timeBudgetMin} minutes. Look, decide, write the list.` : '',
    input.entryFiles?.length ? `## Start here\nThese files render this screen:\n${input.entryFiles.map((f) => `- ${f}`).join('\n')}` : '',
    `## Screenshots (read these images first)\n${Object.entries(input.shots)
      .map(([vp, p]) => `- ${vp}: ${p}`)
      .join('\n')}`,
    `## Measured problems\n${findings.length ? findings.join('\n') : '- None measured.'}`,
    input.skillText
      ? `## Guidance\nUse this skill to choose what to improve on this one screen (its supporting files are in \`${input.skillDir ?? '.mushi-ux/skill'}/\`):\n\n${input.skillText.slice(0, MAX_SKILL_CHARS)}`
      : `## Guidance\n${DEFAULT_GUIDANCE}`,
    `## What to do\nList 2 to ${maxSteps} small, separate improvements for this screen, most valuable first. Each must be one focused change a developer could make in a few minutes, touching at most 3 files, that does not depend on the others. Name the component or file each one changes. Write them to \`.mushi-ux/PLAN.md\`, one per line starting with "- ", within your first 2 minutes, from the screenshots and the "Start here" files alone; then refine the file if you have time, and reply with the same list. You are stopped when the time is up, and a missing PLAN.md wastes the whole pass. Do not edit any other file: each item gets its own attempt later.`,
    `## Rules\n- Do not read or change node_modules or the framework's own code.\n- Do not plan changes to data fetching, API calls, auth, routing, state management or tests.\n- If the screen is already good, write fewer items.`,
  ]
  return sections.filter(Boolean).join('\n\n').slice(0, MAX_PACKET_CHARS)
}

/** Pure: the plan steps in a PLAN.md or a reply ("- x", "* x", "1. x", "- [ ] x"), first ones first. */
export function parsePlan(text: string, max = MAX_PLAN_STEPS): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/)
    // Agents sometimes write HTML entities ("School &amp; Study"); the plan is plain text.
    const item = m?.[1]
      ?.replace(/\*\*/g, '')
      .replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e] ?? _)
      .trim()
    if (!item || item.length < 8 || out.includes(item)) continue
    out.push(cutAtWord(item, 280))
    if (out.length >= max) break
  }
  return out
}

/** Pure: `text` within `max` characters, cut at a word with "…" so no word or `code` span ends half-way. */
export function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text
  const head = text.slice(0, max - 1)
  const space = head.lastIndexOf(' ')
  let cut = (space > max / 2 ? head.slice(0, space) : head).replace(/[\s,;:.(-]+$/, '')
  // An odd number of backticks means a code span was opened and not closed.
  if ((cut.match(/`/g)?.length ?? 0) % 2 === 1) cut = cut.slice(0, cut.lastIndexOf('`')).trimEnd()
  return `${cut}…`
}

/** Steps mode, the planning pass's pointer prompt. */
export const PLAN_POINTER_PROMPT =
  'Read .mushi-ux/PROMPT.md in this repository and follow it exactly. It asks for a plan only: write .mushi-ux/PLAN.md and edit nothing else.'

function describeProbes(viewport: string, p: ProbeResult): string[] {
  const lines: string[] = []
  for (const v of p.axe) {
    lines.push(`- [${viewport}] ${v.id} (${v.impact ?? 'n/a'}, ${v.count} node${v.count === 1 ? '' : 's'}): ${v.help} — e.g. ${v.targets.slice(0, 3).join(', ')}`)
  }
  if (p.overflowX) lines.push(`- [${viewport}] The page scrolls sideways at this width.`)
  if (p.smallTargets > 0) lines.push(`- [${viewport}] ${p.smallTargets} tap target(s) smaller than 24×24 px.`)
  for (const e of p.consoleErrors.slice(0, 5)) lines.push(`- [${viewport}] Console error: ${e}`)
  if (p.cls > CLS_GOOD) lines.push(`- [${viewport}] Layout shift ${p.cls} while loading (aim below ${CLS_GOOD}).`)
  return lines
}

export function buildPacket(input: PacketInput): string {
  const { surface } = input
  const steps = surface.steps.length ? ` then click ${surface.steps.map((s) => `"${s.label}"`).join(' → ')}` : ''
  const findings = Object.entries(input.probes).flatMap(([vp, p]) => describeProbes(vp, p))
  const skill = input.skillText
    ? [
        `Apply this skill to this one screen only. Skip its whole-app steps (stack detection, scoring every screen, app-wide inventories): another pass handles each other screen. Its supporting files (references, scorecards) are in \`${input.skillDir ?? '.mushi-ux/skill'}/\`; read only the ones this screen needs.`,
        input.skillText.slice(0, MAX_SKILL_CHARS),
      ].join('\n\n')
    : DEFAULT_GUIDANCE
  const sections = [
    `# UX pass — ${surface.label}`,
    `Screen: \`${surface.path}\`${steps} (${surface.kind}). Attempt ${input.iteration}.`,
    input.timeBudgetMin
      ? `## Time\nYou have ${input.timeBudgetMin} minutes, then you are stopped and unsaved work is lost. Make your first edit within ${Math.max(1, Math.round(input.timeBudgetMin / 3))} minutes: an attempt that ends without an edit counts as a failure. Do not survey the whole design system; read only what the edit needs. A small, finished improvement beats a large unfinished one: make it, then stop.`
      : '',
    input.entryFiles?.length
      ? `## Start here\nThese files render this screen. Read them first instead of searching the repo:\n${input.entryFiles.map((f) => `- ${f}`).join('\n')}`
      : '',
    `## Screenshots (read these images first)\n${Object.entries(input.shots)
      .map(([vp, p]) => `- ${vp}: ${p}`)
      .join('\n')}`,
    `## Measured problems\n${findings.length ? findings.join('\n') : '- None measured. Focus on hierarchy, clarity and density.'}`,
    input.previousRejection ? `## Your previous attempt was rolled back\n${input.previousRejection}\nTry a different, smaller change.` : '',
    `## Design system (read before editing)\n${input.designFiles.length ? input.designFiles.map((f) => `- ${f}`).join('\n') : '- No token files found; match the styles already used on this screen.'}`,
    input.step
      ? [
          `## This step (${input.step.index} of ${input.step.total})\n${input.step.text}`,
          `Make only this change, touching at most 3 files. ${input.step.done.length ? `Already done in earlier steps: ${input.step.done.map((d) => `"${d}"`).join('; ')}. ` : ''}Later steps come in their own attempts. If this step turns out to be unnecessary, make no edit and say why.`,
        ].join('\n')
      : '',
    input.step ? `## Guidance\n${skill}` : `## What to do\n${skill}`,
    `## ${GUARDRAILS}`,
  ]
  return sections.filter(Boolean).join('\n\n').slice(0, MAX_PACKET_CHARS)
}

/** One-line instruction handed to the agent on stdin / argv. */
export const POINTER_PROMPT =
  'Read .mushi-ux/PROMPT.md in this repository and follow it exactly. It names the screenshots to look at and the screen to improve.'

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo', '.worktrees', '.mushi', '.mushi-ux', 'coverage'])

/**
 * Likely design-system sources, as repo-relative paths: the recipe manifest,
 * Tailwind configs, DTCG token files, and CSS files that declare theme
 * tokens (`@theme` or many custom properties on :root).
 */
export function findDesignFiles(root: string, maxFiles = 12): string[] {
  const found: string[] = []
  const recipe = join(root, 'mushi.recipe.json')
  if (existsSync(recipe)) found.push('mushi.recipe.json')
  const walk = (dir: string, depth: number) => {
    if (depth > 5 || found.length >= maxFiles) return
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (found.length >= maxFiles) return
      if (SKIP_DIRS.has(name)) continue
      const abs = join(dir, name)
      // One handle for the stat and the read, so the size checked is the
      // size of the bytes read (CodeQL js/file-system-race).
      let fd: number
      let isDir: boolean
      let css: string | null = null
      try {
        fd = openSync(abs, 'r')
      } catch {
        continue
      }
      try {
        const st = fstatSync(fd)
        isDir = st.isDirectory()
        if (!isDir && name.endsWith('.css') && st.size < 300_000) css = readFileSync(fd, 'utf8')
      } catch {
        continue
      } finally {
        closeSync(fd)
      }
      if (isDir) {
        walk(abs, depth + 1)
        continue
      }
      const rel = relative(root, abs).replace(/\\/g, '/')
      if (/^tailwind\.config\.(js|cjs|mjs|ts)$/.test(name) || /\.tokens\.json$|^tokens\.json$/.test(name)) {
        found.push(rel)
      } else if (css !== null) {
        if (/@theme\b/.test(css) || (css.match(/--[\w-]+\s*:/g)?.length ?? 0) > 20) found.push(rel)
      }
    }
  }
  walk(root, 0)
  return found
}
