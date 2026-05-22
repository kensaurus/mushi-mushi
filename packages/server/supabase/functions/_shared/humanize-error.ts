/**
 * FILE: packages/server/supabase/functions/_shared/humanize-error.ts
 * PURPOSE: Pure function that converts a raw fix-attempt error string + context
 *          into a human-readable title, hint, and optional action. No platform
 *          imports — safe for both Deno edge functions and the React FE bundle.
 *
 * Usage:
 *   const h = humanizeFixError(fix.error, { agent: fix.agent, category: fix.failure_category });
 *   if (h) renderFriendlyPanel(h);
 */

export interface HumanizedFixError {
  /** ≤ 70 chars, sentence case, ends in a period. */
  title: string;
  /** 1-2 sentences, friendly, never shouty imperative. */
  hint: string;
  /** soft = retry might work without config change; hard = user must change something. */
  severity: 'soft' | 'hard';
  action?: {
    label: string;
    target:
      | { kind: 'route'; to: string; hash?: string }
      | { kind: 'retry' }
      | { kind: 'external'; url: string };
  };
  /** Verbatim source string — always available for power-user forensics. */
  raw: string;
}

type Context = {
  agent?: string | null;
  category?: string | null;
};

/**
 * Returns null when rawError is null/empty — callers render nothing in that case.
 * Matches patterns in priority order: more-specific first.
 */
