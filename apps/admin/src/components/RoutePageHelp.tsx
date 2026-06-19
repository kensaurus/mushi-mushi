/**
 * Top-of-page PageHelp banner — renders registered help from PageHeaderBar / PageHelp.
 */

import { useLocation } from 'react-router-dom'
import { PageHelpBanner, type PageHelpBannerProps } from './ui'
import { usePageHelpRegistration } from '../lib/pageHelpContext'

export function RoutePageHelp() {
  const { pathname } = useLocation()
  const registration = usePageHelpRegistration()

  if (!registration) return null

  const props: PageHelpBannerProps = registration

  return <PageHelpBanner key={`${pathname}:${props.title}`} {...props} />
}
