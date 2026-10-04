/**
 * Canonical GitHub Actions workflow for Claude Code Agent fixes.
 *
 * BYOK contract: this template must never contain API keys, service role
 * tokens, or project-specific Supabase URLs. Operators copy it into
 * `.github/workflows/mushi-claude-fix.yml` in their own repo and configure
 * secrets in GitHub → Settings → Secrets and variables → Actions:
 *
 *   ANTHROPIC_API_KEY        — your Anthropic API key (BYOK)
 *   MUSHI_SERVICE_ROLE_KEY   — optional, self-hosted only (status callback)
 *
 * The fix-worker passes `mushi_supabase_url` in repository_dispatch
 * client_payload so each Mushi deployment can target the correct project.
 */
/** The repository_dispatch event type the workflow listens for when none is saved. */
export const DEFAULT_CLAUDE_WORKFLOW_EVENT = 'mushi_claude_fix'
const EVENT_TYPE_RE = /^[A-Za-z0-9_.-]{1,100}$/

/**
 * `eventType` is the project's saved Workflow event (claude_workflow_event),
 * so the YAML the console hands out listens for the event the project is
 * set to send. Anything that is not a plain identifier falls back to the
 * default rather than being written into the YAML.
 */
export function getMushiClaudeFixWorkflowYaml(eventType?: string | null): string {
  const event = eventType && EVENT_TYPE_RE.test(eventType) ? eventType : DEFAULT_CLAUDE_WORKFLOW_EVENT
  return `name: Mushi Claude Code Fix
# Triggered by Mushi via repository_dispatch (event: ${event}).
# Copy this file to .github/workflows/mushi-claude-fix.yml in your repo.
on:
  repository_dispatch:
    types: [${event}]

jobs:
  fix:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.client_payload.target_branch }}
          token: \${{ secrets.GITHUB_TOKEN }}

      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Configure git
        run: |
          git config user.email "mushi-claude[bot]@users.noreply.github.com"
          git config user.name "Mushi Claude Bot"

      - name: Create fix branch
        run: |
          git checkout -b "\${{ github.event.client_payload.branch_name }}"

      - name: Run Claude Code fix
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          npx --yes @anthropic-ai/claude-code@latest \\
            --dangerously-skip-permissions \\
            -p "\${{ github.event.client_payload.prompt }}"

      - name: Commit and open PR
        id: commit-pr
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          git add -A
          if git diff --staged --quiet; then
            echo "No changes made by Claude."
            echo "pr_created=false" >> $GITHUB_OUTPUT
            exit 1
          fi
          git commit -m "fix: mushi-\${{ github.event.client_payload.report_id }}"
          git push origin "HEAD:\${{ github.event.client_payload.branch_name }}"
          PR_URL=$(gh pr create \\
            --draft \\
            --title "fix: mushi-\${{ github.event.client_payload.report_id }}" \\
            --body "<!-- mushi-fix-id: \${{ github.event.client_payload.dispatch_event_id }} -->

          Auto-fix by Mushi Claude Code Agent.

          **Report**: \${{ github.event.client_payload.report_id }}
          **Fix attempt**: \${{ github.event.client_payload.fix_attempt_id }}")
          echo "pr_url=$PR_URL" >> $GITHUB_OUTPUT
          echo "pr_created=true" >> $GITHUB_OUTPUT

      - name: Report result to Mushi
        if: always()
        env:
          MUSHI_SERVICE_ROLE_KEY: \${{ secrets.MUSHI_SERVICE_ROLE_KEY }}
        run: |
          SUPABASE_URL="\${{ github.event.client_payload.mushi_supabase_url }}"
          FIX_ATTEMPT_ID="\${{ github.event.client_payload.fix_attempt_id }}"
          RUN_ID="\${{ github.run_id }}"
          RUN_URL="\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}"
          PR_CREATED="\${{ steps.commit-pr.outputs.pr_created }}"
          PR_URL="\${{ steps.commit-pr.outputs.pr_url }}"

          if [ -z "$SUPABASE_URL" ] || [ -z "$MUSHI_SERVICE_ROLE_KEY" ]; then
            echo "Skip Mushi callback: set MUSHI_SERVICE_ROLE_KEY repo secret and ensure dispatch includes mushi_supabase_url."
            exit 0
          fi

          if [ "$PR_CREATED" = "true" ]; then
            STATUS="pr_opened"
            DATA="{\\"claude_workflow_run_id\\": $RUN_ID, \\"claude_workflow_run_url\\": \\"$RUN_URL\\", \\"status\\": \\"$STATUS\\", \\"pr_url\\": \\"$PR_URL\\"}"
          else
            STATUS="failed"
            DATA="{\\"claude_workflow_run_id\\": $RUN_ID, \\"claude_workflow_run_url\\": \\"$RUN_URL\\", \\"status\\": \\"$STATUS\\", \\"failure_category\\": \\"claude_api_error\\", \\"error\\": \\"Claude Code analyzed the codebase but made no file changes. Try a more specific report or manual investigation.\\", \\"completed_at\\": \\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\\"}"
          fi

          curl -sf -X PATCH \\
            "$SUPABASE_URL/rest/v1/fix_attempts?id=eq.$FIX_ATTEMPT_ID" \\
            -H "apikey: $MUSHI_SERVICE_ROLE_KEY" \\
            -H "Authorization: Bearer $MUSHI_SERVICE_ROLE_KEY" \\
            -H "Content-Type: application/json" \\
            -H "Prefer: return=minimal" \\
            -d "$DATA" || echo "Mushi callback failed (non-fatal)"
`;
}

/** GitHub repo secrets the operator must configure (BYOK). */
export const MUSHI_CLAUDE_GITHUB_SECRETS = [
  {
    name: 'ANTHROPIC_API_KEY',
    description:
      'Your Anthropic API key. Claude Code runs in your GitHub Actions runner — Mushi never stores this in your public repo.',
  },
  {
    // The console never hands out a service-role key (hosted users must never
    // hold one), so this used to point at a control that does not exist.
    name: 'MUSHI_SERVICE_ROLE_KEY',
    description:
      'Optional, self-hosted Mushi only: the service role key of your own Mushi Supabase project, so the run can write its result back. Hosted Mushi does not hand out this key; leave it unset and the workflow skips the write-back step.',
  },
] as const;
