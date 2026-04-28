'use client'

/**
 * FILE: context.tsx
 * PURPOSE: Router-agnostic glue between marketing components and the host app.
 *
 * BACKGROUND: Hero, MushiCanvas, ClosingCta, MarketingFooter all need to render
 * navigation links. apps/cloud (Next.js) wants `next/link`; apps/admin (Vite +
 * react-router) wants `react-router-dom`'s `Link`. Hardcoding either turns the
 * package into a single-app dependency.
 *
 * INSTEAD: every consumer wraps the marketing surface in <MarketingProvider>,
 * passing the framework's `Link` component plus the runtime URL helpers (docs
 * URL, repo URL, contact mailto, signup/login routes). Components read these
 * via `useMarketing()` so they stay pure JSX with no framework imports.
 */

import { createContext, useContext, type ReactNode } from 'react'

export interface MarketingLinkProps {
  href: string
  className?: string
  children?: ReactNode
  'aria-label'?: string
  lang?: string
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void
}

/**
 * Component contract — must render a navigable element. Cloud passes a tiny
 * adapter around `next/link`; admin passes one around `react-router-dom`'s
 * `Link`. Either signature must accept the props above and forward them.
 */
export type MarketingLink = (props: MarketingLinkProps) => ReactNode

export interface MarketingUrls {
  /** Internal route — sign-up form (cloud: /signup; admin: /login?next=...) */
  signup: string
  /** Internal route — sign-in (both apps: /login) */
  login: string
  /** Internal anchor — scrolls to the loop section on the same page */
  loopAnchor: string
  /** Internal anchor — scrolls to pricing on the same page */
  pricingAnchor: string
  /** External docs site, with optional sub-path */
  docs: (path?: string) => string
  /** GitHub repo, with optional sub-path */
  repo: (path?: string) => string
  /** mailto: link with optional subject */
  contact: (subject?: string) => string
}

export interface MarketingTheme {
  Link: MarketingLink
  urls: MarketingUrls
}

const MarketingContext = createContext<MarketingTheme | null>(null)

export function MarketingProvider({
  value,
  children,
}: {
  value: MarketingTheme
  children: ReactNode
}) {
  return <MarketingContext.Provider value={value}>{children}</MarketingContext.Provider>
}

export function useMarketing(): MarketingTheme {
  const ctx = useContext(MarketingContext)
  if (!ctx) {
    throw new Error(
      '[@mushi-mushi/marketing-ui] Components must be wrapped in <MarketingProvider>. ' +
        'See packages/marketing-ui/README.md for setup.',
    )
  }
  return ctx
}
