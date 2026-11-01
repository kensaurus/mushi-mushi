// Runtime backend settings for the admin console (src/lib/env.ts reads them
// before the values baked in at build time). This default sets nothing.
// The admin container replaces this file at start from its environment
// (deploy/admin/40-mushi-env.sh): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
// VITE_API_URL and MUSHI_LOCAL_ONLY.
window.__MUSHI_ENV__ = window.__MUSHI_ENV__ || {};
