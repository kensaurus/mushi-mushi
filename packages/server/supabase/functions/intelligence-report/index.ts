import { createAnthropic } from 'npm:@ai-sdk/anthropic@1';
import { createOpenAI } from 'npm:@ai-sdk/openai@1';
import { generateText } from 'npm:ai@4';
import { getServiceClient } from '../_shared/db.ts';
import { sendSlackNotification } from '../_shared/slack.ts';
import { createTrace } from '../_shared/observability.ts';
import { log } from '../_shared/logger.ts';
import { startCronRun, logLlmInvocation } from '../_shared/telemetry.ts';
import {
  computeWeeklyStats,
  fetchBenchmarks,
  persistIntelligenceReport,
  renderIntelligenceHtml,
} from '../_shared/intelligence.ts';
import { withSentry } from '../_shared/sentry.ts';
import { requireServiceRoleAuth } from '../_shared/auth.ts';
import { mapWithConcurrency } from '../_shared/concurrency.ts';
import { INTELLIGENCE_FALLBACK, INTELLIGENCE_MODEL } from '../_shared/models.ts';
import { getPromptForStage } from '../_shared/prompt-ab.ts';
import {
  LlmFailoverError,
  sanitizeLlmError,
  withAnthropicOrOpenAi,
} from '../_shared/llm-failover.ts';

const intelLog = log.child('intelligence-report');

type IntelligenceProjectOutcome =
  | {
      projectId: string;
      status: 'generated';
      reportId: string;
      model: string;
      fallbackUsed: boolean;
    }
  | {
      projectId: string;
      status: 'skipped';
      code: 'LLM_KEYS_NOT_CONFIGURED' | 'LLM_KEYS_UNUSABLE';
      message: string;
    }
  | {
      projectId: string;
      status: 'failed';
      code: 'LLM_GENERATION_FAILED' | 'REPORT_PERSIST_FAILED';
      message: string;
    };

