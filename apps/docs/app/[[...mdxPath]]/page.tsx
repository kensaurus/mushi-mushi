/** Nextra v4 catch-all gateway for the `content/` directory. */

import { generateStaticParamsFor, importPage } from 'nextra/pages'
import { useMDXComponents as getMDXComponents } from '../../mdx-components'

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
      title: 'Mushi Mushi — know why your AI-built app broke, with the fix ready',
      description:
        'Your AI shipped it. Mushi tells you why it broke — a plain-English diagnosis and a ready-to-apply fix, right in your editor. Standalone, open source, Sentry optional.',
      openGraph: {
        title: 'Mushi Mushi — know why your AI-built app broke, with the fix ready',
        description:
          'Your AI shipped it. Mushi tells you why it broke — a plain-English diagnosis and a ready-to-apply fix, right in your editor. Standalone, open source, Sentry optional.',
        url: 'https://kensaur.us/mushi-mushi/',
        siteName: 'Mushi Mushi',
        type: 'website',
        images: [
          {
            url: 'https://kensaur.us/mushi-mushi/docs/social-preview/og-card.png',
            width: 1200,
            height: 630,
          },
        ],
      },
      twitter: {
        card: 'summary_large_image',
        title: 'Mushi Mushi — know why your AI-built app broke, with the fix ready',
        description:
          'Plain-English diagnosis + a ready-to-apply fix, right in Cursor. Standalone, open source, Sentry optional.',
      },
      robots: { index: true, follow: true },
      alternates: {
        ...(metadata as { alternates?: Record<string, unknown> })?.alternates,
        canonical: 'https://kensaur.us/mushi-mushi/',
      },
    }
  }
  return metadata
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
