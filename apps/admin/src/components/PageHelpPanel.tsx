/**
 * Enhanced PageHelp — full-width, related-page flow links, rich text, prefs.
 */

import { useEffect, useState, type ReactEventHandler } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { HelpBulletList, HelpRichText } from './HelpRichText'
import { HelpSection } from './HelpSection'
import { PAGE_FLOW_LINKS, flowLinkBlurb, resolveFlowPath, type PageFlowLink } from '../lib/pageLinks'
import { PAGEHELP_PREFS_EVENT, readPageHelpAlwaysOpen, writePageHelpAlwaysOpen } from '../lib/pageHelpPrefs'
import { navIconForPath } from '../lib/pageNavIcons'
import { commandPalette } from '../lib/useCommandPalette'
import {
  PAGE_HELP_BANNER_INNER_BORDER,
  PAGE_HELP_BANNER_SHELL,
  PAGE_HELP_BANNER_SUMMARY_HOVER,
} from '../lib/pageHelpSurfaces'

export interface PageHelpProps {
  title: string
  whatIsIt: string
  useCases?: readonly string[]
  howToUse?: string
  defaultOpen?: boolean
  relatedLinks?: PageFlowLink[]
  flowPath?: string
}

const PAGEHELP_DISMISS_PREFIX = 'mushi:pagehelp:dismissed:'
const PAGEHELP_VISITED_FLAG = 'mushi:visited'

function readPageHelpDismissed(title: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(PAGEHELP_DISMISS_PREFIX + title) === '1'
  } catch {
    return false
  }
}

function writePageHelpDismissed(title: string, dismissed: boolean) {
  if (typeof window === 'undefined') return
  try {
    if (dismissed) {
      window.localStorage.setItem(PAGEHELP_DISMISS_PREFIX + title, '1')
    } else {
      window.localStorage.removeItem(PAGEHELP_DISMISS_PREFIX + title)
    }
  } catch {
    /* best effort */
  }
}

function markVisited() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PAGEHELP_VISITED_FLAG, '1')
  } catch {
    /* best effort */
  }
}

function pageHelpSummaryPills(opts: {
  useCases?: readonly string[]
  howToUse?: string
  relatedCount: number
}): string[] {
  const pills: string[] = []
  const tipCount = (opts.useCases?.length ?? 0) + (opts.howToUse ? 1 : 0)
  if (tipCount > 0) pills.push(`${tipCount} tip${tipCount === 1 ? '' : 's'}`)
  if (opts.relatedCount > 0) {
    pills.push(`${opts.relatedCount} related page${opts.relatedCount === 1 ? '' : 's'}`)
  }
  return pills
}

