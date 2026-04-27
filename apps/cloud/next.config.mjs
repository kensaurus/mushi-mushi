// =============================================================================
// next.config.mjs — apps/cloud
//
// The same build runs in three places:
//   1. local dev          (basePath=/)
//   2. Vercel preview      (basePath=/, deploys per-PR)
//   3. kensaur.us/mushi-mushi   (basePath=/mushi-mushi, served via CloudFront → Vercel)
//
// `MUSHI_BASE_PATH` flips the prefix at build time. Vercel injects it via
// project env vars; the deploy-cloud workflow injects it for the production
// build. Leaving it unset (local dev, plain `pnpm dev`) keeps URLs at /.
// =============================================================================

const rawBase = process.env.MUSHI_BASE_PATH ?? ''
const basePath = rawBase.replace(/\/+$/, '') // strip trailing slash; Next requires no trailing slash

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  experimental: {
    optimizePackageImports: ['@supabase/ssr', '@supabase/supabase-js'],
  },
}

export default nextConfig
