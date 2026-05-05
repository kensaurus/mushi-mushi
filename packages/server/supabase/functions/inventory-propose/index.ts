// ============================================================
// inventory-propose — Mushi Mushi v2.1 (whitepaper §6 hybrid mode)
//
// What it does
// ────────────
// Reads the project's `discovery_observed_inventory` view (30-day
// rolling aggregate of SDK passive-discovery events) and asks Claude
// to draft a complete `inventory.yaml` from it. The model returns:
//
//   1. A top-level `app` block (id/name/base_url inferred from project)
//   2. A `user_stories[]` array — each with title/persona/goal/
//      description/tags inferred from observed routes + DOM summaries
//   3. A `pages[]` array — one per observed route — with elements
//      derived from observed `data-testid`s
//   4. Per-element `backend[]` derived from observed network paths
//   5. Per-story `extensions.proposal_rationale` so the review UI
//      can render the model's reasoning inline
//
// We never emit `verified_by[]` from the proposer — that's authored
// by the human or by Mushi gates after a real CI run; the proposer
// has no way to know which Playwright spec covers what.
//
// Validation
// ──────────
// The model's output is validated against the v2 Zod schema. If
// validation fails we retry up to twice with the validation issues
// fed back into the prompt; if still failing we record the proposal
// with status='draft' but mark it `validation_failed: true` in
// rationale_by_story so the UI can show the human "the model couldn't
// produce a valid YAML — here's the closest attempt; please edit".
//
// BYOK
// ────
// Honours `project_settings.byok_anthropic_key_ref` via the existing
// `resolveLlmKey` helper. Falls back to the host's `ANTHROPIC_API_KEY`.
// ============================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { generateText } from 'npm:ai@4'
import { stringify as yamlStringify } from 'npm:yaml@2'

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { resolveLlmKey } from '../_shared/byok.ts'
import { ANTHROPIC_SONNET } from '../_shared/models.ts'
import {
  validateInventoryObject,
  type Inventory,
} from '../_shared/inventory.ts'

/**
 * We use `generateText` rather than `generateObject` here because the
 * AI SDK's structured-output mode doesn't let the model see the field
 * names of a `z.unknown()` payload — and the full `inventorySchema` is
 * too deeply nested to feed into structured output cleanly. Instead we
 * ask the model to emit a fenced ```json``` block, parse it ourselves,
 * and validate against the canonical Zod schema.
 *
 * This is also more debuggable: if the model produces something that
 * fails to parse as JSON or fails Zod, we keep the raw text for the
 * review UI rather than losing it inside the SDK abstraction.
 */
function extractFencedJson(text: string): unknown {
  // Try the first ```json ...``` block first; fall back to the last
  // top-level `{ ... }` we can find.
  const fence = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i)
  const candidate = fence ? fence[1]! : text.trim()
  // Some Claude responses prefix the JSON with explanatory text — try
  // to slice from the first `{` to the matching last `}`.
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const slice = candidate.slice(start, end + 1)
    try {
      return JSON.parse(slice)
    } catch {
      /* fallthrough */
    }
  }
  return JSON.parse(candidate)
}

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}

const rlog = log.child('inventory-propose')

interface ObservedRoute {
  route: string
  latest_title: string | null
  latest_dom_summary: string | null
  observation_count: number
  observed_testids: string[]
  observed_apis: string[]
  observed_query_keys: string[]
  distinct_users: number
  last_seen_at: string
  first_seen_at: string
}

interface ProposeBody {
  project_id?: string
  triggered_by?: string
  /** Override the default model for experimentation. */
  model?: string
}

/**
 * System prompt is intentionally explicit about BOTH what to emit
 * AND what NOT to emit. The model has a strong bias to fabricate
 * tests (`verified_by`) and statuses; we squash that hard.
 */
