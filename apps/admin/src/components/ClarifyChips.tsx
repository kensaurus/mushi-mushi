/**
 * FILE: apps/admin/src/components/ClarifyChips.tsx
 * PURPOSE: Render the chip-shaped options the assistant returns when its
 *          reply.kind is "clarify". Clicking a chip is identical to
 *          typing the option text as the next user message — keeps the
 *          conversation transcript faithful and avoids hidden side-effects.
 */

interface Props {
  question: string
  options: string[]
  onPick: (option: string) => void
  disabled?: boolean
}

export function ClarifyChips({ question, options, onPick, disabled = false }: Props) {
  if (options.length === 0) return null
  return (
    <div className="mt-1 space-y-1.5">
      <div className="text-2xs text-fg-muted leading-snug">{question}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            onClick={() => onPick(opt)}
            className="inline-flex items-center rounded-full px-2.5 py-1 text-2xs hover:bg-brand-subtle border border-brand/28 bg-brand/12 text-brand disabled:opacity-50 disabled:cursor-not-allowed motion-safe:transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}
