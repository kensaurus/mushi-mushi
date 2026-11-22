// Bundle budget for @mushi-mushi/react-native (brotli, dist/index.js).
// Kept in a .cjs file (not package.json) so the budget can carry its reason.
module.exports = [
  {
    path: 'dist/index.js',
    // 2026-10-02: +1.5 kB for Plan 018 Phase 1 RN parity (one-screen report, v2 timeline,
    // receipt + email opt-in, next-visit toast). RN ships once inside a Metro app bundle,
    // not per page view; shared logic already lives in core/reporter-ui.
    // 2026-11-22: +0.3 kB for the console's colour and corner (runtime-widget.ts,
    // ADR 0068): one GET /v1/sdk/config at start and a code-wins merge.
    limit: '23.8 KB',
  },
]
