/**
 * FILE: intelligence-report-llm-fallback.test.ts
 * PURPOSE: Lock the MUSHI-MUSHI-SERVER-1S regression fix.
 *
 * A tenant with an invalid Anthropic key and a valid OpenAI key must still
 * receive its weekly digest. Exhausting tenant-owned credentials is an
 * actionable BYOK configuration state in Supabase Logs, not a platform
 * exception that should reopen a Sentry issue every week.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(__dirname, '../../supabase/functions/intelligence-report/index.ts'),
  'utf8',
);

describe('intelligence-report LLM fallback (MUSHI-MUSHI-SERVER-1S)', () => {
  it('uses the shared cross-provider failover path', () => {
    expect(source).toContain("import { createOpenAI } from 'npm:@ai-sdk/openai@1'");
    expect(source).toContain('withAnthropicOrOpenAi(');
    expect(source).toContain('model: openai(INTELLIGENCE_FALLBACK)');
    expect(source).toContain("usedProvider === 'openai'");
  });

  it('preserves an OpenAI-compatible tenant base URL', () => {
    expect(source).toMatch(
      /createOpenAI\(\{[\s\S]{0,180}apiKey:\s*resolved\.key,[\s\S]{0,180}baseURL:\s*resolved\.baseUrl/,
    );
  });

  it('records the actual model and fallback state in telemetry', () => {
    expect(source).toMatch(/usedModel,\s*\n\s*fallbackUsed,\s*\n\s*status:\s*'success'/);
    expect(source).toContain('llmModel: usedModel');
  });

  it('keeps exhausted tenant credentials out of Sentry without hiding platform failures', () => {
    expect(source).toMatch(
      /err instanceof LlmFailoverError[\s\S]{0,500}intelLog\.warn\('Intelligence digest has no usable LLM key/,
    );
    expect(source).toContain("intelLog.error('Intelligence digest LLM generation failed'");
    expect(source).not.toContain('if (projectId && !(err instanceof LlmFailoverError))');
  });

  it('returns machine-readable per-project outcomes without raw provider errors', () => {
    expect(source).toContain("status: 'generated'");
    expect(source).toContain("status: 'skipped'");
    expect(source).toContain("status: 'failed'");
    expect(source).toContain("'LLM_KEYS_NOT_CONFIGURED'");
    expect(source).toContain("'LLM_KEYS_UNUSABLE'");
    expect(source).toContain("'LLM_GENERATION_FAILED'");
    expect(source).toContain("'REPORT_PERSIST_FAILED'");
    expect(source).toContain(
      'summary: { generated: generatedCount, skipped: skippedCount, failed: failedCount }',
    );
    expect(source).toContain('sanitizeLlmError(');
    expect(source).toContain('status: responseStatus');
    expect(source).toMatch(
      /failedCount === 0[\s\S]{0,120}\? 200[\s\S]{0,120}\? 207[\s\S]{0,120}: 502/,
    );
  });

  it('does not publish or notify a digest that failed persistence', () => {
    const failureBoundary = source.indexOf(
      "intelLog.error('Failed to persist intelligence report'",
    );
    const stopAfterFailure = source.indexOf('return;', failureBoundary);
    const publishAfterFailure = source.indexOf('digests.push', failureBoundary);

    expect(failureBoundary).toBeGreaterThan(-1);
    expect(stopAfterFailure).toBeGreaterThan(failureBoundary);
    expect(publishAfterFailure).toBeGreaterThan(stopAfterFailure);
    expect(source.indexOf('digests.push')).toBeLessThan(
      source.indexOf("select('slack_webhook_url')"),
    );
  });

  it('closes failed cron telemetry before rethrowing platform errors', () => {
    expect(source).toMatch(
      /catch \(err\) \{\s*await trace\.end\(\);?\s*await cronRun\.fail\(new Error\(sanitizeLlmError/,
    );
  });
});
