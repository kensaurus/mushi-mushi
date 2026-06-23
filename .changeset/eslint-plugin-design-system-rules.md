---
"eslint-plugin-mushi-mushi": minor
---

Add four design-system lint rules used by the console UX-unification pass:

- `no-card-elevated-outside-allowlist` — flags gradient `card-elevated` / `<Card elevated>` on operational admin surfaces (use `variant="flat"` / `Panel`).
- `no-accent-for-selection` — flags accent colour used for selection/active UI (use brand tokens / `<FilterChip tone="brand">`).
- `no-legacy-shadcn-tokens` — flags legacy shadcn token names.
- `no-raw-hex-in-widget` — flags raw hex literals in widget code (use design tokens / `safeWidgetHex`).
