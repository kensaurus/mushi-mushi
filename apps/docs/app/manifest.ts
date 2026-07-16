import type { MetadataRoute } from 'next'
import { MUSHI_TAGLINE_V2 } from '@mushi-mushi/brand'

export const dynamic = 'force-static'

// Icon paths carry the /mushi-mushi/docs prefix explicitly (same convention as
// the og-card in app/layout.tsx) so the manifest works when served from the
// static export on CloudFront.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mushi Mushi',
    short_name: 'Mushi',
    description: MUSHI_TAGLINE_V2.oneLiner,
    start_url: '/mushi-mushi/',
    display: 'browser',
    background_color: '#f8f4ed',
    theme_color: '#0e0d0b',
    icons: [
      { src: '/mushi-mushi/docs/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/mushi-mushi/docs/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
