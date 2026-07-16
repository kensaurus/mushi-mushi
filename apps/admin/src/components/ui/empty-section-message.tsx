/**
 * Shared empty-section message for list panels / filtered views.
 * Lives in ui/ so feature pages do not import from report-detail/.
 */

export function EmptySectionMessage({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="rounded-md border border-dashed border-edge-subtle/70 bg-surface-overlay/20 px-3 py-2.5">
      <p className="text-xs text-fg-muted leading-relaxed">{text}</p>
      {hint && <p className="mt-1 text-2xs text-fg-faint leading-relaxed">{hint}</p>}
    </div>
  )
}
