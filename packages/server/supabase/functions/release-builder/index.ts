/**
 * release-builder — Draft changelog entries with reporter attribution
 *
 * Phase 2 of the closed-loop evolution plan.
 *
 * POST body:
 *   { project_id, version, title?, window_start?, window_end?, auto_source? }
 *
 * Scans reports resolved within the version window, drafts a markdown
 * changelog with reporter credits, creates the release row, and
 * creates release_credits rows.
 *
 * The admin can then edit the body, add/remove reports, and publish.
 * Publishing triggers the widget notification channel.
 *
 * An automatic draft (`auto_source` set, from _shared/auto-release.ts) is
 * published with no person reading it first, and report summaries come from
 * the public widget (untrusted). So it never goes through the LLM: its body
 * is a deterministic list of the summaries with markdown escaped and links
 * removed (deterministicReleaseBody). That also spends no LLM call on it.
 */

import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { createOpenAI } from 'npm:@ai-sdk/openai@1'
import { generateText } from 'npm:ai@4'
import { z } from 'npm:zod@3'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getServiceClient } from '../_shared/db.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { ANTHROPIC_SONNET, OPENAI_PRIMARY } from '../_shared/models.ts'

const bodySchema = z.object({
  project_id: z.string().uuid(),
  version: z.string().min(1),
  title: z.string().optional(),
  window_start: z.string().optional(), // ISO date - start of the release window
  window_end: z.string().optional(),   // ISO date - end of window (default: now)
  // Set only by the opt-in auto-release (_shared/auto-release.ts). The
  // uq_releases_one_auto_draft index then allows one automatic draft per
  // project at a time; a second concurrent trigger gets a 409.
  auto_source: z.enum(['github_release', 'github_deployment', 'recipe_event']).optional(),
})

export interface ReleaseReportRow {
  id: string
  summary: string | null
  description: string | null
  severity: string | null
  category?: string | null
  reporter_token_hash?: string | null
  end_user_id: string | null
}

export interface ReleaseBuilderDeps {
  db: () => SupabaseClient
  authorize: (req: Request) => Response | null
  /** The LLM changelog for a release a person reviews; never called for an automatic draft. */
  writeBody: (input: { version: string; reportSummaries: string; reports: ReleaseReportRow[]; db: SupabaseClient; projectId: string }) => Promise<string>
}

/**
 * One line of reporter-supplied text made safe to publish unread: control
 * characters and line breaks flattened, links removed (GFM autolinks bare
 * URLs and `www.` hosts), and every inline markdown / HTML metacharacter
 * backslash-escaped, so no link, image, emphasis, code span, table cell,
 * entity, email autolink or tag survives. The text always follows
 * "- Fixed: ", so line-start syntax (#, 1., -, +, >) cannot apply.
 */
