/**
 * The page's registered help, under the content (Layout).
 *
 * Pattern P2 (console journeys 2026-10-27): the "What it is / When to use it
 * / How to use it" body opens from "How this page works" in the page header
 * (PageHeaderBar → PageHelpPopover). Here it shows expanded only:
 *   - while the page is empty (a PageFirstStep card is mounted),
 *   - on the first visit to a page whose help was never read (it is marked
 *     read then, so the next visit keeps it in the header), or
 *   - when the user chose "Keep tips open on every page".
 * Otherwise only the "Related:" links stay.
 */

import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { PageHelpBanner, PageRelatedRow, type PageHelpBannerProps } from './ui'
import { usePageHelpRegistration, usePageIsEmpty } from '../lib/pageHelpContext'
import { PAGEHELP_PREFS_EVENT, readPageHelpAlwaysOpen } from '../lib/pageHelpPrefs'
import { isPageHelpRead, markPageHelpRead } from '../lib/pageHelpRead'
import { resolveFlowPath } from '../lib/pageLinks'

function useKeepTipsOpen(): boolean {
  const [on, setOn] = useState(() => readPageHelpAlwaysOpen())
  useEffect(() => {
    const sync = () => setOn(readPageHelpAlwaysOpen())
    window.addEventListener(PAGEHELP_PREFS_EVENT, sync)
    return () => window.removeEventListener(PAGEHELP_PREFS_EVENT, sync)
  }, [])
  return on
}

export function RoutePageHelp() {
  const { pathname } = useLocation()
  const registration = usePageHelpRegistration()
  const empty = usePageIsEmpty()
  const keepOpen = useKeepTipsOpen()
  const routeKey = resolveFlowPath(registration?.flowPath ?? pathname)
  // Read once per page visit: marking it read below must not collapse the
  // help the user is looking at.
  const firstUse = useMemo(() => !isPageHelpRead(routeKey), [routeKey])

  useEffect(() => {
    if (registration && firstUse) markPageHelpRead(routeKey)
  }, [registration, firstUse, routeKey])

  if (!registration) return null

  if (empty || keepOpen || firstUse) {
    const props: PageHelpBannerProps = { ...registration, defaultOpen: true }
    return <PageHelpBanner key={`${pathname}:${props.title}:open`} {...props} />
  }
  return <PageRelatedRow relatedLinks={registration.relatedLinks} flowPath={registration.flowPath} />
}
