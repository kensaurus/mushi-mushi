/**
 * FILE: packages/react/src/trigger.tsx
 * PURPOSE: Headless React primitives for triggering the Mushi reporter
 *          without the auto-injected floating stamp button.
 *
 * OVERVIEW:
 * - MushiTrigger: polymorphic component ("as" prop) that opens the reporter
 *   with an optional pre-selected category on click. Renders any host
 *   element so designers can match the app's design language exactly.
 * - MushiAttach: declarative equivalent of `sdk.attachTo(selector)` — mounts
 *   the click listener on `selector` on mount and tears it down on unmount.
 *
 * USAGE:
 *   // As a button in your own component
 *   <MushiTrigger category="bug">Report a bug</MushiTrigger>
 *
 *   // As a custom element
 *   <MushiTrigger as="a" href="#" category="slow" className="my-btn">
 *     Slow? Tell us
 *   </MushiTrigger>
 *
 *   // Attach to an existing DOM element by selector
 *   <MushiAttach selector="#help-fab" category="bug" />
 *
 * NOTES:
 * - Both components are no-ops when the SDK is not yet initialized (e.g.
 *   server-side render, or before MushiProvider mounts).
 * - MushiAttach adds/removes the listener on every selector change.
 */

import { useEffect, type ComponentPropsWithRef, type ElementType, type ReactNode } from 'react'
import type { MushiReportCategory } from '@mushi-mushi/core'
import { useMushi } from './hooks'

// ── MushiTrigger ────────────────────────────────────────────────────────────

type AsProp<C extends ElementType> = {
  /** Element or component to render as. Defaults to `button`. */
  as?: C
  /** Pre-select a report category when the panel opens. */
  category?: MushiReportCategory
  children?: ReactNode
}

type MushiTriggerProps<C extends ElementType = 'button'> = AsProp<C> &
  Omit<ComponentPropsWithRef<C>, keyof AsProp<C>>

/**
 * Polymorphic trigger that opens the Mushi reporter on click.
 * Passes through all native props and refs so it integrates cleanly
 * with any design system (Radix, Ariakit, shadcn, etc.).
 */
export function MushiTrigger<C extends ElementType = 'button'>({
  as,
  category,
  children,
  onClick,
  ...rest
}: MushiTriggerProps<C>) {
  const sdk = useMushi()
  const Component = (as ?? 'button') as ElementType

  function handleClick(e: React.MouseEvent) {
    ;(onClick as ((e: React.MouseEvent) => void) | undefined)?.(e)
    if (e.defaultPrevented) return
    sdk?.report(category ? { category } : undefined)
  }

  return (
    <Component {...rest} onClick={handleClick}>
      {children}
    </Component>
  )
}

// ── MushiAttach ─────────────────────────────────────────────────────────────

interface MushiAttachProps {
  /** CSS selector of the host element to attach the click listener to. */
  selector: string
  /** Pre-select a category when the reporter opens. */
  category?: MushiReportCategory
}

/**
 * Declarative alternative to `sdk.attachTo(selector)`.
 * Renders nothing — only manages the event listener lifecycle.
 *
 * Use when you can't wrap the trigger element with a React component
 * (e.g. third-party UI, portal, or a non-React DOM node).
 *
 * When `category` is specified, a direct `sdk.report({ category })` click
 * handler is used instead of `sdk.attachTo()` because `attachTo` accepts
 * `MushiWidgetConfig` (position, theme, …) rather than a pre-selected category.
 */
export function MushiAttach({ selector, category }: MushiAttachProps) {
  const sdk = useMushi()

  useEffect(() => {
    if (!sdk || !selector) return

    if (category) {
      // When a category is requested we bypass sdk.attachTo() (which only
      // accepts MushiWidgetConfig, not a pre-selected category) and attach
      // a direct click handler that calls sdk.report({ category }) instead.
      const elements = Array.from(document.querySelectorAll(selector))
      if (!elements.length) return
      const handleClick = (e: Event) => {
        e.preventDefault()
        sdk.report({ category })
      }
      elements.forEach((el) => el.addEventListener('click', handleClick))
      return () => elements.forEach((el) => el.removeEventListener('click', handleClick))
    }

    // No category — delegate to the SDK's built-in attachTo which handles
    // element discovery, event wiring, and cleanup.
    const cleanup = sdk.attachTo(selector)
    return typeof cleanup === 'function' ? cleanup : undefined
  }, [sdk, selector, category])

  return null
}
