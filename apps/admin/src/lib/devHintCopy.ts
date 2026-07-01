/**
 * Detects internal dev-facing hint copy (TAB_META descriptions, "Banner + …"
 * scaffolding notes) that should not render in the operator UI.
 */

export function isDevFacingHint(text: string | null | undefined): boolean {
  if (!text?.trim()) return true
  const t = text.trim()
  return (
    /^Banner \+/i.test(t) ||
    /EXPLORE SNAPSHOT/i.test(t) ||
    /SNAPSHOT (first|—)/i.test(t) ||
    /^(Posture banner|Pipeline posture|MCP posture|Reporter loop|Plugin posture|Workspace posture|Firecrawl posture)/i.test(t) ||
    /posture banner/i.test(t) ||
    /recommended next step/i.test(t)
  )
}