export function sanitizeReleaseLine(text: string, max = 160): string {
  return text
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[link removed]')
    .replace(/\bwww\.\S+/gi, '[link removed]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[\\`*_{}[\]()<>|~&@]/g, (ch) => `\\${ch}`)
}

/** The body of an automatic release: fixed reports listed verbatim, escaped. */
export function deterministicReleaseBody(reports: Array<Pick<ReleaseReportRow, 'summary' | 'description'>>): string {
  if (reports.length === 0) return 'No changes tracked for this release.'
  const lines = reports.map((r) => {
    const text = sanitizeReleaseLine(r.summary?.trim() || r.description?.trim() || 'A reported bug')
    return `- Fixed: ${text || 'a reported bug'}`
  })
  return `## Bug fixes\n\n${lines.join('\n')}`
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export async function handleReleaseBuilder(req: Request, deps: ReleaseBuilderDeps): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const authErr = deps.authorize(req)
  if (authErr) return authErr

  const raw = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return json({ ok: false, error: parsed.error.flatten() }, 400)

  const { project_id, version, title, window_start, window_end, auto_source } = parsed.data
  const db = deps.db()

  const windowEnd = window_end ? new Date(window_end) : new Date()
  const windowStart = window_start
    ? new Date(window_start)
    : new Date(windowEnd.getTime() - 30 * 24 * 60 * 60 * 1000) // default: last 30 days

  // Find resolved reports in the window. A report an earlier published
  // release already shipped (fixed_release_id set) is not listed again, so
  // its reporter is not told "shipped" twice.
  const { data: resolvedReports, error: reportsErr } = await db
    .from('reports')
    .select('id, summary, description, severity, category, reporter_token_hash, end_user_id')
    .eq('project_id', project_id)
    .eq('status', 'fixed')
    .is('fixed_release_id', null)
    .gte('updated_at', windowStart.toISOString())
    .lte('updated_at', windowEnd.toISOString())
    .limit(50)
  if (reportsErr) return json({ ok: false, error: `reading fixed reports failed: ${reportsErr.message}` }, 500)

  const reports = (resolvedReports ?? []) as ReleaseReportRow[]

  // Match reporters via reports.end_user_id (reporter_token_hash is not on end_users)
  const endUserIds = [...new Set(reports.map((r) => r.end_user_id).filter(Boolean))] as string[]
  const { data: endUsers } = endUserIds.length > 0
    ? await db.from('end_users').select('id, display_name, external_user_id').in('id', endUserIds)
    : { data: [] }

  const userById = new Map<string, { id: string; display_name: string | null }>(
    ((endUsers ?? []) as Array<{ id: string; display_name: string | null }>).map((u) => [u.id, { id: u.id, display_name: u.display_name }]),
  )

  let bodyMd: string
  if (auto_source) {
    bodyMd = deterministicReleaseBody(reports)
  } else {
    // Build report summaries for the LLM (a person reviews this draft).
    const reportSummaries = reports
      .map((r) => {
        const user = r.end_user_id ? userById.get(r.end_user_id) : null
        const by = user?.display_name ?? (user ? `User-${user.id.slice(-4)}` : 'anonymous')
        return `- [${r.severity}] ${r.summary ?? r.description?.slice(0, 80) ?? 'Untitled report'} (reported by ${by})`
      })
      .join('\n')
    bodyMd = await deps.writeBody({ version, reportSummaries, reports, db, projectId: project_id })
  }

  // Create the release row
  const { data: release, error: releaseErr } = await db
    .from('releases')
    .insert({
      project_id,
      version,
      title: title ?? `v${version}`,
      body_md: bodyMd,
      status: 'draft',
      fixed_report_ids: reports.map((r) => r.id),
      credited_reporter_ids: [...userById.values()].map((u) => u.id),
      ...(auto_source ? { auto_source } : {}),
    })
    .select()
    .single()

  if (releaseErr) {
    if (auto_source && releaseErr.code === '23505') {
      return json({ ok: false, code: 'AUTO_DRAFT_EXISTS', error: 'An automatic release draft is already open for this project.' }, 409)
    }
    return json({ ok: false, error: releaseErr.message }, 500)
  }
  const releaseId = (release as { id: string }).id

  // Create release_credits rows
  const creditRows = reports
    .filter((r) => r.end_user_id && userById.has(r.end_user_id))
    .map((r) => {
      const user = userById.get(r.end_user_id as string) as { id: string; display_name: string | null }
      return {
        release_id: releaseId,
        end_user_id: user.id,
        report_id: r.id,
        contribution_type: 'reporter',
        display_name_at_time: user.display_name,
      }
    })

  if (creditRows.length > 0) {
    await db.from('release_credits').insert(creditRows)
  }

  return json({ ok: true, data: { release, creditCount: creditRows.length, reportCount: reports.length } })
}

/** LLM changelog (Anthropic, then OpenAI, then the deterministic list). */
async function llmReleaseBody(input: {
  version: string
  reportSummaries: string
  reports: ReleaseReportRow[]
  db: SupabaseClient
  projectId: string
}): Promise<string> {
  const { version, reportSummaries, reports, db, projectId } = input
  try {
    const anthropic = createAnthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
    const { text } = await generateText({
      model: anthropic(ANTHROPIC_SONNET),
      prompt: `You are writing a user-facing changelog for software version ${version}.

Fixed reports in this version:
${reportSummaries || '(no reports in this window)'}

Write a markdown changelog body that:
1. Starts with a short summary paragraph (2-3 sentences about the overall release theme)
2. Has a "## Bug fixes" section listing each fixed report in plain language with the reporter credited by name
   Format each line as: "- Fixed [brief description]. Thanks [name]."
3. If there are no reports, write a brief "No changes tracked for this release." note

Keep it warm, human, and specific. Avoid developer jargon. Max 400 words.`,
      maxTokens: 600,
    })

    // Log cost
    await db.from('llm_cost_usd').insert({
      project_id: projectId,
      operation: 'release-builder',
      model: ANTHROPIC_SONNET,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0.005, // approximate
    })
    return text.trim()
  } catch {
    try {
      const openai = createOpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') })
      const { text } = await generateText({
        model: openai(OPENAI_PRIMARY),
        prompt: `Write a markdown changelog for version ${version} with these fixed reports:\n${reportSummaries || '(none)'}`,
        maxTokens: 600,
      })
      return text.trim()
    } catch {
      return deterministicReleaseBody(reports)
    }
  }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(
    withSentry((req: Request) =>
      handleReleaseBuilder(req, {
        db: getServiceClient,
        authorize: requireServiceRoleAuth,
        writeBody: llmReleaseBody,
      }),
    ),
  )
}
