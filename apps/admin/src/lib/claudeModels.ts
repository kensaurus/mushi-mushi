/**
 * FILE: apps/admin/src/lib/claudeModels.ts
 * PURPOSE: One source for every Claude model picker in Settings: the current
 *          models with prices, the older ones still served, what each LLM
 *          job uses by default (the server's fallback when nothing is set),
 *          and what we recommend for that job, with the reason and its
 *          sources. The live list from the app's own key
 *          (GET /v1/admin/byok/anthropic/models) is merged in by
 *          ClaudeModelSelect, so a model released after this file still
 *          shows up (ADR 0039).
 *
 *          Facts read 2026-10-22 from
 *          https://platform.claude.com/docs/en/models/overview and
 *          https://platform.claude.com/docs/en/about-claude/models/choosing-a-model.
 */

export type ClaudeLine = 'fable' | 'opus' | 'sonnet' | 'haiku'

export interface ClaudeModelInfo {
  id: string
  label: string
  line: ClaudeLine
  /** USD per million tokens, input / output (Claude API list price). */
  price: { input: number; output: number }
  /** Anthropic's one-line positioning, shortened. */
  blurb: string
  /** In Anthropic's current lineup (not a legacy model). */
  current: boolean
}

export const CLAUDE_MODELS: readonly ClaudeModelInfo[] = [
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', line: 'fable', price: { input: 10, output: 50 }, blurb: 'most capable; demanding reasoning, long agent runs', current: true },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', line: 'opus', price: { input: 4, output: 20 }, blurb: 'agentic coding and knowledge work', current: true },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', line: 'sonnet', price: { input: 2, output: 10 }, blurb: 'speed and intelligence', current: true },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', line: 'haiku', price: { input: 0.1, output: 0.5 }, blurb: 'fastest, cheapest; classification and routing', current: true },
  { id: 'claude-fable-5', label: 'Claude Fable 5', line: 'fable', price: { input: 10, output: 50 }, blurb: 'previous Fable', current: false },
  { id: 'claude-opus-5', label: 'Claude Opus 5', line: 'opus', price: { input: 5, output: 25 }, blurb: 'previous Opus', current: false },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', line: 'opus', price: { input: 5, output: 25 }, blurb: 'legacy', current: false },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', line: 'opus', price: { input: 5, output: 25 }, blurb: 'legacy', current: false },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', line: 'opus', price: { input: 5, output: 25 }, blurb: 'legacy', current: false },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', line: 'sonnet', price: { input: 2, output: 10 }, blurb: 'previous Sonnet', current: false },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', line: 'sonnet', price: { input: 3, output: 15 }, blurb: 'legacy', current: false },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', line: 'haiku', price: { input: 1, output: 5 }, blurb: 'legacy', current: false },
]

/** The LLM jobs a project can pick a Claude model for. */
export type ModelRole = 'quick_check' | 'diagnosis' | 'judge' | 'fix' | 'pr_review'

export interface ModelSource {
  label: string
  href: string
  /** Date the source was read. */
  checked: string
}

export interface ModelRecommendation {
  id: string
  why: string
  sources: readonly ModelSource[]
}

const MODELS_OVERVIEW: ModelSource = {
  label: 'Anthropic: Models overview',
  href: 'https://platform.claude.com/docs/en/models/overview',
  checked: '2026-10-22',
}
const CHOOSING_A_MODEL: ModelSource = {
  label: 'Anthropic: Choosing a model',
  href: 'https://platform.claude.com/docs/en/about-claude/models/choosing-a-model',
  checked: '2026-10-22',
}

/**
 * What the server uses when the project sets nothing (`_shared/models.ts`
 * and `resolveClaudeModel`). "Reset to default" writes this.
 */
export const ROLE_DEFAULTS: Record<ModelRole, string> = {
  quick_check: 'claude-haiku-4-5',
  diagnosis: 'claude-sonnet-5-5',
  judge: 'claude-sonnet-5-5',
  fix: 'claude-sonnet-5-5',
  pr_review: 'claude-opus-5-5',
}

