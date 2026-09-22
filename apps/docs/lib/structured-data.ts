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
const OG_CARD_URL = `${DOCS_SITE}/social-preview/og-card.png`

/**
 * The card's real pixel size. og:image:width/height must describe the file —
 * docs-meta.test.ts reads the PNG header and fails if the file and these
 * numbers drift apart. scripts/gen-og-card.mjs renders it at 1200×630.
  * @internal Exported for tests only.
  */
export const OG_CARD_WIDTH = 1200
/** @internal Exported for tests only. */
export const OG_CARD_HEIGHT = 630

/**
 * Landing `<title>` and meta description. Search results cut titles near 60
 * characters and descriptions near 155, so both stay inside those limits
 * (docs-meta.test.ts enforces it).
 */
export const LANDING_META = {
  title: 'Mushi Mushi — know why your AI-built app broke',
  description:
    'Your AI shipped it. Mushi tells you why it broke: a plain-English diagnosis and a ready fix in your editor. Open source, Sentry optional.',
} as const

/** One `openGraph.images` / `twitter.images` entry for the card. */
export const OG_CARD_IMAGE = {
  url: OG_CARD_URL,
  width: OG_CARD_WIDTH,
  height: OG_CARD_HEIGHT,
  alt: 'Mushi Mushi — know why your AI-built app broke, with the fix ready',
} as const

const ORGANIZATION_ID = `${PRODUCT_ROOT}#organization`

/**
 * The Bluesky account that actually posts (docs/marketing/STOREFRONTS.md §5).
 * The brand handle `mushimushi.dev` and the X handle `@mushimushi_dev` were
 * never reserved, so neither may appear in `sameAs` — a `sameAs` URL that
 * 404s (or points at a stranger) is worse for entity resolution than none.
 */
const BLUESKY_PROFILE_URL = 'https://bsky.app/profile/kensaurus.bsky.social'

/** schema.org Organization — rendered site-wide from app/layout.tsx. */
export const ORGANIZATION_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': ORGANIZATION_ID,
  name: 'Mushi Mushi',
  url: PRODUCT_ROOT,
  logo: `${DOCS_SITE}/brand/logo-mark.svg`,
  sameAs: [MUSHI_CANONICAL_URLS.repo, BLUESKY_PROFILE_URL],
} as const

/** One visible Q&A pair; the same array feeds the FAQPage JSON-LD so markup and schema cannot drift. */
export interface FaqEntry {
  q: string
  a: string
}

/** schema.org FAQPage from a visible Q&A list (compare pages, how-to pages). Answers stay plain text. */
export function faqPageJsonLd(items: readonly FaqEntry[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }
}

/** schema.org WebSite — rendered site-wide from app/layout.tsx. */
export const WEBSITE_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Mushi Mushi',
  url: PRODUCT_ROOT,
  description: MUSHI_TAGLINE_V2.oneLiner,
  publisher: { '@id': ORGANIZATION_ID },
} as const

/** RSS feed written by scripts/generate-llms-full.mjs into public/blog/feed.xml. */
export const BLOG_FEED_URL = `${DOCS_SITE}/blog/feed.xml`

/** The byline every post carries in its body. */
export const BLOG_AUTHOR_NAME = 'Kenji Sakuramoto'

export interface BlogPostMeta {
  title: string
  description?: string
  url: string
  datePublished?: Date
}

/** schema.org BlogPosting for one post under /blog/<slug>. */
export function blogPostingJsonLd(post: BlogPostMeta): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    ...(post.description ? { description: post.description } : {}),
    url: post.url,
    mainEntityOfPage: post.url,
    image: OG_CARD_URL,
    ...(post.datePublished ? { datePublished: post.datePublished.toISOString() } : {}),
    author: { '@type': 'Person', name: BLOG_AUTHOR_NAME, url: 'https://github.com/kensaurus' },
    publisher: { '@id': ORGANIZATION_ID },
  }
}

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
