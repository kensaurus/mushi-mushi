// =============================================================================
// next.config.mjs — Nextra 4 + Next.js App Router config for the docs site
//
// We `output: 'export'` so the build produces a fully static `out/` folder
// the deploy-docs workflow syncs to s3://kensaur.us-mushi-mushi/mushi-mushi/docs/.
// CloudFront then serves it at https://kensaur.us/mushi-mushi/docs/* alongside
// the admin SPA and the cloud Next.js app.
//
// `MUSHI_BASE_PATH` and `MUSHI_ASSET_PREFIX` flip the prefix at build time so
// the same source builds:
//   * local dev               → http://localhost:3001/
//   * docs.mushimushi.dev     → / (subdomain, no prefix)
//   * kensaur.us/mushi-mushi/docs → /mushi-mushi/docs (subpath under unified domain)
// =============================================================================

import nextra from 'nextra'

const rawBase = process.env.MUSHI_BASE_PATH ?? ''
const basePath = rawBase.replace(/\/+$/, '')
const assetPrefix = (process.env.MUSHI_ASSET_PREFIX ?? basePath).replace(/\/+$/, '')

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
  // Static-export so the build is a pure folder of HTML + assets we can sync
  // to S3 with the same long/short cache pattern the admin already uses.
  // Set MUSHI_DOCS_EXPORT=0 to opt out (useful when running `next dev` with
  // server-rendered preview features).
  ...(process.env.MUSHI_DOCS_EXPORT === '0' ? {} : { output: 'export' }),
  ...(basePath ? { basePath } : {}),
  ...(assetPrefix ? { assetPrefix } : {}),
  images: {
    unoptimized: true,
  },
  experimental: {
    optimizePackageImports: ['nextra-theme-docs'],
  },
})
