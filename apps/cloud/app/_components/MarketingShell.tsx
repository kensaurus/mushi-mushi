'use client'

import NextLink from 'next/link'
import { useMemo, type ReactNode } from 'react'
import {
  MarketingProvider,
  type MarketingLink,
  type MarketingTheme,
} from '@mushi-mushi/marketing-ui'
import { contactMailto, docsUrl, repoUrl } from '@/lib/links'

/**
 * FILE: MarketingShell.tsx
 *
 * Wraps the marketing surface in <MarketingProvider> with the Next.js-flavoured
 * Link adapter and the existing URL helpers from lib/links.ts. Every page that
 * renders <Hero />, <MushiCanvas />, <ClosingCta />, or <MarketingFooter />
 * must be a child of this shell.
 *
 * Why is this a client component?
 *   - It uses next/link (which itself is a client island for prefetch).
 *   - useMemo needs a render context.
 *   - Any descendant that calls useMarketing() needs Context to be available
 *     in the same render tree, which means a client boundary.
 */

const NextLinkAdapter: MarketingLink = ({ href, children, ...rest }) => {
  // Anchor links (#loop, #pricing) and mailto:/external URLs use a plain <a>
  // because next/link only handles internal navigations and would warn on the
  // others. Internal paths (/signup, /login) get the prefetched next/link.
  const isInternal = href.startsWith('/') && !href.startsWith('//')
  if (!isInternal) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  }
  return (
    <NextLink href={href} {...rest}>
      {children}
    </NextLink>
  )
}

export function MarketingShell({ children }: { children: ReactNode }) {
  const theme = useMemo<MarketingTheme>(
    () => ({
      Link: NextLinkAdapter,
      urls: {
        signup: '/signup',
        login: '/login',
        loopAnchor: '#loop',
        pricingAnchor: '#pricing',
        docs: docsUrl,
        repo: repoUrl,
        contact: contactMailto,
      },
    }),
    [],
  )
  return <MarketingProvider value={theme}>{children}</MarketingProvider>
}
