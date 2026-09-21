/** Nextra v4 catch-all gateway for the `content/` directory. */

import { generateStaticParamsFor, importPage } from 'nextra/pages'
import { useMDXComponents as getMDXComponents } from '../../mdx-components'
import { JsonLd } from '../../components/JsonLd'
import { dateFromFrontMatter } from '../../lib/sitemap-dates'
import {
  BLOG_AUTHOR_NAME,
  BLOG_FEED_URL,
  DOCS_SITE,
  LANDING_META,
  OG_CARD_IMAGE,
  PRODUCT_ROOT,
  blogPostingJsonLd,
  type BlogPostMeta,
} from '../../lib/structured-data'

export const generateStaticParams = generateStaticParamsFor('mdxPath')

/** The front-matter fields this file reads from Nextra's page metadata. */
interface PageFrontMatter {
  title?: unknown
  description?: unknown
  date?: unknown
  alternates?: Record<string, unknown>
}

const isBlogPost = (mdxPath: string[] | undefined): boolean => mdxPath?.length === 2 && mdxPath[0] === 'blog'

/** Title, description, URL and publish date of a /blog/<slug> page. */
function blogPostMeta(mdxPath: string[], metadata: PageFrontMatter): BlogPostMeta {
  const url = `${DOCS_SITE}/${mdxPath.join('/')}`
  const datePublished = dateFromFrontMatter(metadata.date)
  return {
    title: typeof metadata.title === 'string' ? metadata.title : mdxPath[1] ?? url,
    ...(typeof metadata.description === 'string' ? { description: metadata.description } : {}),
    url,
    ...(datePublished ? { datePublished } : {}),
  }
}

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
        ...(metadata as PageFrontMatter)?.alternates,
        canonical: PRODUCT_ROOT,
      },
    }
  }
  // Every other docs page canonicalises to its own /docs URL. Frontmatter may
  // override by shipping its own `alternates.canonical` (spread wins below).
  // The blog index and posts also advertise the RSS feed.
  const existingAlternates = (metadata as PageFrontMatter)?.alternates
  const onBlog = params.mdxPath[0] === 'blog'
  const alternates = {
    canonical: `${DOCS_SITE}/${params.mdxPath.join('/')}`,
    ...(onBlog ? { types: { 'application/rss+xml': BLOG_FEED_URL } } : {}),
    ...existingAlternates,
  }
  if (!isBlogPost(params.mdxPath)) return { ...metadata, alternates }

  // A post is an article, not the site's generic `website` card. Declaring
  // openGraph here replaces the root layout's block, so the image and site
  // name are repeated.
  const post = blogPostMeta(params.mdxPath, metadata as PageFrontMatter)
  return {
    ...metadata,
    alternates,
    openGraph: {
      type: 'article',
      title: post.title,
      ...(post.description ? { description: post.description } : {}),
      url: post.url,
      siteName: 'Mushi Mushi',
      images: [OG_CARD_IMAGE],
      authors: [BLOG_AUTHOR_NAME],
      ...(post.datePublished ? { publishedTime: post.datePublished.toISOString() } : {}),
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
  const metadata = (result as { metadata: unknown }).metadata
  return (
    <Wrapper
      toc={(result as { toc: unknown }).toc as never}
      metadata={metadata as never}
      sourceCode={(result as { sourceCode: string }).sourceCode}
    >
      {params.mdxPath && isBlogPost(params.mdxPath) ? (
        <JsonLd data={blogPostingJsonLd(blogPostMeta(params.mdxPath, metadata as PageFrontMatter))} />
      ) : null}
      <MDXContent params={params} />
    </Wrapper>
  )
}
