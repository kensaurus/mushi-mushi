---
'eslint-plugin-mushi-mushi': patch
---

`recommended` (and `legacy` and the `/recommended` entry) now turn on only the agentic-failure rules: `no-dead-handler`, `no-mock-leak` and `no-allowlist-jsx-textnode`. They used to switch on all 19 rules, including the Mushi console's own design-system rules (tokens, `<Card>`, `<PageHeaderBar>`, the widget theme), which flag ordinary code in any other app. Those rules are still in the plugin; enable one by name if it fits. The Mushi monorepo keeps them through a new `internal` preset.
