/**
 * Copy for the report-detail "Dispatch fix" confirm. One click used to spend
 * LLM budget and open a PR with no pause; the MCP tools already require the
 * agent to confirm first, so the console does too.
 */

/** `owner/repo` from a GitHub URL, else the URL without its scheme. */
function shortRepoName(repoUrl: string): string {
  const match = repoUrl.match(/github\.com[/:]([^/]+\/[^/.]+)/i)
  return match?.[1] ?? repoUrl.replace(/^https?:\/\//, '').replace(/\.git$/, '')
}

export function dispatchConfirmBody(input: { repoUrl: string | null | undefined; baseBranch: string | null | undefined }): string {
  const repo = input.repoUrl ? shortRepoName(input.repoUrl) : 'the connected repo'
  const base = input.baseBranch ? `the ${input.baseBranch} branch` : 'its default branch'
  return (
    `The fix agent reads the code, drafts a change with your LLM budget, and opens a draft PR on ${repo} ` +
    `against ${base}. Nothing merges until you review it.`
  )
}
