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
 *
 *   When helpTitle/helpWhatIsIt are supplied, props are registered with
 *   Layout's `<RoutePageHelp />` so the banner renders full-width above the
 *   page hero (same column width). Collapsed by default unless helpDefaultOpen.
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
import { PDCA_STAGES, PDCA_OVERVIEW_CHIP, chipForPath } from '../lib/pdca'

/* ── Inline PDCA chip ─────────────────────────────────────────────────── */

function HeaderPdcaChip({ chip }: { chip: string }) {
  const meta = chip === 'overview' ? PDCA_OVERVIEW_CHIP : PDCA_STAGES[chip as keyof typeof PDCA_STAGES]
  if (!meta) return null
  const ariaLabel = chip === 'overview'
    ? `Overview: ${meta.hint}`
    : `PDCA stage: ${meta.label}. ${meta.hint}`
  return (
    <Tooltip content={meta.hint}>
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-3xs uppercase tracking-wider cursor-help shrink-0 ${meta.tintBg} ${meta.tintBorder} ${meta.text}`}
        aria-label={ariaLabel}
      >
        <span
          className={`inline-flex h-3 w-3 items-center justify-center rounded-sm font-bold text-3xs ${meta.badgeBg} ${meta.badgeFg}`}
          aria-hidden="true"
        >
          {meta.letter}
        </span>
        {meta.label}
      </span>
    </Tooltip>
  )
}

/* ── Props ────────────────────────────────────────────────────────────── */

export interface PageHeaderBarProps {
  title: string
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
      <div className="flex min-w-0 items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          {/* PDCA chip */}
          {contextChip === undefined && chipKey ? (
            <HeaderPdcaChip chip={chipKey} />
          ) : contextChip ? (
            <span className="shrink-0">{contextChip}</span>
          ) : null}

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

        {/* Right-side slot */}
        {(children || showCopyLink) && (
          <div className="flex shrink-0 items-center gap-2">
            {children}
            {showCopyLink && <CopyViewLinkButton />}
          </div>
        )}
      </div>

      {description && !withPageHero && !hasHelp && !isDevFacingHint(description) && (
        <p className="mt-0.5 max-w-none text-xs leading-relaxed text-fg-muted text-pretty">
          {description}
        </p>
      )}
    </div>
  )
}
