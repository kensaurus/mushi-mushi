/**
 * FILE: apps/admin/src/components/fixes/ClaudeAgentBadge.tsx
 * PURPOSE: Claude Code Agent chip shown on FixCard when agent='claude_code_agent'.
 *          Links to the GitHub Actions workflow run page while the PR is pending,
 *          then to the PR once it opens. Shows a pulsing ring when actively running.
 */

interface Props {
  /** GitHub Actions run HTML URL, e.g. https://github.com/owner/repo/actions/runs/12345 */
  workflowRunUrl?: string | null;
  /** When true, shows a pulsing live indicator (agent still running). */
  isRunning?: boolean;
}

export function ClaudeAgentBadge({ workflowRunUrl, isRunning = false }: Props) {
  const href = workflowRunUrl ?? 'https://docs.claude.com/code';
  const label = workflowRunUrl ? 'View workflow run' : 'Claude Code docs';

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Claude Code Agent — ${label}`}
      className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-2xs font-mono
                 bg-surface-root text-warn border border-warn/40
                 hover:border-warn/80 hover:text-brand transition-opacity"
    >
      {isRunning ? (
        /* Pulsing dot while the agent is live */
        <span
          className="relative flex h-2 w-2 shrink-0"
          aria-label="Agent running"
        >
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warn opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-warn" />
        </span>
      ) : (
        /* Claude logo mark — simplified diamond shape */
        <svg
          width="9"
          height="10"
          viewBox="0 0 9 10"
          fill="currentColor"
          aria-hidden="true"
          className="shrink-0"
        >
          <path d="M4.5 0.5L8.5 4.5L4.5 9.5L0.5 4.5L4.5 0.5Z" />
        </svg>
      )}
      <span>Claude&nbsp;{isRunning ? 'running…' : workflowRunUrl ? 'run ↗' : 'docs ↗'}</span>
    </a>
  );
}
