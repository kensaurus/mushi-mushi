/** @type {import('next').NextConfig} */
const nextConfig = {
  // Served under /mushi-mushi/testers/ in both dev (via Vite proxy) and
  // production (CloudFront routing rule). The path must exactly match the
  // Vite proxy key in apps/admin/vite.config.ts.
  basePath: process.env.MUSHI_BASE_PATH ?? '/mushi-mushi/testers',

  // Trailing slash to align with how CloudFront routes the SPA.
  trailingSlash: true,

  // Remove X-Powered-By header.
  poweredByHeader: false,
}

export default nextConfig
