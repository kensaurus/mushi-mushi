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
 * Mushi does not send the repository_dispatch yet (no claude_code_agent
 * adapter in agent-adapters.ts); operators trigger it themselves. The payload
 * carries report text in `prompt`, so every client_payload value reaches the
 * shell through env and is quoted there, and the Claude step gets no GitHub
 * token.
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
    # Every dispatch value reaches the shell through env and is quoted there,
    # never through an expression inside run: (the prompt carries report text).
    env:
      TARGET_BRANCH: \${{ github.event.client_payload.target_branch }}
      BRANCH_NAME: \${{ github.event.client_payload.branch_name }}
      REPORT_ID: \${{ github.event.client_payload.report_id }}
      FIX_ATTEMPT_ID: \${{ github.event.client_payload.fix_attempt_id }}
      DISPATCH_EVENT_ID: \${{ github.event.client_payload.dispatch_event_id }}
      MUSHI_SUPABASE_URL: \${{ github.event.client_payload.mushi_supabase_url }}
    steps:
      - name: Check dispatch values
        run: |
          ref_ok() { [[ "$1" =~ ^[A-Za-z0-9._/-]{1,200}$ ]] && [[ "$1" != *..* ]]; }
          ref_ok "$TARGET_BRANCH" || { echo "target_branch is not a branch name"; exit 1; }
          ref_ok "$BRANCH_NAME" || { echo "branch_name is not a branch name"; exit 1; }
          [[ "$REPORT_ID" =~ ^[A-Za-z0-9-]{1,64}$ ]] || { echo "report_id is not an id"; exit 1; }
          [[ -z "$FIX_ATTEMPT_ID" || "$FIX_ATTEMPT_ID" =~ ^[A-Za-z0-9-]{1,64}$ ]] || { echo "fix_attempt_id is not an id"; exit 1; }
          [[ -z "$DISPATCH_EVENT_ID" || "$DISPATCH_EVENT_ID" =~ ^[A-Za-z0-9-]{1,64}$ ]] || { echo "dispatch_event_id is not an id"; exit 1; }

      - uses: actions/checkout@v4
        with:
          ref: \${{ env.TARGET_BRANCH }}
          token: \${{ secrets.GITHUB_TOKEN }}
          persist-credentials: false

      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Configure git
        run: |
          git config user.email "mushi-claude[bot]@users.noreply.github.com"
          git config user.name "Mushi Claude Bot"

      - name: Create fix branch
        run: git checkout -b "$BRANCH_NAME"

      # Claude gets the Anthropic key only: no GitHub token, so text in a
      # report cannot talk it into pushing or calling the GitHub API.
      - name: Run Claude Code fix
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          FIX_PROMPT: \${{ github.event.client_payload.prompt }}
        run: |
          npx --yes @anthropic-ai/claude-code@latest \\
            --dangerously-skip-permissions \\
            -p "$FIX_PROMPT"

      - name: Commit and open PR
        id: commit-pr
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          git add -A
          if git diff --staged --quiet; then
            echo "No changes made by Claude."
            echo "pr_created=false" >> "$GITHUB_OUTPUT"
            exit 1
          fi
          git commit -m "fix: mushi-$REPORT_ID"
          git -c "http.extraheader=AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)" \\
            push origin "HEAD:refs/heads/$BRANCH_NAME"
          BODY=$(printf '<!-- mushi-fix-id: %s -->\\n\\nAuto-fix by Mushi Claude Code Agent.\\n\\n**Report**: %s\\n**Fix attempt**: %s\\n' \\
            "$DISPATCH_EVENT_ID" "$REPORT_ID" "$FIX_ATTEMPT_ID")
          PR_URL=$(gh pr create --draft --head "$BRANCH_NAME" --base "$TARGET_BRANCH" \\
            --title "fix: mushi-$REPORT_ID" --body "$BODY")
          echo "pr_url=$PR_URL" >> "$GITHUB_OUTPUT"
          echo "pr_created=true" >> "$GITHUB_OUTPUT"

      - name: Report result to Mushi
        if: always()
        env:
          MUSHI_SERVICE_ROLE_KEY: \${{ secrets.MUSHI_SERVICE_ROLE_KEY }}
          PR_CREATED: \${{ steps.commit-pr.outputs.pr_created }}
          PR_URL: \${{ steps.commit-pr.outputs.pr_url }}
          RUN_ID: \${{ github.run_id }}
          RUN_URL: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}
        run: |
          if [ -z "$MUSHI_SUPABASE_URL" ] || [ -z "$MUSHI_SERVICE_ROLE_KEY" ] || [ -z "$FIX_ATTEMPT_ID" ]; then
            echo "Skip Mushi callback: set MUSHI_SERVICE_ROLE_KEY repo secret and ensure dispatch includes mushi_supabase_url."
            exit 0
          fi
          if [ "$PR_CREATED" = "true" ]; then
            DATA=$(jq -n --argjson id "$RUN_ID" --arg url "$RUN_URL" --arg pr "$PR_URL" \\
              '{claude_workflow_run_id: $id, claude_workflow_run_url: $url, status: "pr_opened", pr_url: $pr}')
          else
            DATA=$(jq -n --argjson id "$RUN_ID" --arg url "$RUN_URL" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \\
              '{claude_workflow_run_id: $id, claude_workflow_run_url: $url, status: "failed", failure_category: "claude_api_error", error: "Claude Code analyzed the codebase but made no file changes. Try a more specific report or manual investigation.", completed_at: $at}')
          fi
          curl -sf -X PATCH \\
            "$MUSHI_SUPABASE_URL/rest/v1/fix_attempts?id=eq.$FIX_ATTEMPT_ID" \\
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
