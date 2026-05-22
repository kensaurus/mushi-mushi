// ============================================================
// next.config.mjs — Mushi Bounties public marketplace
//
// Deployed at kensaur.us/mushi-mushi/testers/ as a subpath
// under the unified CloudFront distribution.
// MUSHI_BASE_PATH and MUSHI_ASSET_PREFIX are injected by CI.
// ============================================================

const rawBase = process.env.MUSHI_BASE_PATH ?? ''
const basePath = rawBase.replace(/\/+$/, '')
const assetPrefix = (process.env.MUSHI_ASSET_PREFIX ?? basePath).replace(/\/+$/, '')

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: basePath || undefined,
  assetPrefix: assetPrefix || undefined,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    NEXT_PUBLIC_ADMIN_URL: process.env.NEXT_PUBLIC_ADMIN_URL ?? 'https://kensaur.us/mushi-mushi/console',
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'https://kensaur.us/mushi-mushi/api',
  },
}

export default nextConfig
