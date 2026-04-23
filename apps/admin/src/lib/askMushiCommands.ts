/**
 * FILE: apps/admin/src/lib/askMushiCommands.ts
 * PURPOSE: Static slash-command registry for the Ask Mushi composer.
 *          Slash commands are user-typed shortcuts that either rewrite the
 *          message they're attached to (`/tldr`, `/sql`), tag the request
 *          with an intent the backend can use to tune model picks /
 *          token budgets (`/draft-pr-summary`, `/why-failed`), or run a
 *          purely local action (`/clear`, `/help`).
 *
 *          A separate registry rather than inline strings so the cmdk
 *          popover, the help command, and the unit tests all read from
 *          one source of truth.
 */

import type { AskMushiIntent } from './askMushiTypes'

export type SlashEffect =
  /** Prepend an instruction to the user's text and submit. */
  | { kind: 'prepend'; text: string; intent?: AskMushiIntent }
  /** Locally clear the conversation (start a new thread). */
  | { kind: 'local'; action: 'clear' | 'help' }
  /** Override the model used for the next turn. */
  | { kind: 'model-override'; model: 'sonnet' | 'haiku' | 'gpt' }

export interface SlashCommand {
  /** Token typed by the user, including the leading slash. */
  command: string
  /** Short label shown in the cmdk popover. */
  label: string
  /** Single-line description of what the command does. */
  hint: string
  /** Aliases the cmdk filter should match against. */
  aliases?: string[]
  /** What happens when the user accepts the command. */
  effect: SlashEffect
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    command: '/explain',
    label: 'Explain',
    hint: 'Ask for a step-by-step explanation of what is on screen.',
    aliases: ['walkthrough', 'how'],
    effect: { kind: 'prepend', text: 'Explain what I am looking at on this page, step by step:' },
  },
  {
    command: '/tldr',
    label: 'TL;DR',
    hint: 'One short paragraph. Cheap, fast.',
    aliases: ['short', 'summarise', 'summarize'],
    effect: { kind: 'prepend', text: 'TL;DR — one short paragraph:', intent: 'tldr' },
  },
  {
    command: '/long',
    label: 'Long answer',
    hint: 'Up to 6 paragraphs with reasoning and citations.',
    aliases: ['detailed', 'explain'],
    effect: { kind: 'prepend', text: 'Give a thorough multi-paragraph answer with reasoning:', intent: 'long' },
  },
  {
    command: '/why-failed',
    label: 'Why failed?',
    hint: 'Diagnose the focused report or fix.',
    aliases: ['diagnose', 'rca'],
    effect: { kind: 'prepend', text: 'Why did this fail? Walk me through the most likely causes given the focused entity:', intent: 'why-failed' },
  },
  {
    command: '/draft-pr-summary',
    label: 'Draft PR summary',
    hint: 'Markdown PR description for the focused fix.',
    aliases: ['pr', 'pull-request'],
    effect: { kind: 'prepend', text: 'Draft a clear PR description (Summary, Why, Test Plan) for this fix:', intent: 'pr-summary' },
  },
  {
    command: '/sql',
    label: 'Show SQL',
    hint: 'Ask for a SQL snippet that produces the data on screen.',
    aliases: ['query'],
    effect: { kind: 'prepend', text: 'Give me a Postgres SQL query that produces the data shown on this page. Use ```sql code fences:', intent: 'sql' },
  },
  {
    command: '/cite',
    label: 'Cite sources',
    hint: 'Ask the model to cite report ids.',
    aliases: ['sources'],
    effect: { kind: 'prepend', text: 'Cite specific report or fix ids for every claim:', intent: 'cite' },
  },
  {
    command: '/model:sonnet',
    label: 'Use Sonnet',
    hint: 'Force Anthropic Sonnet for the next turn.',
    aliases: ['claude'],
    effect: { kind: 'model-override', model: 'sonnet' },
  },
  {
    command: '/model:haiku',
    label: 'Use Haiku',
    hint: 'Force Anthropic Haiku — cheaper, faster, less accurate.',
    aliases: ['fast'],
    effect: { kind: 'model-override', model: 'haiku' },
  },
  {
    command: '/model:gpt',
    label: 'Use GPT',
    hint: 'Force the OpenAI fallback model.',
    aliases: ['openai'],
    effect: { kind: 'model-override', model: 'gpt' },
  },
  {
    command: '/clear',
    label: 'Clear conversation',
    hint: 'Start a new thread. Past turns stay in History.',
    aliases: ['new', 'reset'],
    effect: { kind: 'local', action: 'clear' },
  },
  {
    command: '/help',
    label: 'List commands',
    hint: 'Show every slash command without sending a message.',
    aliases: ['?'],
    effect: { kind: 'local', action: 'help' },
  },
] as const

/**
 * Result of inspecting the text around the caret to decide whether the
 * composer should open a slash-command or @-mention popover. Returns
 * `null` when the caret is not inside a `/` or `@` token.
 *
 * Pure function, exported separately so the cmdk popover and unit
 * tests both consume the same caret logic.
 */
export type ComposerToken =
  | { kind: 'slash'; query: string; tokenStart: number }
  | { kind: 'mention'; query: string; tokenStart: number }

export function detectComposerToken(text: string, caret: number): ComposerToken | null {
  // Walk back from the caret to a whitespace boundary, then check the
  // sigil. We stop at whitespace (not arbitrary punctuation) so the
  // user can keep typing within a token like `@report:abc-123`.
  let start = Math.max(0, Math.min(caret, text.length))
  while (start > 0 && !/\s/.test(text[start - 1] ?? '')) start--
  const token = text.slice(start, caret)
  if (token.startsWith('/')) return { kind: 'slash', query: token.slice(1), tokenStart: start }
  if (token.startsWith('@')) return { kind: 'mention', query: token.slice(1), tokenStart: start }
  return null
}

export function findSlashCommand(token: string): SlashCommand | undefined {
  const norm = token.trim().toLowerCase()
  if (!norm.startsWith('/')) return undefined
  return SLASH_COMMANDS.find((c) => c.command === norm)
}

/**
 * Filter the registry by a partial token (e.g. `/tld` → matches `/tldr`).
 * Aliases match too — e.g. `summarise` matches `/tldr`. Used by the cmdk
 * popover; cmdk does its own fuzzy ranking on top.
 */
export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase().replace(/^\//, '')
  if (q.length === 0) return [...SLASH_COMMANDS]
  return SLASH_COMMANDS.filter((c) => {
    const naked = c.command.replace(/^\//, '')
    if (naked.includes(q)) return true
    return (c.aliases ?? []).some((a) => a.toLowerCase().includes(q))
  })
}
