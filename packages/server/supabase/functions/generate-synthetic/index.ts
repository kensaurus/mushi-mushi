import { createAnthropic } from 'npm:@ai-sdk/anthropic@1';
import { generateObject } from 'npm:ai@4';
import { z } from 'npm:zod@3';
import { getServiceClient } from '../_shared/db.ts';
import { createTrace } from '../_shared/observability.ts';
import { log } from '../_shared/logger.ts';
import { withSentry } from '../_shared/sentry.ts';
import { requireServiceRoleAuth } from '../_shared/auth.ts';
import { SYNTHETIC_MODEL, ANTHROPIC_HAIKU } from '../_shared/models.ts';
import { getPromptForStage } from '../_shared/prompt-ab.ts';

// Wave T (2026-04-23): fallback template used when `prompt_versions` has no
// `synthetic` row for this project (migration 20260422110000 seeded a global
// `v2-experiment` variant; `v1-baseline` is seeded by
// 20260418002000_phase1_backfill_seed.sql). Keeping this literal lets the
// function boot even if the prompt registry is unreachable — callers still
// get a synthetic report, just without the A/B variant telemetry.
const SYNTHETIC_FALLBACK_PROMPT =
  'Generate a realistic bug report for a web application. Vary the complexity ' +
  '\u2014 some obvious, some ambiguous. Include realistic console errors and URLs.';

const synthLog = log.child('synthetic');

const CATEGORY_ENUM = ['bug', 'slow', 'visual', 'confusing', 'other'] as const;
const SEVERITY_ENUM = ['critical', 'high', 'medium', 'low'] as const;

const syntheticSchema = z.object({
  description: z.string().describe('Realistic user bug description'),
  category: z.enum(CATEGORY_ENUM),
  severity: z.enum(SEVERITY_ENUM),
  component: z.string().optional(),
  console_errors: z.array(z.string()).optional(),
  url: z.string().optional(),
  expected_classification: z.object({
    category: z.enum(CATEGORY_ENUM),
    severity: z.enum(SEVERITY_ENUM),
    confidence: z.number().min(0).max(1),
  }),
});

// Schema for the eval pass — matches the production stage2 classifier's
// output shape so the eval is a fair representation of what the live
// pipeline would produce on the same input. Kept minimal (only the
// dimensions the synthetic_reports table compares) so the eval LLM
// call is cheap (single Haiku turn, no tools).
const evalSchema = z.object({
  category: z.enum(CATEGORY_ENUM),
  severity: z.enum(SEVERITY_ENUM),
  confidence: z.number().min(0).max(1),
});

/**
 * Compute a 0..1 match score between the synthetic generator's
 * `expected_classification` and the eval pass's `actual_classification`.
 *
 * Two equally-weighted dimensions:
 *   - category: 1.0 exact, 0.0 mismatch (categorical, no ordering)
 *   - severity: 1.0 exact, 0.5 adjacent (e.g. high vs critical), 0.0 else
 *
 * Returned to two decimals so the Prompt Lab UI's `match_score >= 0.8`
 * filter has stable buckets.
 */
function computeMatchScore(
  expected: { category: string; severity: string },
  actual: { category: string; severity: string },
): number {
  const SEVERITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  const catScore = expected.category === actual.category ? 1 : 0;
  const ed = SEVERITY_RANK[expected.severity] ?? -1;
  const ad = SEVERITY_RANK[actual.severity] ?? -1;
  const sevDiff = Math.abs(ed - ad);
  const sevScore = sevDiff === 0 ? 1 : sevDiff === 1 ? 0.5 : 0;
  return Math.round((catScore * 0.5 + sevScore * 0.5) * 100) / 100;
}