Deno.serve(
  withSentry('intelligence-report', async (req) => {
    // SEC-1 (Wave S1 / D-14): unified internal auth — accepts service-role key
    // or MUSHI_INTERNAL_CALLER_SECRET so cron-owned pg_net jobs work.
    const unauthorized = requireServiceRoleAuth(req);
    if (unauthorized) return unauthorized;

    const db = getServiceClient();
    const body = await req.json().catch(() => ({}));
    const projectId = body.projectId as string | undefined;
    const trigger = (body.trigger ?? 'http') as 'cron' | 'manual' | 'http';
    const cronRun = await startCronRun(db, 'intelligence-report', trigger);

    const { data: projects } = projectId
      ? await db.from('projects').select('id, name').eq('id', projectId)
      : await db.from('projects').select('id, name');

    const trace = createTrace('intelligence-report', { projectId });
    const reportIds: string[] = [];
    const digests: string[] = [];
    const skipped: Array<{ projectId: string; code: string; message: string; reason: string }> = [];
    const outcomes: IntelligenceProjectOutcome[] = [];

    // Reporting week = the most recently completed Monday→Sunday window.
    const weekStart = mostRecentMondayUtc();

    // Wave S3 (PERF): process up to 5 projects in parallel. Per-project the
    // only expensive call is a single generateText; DB stats queries are
    // cached / indexed. Weekly digests for 50 projects dropped from ~12 min
    // to ~2.5 min (measured during the 2026-04-21 audit).
    try {
      await mapWithConcurrency(projects ?? [], 5, async (project) => {
        const stats = await computeWeeklyStats(db, project.id, weekStart);
        const benchmarks = await fetchBenchmarks(db, project.id);

        const statsContext = `Project: ${project.name}
Week start: ${stats.weekStart}
New reports: ${stats.reports.total}
By category: ${JSON.stringify(stats.reports.byCategory)}
By severity: ${JSON.stringify(stats.reports.bySeverity)}
Top components: ${JSON.stringify(topN(stats.reports.byComponent, 8))}
Fix attempts: ${stats.fixes.total} (${stats.fixes.completed} completed, completion rate ${(stats.fixes.completionRate * 100).toFixed(0)}%)
Judge scores: ${JSON.stringify(stats.judgeScores.slice(0, 2))}
Cross-customer benchmarks available: ${benchmarks.optedIn ? 'yes' : 'no (project not opted in or k-anonymity unmet)'}`;

        const span = trace.span(`digest.${project.name}`);
        const digestStart = Date.now();
        const intelSelection = await getPromptForStage(db, project.id, 'intelligence');
        const intelSystemPrompt =
          intelSelection.promptTemplate ??
          'You are a bug intelligence analyst. Write a concise weekly digest summarizing bug trends, fix velocity, areas of concern, and 2-3 actionable recommendations. Be specific and data-driven. Use Markdown with short paragraphs and bullet lists. Do NOT mention other tenants by name; benchmarks are anonymised aggregates.';

        let digest: string;
        let usage: { promptTokens?: number; completionTokens?: number } | undefined;
        let usedModel = INTELLIGENCE_MODEL;
        let fallbackUsed = false;
        try {
          const generation = await withAnthropicOrOpenAi(
            db,
            project.id,
            async (resolved) => {
              const anthropic = createAnthropic({ apiKey: resolved.key });
              return generateText({
                model: anthropic(INTELLIGENCE_MODEL),
                messages: [
                  {
                    role: 'system',
                    content: intelSystemPrompt,
                    experimental_providerMetadata: {
                      anthropic: { cacheControl: { type: 'ephemeral' } },
                    },
                  },
                  { role: 'user', content: statsContext },
                ],
              });
            },
            async (resolved) => {
              const openai = createOpenAI({
                apiKey: resolved.key,
                ...(resolved.baseUrl ? { baseURL: resolved.baseUrl } : {}),
              });
              return generateText({
                model: openai(INTELLIGENCE_FALLBACK),
                system: intelSystemPrompt,
                prompt: statsContext,
              });
            },
          );
          digest = generation.result.text;
          usage = generation.result.usage;
          fallbackUsed = generation.usedProvider === 'openai';
          usedModel = fallbackUsed ? INTELLIGENCE_FALLBACK : INTELLIGENCE_MODEL;
        } catch (err) {
          const diagnostic = sanitizeLlmError(
            err instanceof LlmFailoverError ? `${err.code}: ${err.lastError}` : err,
          ).slice(0, 300);
          if (err instanceof LlmFailoverError) {
            const code =
              err.code === 'NO_KEYS_CONFIGURED' ? 'LLM_KEYS_NOT_CONFIGURED' : 'LLM_KEYS_UNUSABLE';
            const message =
              err.code === 'NO_KEYS_CONFIGURED'
                ? 'No validated Anthropic or OpenAI credential is configured.'
                : 'All validated Anthropic and OpenAI credentials are currently unusable.';
            intelLog.warn('Intelligence digest has no usable LLM key — skipping project', {
              projectId: project.id,
              projectName: project.name,
              code,
              sentry: false,
            });
            skipped.push({ projectId: project.id, code, message, reason: message });
            outcomes.push({ projectId: project.id, status: 'skipped', code, message });
          } else {
            intelLog.error('Intelligence digest LLM generation failed', {
              projectId: project.id,
              projectName: project.name,
              err: diagnostic,
            });
            outcomes.push({
              projectId: project.id,
              status: 'failed',
              code: 'LLM_GENERATION_FAILED',
              message: 'The digest could not be generated.',
            });
          }
          span.end({ model: usedModel, error: diagnostic });
          await logLlmInvocation(db, {
            projectId: project.id,
            functionName: 'intelligence-report',
            stage: 'digest',
            primaryModel: INTELLIGENCE_MODEL,
            usedModel,
            fallbackUsed,
            status: 'error',
            latencyMs: Date.now() - digestStart,
            errorMessage: diagnostic,
            langfuseTraceId: trace.id,
          }).catch((telemetryError) => {
            intelLog.warn('Failed to record intelligence LLM error telemetry', {
              projectId: project.id,
              err: sanitizeLlmError(telemetryError).slice(0, 200),
            });
          });
          return;
        }

        const digestLatency = Date.now() - digestStart;
        span.end({
          model: usedModel,
          inputTokens: usage?.promptTokens,
          outputTokens: usage?.completionTokens,
        });

        await logLlmInvocation(db, {
          projectId: project.id,
          functionName: 'intelligence-report',
          stage: 'digest',
          primaryModel: INTELLIGENCE_MODEL,
          usedModel,
          fallbackUsed,
          status: 'success',
          latencyMs: digestLatency,
          inputTokens: usage?.promptTokens ?? null,
          outputTokens: usage?.completionTokens ?? null,
          langfuseTraceId: trace.id,
        });

        const renderedHtml = renderIntelligenceHtml({
          projectName: project.name,
          weekStart: stats.weekStart,
          summaryMd: digest,
          stats,
          benchmarks,
        });

        try {
          const { id } = await persistIntelligenceReport(db, {
            projectId: project.id,
            weekStart: stats.weekStart,
            summaryMd: digest,
            stats,
            benchmarks: benchmarks.optedIn ? benchmarks : null,
            llmModel: usedModel,
            llmTokensIn: usage?.promptTokens ?? null,
            llmTokensOut: usage?.completionTokens ?? null,
            generatedBy: trigger,
            renderedHtml,
          });
          reportIds.push(id);
          outcomes.push({
            projectId: project.id,
            status: 'generated',
            reportId: id,
            model: usedModel,
            fallbackUsed,
          });
        } catch (e) {
          const diagnostic = sanitizeLlmError(e).slice(0, 300);
          intelLog.error('Failed to persist intelligence report', {
            err: diagnostic,
            projectId: project.id,
          });
          outcomes.push({
            projectId: project.id,
            status: 'failed',
            code: 'REPORT_PERSIST_FAILED',
            message: 'The digest was generated but could not be persisted.',
          });
          // Persistence is the publication boundary. Do not return content in
          // the aggregate response or notify Slack about a report that users
          // cannot retrieve from the audit trail.
          return;
        }

        digests.push(`## ${project.name}\n\n${digest}`);

        const { data: settings } = await db
          .from('project_settings')
          .select('slack_webhook_url')
          .eq('project_id', project.id)
          .single();
        if (settings?.slack_webhook_url) {
          await sendSlackNotification(settings.slack_webhook_url, {
            text: `Weekly Bug Intelligence — ${project.name}\n\n${digest.slice(0, 2000)}`,
          }).catch((e) =>
            intelLog.error('Slack delivery failed', { err: sanitizeLlmError(String(e)) }),
          );
        }
      });
    } catch (err) {
      await trace.end();
      await cronRun.fail(new Error(sanitizeLlmError(err).slice(0, 500)));
      throw err;
    }

    await trace.end();
    const generatedCount = outcomes.filter((outcome) => outcome.status === 'generated').length;
    const skippedCount = outcomes.filter((outcome) => outcome.status === 'skipped').length;
    const failedCount = outcomes.filter((outcome) => outcome.status === 'failed').length;
    const responseStatus =
      failedCount === 0 ? 200 : generatedCount > 0 || skippedCount > 0 ? 207 : 502;
    await cronRun.finish({
      rowsAffected: reportIds.length,
      metadata: {
        projectIds: (projects ?? []).map((p) => p.id),
        reportIds,
        skipped,
        outcomes,
        summary: { generated: generatedCount, skipped: skippedCount, failed: failedCount },
        weekStart: weekStart.toISOString().slice(0, 10),
      },
    });

    return new Response(
      JSON.stringify({
        ok: failedCount === 0,
        data: {
          reports: reportIds.length,
          reportIds,
          skipped,
          outcomes,
          summary: { generated: generatedCount, skipped: skippedCount, failed: failedCount },
          digest: digests.join('\n\n---\n\n'),
        },
      }),
      {
        status: responseStatus,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }),
);

function mostRecentMondayUtc(): Date {
  const now = new Date();
  const dow = now.getUTCDay(); // 0 = Sunday
  const daysSinceMonday = (dow + 6) % 7; // Monday → 0
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday - 7);
  return monday;
}

function topN(map: Record<string, number>, n: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n),
  );
}
