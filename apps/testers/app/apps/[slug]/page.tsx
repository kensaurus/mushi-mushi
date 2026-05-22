/**
 * /apps/[slug] — thin server wrapper.
 * generateStaticParams() pre-builds known slugs at `next build`.
 * In dev mode Next.js renders dynamically for unknown slugs.
 * All display/fetch logic lives in AppDetailClient (client component).
 */
import AppDetailClient from './AppDetailClient'

export async function generateStaticParams() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
  if (!apiUrl) return []
  try {
    const res = await fetch(`${apiUrl}/v1/public/marketplace/apps`, { cache: 'no-store' })
    if (!res.ok) return []
    const data = await res.json() as Array<{ slug: string }>
    return data.map(a => ({ slug: a.slug }))
  } catch {
    return []
  }
}

export default function AppDetailPage() {
  return <AppDetailClient />
}
