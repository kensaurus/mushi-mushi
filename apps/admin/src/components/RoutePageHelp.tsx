/**
 * Top-of-page PageHelp banner — copy registry fallback when a page omits inline PageHelp.
 */

import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { PageHelpBanner, type PageHelpBannerProps } from './ui'
import { buildPageHelpProps, usePageCopy } from '../lib/copy'
import { resolveFlowPath } from '../lib/pageLinks'
import { usePageHelpRegistration } from '../lib/pageHelpContext'

export function RoutePageHelp() {
  const { pathname } = useLocation()
  const routeKey = resolveFlowPath(pathname)
  const copy = usePageCopy(routeKey)
  const registration = usePageHelpRegistration()

  const fromCopy = useMemo((): PageHelpBannerProps | null => {
    if (!copy?.help) return null
    return buildPageHelpProps(routeKey, copy, {
      title: copy.help.title,
      whatIsIt: copy.help.whatIsIt,
      useCases: copy.help.useCases,
      howToUse: copy.help.howToUse,
    })
  }, [copy, routeKey])

  const props = registration ?? fromCopy
  if (!props) return null

  return <PageHelpBanner {...props} />
}