export function humanizeFixError(
  rawError: string | null | undefined,
  context: Context = {},
): HumanizedFixError | null {
  if (!rawError) return null;
  const raw = rawError;
  const m = raw.toLowerCase();
  const { category } = context;

  // ── Cursor Cloud: model slug rejected ──────────────────────────────────────
  const invalidModelMatch = raw.match(/Cursor API error 400.*invalid_model.*'([^']+)'/i);
  if (invalidModelMatch || category === 'cursor_invalid_model') {
    const slug = invalidModelMatch?.[1] ?? 'the selected model';
    return {
      title: `Cursor doesn't recognise the model \`${slug}\`.`,
      hint:
        'Open Integrations → Cursor Cloud and choose a model from the dropdown, or leave it blank to let Cursor use your account default (composer-2.5 right now).',
      severity: 'hard',
      action: {
        label: 'Open Cursor Cloud settings',
        target: { kind: 'route', to: '/integrations/config', hash: 'cursor_cloud' },
      },
      raw,
    };
  }

  // ── Cursor Cloud: unrecognised body key (schema drift) ─────────────────────
  if (m.includes('cursor api error 400') && m.includes('unrecognized key')) {
    return {
      title: 'Mushi sent Cursor a field it no longer accepts.',
      hint:
        'This is a Mushi internal issue — the Cursor API changed its request schema. A Mushi update should fix it; you can retry in the meantime.',
      severity: 'soft',
      action: {
        label: 'Check Cursor changelog',
        target: { kind: 'external', url: 'https://cursor.com/changelog' },
      },
      raw,
    };
  }

  // ── Cursor Cloud: generic 400 ──────────────────────────────────────────────
  if (m.includes('cursor api error 400')) {
    return {
      title: 'Cursor rejected the fix request.',
      hint:
        'Check that your Cursor API key is valid and your Cursor plan includes agent access.',
      severity: 'hard',
      action: {
        label: 'Re-save Cursor API key',
        target: { kind: 'route', to: '/integrations/config', hash: 'cursor_cloud' },
      },
      raw,
    };
  }

  // ── Cursor Cloud: auth / key rejected ─────────────────────────────────────
  if (m.includes('cursor api error 401') || m.includes('cursor api error 403')) {
    return {
      title: 'Your Cursor API key was rejected.',
      hint:
        'Re-save the key in Integrations → Cursor Cloud. Make sure you copied the full `crsr_…` token.',
      severity: 'hard',
      action: {
        label: 'Re-save Cursor API key',
        target: { kind: 'route', to: '/integrations/config', hash: 'cursor_cloud' },
      },
      raw,
    };
  }

  // ── Cursor Cloud: rate limited ─────────────────────────────────────────────
  if (m.includes('cursor api error 429')) {
    return {
      title: 'Cursor temporarily rate-limited your account.',
      hint: 'Wait a minute and try again — rate limits usually clear within 60 seconds.',
      severity: 'soft',
      action: { label: 'Try again', target: { kind: 'retry' } },
      raw,
    };
  }

  // ── Cursor Cloud: server error ─────────────────────────────────────────────
  if (/cursor api error 5\d\d/.test(m)) {
    return {
      title: 'Cursor Cloud had a server error.',
      hint: 'This is on Cursor's side — retrying usually resolves it within a few minutes.',
      severity: 'soft',
      action: { label: 'Try again', target: { kind: 'retry' } },
      raw,
    };
  }

  // ── Cursor Cloud: unreachable ──────────────────────────────────────────────
  if (m.includes('cursor api unreachable')) {
    return {
      title: 'Mushi could not reach the Cursor API.',
      hint:
        'This is usually a transient network timeout. Try again in a moment.',
      severity: 'soft',
      action: { label: 'Try again', target: { kind: 'retry' } },
      raw,
    };
  }

  // ── Cursor Cloud: key not configured ──────────────────────────────────────
  if (m.includes('cursor_api_key_ref not set') || m.includes('cursor api key vault lookup failed')) {
    return {
      title: 'Cursor isn't connected for this project yet.',
      hint: 'Add a Cursor API key in Integrations → Cursor Cloud to enable cloud agent fixes.',
      severity: 'hard',
      action: {
        label: 'Connect Cursor Cloud',
        target: { kind: 'route', to: '/integrations/config', hash: 'cursor_cloud' },
      },
      raw,
    };
  }

  // ── GitHub: repo URL missing ───────────────────────────────────────────────
  if (m.includes('cursor_cloud requires a github repo url') || m.includes('github repo url')) {
    return {
      title: 'Cursor needs to know which repo to clone.',
      hint: 'Add a GitHub repo URL in Integrations → GitHub so Cursor knows where to push the fix.',
      severity: 'hard',
      action: {
        label: 'Add GitHub repo',
        target: { kind: 'route', to: '/fixes' },
      },
      raw,
    };
  }

  // ── GitHub: token rejected ─────────────────────────────────────────────────
  if (m.includes('github api error 401') || m.includes('github') && m.includes('401')) {
    return {
      title: 'Your GitHub token isn't authorised on this repo.',
      hint:
        'Re-save the token in Integrations → GitHub. It needs `contents:write` and `pull_requests:write` scopes.',
      severity: 'hard',
      action: {
        label: 'Re-save GitHub token',
        target: { kind: 'route', to: '/integrations/config', hash: 'github' },
      },
      raw,
    };
  }

  // ── GitHub: rate limited ───────────────────────────────────────────────────
  if (m.includes('github api error 403') && m.includes('rate limit')) {
    return {
      title: 'GitHub rate-limited your token.',
      hint: 'The GitHub API rate limit resets every hour. Try again in a few minutes.',
      severity: 'soft',
      action: { label: 'Try again in a few minutes', target: { kind: 'retry' } },
      raw,
    };
  }

  // ── GitHub: forbidden / no write access ───────────────────────────────────
  if (m.includes('github api error 403') || (m.includes('github') && m.includes('403'))) {
    return {
      title: 'Mushi doesn't have write access to the repo.',
      hint:
        'Check the token has `contents:write` and `pull_requests:write` permissions, and that it hasn't expired.',
      severity: 'hard',
      action: {
        label: 'Re-save GitHub token',
        target: { kind: 'route', to: '/integrations/config', hash: 'github' },
      },
      raw,
    };
  }

  // ── GitHub: repo not found ─────────────────────────────────────────────────
  if ((m.includes('github') || m.includes('github_404') || category === 'github_404') && m.includes('404')) {
    return {
      title: 'Mushi can't find that GitHub repo or branch.',
      hint:
        'Check the repo URL in Integrations → GitHub — the repo may have been renamed or the default branch changed.',
      severity: 'hard',
      action: {
        label: 'Check repo URL',
        target: { kind: 'route', to: '/integrations/config', hash: 'github' },
      },
      raw,
    };
  }

  // ── LLM: structured-output failure ────────────────────────────────────────
  if (
    m.includes('noobjectgeneratederror') ||
    m.includes('no_object') ||
    category === 'llm_no_object'
  ) {
    return {
      title: 'The LLM gave a response that didn't fit the expected shape.',
      hint:
        'This is usually a transient model hiccup — the fix-worker already retried with a schema-repair hint. Try once more.',
      severity: 'soft',
      action: { label: 'Retry once more', target: { kind: 'retry' } },
      raw,
    };
  }

  // ── LLM: schema violation (well-formed JSON but zod fails) ────────────────
  if (
    m.includes('zoderror') ||
    m.includes('zod schema') ||
    category === 'llm_schema_violation'
  ) {
    return {
      title: 'The LLM's response had the right format but the wrong shape.',
      hint:
        'A second retry usually resolves this — the model occasionally omits required fields when the prompt is complex.',
      severity: 'soft',
      action: { label: 'Retry', target: { kind: 'retry' } },
      raw,
    };
  }

  // ── LLM: rate limit ───────────────────────────────────────────────────────
  if (m.includes('rate limit') || m.includes('429') || category === 'llm_rate_limit') {
    return {
      title: 'The LLM provider rate-limited this request.',
      hint:
        'Retrying in a moment usually works. If it happens repeatedly, check your BYOK API key quota.',
      severity: 'soft',
      action: { label: 'Retry', target: { kind: 'retry' } },
      raw,
    };
  }

  // ── Embedding provider returned HTML ──────────────────────────────────────
  if (
    m.includes("unexpected token '<'") ||
    m.includes('<!doctype') ||
    category === 'embedding_provider_html_response'
  ) {
    return {
      title: 'The embedding provider returned an error page instead of a vector.',
      hint:
        'This usually means your OpenAI / OpenRouter key is invalid or has run out of credits.',
      severity: 'hard',
      action: {
        label: 'Re-save API key',
        target: { kind: 'route', to: '/integrations/config', hash: 'byok' },
      },
      raw,
    };
  }

  // ── Upstream 500 HTML ──────────────────────────────────────────────────────
  if (category === 'upstream_internal_server') {
    return {
      title: 'An upstream provider returned a server error.',
      hint: 'This is on the provider's side. Retrying usually resolves it.',
      severity: 'soft',
      action: { label: 'Try again', target: { kind: 'retry' } },
      raw,
    };
  }

  // ── Sandbox timeout ────────────────────────────────────────────────────────
  if (m.includes('sandbox') && m.includes('timeout') || category === 'sandbox_timeout') {
    return {
      title: 'The fix sandbox ran out of time before the agent finished.',
      hint:
        'The codebase may be large or the fix complex. Retrying with a narrower scope often helps.',
      severity: 'soft',
      action: { label: 'Retry', target: { kind: 'retry' } },
      raw,
    };
  }

  // ── No relevant context / RAG found nothing ────────────────────────────────
  if (
    m.includes('no grounding context') ||
    m.includes('skipped_no_context') ||
    category === 'no_relevant_code'
  ) {
    return {
      title: 'Mushi couldn't find relevant code to fix.',
      hint:
        'The codebase index may be out of date. Re-index under Settings → Codebase Indexing and retry.',
      severity: 'hard',
      action: { label: 'Retry', target: { kind: 'retry' } },
      raw,
    };
  }

  // ── Scope blocked ──────────────────────────────────────────────────────────
  if (category === 'scope_blocked' || m.includes('outside scope')) {
    return {
      title: 'The fix was blocked by the scope restriction setting.',
      hint:
        'The agent tried to modify files outside the allowed scope. Expand the scope in Settings or retry with a different agent.',
      severity: 'hard',
      action: { label: 'Check scope settings', target: { kind: 'route', to: '/settings' } },
      raw,
    };
  }

  // ── Spec violation ─────────────────────────────────────────────────────────
  if (category === 'spec_violation' || m.includes('spec violation')) {
    return {
      title: 'The fix failed a spec validation gate.',
      hint:
        'The agent's changes didn't satisfy the inventory contract for this action. Expand the fix card to see the validation warnings.',
      severity: 'soft',
      action: { label: 'Retry', target: { kind: 'retry' } },
      raw,
    };
  }

  // ── Claude Code Agent ──────────────────────────────────────────────────────
  // SYNC NOTE: Keep in sync with apps/admin/src/lib/humanizeFixError.ts

  // Claude: no changes (agent ran but found nothing to fix)
  if ((m.includes('no changes') && m.includes('claude')) || (category === 'claude_api_error' && m.includes('no changes'))) {
    return {
      title: 'Claude Code analyzed the codebase but made no changes.',
      hint: 'The bug may need a more specific prompt or manual investigation. Try again with a more detailed description.',
      severity: 'soft',
      action: { label: 'Retry with more detail', target: { kind: 'retry' } },
      raw,
    };
  }

  // Claude: key not configured
  if (m.includes('claude_code_agent requires an anthropic api key') || m.includes('claude api key vault lookup failed') || category === 'claude_api_error') {
    return {
      title: 'Claude Code Agent needs an Anthropic API key.',
      hint: 'Add your Anthropic API key in Integrations → Claude Code Agent.',
      severity: 'hard',
      action: { label: 'Connect Claude Code Agent', target: { kind: 'route', to: '/integrations/config', hash: 'claude_code_agent' } },
      raw,
    };
  }

  // Claude: workflow not found
  if (category === 'claude_workflow_missing' || m.includes('mushi-claude-fix workflow not found')) {
    return {
      title: 'The mushi-claude-fix GitHub Actions workflow is missing.',
      hint: 'Add the workflow YAML from Integrations → Claude Code Agent → Workflow YAML to .github/workflows/mushi-claude-fix.yml in your repo.',
      severity: 'hard',
      action: { label: 'View setup docs', target: { kind: 'route', to: '/integrations/config', hash: 'claude_code_agent' } },
      raw,
    };
  }

  // Claude: dispatch failed
  if (category === 'claude_repo_dispatch_failed' || m.includes('github dispatch error')) {
    return {
      title: 'Mushi could not trigger the GitHub Actions workflow.',
      hint: 'Check that your GitHub token has `actions:write` (or `contents:write`) permission on the repo.',
      severity: 'hard',
      action: { label: 'Re-save GitHub token', target: { kind: 'route', to: '/integrations/config', hash: 'github' } },
      raw,
    };
  }

  // ── Fallthrough ────────────────────────────────────────────────────────────
  return {
    title: 'The fix attempt failed.',
    hint:
      'Expand the technical details below to see the full error. You can also open the Langfuse trace for the LLM output.',
    severity: 'soft',
    action: { label: 'Retry', target: { kind: 'retry' } },
    raw,
  };
}
