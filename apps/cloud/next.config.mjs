/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ['@supabase/ssr', '@supabase/supabase-js'],
  },
}

export default nextConfig
