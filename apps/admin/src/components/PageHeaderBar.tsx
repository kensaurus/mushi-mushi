/**
 * FILE: apps/admin/src/components/PageHeaderBar.tsx
 * PURPOSE: Compact, Supabase/AWS-grade page header that merges the old
 *          PageHeader + PageHelp combo into a single component.
 *
 * DESIGN:
 *   A single-line strip:
 *     PDCA chip · title [· project scope] · [right children] · copy-link
 *
 *   The optional description renders in a smaller line below.
 *   On a page hub, the view switcher (Today, Overview, …) renders under
 *   this header — the first header on the page claims it.
 *
 *   When helpTitle/helpWhatIsIt are supplied, a "How this page works" button
 *   at the header's right edge opens them as a popover. They are also
 *   registered with Layout's `<RoutePageHelp />`, which shows them expanded
 *   under the content only while the page is empty (a PageFirstStep card is
 *   on screen) or the user keeps tips open.
 *
 * MIGRATION from PageHeader + PageHelp:
 *   Before:
 *     <PageHeader title="X" projectScope={name}><FreshnessPill/></PageHeader>
 *     <PageHelp title="About X" whatIsIt="..." useCases={[...]} />
 *
 *   After:
 *     <PageHeaderBar
 *       title="X"
 *       projectScope={name}
 *       helpTitle="About X"
 *       helpWhatIsIt="..."
 *       helpUseCases={[...]}
 *     >
 *       <FreshnessPill />
 *     </PageHeaderBar>
 *
 *   Remove the <PageHelp> call once migrated.
 */

