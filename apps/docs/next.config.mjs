// =============================================================================
// next.config.mjs — Nextra 4 + Next.js App Router config for docs.mushimushi.dev
// =============================================================================

import nextra from 'nextra'

const withNextra = nextra({
  defaultShowCopyCode: true,
  search: {
    codeblocks: false,
  },
  contentDirBasePath: '/',
})

export default withNextra({
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  trailingSlash: false,
  images: {
    unoptimized: true,
  },
  experimental: {
    optimizePackageImports: ['nextra-theme-docs'],
  },
})
