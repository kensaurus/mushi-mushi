---
'mushi-mushi': minor
'@mushi-mushi/cli': minor
'create-mushi-mushi': patch
---

One package for users, continued (ADR 0060 Phase 1b).

- `mushi-mushi/eslint`: the Mushi Mushi ESLint rules (`no-dead-handler`,
  `no-mock-leak`) now ship inside `mushi-mushi`. Use
  `import mushi from 'mushi-mushi/eslint'` and `mushi.configs.recommended`
  (or `import { recommended } from 'mushi-mushi/eslint'`) in a flat config.
  `eslint` is an optional peer. `eslint-plugin-mushi-mushi` is no longer
  published; 0.3.7 is its last version.
- `npx mushi-mushi --template <vue|svelte|node> [dir]` scaffolds a starter app.
  The starters moved from `create-mushi-mushi` into `@mushi-mushi/cli`, and
  they now install `mushi-mushi` and import from `mushi-mushi/vue`,
  `mushi-mushi/svelte` and `mushi-mushi/node`, the same as the docs.
- `create-mushi-mushi` is now an alias of `npx mushi-mushi`: it forwards every
  argument to the same code, so `npm create mushi-mushi` also forwards `mushi`
  commands (`npm create mushi-mushi setup`). A bare word that is not a command
  (`npm create mushi-mushi my-app`) still runs the wizard, after one hint line
  about `--template`. Errors from both bins now start with the bin name.