export const ROLE_RECOMMENDED: Record<ModelRole, ModelRecommendation> = {
  quick_check: {
    id: 'claude-haiku-5-5',
    why: 'The quick check sorts every report, so it is high-volume classification: what Anthropic positions Haiku for. Haiku 5.5 costs a tenth of Haiku 4.5 ($0.10 / $0.50 against $1 / $5 per million tokens).',
    sources: [MODELS_OVERVIEW, CHOOSING_A_MODEL],
  },
  diagnosis: {
    id: 'claude-opus-5-5',
    why: 'The diagnosis reads code and logs to find a root cause, which is the agentic coding and knowledge work Opus 5.5 is built for. Anthropic suggests starting most workloads on Opus 5.5. It costs about twice Sonnet 5.5, once per report that reaches diagnosis.',
    sources: [MODELS_OVERVIEW, CHOOSING_A_MODEL],
  },
  judge: {
    id: 'claude-sonnet-5-5',
    why: 'A judge should not be the model it grades: judges score text they find more probable higher (self-preference). With diagnosis on Opus 5.5, Sonnet 5.5 grades it from outside at half the price.',
    sources: [
      { label: 'Adaline: LLM-as-a-judge reliability and bias (2026-04-08)', href: 'https://www.adaline.ai/blog/llm-as-a-judge-reliability-bias', checked: '2026-10-22' },
      { label: 'Future AGI: Evaluating LLM judge bias mitigation (2026)', href: 'https://futureagi.com/blog/evaluating-llm-judge-bias-mitigation-2026/', checked: '2026-10-22' },
    ],
  },
  fix: {
    id: 'claude-opus-5-5',
    why: 'Writing a fix is agentic coding, the job Anthropic recommends Opus 5.5 for. A fix that fails review costs a second run, so the stronger model is usually cheaper per merged fix.',
    sources: [CHOOSING_A_MODEL],
  },
  pr_review: {
    id: 'claude-opus-5-5',
    why: 'The review grades another model\'s code before it can merge (ADR 0030). Opus 5.5 is the default; move to Fable 5.1 only if reviews miss problems that a stronger reviewer would catch, as Anthropic advises for work Opus 5.5 still falls short on.',
    sources: [CHOOSING_A_MODEL],
  },
}

export function modelInfo(id: string): ClaudeModelInfo | undefined {
  return CLAUDE_MODELS.find((m) => m.id === id)
}

/** "Claude Opus 5.5" for a known id, the id itself otherwise. */
export function modelLabel(id: string): string {
  return modelInfo(id)?.label ?? id
}

export interface LiveModel {
  id: string
  displayName: string | null
  createdAt: string | null
  line: string | null
}

export interface ModelOption {
  id: string
  label: string
  group: 'current' | 'older' | 'saved'
}

const LINE_ORDER: Record<string, number> = { fable: 0, opus: 1, sonnet: 2, haiku: 3 }

/**
 * Picker rows: the catalog plus any model the live list has that the catalog
 * does not (a newer release lands under "current"; one older than the
 * catalog's current generation under "older"). A saved value that is in
 * neither comes first as "saved", so the picker never shows a model the
 * project is not using.
 */
export function modelOptions(live: readonly LiveModel[], saved: string | null | undefined): ModelOption[] {
  const out: ModelOption[] = []
  const seen = new Set<string>()
  const newestCurrent = CLAUDE_MODELS.filter((m) => m.current)
  const currentCreatedFloor = live
    .filter((l) => newestCurrent.some((m) => m.id === l.id))
    .map((l) => l.createdAt ?? '')
    .sort()[0]
  for (const l of live) {
    if (CLAUDE_MODELS.some((m) => m.id === l.id)) continue
    const isNew = currentCreatedFloor ? (l.createdAt ?? '') > currentCreatedFloor : false
    out.push({ id: l.id, label: `${l.displayName ?? l.id}${isNew ? ' — new' : ''}`, group: isNew ? 'current' : 'older' })
    seen.add(l.id)
  }
  const liveIds = new Set(live.map((l) => l.id))
  for (const m of CLAUDE_MODELS) {
    // With a live list, an older model the key cannot use is left out.
    if (!m.current && live.length > 0 && !liveIds.has(m.id)) continue
    out.push({ id: m.id, label: `${m.label} — ${m.blurb} ($${m.price.input} / $${m.price.output})`, group: m.current ? 'current' : 'older' })
    seen.add(m.id)
  }
  if (saved && !seen.has(saved)) out.unshift({ id: saved, label: `${saved} (saved)`, group: 'saved' })
  return out.sort((a, b) => {
    const g = { saved: 0, current: 1, older: 2 }
    if (g[a.group] !== g[b.group]) return g[a.group] - g[b.group]
    const la = LINE_ORDER[modelInfo(a.id)?.line ?? ''] ?? 9
    const lb = LINE_ORDER[modelInfo(b.id)?.line ?? ''] ?? 9
    return la - lb
  })
}

/**
 * The model the server actually runs for a stored id, the way
 * `_shared/claude-request.ts` resolveClaudeModel maps it: empty, Claude 3.x
 * and Sonnet/Opus 4.0–4.5 (column defaults such as `claude-opus-4-1`) fall
 * back to the job's default; a dated Haiku 4.5 snapshot is the
 * `claude-haiku-4-5` alias. Anything else is shown as stored.
 */
export function effectiveModelId(stored: string | null | undefined, role: ModelRole): string {
  const id = (stored ?? '').trim()
  if (!id) return ROLE_DEFAULTS[role]
  if (/^claude-haiku-4-5-\d{8}$/.test(id)) return 'claude-haiku-4-5'
  if (/^claude-3/.test(id)) return ROLE_DEFAULTS[role]
  if (/^claude-(sonnet|opus)-4(-[0-5])?(-\d{8})?$/.test(id)) return ROLE_DEFAULTS[role]
  return id
}
