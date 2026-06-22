# eslint-plugin-mushi-mushi

ESLint rules that catch the dominant agentic-coding failure modes: empty handlers (Gate 1) and mock-data leaks into production paths (Gate 2).

## Rules

| Rule | What it catches |
| ---- | ---- |
| `mushi-mushi/no-dead-handler` | `onClick={() => {}}`, `() => null` placeholders, `console.log`-only handlers, `throw new Error('not implemented')` stubs, `useCallback(() => {}, [])`. |
| `mushi-mushi/no-mock-leak` | `import { faker } from '@faker-js/faker'` outside test paths, MSW imports, hardcoded `John Doe` arrays, `lorem ipsum` strings, `placeholder@example.com`. |
| `mushi-mushi/no-hand-rolled-dialog` | Raw `<div role="dialog" className="fixed inset-0">` overlays — use shared `<Modal>` / `<Drawer>`. |
| `mushi-mushi/no-hand-rolled-tablist` | Raw `role="tablist"` in admin `*Page.tsx` files — use `<SegmentedControl scrollable>`. |
| `mushi-mushi/no-missing-page-posture` | Operator `*Page.tsx` files without `<PagePosture>` (admin eslint override). |

## Install

```bash
npm install --save-dev eslint-plugin-mushi-mushi
```

## Use (flat config)

```js
import mushi from 'eslint-plugin-mushi-mushi'

export default [
  mushi.configs.recommended,
]
```

## Use (legacy)

```json
{
  "plugins": ["mushi-mushi"],
  "extends": ["plugin:mushi-mushi/legacy"]
}
```

## Why

Agentic / "vibe coding" tools scaffold UI fast — and ship handlers wired to nothing or pages padded with `John Doe` fake data. Sentry doesn't catch it (no error). User feedback catches it late (you already shipped). These two lint rules close the gap deterministically — no LLM, no false positives at zero cost.

Part of the [Mushi Mushi v2](https://github.com/kensaurus/mushi-mushi) bidirectional bug knowledge graph. Works perfectly fine standalone.

## Allowlist

Add `// mushi-mushi-allowlist: <reason>` immediately above a handler call site to opt out of `no-dead-handler` for that one occurrence. The reason is required — silent allowlists are the failure mode this plugin exists to catch.

## License

MIT.


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (June 2026): 47 edge functions · 256 SQL migrations · 13 outbound plugins · 11 inbound adapters · 18 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
