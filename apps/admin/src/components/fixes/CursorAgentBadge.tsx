/**
 * FILE: apps/admin/src/components/fixes/CursorAgentBadge.tsx
 * PURPOSE: Small Cursor agent chip shown on FixCard when agent='cursor_cloud'.
 *          Deep-links to the Cursor Web agent run page.
 */

interface Props {
  agentId: string;
}

export function CursorAgentBadge({ agentId }: Props) {
  const agentUrl = `https://cursor.com/agents/${agentId}`;
  const shortId = agentId.length > 12 ? `${agentId.slice(0, 12)}…` : agentId;

  return (
    <a
      href={agentUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`Cursor Cloud Agent run ${agentId} — click to open in Cursor Web`}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-mono
                 bg-[#1a1a2e] text-[#a78bfa] border border-[#7c3aed]/40
                 hover:border-[#7c3aed]/80 hover:text-[#c4b5fd] transition-colors"
    >
      {/* Cursor logo glyph (simple diamond) */}
      <svg
        width="8"
        height="8"
        viewBox="0 0 8 8"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M4 0L8 4L4 8L0 4Z" />
      </svg>
      Cursor&nbsp;{shortId}
    </a>
  );
}
