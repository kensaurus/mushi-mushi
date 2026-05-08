/// <reference types="vite/client" />

// Build-time constants injected via Vite's `define` config (see
// apps/admin/vite.config.ts). These get statically replaced at build time
// so they're safe to read from any module without a runtime fetch.
declare const __APP_VERSION__: string
declare const __SDK_WEB_VERSION__: string
declare const __SDK_REACT_VERSION__: string
declare const __SERVER_VERSION__: string
declare const __BUILD_SHA__: string
declare const __BUILD_DATE__: string
