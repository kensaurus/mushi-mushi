# eslint-plugin-mushi-mushi

> **Your AI wrote it. Mushi tells you why it broke.**

Part of the Mushi Mushi monorepo — plain-English bug comprehension for vibe coders.


ESLint rules that catch the dominant agentic-coding failure modes: empty handlers (Gate 1) and mock-data leaks into production paths (Gate 2).

## Rules

| Rule | What it catches |
| ---- | ---- |
| `mushi-mushi/no-dead-handler` | `onClick={() => {}}`, `() => null` placeholders, `console.log`-only handlers, `throw new Error('not implemented')` stubs, `useCallback(() => {}, [])`. |
| `mushi-mushi/no-mock-leak` | `import { faker } from '@faker-js/faker'` outside test paths, MSW imports, hardcoded `John Doe` arrays, `lorem ipsum` strings, `placeholder@example.com`. |
| `mushi-mushi/no-hand-rolled-dialog` | Raw `<div role="dialog" className="fixed inset-0">` overlays — use shared `<Modal>` / `<Drawer>`. |
| `mushi-mushi/no-hand-rolled-tablist` | Raw `role="tablist"` in admin `*Page.tsx` files — use `<SegmentedControl scrollable>`. |
| `mushi-mushi/no-missing-page-posture` | Operator `*Page.tsx` files without `<PagePosture>` (admin eslint override). |
| `mushi-mushi/no-legacy-page-header-in-pages` | Legacy `<PageHeader>` in page files — use `<PageHeaderBar>`. |
| `mushi-mushi/no-page-root-padding` | Page roots missing `PAGE_CONTENT_STACK` or adding root `p-*` / `max-w-*` (shell already pads). |
| `mushi-mushi/no-arbitrary-length-value` | Non-`var(--…)` Tailwind arbitraries (`w-[240px]`, `text-[13px]`) — prefer tokens. |
| `mushi-mushi/prefer-card-primitive` | Hand-rolled `rounded border bg-surface-*` — prefer `<Card>` / `<Panel>`. |
| `mushi-mushi/no-allowlist-jsx-textnode` | `// mushi-mushi-allowlist` written as a JSX child (renders as visible text). Use a JSX block comment or an attribute-line `//`. |

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

Add `// mushi-mushi-allowlist: <reason>` immediately above a call site (JS/attribute context) to opt out of rules that honour the marker. The reason is required — silent allowlists are the failure mode this plugin exists to catch.

**Never put bare `//` as a JSX child** — React renders it as text. Inside a children list use a JSX block comment (`{` + `/* … */` + `}`) instead. See `mushi-mushi/no-allowlist-jsx-textnode`.

## License

MIT.


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 55 edge functions · 328 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