import { useLayoutEffect, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { CopyViewLinkButton } from './CopyViewLinkButton'
import { isDevFacingHint } from '../lib/devHintCopy'
import { useLocationChrome } from '../lib/locationChrome'
import { usePageHelpRegister } from '../lib/pageHelpContext'
import { Tooltip } from './ui'
import { PDCA_STAGES, PDCA_OVERVIEW_CHIP, chipForPath, type PdcaStageId } from '../lib/pdca'
import { stageChipCopy } from '../lib/navRegistry'
import { PageHelpPopover } from './ui/help-popover'
import { useHubViewTabs } from './hubViewSlot'

/* ── Inline PDCA chip ─────────────────────────────────────────────────── */

function HeaderPdcaChip({ chip }: { chip: string }) {
  const meta = chip === 'overview' ? PDCA_OVERVIEW_CHIP : PDCA_STAGES[chip as keyof typeof PDCA_STAGES]
  if (!meta) return null
  // Colours from the stage; words from the cycle step the sidebar shows (ADR 0027).
  const copy = stageChipCopy(chip as 'overview' | PdcaStageId)
  return (
    // The chip must be able to shrink: a long label is wider than the header
    // column at 390px, and a non-shrinking chip overflowed its row and sat
    // on top of the freshness pill. The tooltip and aria-label keep the
    // full wording.
    <Tooltip content={copy.hint} className="min-w-0 max-w-full">
      <span
        className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-3xs uppercase tracking-wider cursor-help ${meta.tintBg} ${meta.tintBorder} ${meta.text}`}
        aria-label={copy.ariaLabel}
      >
        <span
          className={`inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-sm font-bold text-3xs ${meta.badgeBg} ${meta.badgeFg}`}
          aria-hidden="true"
        >
          {copy.glyph}
        </span>
        <span className="truncate">{copy.label}</span>
      </span>
    </Tooltip>
  )
}

/* ── Props ────────────────────────────────────────────────────────────── */

export interface PageHeaderBarProps {
  title: string
  /** Leading glyph before the title — pass the page's nav icon for scan consistency. */
  icon?: ReactNode
  /** Secondary descriptor shown mid-title (e.g. project name). */
  projectScope?: string | null
  /** Override the URL-derived PDCA chip. Pass null to suppress entirely. */
  contextChip?: ReactNode | null
  /** Force-hide PDCA chip even on mobile (e.g. detail pages). */
  suppressContextChip?: boolean
  /** Short subtitle line below the title row. Keep under 120 chars. */
  description?: string
  /** Whether to show the copy-current-URL button. Default true. */
  showCopyLink?: boolean
  /** Right-side slot: freshness pills, count chips, toggle buttons. */
  children?: ReactNode

  /* ── Inline help panel (optional) ── */
  /** Title for the page guide — required to show the guide at all. */
  helpTitle?: string
  /** What this page is / does. Required if helpTitle is set. */
  helpWhatIsIt?: string
  helpUseCases?: string[]
  helpHowToUse?: string
  helpFlowPath?: string
  /** Force-override help panel open state. Leave undefined for collapsed by default. */
  helpDefaultOpen?: boolean
  /** When true, suppresses the subtitle line — use when the page renders its
   *  own PageHero DAV strip below to avoid double-chrome stacking. */
  withPageHero?: boolean
}

/**
 * Compact page header for all admin data pages. Replaces the PageHeader +
 * PageHelp combo with a single focused component.
 */
export function PageHeaderBar({
  title,
  icon,
  projectScope,
  contextChip,
  suppressContextChip: suppressContextChipProp,
  description,
  showCopyLink = true,
  children,
  helpTitle,
  helpWhatIsIt,
  helpUseCases,
  helpHowToUse,
  helpFlowPath,
  helpDefaultOpen,
  withPageHero = false,
}: PageHeaderBarProps) {
  const { pathname } = useLocation()
  const registerPageHelp = usePageHelpRegister()
  const locationChrome = useLocationChrome()
  const hubTabs = useHubViewTabs()

  const chipKey =
    contextChip === undefined && !suppressContextChipProp && !locationChrome.suppressContextChip
      ? chipForPath(pathname)
      : null
  const hasHelp = Boolean(helpTitle && helpWhatIsIt)
  const showProjectScope = projectScope && !locationChrome.suppressProjectScope

  useLayoutEffect(() => {
    if (!hasHelp || !helpTitle || !helpWhatIsIt) {
      registerPageHelp(null)
      return
    }
    registerPageHelp({
      title: helpTitle,
      whatIsIt: helpWhatIsIt,
      useCases: helpUseCases,
      howToUse: helpHowToUse,
      flowPath: helpFlowPath,
      defaultOpen: helpDefaultOpen,
    })
    return () => registerPageHelp(null)
  }, [
    hasHelp,
    helpTitle,
    helpWhatIsIt,
    helpUseCases,
    helpHowToUse,
    helpFlowPath,
    helpDefaultOpen,
    registerPageHelp,
  ])

  return (
    <div className="mb-4 w-full min-w-0">
      {/* ── Primary row ──────────────────────────────────────────────── */}
      {/* flex-wrap: on a phone the actions drop under the title instead of
          pushing past the column edge (they used to scroll <main> sideways
          on /explore and /mcp at 390px and squeeze the title to one word
          per line). */}
      <div className="flex min-w-0 flex-wrap items-start gap-2">
        <div className="flex min-w-0 flex-1 basis-48 flex-wrap items-center gap-x-2 gap-y-1">
          {/* PDCA chip */}
          {contextChip === undefined && chipKey ? (
            <HeaderPdcaChip chip={chipKey} />
          ) : contextChip ? (
            <span className="shrink-0">{contextChip}</span>
          ) : null}

          {icon && (
            <span
              className="shrink-0 text-fg-muted [&>svg]:h-4 [&>svg]:w-4"
              aria-hidden="true"
            >
              {icon}
            </span>
          )}

          {/* Title — aria-label includes the middot scope when present (dot is aria-hidden visually). */}
          <h2
            className="min-w-0 text-sm font-semibold leading-snug text-fg text-balance"
            {...(showProjectScope ? { 'aria-label': `${title} · ${projectScope}` } : {})}
          >
            {title}
            {showProjectScope && (
              <>
                <span className="mx-1.5 text-fg-faint" aria-hidden="true">·</span>
                <span className="font-mono text-xs text-fg-secondary">{projectScope}</span>
              </>
            )}
          </h2>
        </div>

        {/* Right-side slot. "How this page works" sits at the edge (P2,
            console journeys 2026-10-27): the explainer no longer takes a row
            of the page. */}
        {(children || showCopyLink || hasHelp) && (
          <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1.5">
            {children}
            {hasHelp && helpTitle && helpWhatIsIt ? (
              <PageHelpPopover
                title={helpTitle}
                whatIsIt={helpWhatIsIt}
                useCases={helpUseCases}
                howToUse={helpHowToUse}
                flowPath={helpFlowPath}
              />
            ) : null}
            {showCopyLink && <CopyViewLinkButton />}
          </div>
        )}
      </div>

      {description && !withPageHero && !hasHelp && !isDevFacingHint(description) && (
        <p className="mt-0.5 max-w-none text-xs leading-relaxed text-fg-muted text-pretty">
          {description}
        </p>
      )}
      {hubTabs ? <div className="mt-2">{hubTabs}</div> : null}
    </div>
  )
}
