---
"@mushi-mushi/web": minor
"@mushi-mushi/react-native": minor
"@mushi-mushi/core": minor
---

SDK polish from the UI/UX audit pass:

- **web**: the widget now live-restyles when the OS `prefers-color-scheme`
  changes under `theme: 'auto' | 'inherit'`, and mount is hardened so a host
  page whose `matchMedia` lacks the modern `addEventListener` can never throw.
  Richer banner layout (pill + message + flat actions), `hideOnSelector`
  suppression, submit failure-kind surfacing, and expanded i18n copy
  (en/es/ja/th).
- **react-native**: banner, bottom-sheet, and floating-button polish;
  `submitReport()` now resolves to a typed failure result instead of
  `undefined` when called before the provider finishes initializing.
- **core**: additional shared design tokens consumed by the surfaces above.
