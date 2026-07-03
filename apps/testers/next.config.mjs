import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root explicitly. Without this, Turbopack's automatic
  // inference can pick a stray lockfile higher up the filesystem (e.g. an
  // unrelated ~/package-lock.json) as the root, which breaks route
  // detection — e.g. `generateStaticParams()` on /apps/[slug] gets
  // misreported as missing during `next build`.
  turbopack: {
    root: path.join(__dirname, '../..'),
  },

  // Served under /mushi-mushi/testers/ in both dev (via Vite proxy) and
  // production (CloudFront routing rule). The path must exactly match the
  // Vite proxy key in apps/admin/vite.config.ts.
  basePath: process.env.MUSHI_BASE_PATH ?? '/mushi-mushi/testers',

  // Trailing slash to align with how CloudFront routes the SPA.
  trailingSlash: true,

  // Remove X-Powered-By header.
  poweredByHeader: false,

  // Static-export so `next build` produces a plain `out/` folder we can sync
  // to S3 the same way apps/docs does (see deploy-testers.yml). The dynamic
  // `/apps/[slug]` route pre-builds known slugs via `generateStaticParams`.
  // Set MUSHI_TESTERS_EXPORT=0 to opt out for a local dynamic-server preview.
  ...(process.env.MUSHI_TESTERS_EXPORT === '0' ? {} : { output: 'export' }),
}

export default nextConfig