const SYSTEM_PROMPT = `You are Mushi Mushi's inventory proposer. You receive a list of observed routes from a customer's app — each with the page title, a short DOM summary, the data-testid values seen on that page, and the outbound API paths that page called. Your job is to produce a complete \`inventory.yaml\` that an engineer can hand-edit and ingest.

Hard rules:
1. Emit exactly the v2 inventory schema. \`schema_version\` MUST be \`"2.0"\`.
2. NEVER invent a \`verified_by[]\` entry. The proposer cannot know which test spec covers an action — leave it as an empty array. The human author will fill these in later.
3. NEVER set a \`status\` claim. Status is derived by the reconciler from observable signals; a claimed status here actively confuses the disagreement log.
4. Only generate elements for testids that are actually in the observed list. Do not invent buttons or forms the SDK didn't see.
5. Map each observed network path to a \`backend[]\` entry on the most relevant element on that page. Method defaults to GET unless the path looks like a write (\`/upsert\`, \`/create\`, \`/save\`, etc — use POST), \`/delete\` (DELETE), \`/update\` (PATCH).
6. Group elements into \`user_stories[]\` based on what the user is *trying to accomplish* on those routes. Use the DOM summaries as the strongest hint. Each story needs:
   - \`id\`: short kebab-case slug
   - \`title\`: human sentence ("Send a chat turn in role-play")
   - \`persona\`: who is doing this — usually "user", "learner", "admin", "buyer"
   - \`goal\`: a single sentence about the outcome they want
   - \`description\`: 1-2 sentences elaborating
   - \`pages\`: list of page slugs that contribute to this story
   - \`tags\`: 1-3 short tags
7. Each element MUST link back to a story via its \`user_story\` field if the page is part of a story. Pages without an obvious user goal can omit it.
8. Page \`auth_required\` defaults to true unless the route is clearly public (login/signup/landing/about/pricing).
9. For each story you emit, also include a short \`proposal_rationale\` (≤300 chars) explaining what observations led you to propose it. The harness will hoist this into \`extensions.proposal_rationale\` later — emit it as part of your output object.

Output format
─────────────
Respond with **a single \`\`\`json fenced block\`\`\`** containing exactly:

\`\`\`json
{
  "inventory": { "schema_version": "2.0", "app": { ... }, "user_stories": [ ... ], "pages": [ ... ] },
  "rationale_by_story": { "<story_id>": "<≤300-char explanation>" }
}
\`\`\`

No prose before or after the fenced block. Do not include comments inside the JSON. Be conservative — if you're not sure something is a story, omit it. A small accurate inventory is far more useful than a sprawling speculative one.`

interface ModelOutput {
  inventory: unknown
  rationale_by_story: Record<string, string>
}

async function loadObservations(db: SupabaseClient, projectId: string): Promise<ObservedRoute[]> {
  const { data, error } = await db
    .from('discovery_observed_inventory')
    .select('*')
    .eq('project_id', projectId)
    .order('observation_count', { ascending: false })
    .limit(80)
  if (error) throw new Error(`load observations: ${error.message}`)
  return (data ?? []) as unknown as ObservedRoute[]
}

async function loadCurrentInventory(db: SupabaseClient, projectId: string): Promise<Inventory | null> {
  const { data } = await db
    .from('inventories')
    .select('parsed')
    .eq('project_id', projectId)
    .eq('is_current', true)
    .maybeSingle()
  return (data?.parsed as Inventory | undefined) ?? null
}

async function loadProjectMeta(
  db: SupabaseClient,
  projectId: string,
): Promise<{ id: string; name: string; baseUrl: string }> {
  const { data: project } = await db
    .from('projects')
    .select('id, name, slug')
    .eq('id', projectId)
    .maybeSingle()
  const { data: settings } = await db
    .from('project_settings')
    .select('crawler_base_url')
    .eq('project_id', projectId)
    .maybeSingle()
  return {
    id: (project?.slug as string | undefined) ?? 'app',
    name: (project?.name as string | undefined) ?? 'App',
    baseUrl: (settings?.crawler_base_url as string | undefined) ?? 'https://example.com',
  }
}

