/**
 * FILE: apps/admin/src/components/integrations/SuggestIntegrationButton.tsx
 * PURPOSE: Low-friction "suggest an integration" nudge rendered at the foot
 *          of each integration tab. Taps into the existing FeedbackModal
 *          (feature category) — no new backend surface needed; the support
 *          contact endpoint already handles feature requests.
 */

import { IconNote } from '../icons'

interface Props {
  /** Which tab this lives on — used only for accessible labelling. */
  context: 'platform' | 'routing'
  onSuggest: () => void
}

export function SuggestIntegrationButton({ context, onSuggest }: Props) {
  const label =
    context === 'platform'
      ? 'Missing an observability or CI tool?'
      : 'Need a different ticketing or paging destination?'

  return (
    <div className="mt-1 flex items-center justify-between rounded-md border border-dashed border-edge px-3 py-2.5">
      <p className="text-2xs text-fg-faint leading-snug">{label}</p>
      <button
        type="button"
        onClick={onSuggest}
        className="ml-3 shrink-0 inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-2xs font-medium text-fg-muted hover:text-fg hover:bg-surface-raised transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        aria-label="Suggest an integration"
      >
        <IconNote size={12} />
        Suggest an integration
      </button>
    </div>
  )
}
