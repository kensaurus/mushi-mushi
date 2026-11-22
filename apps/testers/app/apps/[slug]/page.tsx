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
    'App detail page on the Mushi Mushi Bounties marketplace — bounty points, platforms, and how to start testing.',
  robots: { index: false, follow: true },
}

export const PLACEHOLDER_SLUG = '_shell'

// The shell is always emitted. The router rewrites EVERY /apps/<slug>/ to
// `_shell/index.html`, so a build that emitted only the known slugs left the
// rewrite target missing and every app-detail link 404'd.
export async function generateStaticParams() {
  const shell = { slug: PLACEHOLDER_SLUG }
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
  if (!apiUrl) return [shell]
  try {
    const res = await fetch(`${apiUrl}/v1/public/marketplace/apps`, { cache: 'no-store' })
    if (!res.ok) return [shell]
    const data = await res.json() as Array<{ slug: string }>
    const known = data.map(a => ({ slug: a.slug })).filter(p => p.slug !== PLACEHOLDER_SLUG)
    return [shell, ...known]
  } catch {
    return [shell]
  }
}

export default function AppDetailPage() {
  return <AppDetailClient />
}