function buildUserPrompt(observations: ObservedRoute[], current: Inventory | null, app: { id: string; name: string; baseUrl: string }): string {
  const obsLines = observations.map((o) => {
    const parts: string[] = []
    parts.push(`route: ${o.route}`)
    if (o.latest_title) parts.push(`  title: ${JSON.stringify(o.latest_title)}`)
    if (o.latest_dom_summary) parts.push(`  summary: ${JSON.stringify(o.latest_dom_summary)}`)
    if (o.observed_testids.length) parts.push(`  testids: ${JSON.stringify(o.observed_testids.slice(0, 30))}`)
    if (o.observed_apis.length) parts.push(`  apis: ${JSON.stringify(o.observed_apis.slice(0, 20))}`)
    if (o.distinct_users > 0) parts.push(`  users_seen: ${o.distinct_users}`)
    parts.push(`  observations: ${o.observation_count}`)
    return parts.join('\n')
  })

  const currentSection = current
    ? `\nCURRENT INVENTORY (preserve where compatible — don't drop existing user_story ids unless the route is no longer observed):\n${JSON.stringify(current, null, 2).slice(0, 8000)}\n`
    : ''

  return `App: ${app.name} (${app.id})
Base URL: ${app.baseUrl}

OBSERVATIONS (last 30 days, from @mushi-mushi/web SDK with discoverInventory: true):

${obsLines.join('\n\n')}
${currentSection}
Produce a complete inventory.yaml object as JSON. Wrap the inventory under \`inventory\` and the per-story rationale under \`rationale_by_story\` (keys are story ids).`
}

/**
 * One round-trip with Claude. Validates the result; throws on schema
 * failure so the caller can retry with the issues attached.
 */
async function runProposer(args: {
  apiKey: string
  modelId: string
  prompt: string
  previousIssues?: string
}): Promise<{ inventory: Inventory; rationale: Record<string, string>; tokens: { in: number; out: number } }> {
  const anthropic = createAnthropic({ apiKey: args.apiKey })
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: args.prompt },
  ]
  if (args.previousIssues) {
    messages.push({
      role: 'user',
      content: `Your previous attempt failed schema validation. Issues:\n${args.previousIssues}\n\nReturn a corrected JSON object with the exact same shape, fixing the listed issues.`,
    })
  }

  // generateText + manual JSON parse. See `extractFencedJson` for the
  // rationale on why we don't use generateObject here.
  const result = await generateText({
    model: anthropic(args.modelId),
    messages,
    maxTokens: 8192,
  })

  let out: ModelOutput
  try {
    out = extractFencedJson(result.text) as ModelOutput
  } catch (err) {
    throw Object.assign(new Error('model returned non-JSON response'), {
      issuesSummary: `JSON parse: ${err instanceof Error ? err.message : 'unknown'}`,
      lastModelOutput: result.text.slice(0, 4000),
      lastIssues: [{ path: '$', code: 'parse_error', message: 'response was not valid JSON' }],
    })
  }

  // The wrapper shape is `{ inventory, rationale_by_story }`. Defensive:
  // some smaller models or older snapshots emit the inventory at the
  // top level — accept both.
  const inventoryCandidate =
    out && typeof out === 'object' && 'inventory' in out
      ? (out as { inventory: unknown }).inventory
      : out
  const rationaleCandidate =
    out && typeof out === 'object' && 'rationale_by_story' in out
      ? ((out as { rationale_by_story: Record<string, string> }).rationale_by_story ?? {})
      : {}

  const validated = validateInventoryObject(inventoryCandidate)
  if (!validated.ok || !validated.inventory) {
    const summary = validated.issues
      .slice(0, 20)
      .map((i) => `${i.path}: ${i.message}`)
      .join('\n')
    throw Object.assign(new Error('invalid inventory'), {
      issuesSummary: summary,
      lastModelOutput: inventoryCandidate,
      lastIssues: validated.issues,
    })
  }
  return {
    inventory: validated.inventory,
    rationale: rationaleCandidate,
    tokens: {
      in: result.usage?.promptTokens ?? 0,
      out: result.usage?.completionTokens ?? 0,
    },
  }
}

