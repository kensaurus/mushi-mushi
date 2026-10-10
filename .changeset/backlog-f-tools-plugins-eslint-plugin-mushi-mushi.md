---
"eslint-plugin-mushi-mushi": patch
---

- `no-hand-rolled-dialog` no longer flags a fixed-inset element whose `aria-modal` is explicitly `"false"` or `{false}`.
- The legacy `.eslintrc` usage example in the source header now extends `plugin:mushi-mushi/legacy`; `plugin:mushi-mushi/recommended` is the flat config and legacy ESLint rejects it.
