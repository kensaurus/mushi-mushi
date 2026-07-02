import { useState, useEffect } from 'react';
import type { ReactNode, ReactEventHandler } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PDCA_STAGES, PDCA_OVERVIEW_CHIP, chipForPath } from '../../lib/pdca';
import { PAGE_FLOW_LINKS, flowLinkBlurb, resolveFlowPath, type PageFlowLink } from '../../lib/pageLinks';
import { navIconForPath } from '../../lib/pageNavIcons';
import { HelpBulletList, HelpRichText } from '../HelpRichText';
import { HelpSection } from '../HelpSection';
import { CopyViewLinkButton } from '../CopyViewLinkButton';
import { usePageHelpRegister } from '../../lib/pageHelpContext';
import { isPageHelpRead, markPageHelpRead, PAGEHELP_READ_EVENT } from '../../lib/pageHelpRead';
import { isDevFacingHint } from '../../lib/devHintCopy';
import {
  PAGE_HELP_BANNER_INNER_BORDER,
  PAGE_HELP_BANNER_SHELL,
  PAGE_HELP_BANNER_SUMMARY_HOVER,
} from '../../lib/pageHelpSurfaces';
import { Tooltip } from './misc';
import { CHIP_TONE } from '../../lib/chipTone'


/* ── PageHeader ─────────────────────────────────────────────────────────── */

interface PageHeaderProps {
  title: string
  description?: string
  children?: ReactNode
  /** Override the leading chip slot. Pass an explicit chip (e.g. a custom
   *  <PdcaContextHint stage="…" />) to override the URL-derived default, or
   *  pass `null` to suppress the chip entirely on pages that aren't part of
   *  the PDCA loop (login, settings, etc.). Leave undefined to inherit the
   *  default URL-driven chip — that's the path almost every page should take. */
  contextChip?: ReactNode | null
  /** Project name to anchor the page in the user's reality
   *  (e.g. `Reports · glot-it`). Pass `null` or omit to keep the bare title.
   * every PDCA page surfaces the active project so the user
   *  can tell which app a bug came from without scanning the switcher. */
  projectScope?: string | null
  showCopyLink?: boolean
}

export function PageHeader({ title, description, children, contextChip, projectScope, showCopyLink = true }: PageHeaderProps) {
  // `undefined` = render the auto URL-derived stage chip; `null` = explicitly
  // suppressed; anything else = caller-provided chip. This keeps the audit
  // invariant ("every PDCA page shows its stage above the title") without
  // forcing every page to import PdcaContextHint manually.
  const chip = contextChip === undefined ? <AutoPdcaChip /> : contextChip
  return (
    <div className="mb-5 w-full min-w-0 space-y-1.5">
      {chip && <div>{chip}</div>}
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 flex-1 text-base font-semibold text-fg leading-snug">
          {title}
          {projectScope && (
            <>
              <span className="mx-1.5 text-fg-faint" aria-hidden="true">·</span>
              <span className="font-mono text-fg-secondary">{projectScope}</span>
            </>
          )}
        </h2>
        {(children || showCopyLink) && (
          <div className="flex items-center gap-2 shrink-0">
            {showCopyLink && <CopyViewLinkButton />}
            {children}
          </div>
        )}
      </div>
      {description && !isDevFacingHint(description) && (
        <p className="w-full max-w-none text-xs text-fg-muted leading-relaxed text-pretty text-balance">
          {description}
        </p>
      )}
    </div>
  )
}

/**
 * URL-derived PDCA stage chip rendered inline (rather than re-using
 * `<PdcaContextHint />`) to sidestep the circular import that would arise if
 * ui.tsx imported a component which itself imports Tooltip from ui.tsx. The
 * styling stays in lock-step with `PdcaContextHint` because both surfaces
 * read from the shared `PDCA_STAGES` map.
 */
function AutoPdcaChip() {
  const { pathname } = useLocation()
  const chip = chipForPath(pathname)
  if (!chip) return null
  const meta = chip === 'overview' ? PDCA_OVERVIEW_CHIP : PDCA_STAGES[chip]
  const ariaLabel = chip === 'overview'
    ? `Overview: ${meta.hint}`
    : `PDCA stage: ${meta.label}. ${meta.hint}`
  return (
    <Tooltip content={meta.hint}>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs uppercase tracking-wider cursor-help ${meta.tintBg} ${meta.tintBorder} ${meta.text}`}
        aria-label={ariaLabel}
      >
        <span
          className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm font-semibold text-3xs ${meta.badgeBg} ${meta.badgeFg}`}
          aria-hidden="true"
        >
          {meta.letter}
        </span>
        {meta.label}
      </span>
    </Tooltip>
  )
}

/* ── PageHelp (collapsible "About this page") ──────────────────────────── */

export interface PageHelpBannerProps {
  title: string
  whatIsIt: string
  useCases?: string[]
  howToUse?: string
  /** Force-override the default-open behaviour. Leave unset for the
   *  default "open until the user dismisses it once" UX. */
  defaultOpen?: boolean
  /** Cross-page navigation chips (plain-language). */
  relatedLinks?: PageFlowLink[]
  /** When set, loads defaults from `PAGE_FLOW_LINKS` unless `relatedLinks` is provided. */
  flowPath?: string
}

/** @deprecated Use PageHelpBannerProps — kept for call-site ergonomics. */
type PageHelpProps = PageHelpBannerProps

