/** Nextra v4 catch-all gateway for the `content/` directory. */

import { generateStaticParamsFor, importPage } from 'nextra/pages'
import { useMDXComponents as getMDXComponents } from '../../mdx-components'
import { DOCS_SITE, LANDING_META, OG_CARD_IMAGE, PRODUCT_ROOT } from '../../lib/structured-data'

export const generateStaticParams = generateStaticParamsFor('mdxPath')

export async function generateMetadata(props: { params: Promise<{ mdxPath?: string[] }> }) {
  const params = await props.params
  const { metadata } = await importPage(params.mdxPath)
  // The home page (empty mdxPath) is also served in place at the bare product
  // root kensaur.us/mushi-mushi/ via the CloudFront internal rewrite in
  // scripts/cloudfront-mushi-spa-router.js. Pin its canonical to that product
  // root so the product root and /mushi-mushi/docs/ consolidate to one indexable URL.
  if (!params.mdxPath || params.mdxPath.length === 0) {
    return {
      ...metadata,
      // `absolute` skips the root layout's '%s · Mushi Mushi' template, which
      // pushed the landing title past 80 characters.
      title: { absolute: LANDING_META.title },
      description: LANDING_META.description,
      openGraph: {
        title: LANDING_META.title,
        description: LANDING_META.description,
        url: PRODUCT_ROOT,
        siteName: 'Mushi Mushi',
        type: 'website',
        images: [OG_CARD_IMAGE],
      },
      twitter: {
        card: 'summary_large_image',
        title: LANDING_META.title,
        description: LANDING_META.description,
        images: [OG_CARD_IMAGE.url],
      },
      robots: { index: true, follow: true },
      alternates: {
        ...(metadata as { alternates?: Record<string, unknown> })?.alternates,
        canonical: PRODUCT_ROOT,
      },
    }
  }
  // Every other docs page canonicalises to its own /docs URL. Frontmatter may
  // override by shipping its own `alternates.canonical` (spread wins below).
  const existingAlternates = (metadata as { alternates?: Record<string, unknown> })?.alternates
  return {
    ...metadata,
    alternates: {
      canonical: `${DOCS_SITE}/${params.mdxPath.join('/')}`,
      ...existingAlternates,
    },
  }
}

const Wrapper = getMDXComponents().wrapper

export default async function Page(props: { params: Promise<{ mdxPath?: string[] }> }) {
  const params = await props.params
  const result = await importPage(params.mdxPath)
  // Nextra exposes default + toc + metadata + sourceCode but doesn't
  // ship richer types here; mirror the reference shape one-for-one.
  const MDXContent = result.default as (innerProps: {
    params: { mdxPath?: string[] }
  }) => React.ReactNode
  return (
    <Wrapper
      toc={(result as { toc: unknown }).toc as never}
      metadata={(result as { metadata: unknown }).metadata as never}
      sourceCode={(result as { sourceCode: string }).sourceCode}
    >
      <MDXContent params={params} />
    </Wrapper>
  )
}
