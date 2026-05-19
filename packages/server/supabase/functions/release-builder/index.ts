/**
 * release-builder — Draft changelog entries with reporter attribution
 *
 * Phase 2 of the closed-loop evolution plan.
 *
 * POST body:
 *   { project_id, version, title?, window_start?, window_end? }
 *
 * Scans reports resolved within the version window, drafts a markdown
 * changelog with reporter credits, creates the release row, and
 * creates release_credits rows.
 *
 * The admin can then edit the body, add/remove reports, and publish.
 * Publishing triggers the widget notification channel.
 */

import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { createOpenAI } from 'npm:@ai-sdk/openai@1'
import { generateText } from 'npm:ai@4'
import { z } from 'npm:zod@3'
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
})

Deno.serve(
  withSentry(async (req: Request) => {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

    const authErr = requireServiceRoleAuth(req)
    const isAdmin = req.headers.get('x-mushi-admin') === '1'
    if (authErr && !isAdmin) return authErr

    const raw = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) {
      return new Response(JSON.stringify({ ok: false, error: parsed.error.flatten() }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    }

    const { project_id, version, title, window_start, window_end } = parsed.data
    const db = getServiceClient()

    const windowEnd = window_end ? new Date(window_end) : new Date()
    const windowStart = window_start
      ? new Date(window_start)
      : new Date(windowEnd.getTime() - 30 * 24 * 60 * 60 * 1000) // default: last 30 days

    // Find resolved reports in the window
    const { data: resolvedReports } = await db
      .from('reports')
      .select('id, title, description, severity, category, reporter_token_hash')
      .eq('project_id', project_id)
      .eq('status', 'fixed')
      .gte('updated_at', windowStart.toISOString())
      .lte('updated_at', windowEnd.toISOString())
      .limit(50)

    const reports = resolvedReports ?? []

    // Try to match reporter tokens → end_users for attribution
    const reporterTokens = [...new Set(reports.map((r) => r.reporter_token_hash).filter(Boolean))]
    const { data: endUsers } = reporterTokens.length > 0
      ? await db
        .from('end_users')
        .select('id, display_name, external_user_id, reporter_token_hash')
        .in('reporter_token_hash', reporterTokens)
      : { data: [] }

    const tokenToUser = new Map<string, { id: string; display_name: string | null }>(
      (endUsers ?? []).map((u) => [u.reporter_token_hash as string, { id: u.id as string, display_name: u.display_name as string | null }]),
    )

    // Build report summaries for LLM
    const reportSummaries = reports
      .map((r) => {
        const user = r.reporter_token_hash ? tokenToUser.get(r.reporter_token_hash) : null
        const by = user?.display_name ?? (user ? `User-${user.id.slice(-4)}` : 'anonymous')
        return `- [${r.severity}] ${r.title ?? r.description?.slice(0, 80) ?? 'Untitled report'} (reported by ${by})`
      })
      .join('\n')

    // Generate changelog body with LLM
    let bodyMd = ''
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
      bodyMd = text.trim()

      // Log cost
      await db.from('llm_cost_usd').insert({
        project_id,
        operation: 'release-builder',
        model: ANTHROPIC_SONNET,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0.005, // approximate
      })
    } catch {
      try {
        const openai = createOpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') })
        const { text } = await generateText({
          model: openai(OPENAI_PRIMARY),
          prompt: `Write a markdown changelog for version ${version} with these fixed reports:\n${reportSummaries || '(none)'}`,
          maxTokens: 600,
        })
        bodyMd = text.trim()
      } catch {
        bodyMd = reports.length > 0
          ? `## Bug fixes\n\n${reports.map((r) => `- ${r.title ?? r.description?.slice(0, 60)}`).join('\n')}`
          : 'No changes tracked for this release.'
      }
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
        credited_reporter_ids: [...tokenToUser.values()].map((u) => u.id),
      })
      .select()
      .single()

    if (releaseErr) {
      return new Response(JSON.stringify({ ok: false, error: releaseErr.message }), {
        status: 500, headers: { 'content-type': 'application/json' },
      })
    }

    // Create release_credits rows
    const creditRows = reports
      .filter((r) => r.reporter_token_hash && tokenToUser.has(r.reporter_token_hash!))
      .map((r) => {
        const user = tokenToUser.get(r.reporter_token_hash!)!
        return {
          release_id: release.id,
          end_user_id: user.id,
          report_id: r.id,
          contribution_type: 'reporter',
          display_name_at_time: user.display_name,
        }
      })

    if (creditRows.length > 0) {
      await db.from('release_credits').insert(creditRows)
    }

    return new Response(
      JSON.stringify({ ok: true, data: { release, creditCount: creditRows.length, reportCount: reports.length } }),
      { headers: { 'content-type': 'application/json' } },
    )
  }),
)
