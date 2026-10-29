# eslint-plugin-mushi-mushi

> **Your AI wrote it. Mushi tells you why it broke.**

ESLint rules from Mushi Mushi for two bugs AI coding tools often ship: a button
wired to a handler that does nothing, and fake data (faker, MSW, `John Doe`
arrays) left in production code. Neither throws an error, so error monitoring
never sees them. Free, MIT, and works without a Mushi Mushi account.

```bash
npm install --save-dev eslint-plugin-mushi-mushi
```

```js
// eslint.config.js
import mushi from 'eslint-plugin-mushi-mushi'

export default [
  {
    plugins: { 'mushi-mushi': mushi },
    rules: {
      'mushi-mushi/no-dead-handler': 'error',
      'mushi-mushi/no-mock-leak': 'error',
    },
  },
]
```

Docs: [eslint-plugin-mushi-mushi](https://kensaur.us/mushi-mushi/docs/sdks/eslint-plugin)

## Rules

The plugin has 19 rules. `recommended` (and `legacy`) turn on three:
`no-dead-handler`, `no-mock-leak` and `no-allowlist-jsx-textnode`. The other
16 check the Mushi Mushi console's own design system (its tokens, `<Card>`,
`<PageHeaderBar>`, the widget theme) and are on only in the `internal` preset
that the Mushi Mushi repo uses. The table lists some of them. Turn one on by
name if it fits your app.

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

Only `no-dead-handler` and `no-mock-leak` (plus the allowlist guard) are meant
for any app. The rest are design rules for Mushi Mushi's own console, and some
of them (`no-hand-rolled-dialog`, the `*Page.tsx` rules) would flag ordinary
code in your app.

## The `recommended` preset

`mushi.configs.recommended` (also exported as `eslint-plugin-mushi-mushi/recommended`) turns on the same three rules as errors. Since 0.3.6 it no longer includes the console's design rules.

```js
import mushi from 'eslint-plugin-mushi-mushi'

export default [
  mushi.configs.recommended, // no-dead-handler, no-mock-leak, no-allowlist-jsx-textnode
]
```

## Legacy `.eslintrc`

```json
{
  "plugins": ["mushi-mushi"],
  "rules": {
    "mushi-mushi/no-dead-handler": "error",
    "mushi-mushi/no-mock-leak": "error"
  }
}
```

`"extends": ["plugin:mushi-mushi/legacy"]` is the legacy form of `recommended`, with the same three rules.

## Why

AI coding tools build UI fast, and sometimes ship handlers wired to nothing or
pages padded with `John Doe` fake data. Nothing throws, so Sentry never sees
it, and users find it after you shipped. These rules catch it at lint time,
with plain pattern checks and no AI call. Like any pattern rule they can flag
something you meant to write; use the allowlist below for those.

If you use Mushi Mushi's pre-release checks, its `dead_handler` and
`mock_leak` checks read the ESLint JSON report these rules produce (see
[`@mushi-mushi/mcp-ci`](https://www.npmjs.com/package/@mushi-mushi/mcp-ci)).
The plugin works the same without them.

## Allowlist

Add `// mushi-mushi-allowlist: <reason>` immediately above a call site (JS/attribute context) to opt out of rules that honour the marker. The reason is required, so every exception says why.

**Never put bare `//` as a JSX child.** React renders it as text. Inside a children list use a JSX block comment (`{` + `/* … */` + `}`) instead. See `mushi-mushi/no-allowlist-jsx-textnode`.

## License

MIT.


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 77 edge functions · 529 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