function PageRelatedLinks({ links }: { links: PageFlowLink[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {links.map((link) => {
        const Icon = navIconForPath(link.to) ?? navIconForPath('/dashboard')
        const blurb = flowLinkBlurb(link)
        return (
          <li key={link.to}>
            <Link
              to={link.to}
              className="group/link flex min-w-0 w-full items-start gap-2.5 rounded-md border border-edge-subtle bg-surface-overlay/60 px-3 py-2.5 motion-safe:transition-[background-color,border-color,color,box-shadow,transform,opacity] motion-safe:duration-150 hover:border-brand/45 hover:bg-brand-muted/25 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 motion-safe:active:translate-y-0 motion-safe:active:scale-[0.99]"
            >
              <span
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-muted/25 text-brand motion-safe:transition-colors group-hover/link:bg-brand-muted/40"
                aria-hidden="true"
              >
                {Icon ? <Icon className="h-4 w-4" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-fg-secondary motion-safe:transition-colors group-hover/link:text-fg">
                  {link.label}
                </span>
                {blurb ? (
                  <span className="mt-0.5 block text-2xs leading-snug text-fg-muted">{blurb}</span>
                ) : null}
              </span>
              <svg
                className="mt-1 h-4 w-4 shrink-0 text-fg-faint motion-safe:transition-[background-color,border-color,color,box-shadow,transform,opacity] motion-safe:duration-150 group-hover/link:translate-x-0.5 group-hover/link:text-brand"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

export function PageHelp({
  title,
  whatIsIt,
  useCases,
  howToUse,
  defaultOpen,
  relatedLinks,
  flowPath,
}: PageHelpProps) {
  const { pathname } = useLocation()
  const routeKey = flowPath ?? resolveFlowPath(pathname)
  const resolvedLinks = (relatedLinks ?? PAGE_FLOW_LINKS[routeKey] ?? []).filter(
    (link) => link.to !== pathname,
  )
  const summaryPills = pageHelpSummaryPills({
    useCases,
    howToUse,
    relatedCount: resolvedLinks.length,
  })

  const [alwaysOpen, setAlwaysOpen] = useState(() => readPageHelpAlwaysOpen())

  const [open, setOpen] = useState<boolean>(() => {
    if (defaultOpen !== undefined) return defaultOpen
    if (readPageHelpAlwaysOpen()) return true
    if (readPageHelpDismissed(title)) return false
    return false
  })

  useEffect(() => {
    markVisited()
  }, [])

  useEffect(() => {
    function onPrefs() {
      setAlwaysOpen(readPageHelpAlwaysOpen())
    }
    window.addEventListener(PAGEHELP_PREFS_EVENT, onPrefs)
    return () => window.removeEventListener(PAGEHELP_PREFS_EVENT, onPrefs)
  }, [])

  useEffect(() => {
    if (readPageHelpAlwaysOpen()) {
      setOpen(true)
    }
  }, [pathname, title])

  const handleToggle: ReactEventHandler<HTMLDetailsElement> = (e) => {
    const next = e.currentTarget.open
    setOpen(next)
    if (!next && readPageHelpAlwaysOpen()) {
      writePageHelpAlwaysOpen(false)
      setAlwaysOpen(false)
    }
    writePageHelpDismissed(title, !next)
  }

  const handleAlwaysOpenChange = (checked: boolean) => {
    writePageHelpAlwaysOpen(checked)
    setAlwaysOpen(checked)
    if (checked) {
      setOpen(true)
      writePageHelpDismissed(title, false)
    }
  }

  return (
    <details
      open={open}
      onToggle={handleToggle}
      className={`group mb-4 w-full min-w-0 rounded-lg border motion-safe:transition-colors motion-safe:duration-150 ${PAGE_HELP_BANNER_SHELL}`}
    >
      <summary className={`flex w-full cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2.5 text-xs text-fg-muted motion-safe:transition-[background-color,border-color,color,box-shadow,transform,opacity] motion-safe:duration-150 motion-safe:active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ok/40 ${PAGE_HELP_BANNER_SUMMARY_HOVER} [&::-webkit-details-marker]:hidden`}>
        <svg
          className="h-3 w-3 shrink-0 text-fg-faint motion-safe:transition-transform group-open:rotate-90"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-ok-muted/60 text-ok"
          aria-hidden="true"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 2.5h7l3 3v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" />
            <path d="M10 2.5V5.5h3" />
            <path d="M5 8h6M5 10.5h4" strokeLinecap="round" />
          </svg>
        </span>
        <span className="min-w-0 font-medium text-fg-secondary group-open:text-fg">{title}</span>
        {!open && summaryPills.length > 0 ? (
          <span className="hidden min-w-0 items-center gap-1 sm:flex">
            {summaryPills.map((pill) => (
              <span
                key={pill}
                className="shrink-0 rounded-full border border-edge-subtle/80 bg-surface-overlay/50 px-1.5 py-px text-3xs text-fg-faint"
              >
                {pill}
              </span>
            ))}
          </span>
        ) : null}
        <span className="ml-auto hidden shrink-0 text-3xs text-fg-faint md:inline">
          {open ? 'Click to collapse' : 'Click to expand'}
        </span>
      </summary>
      <div className={`w-full min-w-0 border-t px-3 py-3 sm:px-4 ${PAGE_HELP_BANNER_INNER_BORDER}`}>
        <div className="grid w-full min-w-0 grid-cols-1 gap-2.5 md:grid-cols-2">
          <HelpSection tone="info" title="What it is" className="md:col-span-2">
            <HelpRichText text={whatIsIt} />
          </HelpSection>
          {useCases && useCases.length > 0 && (
            <HelpSection tone="tip" title="When to use it">
              <HelpBulletList items={useCases} />
            </HelpSection>
          )}
          {howToUse && (
            <HelpSection tone="steps" title="How to use it">
              <HelpRichText text={howToUse} />
            </HelpSection>
          )}
          {resolvedLinks.length > 0 && (
            <HelpSection tone="nav" title="Related pages" className="md:col-span-2">
              <PageRelatedLinks links={resolvedLinks} />
            </HelpSection>
          )}
        </div>
        <footer className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-edge-subtle/60 pt-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-2xs text-fg-muted">
            <input
              type="checkbox"
              className="rounded border-edge-subtle text-brand focus:ring-brand/40"
              checked={alwaysOpen}
              onChange={(e) => handleAlwaysOpenChange(e.target.checked)}
            />
            Keep tips open on every page
          </label>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-sm text-3xs font-medium text-brand hover:text-brand-hover motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            onClick={() => commandPalette.open()}
          >
            Jump to any page
            <kbd className="rounded border border-edge-subtle bg-surface-overlay/80 px-1 py-px font-mono text-3xs text-fg-faint">
              ⌘K
            </kbd>
          </button>
        </footer>
      </div>
    </details>
  )
}
