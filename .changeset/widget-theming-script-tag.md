---
"@mushi-mushi/web": minor
"@mushi-mushi/core": minor
---

- **More settings on the script tag** — `data-accent`, `data-accent-text`, `data-locale` and `data-hide-on-routes` (comma-separated), so Lovable, Bolt and plain HTML sites can brand the widget without code.
- **Script tag typos no longer slip through** — every attribute is checked. A value the widget does not take is skipped with one console warning naming the attribute and the values it accepts; it never throws or breaks the page.
- **Route rules take simple globs** — `hideOnRoutes: ['/admin/*', '/blog/**']`. An entry without `*` still matches anywhere in the path, exactly as before.
- **Text on your accent stays readable** — when `accentText`, `data-accent-text` or a CSS `--mushi-accent-fg` is under 3:1 contrast on the accent, the widget uses black or white instead and says so in `Mushi.diagnose().warnings` (and in the console with `debug: true`). Your accent colour itself is never changed. A CSS `--mushi-accent` now also gets matching text colour instead of the panel background.
- **oklch and lab accents are measured correctly** for these contrast checks.
- `MushiDiagnosticsResult` gains an optional `warnings` list (core).
- New docs page: [Theming the bug widget](https://kensaur.us/mushi-mushi/docs/sdks/theming), with all 13 `--mushi-*` CSS tokens, now guarded by a test.
- The core web bundle budget moves from 89.2 KB to 89.8 KB gzipped for these checks (the script tag parser only ships in the script tag file).
