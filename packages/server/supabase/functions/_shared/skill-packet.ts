/**
 * FILE: packages/server/supabase/functions/_shared/skill-packet.ts
 * PURPOSE: Compose the "run packet" that binds a skill chain to a Mushi report.
 *
 * The packet is a self-contained markdown document a Cursor agent (local or
 * Cloud) can consume to execute the pipeline step-by-step. It includes:
 *   - The skill's full SKILL.md body (instructions)
 *   - Bodies of any chained sub-skills (for workflow bundles)
 *   - The report context: summary, severity, component, repro steps,
 *     suggested fix, evidence links, RAG code file hints
 *
 * The packet is stored as `skill_pipeline_runs.context_packet` so any
 * surface (CLI: mushi pipeline start, MCP: get_pipeline_run, console "Copy
 * packet") can retrieve it without re-composing.
 *
 * Security:
 *   - All skill content comes from trusted agent_skills rows (allowlisted
 *     GitHub repos only — never raw user-submitted text).
 *   - Report context is the already air-gapped Stage 2 output, not raw
 *     user strings. This mirrors the classify-report air-gap design.
 *   - Evidence URLs are included as references only (no content fetched here).
 */

import { getServiceClient } from './db.ts'

export interface ReportContext {
  id: string
  summary: string | null
  severity: string | null
  category: string | null
  component: string | null
  rootCause: string | null
  reproductionSteps: string[] | null
  suggestedFix: string | null
  screenshotUrl: string | null
  ragFiles: Array<{ path: string; snippet: string }>
}

export interface PacketOptions {
  /** Max chars for each chained skill body to keep packet under budget. */
  maxBodyChars?: number
  /** Max total packet chars. Enforced by truncating RAG files last. */
  maxTotalChars?: number
}

const DEFAULT_MAX_BODY = 8_000
const DEFAULT_MAX_TOTAL = 40_000

/**
 * Compose a self-contained markdown run packet for a skill pipeline run.
 * Resolves the full chain of skills from the catalog and bundles them with
 * the report context into one document.
 */
export async function composeRunPacket(opts: {
  rootSkillSlug: string
  chainSlugs: string[]
  reportContext: ReportContext
  options?: PacketOptions
}): Promise<string> {
  const { rootSkillSlug, chainSlugs, reportContext, options = {} } = opts
  const maxBody = options.maxBodyChars ?? DEFAULT_MAX_BODY
  const maxTotal = options.maxTotalChars ?? DEFAULT_MAX_TOTAL

  const db = getServiceClient()

  // Fetch skill bodies for root + all chain steps
  const allSlugs = [rootSkillSlug, ...chainSlugs.filter((s) => s !== rootSkillSlug)]
  const { data: skills } = await db
    .from('agent_skills')
    .select('slug, title, description, body_md, chain_slugs')
    .in('slug', allSlugs)
    .eq('is_active', true)

  const skillMap = new Map((skills ?? []).map((s) => [s.slug as string, s]))

  const rootSkill = skillMap.get(rootSkillSlug)

  // Build packet sections
  const sections: string[] = []

  sections.push(`# Mushi Skill Pipeline Run Packet`)
  sections.push(`> **Skill:** ${rootSkill?.title ?? rootSkillSlug}  \n> **Generated:** ${new Date().toUTCString()}`)
  sections.push(`---`)

  // ── Report Context ────────────────────────────────────────────────────────
  sections.push(`## Report Context`)
  sections.push([
    `- **Report ID:** \`${reportContext.id}\``,
    `- **Summary:** ${reportContext.summary ?? '(not classified yet)'}`,
    `- **Severity:** ${reportContext.severity ?? 'unknown'}`,
    `- **Category:** ${reportContext.category ?? 'unknown'}`,
    `- **Component:** ${reportContext.component ?? 'unknown'}`,
  ].join('\n'))

  if (reportContext.rootCause) {
    sections.push(`### Root Cause\n${reportContext.rootCause}`)
  }

  if (reportContext.reproductionSteps && reportContext.reproductionSteps.length > 0) {
    sections.push(`### Reproduction Steps\n${reportContext.reproductionSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`)
  }

  if (reportContext.suggestedFix) {
    sections.push(`### Suggested Fix\n${reportContext.suggestedFix}`)
  }

  if (reportContext.screenshotUrl) {
    sections.push(`### Evidence\n- Screenshot: ${reportContext.screenshotUrl}`)
  }

  if (reportContext.ragFiles && reportContext.ragFiles.length > 0) {
    const ragLines = reportContext.ragFiles.map(
      (f) => `#### \`${f.path}\`\n\`\`\`\n${f.snippet.slice(0, 400)}\n\`\`\``,
    )
    sections.push(`### Relevant Code Files\n${ragLines.join('\n\n')}`)
  }

  sections.push(`---`)

  // ── Skill Instructions ────────────────────────────────────────────────────
  sections.push(`## Skill Instructions`)

  if (rootSkill) {
    const rootBody = rootSkill.body_md as string
    sections.push(`### ${rootSkill.title} (\`${rootSkillSlug}\`)\n\n${truncateBody(rootBody, maxBody)}`)
  } else {
    sections.push(`_Skill \`${rootSkillSlug}\` not found in catalog — sync may be needed._`)
  }

  // Chain steps
  if (chainSlugs.length > 0) {
    sections.push(`---`)
    sections.push(`## Chained Sub-Skills`)
    for (const slug of chainSlugs) {
      const skill = skillMap.get(slug)
      if (!skill) continue
      const body = skill.body_md as string
      sections.push(`### ${skill.title} (\`${slug}\`)\n\n${truncateBody(body, maxBody)}`)
    }
  }

  // ── Execution Checklist ───────────────────────────────────────────────────
  sections.push(`---`)
  sections.push(`## Execution Checklist`)
  sections.push(buildChecklist(rootSkillSlug, chainSlugs))

  const packet = sections.join('\n\n')

  // Enforce total budget — truncate from the end if needed
  if (packet.length > maxTotal) {
    return packet.slice(0, maxTotal) + '\n\n_[packet truncated at budget limit]_'
  }
  return packet
}

function truncateBody(body: string, maxChars: number): string {
  if (body.length <= maxChars) return body
  return body.slice(0, maxChars) + '\n\n_[body truncated — use `mushi skills show <slug>` for full instructions]_'
}

function buildChecklist(rootSlug: string, chain: string[]): string {
  const steps = [rootSlug, ...chain]
  return steps.map((slug, i) => `- [ ] Step ${i + 1}: \`${slug}\` — update pipeline step status when complete`).join('\n')
}

/**
 * Resolve the full chain of slugs for a root skill by recursively following
 * chain_slugs from the agent_skills catalog. Max depth 5 to prevent cycles.
 */
export async function resolveChain(rootSlug: string, maxDepth = 5): Promise<string[]> {
  const db = getServiceClient()
  const visited = new Set<string>()
  const chain: string[] = []

  async function walk(slug: string, depth: number): Promise<void> {
    if (depth >= maxDepth || visited.has(slug)) return
    visited.add(slug)

    const { data } = await db
      .from('agent_skills')
      .select('slug, chain_slugs')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle()

    if (!data) return

    const subSlugs = (data.chain_slugs as string[]) ?? []
    for (const sub of subSlugs) {
      if (!visited.has(sub)) {
        chain.push(sub)
        await walk(sub, depth + 1)
      }
    }
  }

  await walk(rootSlug, 0)
  return chain
}