Deno.serve(
  withSentry('generate-synthetic', async (req) => {
    // SEC-1 (Wave S1 / D-14): unified internal auth.
    const unauthorized = requireServiceRoleAuth(req);
    if (unauthorized) return unauthorized;

    const db = getServiceClient();
    const body = await req.json().catch(() => ({}));
    const projectId = body.projectId as string;
    const count = Math.min(body.count ?? 20, 50);

    if (!projectId) {
      return new Response(JSON.stringify({ error: 'projectId required' }), { status: 400 });
    }

    const anthropic = createAnthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
    const trace = createTrace('generate-synthetic', { projectId, count });
    const generated: unknown[] = [];

    // Wave T (2026-04-23) — pull the generator's system prompt from
    // `prompt_versions` with the `synthetic` stage so `prompt-auto-tune` /
    // Prompt Lab iterations flow into synthetic generation too. Falls back
    // to the literal string above if the registry is empty so we never
    // fail-open with an unspecified model behaviour.
    const promptSelection = await getPromptForStage(db, projectId, 'synthetic');
    const syntheticSystemPrompt = promptSelection.promptTemplate ?? SYNTHETIC_FALLBACK_PROMPT;
    const promptVersion = promptSelection.promptVersion ?? 'fallback-literal';

    // Loop-closure: pull the live stage2 production prompt so the eval pass
    // measures what real reports would actually see. If the prompt registry
    // is empty we skip the eval (rather than guessing a system prompt) so
    // the match_score column stays NULL for those rows — the Prompt Lab UI
    // already handles NULL gracefully.
    const stage2Selection = await getPromptForStage(db, projectId, 'stage2');
    const stage2Prompt = stage2Selection.promptTemplate;

    let evaluated = 0;

    const BATCH_SIZE = 5;
    for (let batch = 0; batch < count; batch += BATCH_SIZE) {
      const batchItems = Array.from(
        { length: Math.min(BATCH_SIZE, count - batch) },
        (_, j) => batch + j,
      );
      const results = await Promise.allSettled(
        batchItems.map(async (i) => {
          const span = trace.span(`generate.${i}`);
          const { object, usage } = await generateObject({
            model: anthropic(SYNTHETIC_MODEL),
            schema: syntheticSchema,
            system: syntheticSystemPrompt,
            prompt: `Generate bug report #${i + 1} of ${count}. Make each unique in category and complexity.`,
          });
          span.end({
            model: SYNTHETIC_MODEL,
            inputTokens: usage?.promptTokens,
            outputTokens: usage?.completionTokens,
            promptVersion,
          });

          const generated_report = {
            description: object.description,
            category: object.category,
            severity: object.severity,
            component: object.component,
            console_errors: object.console_errors,
            url: object.url,
          };

          // Insert FIRST so the row exists even if the eval pass fails —
          // the Prompt Lab UI gracefully renders rows with null
          // actual_classification + match_score, but it can't render rows
          // that don't exist at all.
          const { data: inserted } = await db
            .from('synthetic_reports')
            .insert({
              project_id: projectId,
              generated_report,
              expected_classification: object.expected_classification,
            })
            .select('id')
            .maybeSingle();
          const rowId = inserted?.id as string | undefined;

          // Loop-closure: run the production stage2 prompt against this
          // synthetic so the operator can see "the live classifier got
          // this synthetic right / wrong" in the Prompt Lab. We only do
          // this when we successfully resolved a stage2 prompt — otherwise
          // we'd be evaluating an undefined prompt and the result would be
          // misleading.
          if (rowId && stage2Prompt) {
            const evalSpan = trace.span(`eval.${i}`);
            try {
              const evalUserPrompt = [
                'Classify this bug report. Respond ONLY with the JSON schema requested.',
                '',
                `Description: ${generated_report.description}`,
                generated_report.component ? `Component: ${generated_report.component}` : '',
                generated_report.url ? `URL: ${generated_report.url}` : '',
                generated_report.console_errors?.length
                  ? `Console errors: ${generated_report.console_errors.join('; ')}`
                  : '',
              ]
                .filter(Boolean)
                .join('\n');

              // Use Haiku for the eval pass — Stage 2 in production runs
              // Sonnet but the eval doesn't need full context (no RAG, no
              // inventory lookup), and at 50 syntheticshs/run the cost
              // delta matters: Haiku is ~12x cheaper than Sonnet.
              const { object: actual } = await generateObject({
                model: anthropic(ANTHROPIC_HAIKU),
                schema: evalSchema,
                system: stage2Prompt,
                prompt: evalUserPrompt,
              });
              const matchScore = computeMatchScore(
                {
                  category: object.expected_classification.category,
                  severity: object.expected_classification.severity,
                },
                { category: actual.category, severity: actual.severity },
              );
              await db
                .from('synthetic_reports')
                .update({
                  actual_classification: actual,
                  match_score: matchScore,
                })
                .eq('id', rowId);
              evaluated++;
              evalSpan.end({ model: ANTHROPIC_HAIKU, matchScore });
            } catch (evalErr) {
              // Eval failure must not poison the run — the row is already
              // inserted with NULL eval columns and the operator can
              // rerun eval-only later (`prompt-auto-tune` re-classifies
              // synthetics on schedule).
              evalSpan.end({ error: String(evalErr).slice(0, 240) });
              synthLog.warn('Eval failed (non-fatal)', { rowId, err: String(evalErr) });
            }
          }

          return object;
        }),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') generated.push(r.value);
        else synthLog.error('Generation failed', { err: String(r.reason) });
      }
    }

    await trace.end();

    return new Response(
      JSON.stringify({ ok: true, data: { generated: generated.length, evaluated } }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }),
);
