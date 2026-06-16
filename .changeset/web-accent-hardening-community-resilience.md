---
"@mushi-mushi/web": patch
---

Harden the web widget and make the cross-app community bootstrap resilient.

- **Security**: `getWidgetStyles` now validates the `accent` / `accentText`
  config values against a strict hex-colour pattern (`#rgb` … `#rrggbbaa`)
  before interpolating them into the shadow-DOM `<style>` template. Non-hex
  values are ignored and fall back to the default palette, closing a
  CSS-injection vector from untrusted host configuration.
- **Reliability**: the community load (global leaderboard + tester reputation)
  is wrapped in `try/catch` so a failed leaderboard or reputation fetch can no
  longer reject during widget bootstrap.
- **Maintainability**: the widget's rendering and stateless helpers were
  extracted into `widget-render.ts` / `widget-helpers.ts` (behaviour preserved;
  all user-controlled HTML continues to route through `escapeHtml`).