async function proposeAndPersist(
  db: SupabaseClient,
  projectId: string,
  triggeredBy: string | null,
  modelOverride?: string,
): Promise<{
  proposalId: string
  routeCount: number
  storyCount: number
  pageCount: number
  validationOk: boolean
}> {
  const observations = await loadObservations(db, projectId)
  if (observations.length < 3) {
    throw new Error(`not enough observations (${observations.length} routes < 3)`)
  }

  const [current, app] = await Promise.all([
    loadCurrentInventory(db, projectId),
    loadProjectMeta(db, projectId),
  ])

  // Defensive: if the project has no `slug`, force a schema-valid id.
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(app.id)) app.id = 'app'

  const resolved = await resolveLlmKey(db, projectId, 'anthropic')
  const apiKey = resolved?.key ?? Deno.env.get('ANTHROPIC_API_KEY') ?? ''
  if (!apiKey) {
    throw new Error('No ANTHROPIC_API_KEY available (env or BYOK)')
  }
  const modelId = modelOverride ?? ANTHROPIC_SONNET
  const prompt = buildUserPrompt(observations, current, app)

  // Up to 3 attempts: first clean, then 2 retries with the schema issues fed back.
  let attempt = 0
  let previousIssues: string | undefined
  let last: Awaited<ReturnType<typeof runProposer>> | null = null
  let lastError: { message: string; summary?: string } | null = null
  while (attempt < 3) {
    try {
      last = await runProposer({ apiKey, modelId, prompt, previousIssues })
      break
    } catch (err) {
      lastError = {
        message: err instanceof Error ? err.message : String(err),
        summary: (err as { issuesSummary?: string }).issuesSummary,
      }
      previousIssues = lastError.summary
      // Surface at INFO so the issue summary is greppable in Edge logs.
      rlog.info('propose attempt failed', {
        attempt,
        projectId,
        message: lastError.message,
        issues: lastError.summary,
      })
      attempt += 1
    }
  }

  // Even if the model never produced a valid YAML, we persist a draft
  // row so the human can edit and accept manually rather than having
  // to start from scratch. When validation fails we also stash the
  // model's last raw output + the issue list under
  // `rationale_by_story.__validation_errors` so the UI can show "the
  // model wrote this; here's why it failed".
  const inventory = last?.inventory ?? null
  const rationale: Record<string, string> = { ...(last?.rationale ?? {}) }
  let yamlText: string
  let parsedJson: Record<string, unknown>
  if (inventory) {
    yamlText = yamlStringify({
      ...inventory,
      extensions: {
        ...(inventory.extensions ?? {}),
        proposal_rationale: last?.rationale ?? {},
      },
    })
    parsedJson = inventory as unknown as Record<string, unknown>
  } else {
    // Fall back to the raw model output so the human can fix it.
    const raw = (lastError as { lastModelOutput?: unknown })?.lastModelOutput ?? null
    parsedJson = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {})
    rationale.__validation_errors = (lastError?.summary ?? lastError?.message ?? 'unknown')
    try {
      yamlText = `# Mushi proposer: Claude returned a draft that failed validation ${attempt} time(s).
# Validation issues:
${(lastError?.summary ?? '').split('\n').map((l) => `#   ${l}`).join('\n')}
#
# Below is the raw model output as YAML — edit and re-validate, or click
# Discard and paste a hand-authored YAML instead.

${raw ? yamlStringify(raw) : '# (no model output captured)\n'}`
    } catch {
      yamlText = `# Mushi proposer failed and the raw output could not be serialised: ${lastError?.message ?? 'unknown'}\n`
    }
  }

  const { data: proposal, error: insErr } = await db
    .from('inventory_proposals')
    .insert({
      project_id: projectId,
      status: 'draft',
      proposed_yaml: yamlText,
      proposed_parsed: parsedJson as unknown as Record<string, unknown>,
      rationale_by_story: rationale as unknown as Record<string, unknown>,
      llm_model: modelId,
      observation_count: observations.length,
      created_by: triggeredBy,
    })
    .select('id')
    .single()
  if (insErr || !proposal) throw new Error(`insert proposal: ${insErr?.message}`)

  return {
    proposalId: proposal.id as string,
    routeCount: observations.length,
    storyCount: inventory?.user_stories?.length ?? 0,
    pageCount: inventory?.pages.length ?? 0,
    validationOk: !!inventory,
  }
}

async function handler(req: Request): Promise<Response> {
  const authResp = requireServiceRoleAuth(req)
  if (authResp) return authResp

  let body: ProposeBody
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ ok: false, error: { code: 'INVALID_JSON' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!body.project_id) {
    return new Response(JSON.stringify({ ok: false, error: { code: 'MISSING_PROJECT' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const db = getServiceClient()
  try {
    const result = await proposeAndPersist(
      db,
      body.project_id,
      body.triggered_by ?? null,
      body.model,
    )
    return new Response(JSON.stringify({ ok: true, data: result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    rlog.error('propose failed', { project_id: body.project_id, err: String(err) })
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'PROPOSE_FAILED', message: String(err) } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('inventory-propose', handler))
}

export { proposeAndPersist }
