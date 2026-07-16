/**
 * Shared SEO constants + schema.org JSON-LD graphs for the docs/landing app.
 *
 * URL SSOT: `MUSHI_CANONICAL_URLS` from @mushi-mushi/brand. The product root
 * (`https://kensaur.us/mushi-mushi/`, trailing slash) is the canonical URL for
 * the landing page — CloudFront internally rewrites it to this app's exported
 * index.html (scripts/cloudfront-mushi-spa-router.js). Every other docs page
 * canonicalises under `${DOCS_SITE}<route>`.
 */
import { MUSHI_CANONICAL_URLS, MUSHI_TAGLINE_V2 } from '@mushi-mushi/brand'

/** Canonical landing URL — product root, trailing slash (matches the CloudFront rewrite). */
export const PRODUCT_ROOT = `${MUSHI_CANONICAL_URLS.home}/`

/** Canonical docs origin — no trailing slash (next.config.mjs `trailingSlash: false`). */
export const DOCS_SITE = MUSHI_CANONICAL_URLS.docs

/** Social preview card shipped in apps/docs/public/social-preview/. */
export const OG_CARD_URL = `${DOCS_SITE}/social-preview/og-card.png`

const ORGANIZATION_ID = `${PRODUCT_ROOT}#organization`

/** schema.org Organization — rendered site-wide from app/layout.tsx. */
export const ORGANIZATION_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': ORGANIZATION_ID,
  name: 'Mushi Mushi',
  url: PRODUCT_ROOT,
  logo: `${DOCS_SITE}/brand/logo-mark.svg`,
  sameAs: [MUSHI_CANONICAL_URLS.repo, 'https://x.com/mushimushi_dev'],
} as const

/** schema.org WebSite — rendered site-wide from app/layout.tsx. */
export const WEBSITE_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Mushi Mushi',
  url: PRODUCT_ROOT,
  description: MUSHI_TAGLINE_V2.oneLiner,
  publisher: { '@id': ORGANIZATION_ID },
} as const

/** schema.org SoftwareApplication — landing page only (content/index.mdx). */
export const SOFTWARE_APPLICATION_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Mushi Mushi',
  url: PRODUCT_ROOT,
  description: MUSHI_TAGLINE_V2.oneLiner,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Web, iOS, Android',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
    description: '50 diagnoses/month on the free tier — no card required. Self-hosting is free.',
  },
  softwareHelp: { '@type': 'CreativeWork', url: DOCS_SITE },
  license: `${MUSHI_CANONICAL_URLS.repo}/blob/master/LICENSE`,
  author: { '@id': ORGANIZATION_ID },
} as const
