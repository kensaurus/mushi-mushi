/**
 * FILE: apps/admin/src/components/RoutePageHelp.tsx
 * PURPOSE: Renders the registered "About this page" banner under the page.
 *          On /checks only, a top margin separates that banner from the
 *          check grid. Other routes keep the shared gap.
 */

import { useLocation } from 'react-router-dom'
import { PageHelpBanner, type PageHelpBannerProps } from './ui'
import { usePageHelpRegistration } from '../lib/pageHelpContext'

/** Space between the check grid and About Checks. Other pages keep the shared gap. */
export function routeHelpClass(pathname: string): string {
  return pathname === '/checks' ? 'mt-4' : ''
}

export function RoutePageHelp() {
  const { pathname } = useLocation()
  const registration = usePageHelpRegistration()

  if (!registration) return null

  const props: PageHelpBannerProps = registration
  const gap = routeHelpClass(pathname)
  const banner = <PageHelpBanner key={`${pathname}:${props.title}`} {...props} />
  if (!gap) return banner
  return <div className={gap}>{banner}</div>
}
