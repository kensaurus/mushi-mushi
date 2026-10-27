/**
 * FILE: apps/admin/src/components/ui/help-popover.tsx
 * PURPOSE: "How this page works" at the edge of a page header (pattern P2,
 *          console journeys 2026-10-27). The "What it is / When to use it /
 *          How to use it" explainers used to sit in the page's flow, above
 *          or between the real content; now they open from one small button
 *          and the page leads with its data.
 *
 *          - <HelpPopover> takes any content (Home can put its "How Mushi
 *            works" loop in one).
 *          - <PageHelpPopover> renders a page's registered help (the same
 *            props PageHeaderBar takes) and marks it read when opened. Until
 *            then the trigger carries a small dot: the first-use cue, from
 *            the existing per-route read store (lib/pageHelpRead).
 *          - <PageHelpSections> is the body, shared with the inline panel
 *            Layout shows on an empty page.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { HelpBulletList, HelpRichText } from '../HelpRichText'
import { HelpSection } from '../HelpSection'
import { isPageHelpRead, markPageHelpRead } from '../../lib/pageHelpRead'
import { resolveFlowPath } from '../../lib/pageLinks'
import { CONFIG_HELP_POPOVER_SHELL } from '../../lib/pageHelpSurfaces'
import { AnchoredPopoverPanel, useAnchoredPopover } from './anchored-popover'

const HELP_POPOVER_WIDTH = 400

/** @public Shared with Home's "How Mushi works" (wave 2, feat/project-home). */
export interface HelpPopoverProps {
  /** Visible trigger text; hidden below `sm`, where the "?" glyph stays. */
  label?: string
  /** Heading inside the popover. */
  title: string
  children: ReactNode
  /** Shows a dot on the trigger: help the user has not opened yet. */
  unread?: boolean
  onOpenChange?: (open: boolean) => void
  /** Which trigger edge the popover lines up with. Header corners use `end`. */
  align?: 'start' | 'end'
}

/** @public A help popover for any content, e.g. Home's "How Mushi works" loop. */
export function HelpPopover({
  label = 'How this page works',
  title,
  children,
  unread = false,
  onOpenChange,
  align = 'end',
}: HelpPopoverProps) {
  const popover = useAnchoredPopover({ width: HELP_POPOVER_WIDTH, align, onOpenChange })
  const { open, setOpen, close, triggerRef, popoverId, titleId } = popover
  return (
    <span className="relative inline-flex shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={popoverId}
        aria-haspopup="dialog"
        data-testid="help-popover-trigger"
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-sm border border-edge-subtle px-1.5 text-2xs text-fg-muted motion-safe:transition-opacity hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 aria-expanded:bg-surface-hover aria-expanded:text-fg"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-3xs font-semibold leading-none"
        >
          ?
        </span>
        <span className="hidden sm:inline">{label}</span>
        {unread ? (
          <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-brand" />
        ) : null}
      </button>
      <AnchoredPopoverPanel state={popover} className={`text-xs text-fg-secondary text-pretty ${CONFIG_HELP_POPOVER_SHELL}`}>
        <header className="flex shrink-0 items-start justify-between gap-2 border-b border-edge-subtle px-3.5 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-2xs font-medium uppercase leading-none tracking-widest text-brand/80">{label}</p>
            <h3 id={titleId} className="text-sm font-semibold leading-snug text-fg">
              {title}
            </h3>
          </div>
          <button
            type="button"
            aria-label="Close help"
            onClick={close}
            className="-mr-1 -mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-sm text-fg-faint hover:bg-surface-raised hover:text-fg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40"
          >
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto px-3.5 py-3">{children}</div>
      </AnchoredPopoverPanel>
    </span>
  )
}

export interface PageHelpContent {
  title: string
  whatIsIt: string
  useCases?: readonly string[]
  howToUse?: string
}

/** @public The "What it is / When to use it / How to use it" body. */
export function PageHelpSections({ whatIsIt, useCases, howToUse, columns = 1 }: PageHelpContent & { columns?: 1 | 2 }) {
  return (
    <div className={`grid w-full min-w-0 grid-cols-1 gap-2.5 ${columns === 2 ? 'md:grid-cols-2' : ''}`}>
      <HelpSection tone="info" title="What it is" className={columns === 2 ? 'md:col-span-2' : ''}>
        <HelpRichText text={whatIsIt} />
      </HelpSection>
      {useCases && useCases.length > 0 ? (
        <HelpSection tone="tip" title="When to use it">
          <HelpBulletList items={useCases} />
        </HelpSection>
      ) : null}
      {howToUse ? (
        <HelpSection tone="steps" title="How to use it">
          <HelpRichText text={howToUse} />
        </HelpSection>
      ) : null}
    </div>
  )
}

/** A page's registered help, opened from the header. Marks it read on open. */
export function PageHelpPopover({ flowPath, ...content }: PageHelpContent & { flowPath?: string }) {
  const { pathname } = useLocation()
  const routeKey = resolveFlowPath(flowPath ?? pathname)
  const [read, setRead] = useState(() => isPageHelpRead(routeKey))

  useEffect(() => {
    setRead(isPageHelpRead(routeKey))
    const onRead = (e: Event) => {
      if ((e as CustomEvent<string>).detail === routeKey) setRead(true)
    }
    window.addEventListener('mushi:pagehelp-read', onRead)
    return () => window.removeEventListener('mushi:pagehelp-read', onRead)
  }, [routeKey])

  return (
    <HelpPopover
      title={content.title}
      unread={!read}
      onOpenChange={(open) => {
        if (open && !read) markPageHelpRead(routeKey)
      }}
    >
      <PageHelpSections {...content} />
    </HelpPopover>
  )
}