/* ── PageRelatedLinks — "where to go next" chips ───────────────────────── */

export function PageRelatedLinks({ links, className = '' }: { links: PageFlowLink[]; className?: string }) {
  if (links.length === 0) return null
  return (
    <nav
      aria-label="Related pages"
      className={`grid w-full grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3 ${className}`}
    >
      {links.map((link) => {
        const NavIcon = navIconForPath(link.to)
        const blurb = flowLinkBlurb(link)
        return (
          <Link
            key={link.to + link.label}
            to={link.to}
            title={blurb ? `${link.label} — ${blurb}` : link.label}
            className="group/link flex min-w-0 w-full items-start gap-2.5 rounded-md border border-chrome-border bg-chrome px-3 py-2 motion-safe:transition-[background-color,border-color,color,box-shadow,transform,opacity] motion-safe:duration-150 hover:border-brand/35 hover:bg-surface-overlay hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 motion-safe:active:translate-y-0 motion-safe:active:scale-[0.99]"
          >
            {NavIcon ? (
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-surface-overlay text-fg-muted motion-safe:transition-colors group-hover/link:text-brand" aria-hidden="true">
                <NavIcon size={14} />
              </span>
            ) : (
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-surface-overlay text-fg-muted" aria-hidden="true">→</span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium text-fg-secondary motion-safe:transition-colors group-hover/link:text-fg">
                {link.label}
              </span>
              {blurb ? (
                <span className="mt-0.5 block text-3xs leading-snug text-fg-muted text-pretty line-clamp-3 group-hover/link:text-fg-secondary">
                  {blurb}
                </span>
              ) : null}
            </span>
          </Link>
        )
      })}
    </nav>
  )
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
    // localStorage is best-effort; private-mode browsers throw on write.
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

/** Top-of-page "About this page" banner — green guide surface; collapsed by default. */
export function PageHelpBanner({
  title,
  whatIsIt,
  useCases,
  howToUse,
  defaultOpen,
  relatedLinks,
  flowPath,
}: PageHelpBannerProps) {
  const { pathname } = useLocation()
  const routeKey = resolveFlowPath(flowPath ?? pathname)
  const resolvedLinks = relatedLinks ?? PAGE_FLOW_LINKS[routeKey] ?? []
  const [isRead, setIsRead] = useState(() => isPageHelpRead(routeKey))

  useEffect(() => {
    setIsRead(isPageHelpRead(routeKey))
    const onRead = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail
      if (detail === routeKey) setIsRead(true)
    }
    window.addEventListener(PAGEHELP_READ_EVENT, onRead)
    return () => window.removeEventListener(PAGEHELP_READ_EVENT, onRead)
  }, [routeKey])

  const [open, setOpen] = useState<boolean>(() => {
    if (defaultOpen !== undefined) return defaultOpen
    if (readPageHelpDismissed(title)) return false
    return false
  })

  useEffect(() => {
    markVisited()
  }, [])

  const handleToggle: ReactEventHandler<HTMLDetailsElement> = (e) => {
    const next = e.currentTarget.open
    setOpen(next)
    writePageHelpDismissed(title, !next)
    if (!next && !isPageHelpRead(routeKey)) {
      markPageHelpRead(routeKey)
      setIsRead(true)
    }
  }

  // Moss-green guide surface — calm, readable, distinct from warn/danger chrome.
  const surfaceClass = PAGE_HELP_BANNER_SHELL
  const iconClass = CHIP_TONE.okSubtle
  const statusLabel = isRead ? 'Read' : 'New'
  const statusBadgeClass = isRead
    ? CHIP_TONE.ok
    : CHIP_TONE.okSubtle + ' border border-ok/35'

  return (
    <details
      open={open}
      onToggle={handleToggle}
      className={`group mb-3 w-full min-w-0 rounded-md border motion-safe:transition-colors motion-safe:duration-150 ${surfaceClass}`}
    >
      <summary className={`flex w-full cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-xs text-fg-muted motion-safe:transition-[background-color,border-color,color,box-shadow,transform,opacity] motion-safe:duration-150 motion-safe:active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ok/40 ${PAGE_HELP_BANNER_SUMMARY_HOVER}`}>
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
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-sm ${iconClass}`}
          aria-hidden="true"
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 2.5h7l3 3v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" />
            <path d="M10 2.5V5.5h3" />
            <path d="M5 8h6M5 10.5h4" strokeLinecap="round" />
          </svg>
        </span>
        <span className="font-medium text-fg-secondary group-open:text-fg">{title}</span>
        <span
          className={`rounded-full border px-1.5 py-0.5 text-3xs font-semibold ${statusBadgeClass}`}
        >
          {statusLabel}
        </span>
        <span className="ml-auto hidden text-3xs text-fg-faint sm:inline">{open ? 'Click to collapse' : 'Click to expand'}</span>
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
      </div>
    </details>
  )
}

/** Registers page help with Layout; banner renders at the top via `<RoutePageHelp />`. */
export function PageHelp(props: PageHelpProps) {
  const register = usePageHelpRegister()
  const { title, whatIsIt, useCases, howToUse, defaultOpen, relatedLinks, flowPath } = props

  useEffect(() => {
    register({ title, whatIsIt, useCases, howToUse, defaultOpen, relatedLinks, flowPath })
    return () => register(null)
  }, [register, title, whatIsIt, useCases, howToUse, defaultOpen, relatedLinks, flowPath])

  return null
}
