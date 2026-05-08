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
// Extended SDK catalog — added to surface the full package list in VersionBadge
declare const __SDK_CORE_VERSION__: string
declare const __SDK_VUE_VERSION__: string
declare const __SDK_SVELTE_VERSION__: string
declare const __SDK_ANGULAR_VERSION__: string
declare const __SDK_RN_VERSION__: string
declare const __SDK_CLI_VERSION__: string
declare const __SDK_MCP_VERSION__: string
declare const __SDK_NODE_VERSION__: string
declare const __SDK_CAPACITOR_VERSION__: string
declare const __SDK_PLUGIN_SDK_VERSION__: string
declare const __SDK_PLUGIN_JIRA_VERSION__: string
declare const __SDK_PLUGIN_LINEAR_VERSION__: string
declare const __SDK_PLUGIN_PAGERDUTY_VERSION__: string
declare const __SDK_PLUGIN_SENTRY_VERSION__: string
declare const __SDK_PLUGIN_SLACK_VERSION__: string
declare const __SDK_PLUGIN_ZAPIER_VERSION__: string
declare const __SDK_ADAPTERS_VERSION__: string
declare const __SDK_WASM_VERSION__: string
declare const __CREATE_MUSHI_VERSION__: string
declare const __LAUNCHER_VERSION__: string
