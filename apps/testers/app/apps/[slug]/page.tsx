/**
 * /apps/[slug] — thin server wrapper.
 * generateStaticParams() pre-builds known slugs at `next build`, but the
 * page content is entirely client-fetched via useParams() in
 * AppDetailClient — the pre-rendered slug is just an HTML shell. With
 * `output: export`, an empty params array makes Next.js report the route as
 * missing generateStaticParams() entirely and fail the build, so we always
 * emit the `PLACEHOLDER_SLUG` shell even when zero apps are published yet.
 * The CloudFront router rewrites every /apps/<slug>/ request to this same
 * shell (see cloudfront-mushi-spa-router.js), so real slugs published after
 * this build still resolve correctly at runtime.
 */
import type { Metadata } from 'next'
import AppDetailClient from './AppDetailClient'

// Every /apps/<slug>/ request is served this same shell by the CloudFront
// router, so per-slug metadata can never reach crawlers — keep the shell
// noindex (thin client-fetched content) and let /apps/ carry the SEO weight.
export const metadata: Metadata = {
  title: 'App details',
  description:
    'App detail page on the Mushi Bounties marketplace — bounty points, platforms, and how to start testing.',
  robots: { index: false, follow: true },
}

export const PLACEHOLDER_SLUG = '_shell'

export async function generateStaticParams() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
  if (!apiUrl) return [{ slug: PLACEHOLDER_SLUG }]
  try {
    const res = await fetch(`${apiUrl}/v1/public/marketplace/apps`, { cache: 'no-store' })
    if (!res.ok) return [{ slug: PLACEHOLDER_SLUG }]
    const data = await res.json() as Array<{ slug: string }>
    if (data.length === 0) return [{ slug: PLACEHOLDER_SLUG }]
    return data.map(a => ({ slug: a.slug }))
  } catch {
    return [{ slug: PLACEHOLDER_SLUG }]
  }
}

export default function AppDetailPage() {
  return <AppDetailClient />
}
