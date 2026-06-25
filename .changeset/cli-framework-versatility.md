---
"@mushi-mushi/cli": minor
---

Detect and correctly configure four more project types in `mushi init`:

- **Create React App** (`react-scripts`) → `@mushi-mushi/react` with the `REACT_APP_` env prefix (previously mis-detected as plain React and given the wrong `VITE_` prefix).
- **Remix** (`@remix-run/*`) → `@mushi-mushi/react` using the runtime `window.ENV` root-loader pattern with bare `MUSHI_*` server env (Remix doesn't inline client env at build time).
- **Astro** (`astro`) → `@mushi-mushi/web` with the `PUBLIC_` prefix.
- **Solid / SolidStart** (`@solidjs/start`, `solid-js`) → `@mushi-mushi/web` with the `VITE_` prefix.

Detection is ordered so meta-frameworks win over the bare `react`/`vue`/`solid` deps they ship with, and CRA is detected before plain React.
