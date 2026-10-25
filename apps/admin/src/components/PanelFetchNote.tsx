/**
 * FILE: apps/admin/src/components/PanelFetchNote.tsx
 * PURPOSE: One-line failure for a panel that already has its own layout.
 *          The first failure names what failed and offers Retry. A later
 *          failure leaves the last result on screen and says so.
 *
 *          EmptySectionMessage is the dashed "nothing here yet" box and has
 *          no Retry. PageLoadError is the page-level danger card: it takes
 *          focus and always uses role="alert". This note is the one-line
 *          form for a panel that keeps its layout: role="alert" on a first
 *          failure, role="status" when the last result stays on screen.
 */

interface Props {
  /** First-failure sentence, e.g. "Couldn't load team activity." */
  message?: string
  /** True when earlier data is still on screen. */
  stale?: boolean
  onRetry?: () => void
  className?: string
}

export function PanelFetchNote({ message, stale = false, onRetry, className = '' }: Props) {
  const text = stale ? "Couldn't refresh. Showing the last result." : (message ?? '')
  if (!text && !onRetry) return null
  return (
    <p role={stale ? 'status' : 'alert'} className={`text-xs leading-relaxed ${stale ? 'text-fg-muted' : 'text-danger'} ${className}`}>
      {text}
      {text && onRetry ? ' ' : null}
      {onRetry ? (
        <button
          type="button"
          className="font-medium text-brand underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded-sm"
          onClick={onRetry}
        >
          Retry
        </button>
      ) : null}
    </p>
  )
}
