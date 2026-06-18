/**
 * FILE: packages/server/supabase/functions/_shared/fix-packet.ts
 * PURPOSE: The first-class, reusable fix-prompt generator.
 *
 * `composeFixPacket()` turns a report's air-gapped Stage-2 diagnosis (plus
 * reproduction, suggested fix, relevant code files, and blast radius) into a
 * single self-contained, paste-ready markdown prompt tuned for Cursor /
 * Claude Code. It is the canonical version of the pattern that
 * `skill-packet.ts` (`composeRunPacket`) pioneered for skill pipelines, but
 * generalised so any surface can call it: the report-detail API (`fix_packet`
 * field), the MCP `get_fix_context` tool, the CLI `mushi fix`, and the
 * agentic `dispatch_fix` worker.
 *
 * Design notes:
 *   - PURE function — no DB calls, no I/O. The caller assembles the context
 *     (so this stays trivially testable and usable from edge functions, the
 *     MCP server, or the CLI).
 *   - Consumes the already air-gapped Stage-2 output, never raw user strings
 *     — mirrors the classify-report / skill-packet air-gap design.
 *   - "Lead with the fix" — the prompt asks the agent for the smallest patch
 *     that fixes the root cause, then tests, then a PR. No preamble.
 *   - Confidence-aware: a low-confidence diagnosis is framed as "what to
 *     check first" instead of a confident-but-wrong root cause.
 */

export interface FixPacketFile {
  path: string
  snippet: string
}

export interface FixPacketContext {
  /** Report UUID — embedded so no substitution is needed downstream. */
  id: string
  summary: string | null
  severity: string | null
  category: string | null
  component: string | null
  /** Stage-2 self-reported confidence (0..1). */
  confidence?: number | null
  rootCause: string | null
  reproductionSteps: string[] | null
  suggestedFix: string | null
  screenshotUrl?: string | null
  /** RAG code hints (best-effort; may be empty). */
  ragFiles?: FixPacketFile[]
  /** Blast-radius / inventory anchor label, when known. */
  blastRadius?: string | null
  bugOntologyTags?: string[] | null
}

export interface FixPacketOptions {
  /** Max chars for each code snippet. */
  maxSnippetChars?: number
  /** Max total packet chars. */
  maxTotalChars?: number
}

const DEFAULT_MAX_SNIPPET = 600
const DEFAULT_MAX_TOTAL = 40_000

/** Below this Stage-2 confidence we hedge instead of asserting a root cause. */
const LOW_CONFIDENCE = 0.7

/**
 * Compose a self-contained, paste-ready fix prompt for a single report.
 * Returns markdown an agent in Cursor / Claude Code can act on directly.
 */
export function composeFixPacket(ctx: FixPacketContext, options: FixPacketOptions = {}): string {
  const maxSnippet = options.maxSnippetChars ?? DEFAULT_MAX_SNIPPET
  const maxTotal = options.maxTotalChars ?? DEFAULT_MAX_TOTAL

  const conf = ctx.confidence ?? null
  const isConfident = (conf == null || conf >= LOW_CONFIDENCE) && Boolean(ctx.rootCause || ctx.summary)

  const sections: string[] = []

  sections.push(`# Fix this Mushi report: ${ctx.id}`)

  // ── Diagnosis ──────────────────────────────────────────────────────────────
  const meta = [
    ctx.summary ? `**What broke:** ${ctx.summary}` : null,
    ctx.severity ? `**Severity:** ${ctx.severity}` : null,
    ctx.category ? `**Category:** ${ctx.category}` : null,
    ctx.component ? `**Likely component:** \`${ctx.component}\`` : null,
    conf != null ? `**Diagnosis confidence:** ${(conf * 100).toFixed(0)}%` : null,
  ].filter((x): x is string => Boolean(x))
  if (meta.length > 0) sections.push(meta.join('  \n'))

  if (isConfident && ctx.rootCause) {
    sections.push(`## Most likely cause\n${ctx.rootCause}`)
  } else if (!isConfident) {
    const checks = [
      ctx.component ? `the \`${ctx.component}\` component / page` : null,
      ctx.rootCause || null,
      ctx.summary || null,
    ].filter((x): x is string => Boolean(x))
    sections.push(
      `## Not certain yet — check these first\n` +
        (checks.length > 0
          ? checks.map((c) => `- ${c}`).join('\n')
          : '- Reproduce it, then inspect the console + network evidence.'),
    )
  }

  if (ctx.reproductionSteps && ctx.reproductionSteps.length > 0) {
    sections.push(
      `## Reproduction\n${ctx.reproductionSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    )
  }

  if (ctx.suggestedFix) {
    sections.push(`## Suggested direction\n${ctx.suggestedFix}`)
  }

  if (ctx.blastRadius) {
    sections.push(`## Blast radius\n${ctx.blastRadius}`)
  }

  if (ctx.ragFiles && ctx.ragFiles.length > 0) {
    const ragLines = ctx.ragFiles.map(
      (f) => `### \`${f.path}\`\n\`\`\`\n${f.snippet.slice(0, maxSnippet)}\n\`\`\``,
    )
    sections.push(`## Relevant code\n${ragLines.join('\n\n')}`)
  }

  if (ctx.bugOntologyTags && ctx.bugOntologyTags.length > 0) {
    sections.push(`_Tags: ${ctx.bugOntologyTags.join(', ')}_`)
  }

  // ── The ask ─────────────────────────────────────────────────────────────────
  sections.push(
    [
      `## Your task`,
      `1. Write the smallest patch that fixes the root cause above. Touch the fewest files.`,
      `2. Run the project test suite before committing.`,
      `3. Open a PR whose body links back to this report (\`${ctx.id}\`).`,
      ``,
      `Lead with the fix. Skip the preamble. If you are not confident the diagnosis is right, say what you checked and why.`,
    ].join('\n'),
  )

  const packet = sections.join('\n\n')
  if (packet.length > maxTotal) {
    return packet.slice(0, maxTotal) + '\n\n_[fix packet truncated at budget limit]_'
  }
  return packet
}

/**
 * Build a FixPacketContext from a raw `reports` row. Centralises the
 * stage2_analysis field mapping so every caller reads it the same way.
 */
export function fixPacketContextFromReport(
  row: Record<string, unknown>,
  extras: { ragFiles?: FixPacketFile[]; blastRadius?: string | null } = {},
): FixPacketContext {
  const s2 = (row.stage2_analysis as Record<string, unknown> | null) ?? {}
  return {
    id: String(row.id ?? ''),
    summary: (row.summary as string | null) ?? null,
    severity: (row.severity as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    component: (row.component as string | null) ?? null,
    confidence: (row.confidence as number | null) ?? null,
    rootCause: (s2.rootCause as string | null) ?? null,
    reproductionSteps:
      (s2.reproductionSteps as string[] | null) ?? (row.reproduction_steps as string[] | null) ?? null,
    suggestedFix: (s2.suggestedFix as string | null) ?? null,
    screenshotUrl: (row.screenshot_url as string | null) ?? null,
    ragFiles: extras.ragFiles ?? [],
    blastRadius: extras.blastRadius ?? null,
    bugOntologyTags: (row.bug_ontology_tags as string[] | null) ?? null,
  }
}
