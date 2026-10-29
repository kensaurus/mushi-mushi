# Create React App → Vite

Source: https://kensaur.us/mushi-mushi/docs/migrations/cra-to-vite

---
title: 'Create React App → Vite'
description: Migrate a Create React App project to Vite. Run the codemod, rename REACT_APP_ env vars to VITE_, and keep your Mushi Mushi React setup working.
---

# Create React App → Vite

 

The React team deprecated Create React App on February 14, 2025: it has
no active maintainers and stays in maintenance mode
([React blog](https://react.dev/blog/2025/02/14/sunsetting-create-react-app)).
The same post lists Vite as one of the build tools to move to.

A community codemod handles much of the mechanical work:

```bash
npx migrate-to-vite@latest cra
```

This guide walks the rest.

  **Mushi Mushi keeps working** through this migration. The SDK doesn't
  care which bundler ships your app; only the env-var prefix changes
  (`REACT_APP_*` → `VITE_*`).

## Prerequisites

- A working CRA app (`react-scripts` ≥ 5).
- A Node version the current Vite supports (check the
  [Vite guide](https://vite.dev/guide/)).
- Mushi web SDK or React adapter already installed.

## Migration checklist

The codemod rewrites package.json, the entry HTML, and config files. Branch first so you can diff.</> },
    { id: 'codemod', label: 'Run the codemod', content: {`npx migrate-to-vite@latest cra`} },
    { id: 'review-diff', label: 'Review the diff carefully', content: <>Per its README, the codemod moves index.html to the root, swaps react-scripts for Vite, rewrites the package.json scripts, replaces process.env with import.meta.env, and adds the vite/client types. Read every changed file before committing.</> },
    { id: 'env-prefix', label: 'Rename env vars: REACT_APP_* → VITE_*', content: {`# .env.local
- REACT_APP_MUSHI_PROJECT_ID=proj_xxx
- REACT_APP_MUSHI_API_KEY=mushi_xxx
+ VITE_MUSHI_PROJECT_ID=proj_xxx
+ VITE_MUSHI_API_KEY=mushi_xxx

# In code
- process.env.REACT_APP_MUSHI_PROJECT_ID
+ import.meta.env.VITE_MUSHI_PROJECT_ID`} },
    { id: 'public', label: 'Move public assets', content: <>CRA: public/ contents are referenced via %PUBLIC_URL%. Vite: same folder, but reference as /asset.png directly. Search for %PUBLIC_URL% to catch any the codemod left.</> },
    { id: 'index-html', label: 'Verify index.html is at the project root', content: <>Vite expects index.html at the root, NOT in public/. Update &lt;script type="module" src="/src/index.tsx"&gt; to point at your actual entry file.</> },
    { id: 'svg', label: 'Update SVG-as-React-component imports', content: {`// CRA
- import { ReactComponent as Logo } from './logo.svg'
// Vite — install vite-plugin-svgr, then:
+ import Logo from './logo.svg?react'`} },
    { id: 'jest', label: 'Decide on testing framework', content: <>CRA ran Jest through react-scripts test, which goes away. Vitest (a separate package from the Vite team) has a Jest-compatible API and is the usual replacement. To keep Jest instead, configure babel-jest or ts-jest yourself.</> },
    { id: 'mushi-import', label: 'Re-verify Mushi mounts correctly', content: {`// src/main.tsx

createRoot(document.getElementById('root')!).render(
  
    

)`} },
    { id: 'remove-cra', label: 'Remove CRA dependencies', content: {`npm uninstall react-scripts
# Also remove any @craco/craco or react-app-rewired hold-overs`} },
    { id: 'tsconfig', label: 'Update tsconfig.json types', content: {`// In src/react-app-env.d.ts (or vite-env.d.ts after the codemod)
- /// 
+ /// `} },
    { id: 'verify', label: 'Smoke-test dev + prod builds', content: {`npm run dev    # Vite dev server on :5173 by default
npm run build  # Production build into dist/
npm run preview`} },
    { id: 'test-report', label: 'Submit a test Mushi report', content: <>Open the dev server, open the floating widget (or your own button), submit a report, and confirm it appears on the Reports page.</> },

/>

## Common gotchas

- **`process.env`**. Vite doesn't inject `process.env` at build time. The
  codemod rewrites `process.env` to `import.meta.env`; grep for
  `REACT_APP_` to catch names that still need the `VITE_` prefix.
- **Absolute imports without aliases**. CRA had implicit absolute imports
  via `jsconfig.json` / `tsconfig.json` `baseUrl`. Vite respects
  `tsconfig.json` paths only through a plugin such as `vite-tsconfig-paths`
  or a `resolve.alias` entry; add one yourself.
- **Worker imports**. CRA used a webpack-specific `Worker` loader; Vite
  uses native `?worker` URL imports. The codemod won't migrate workers
  for you.
- **`@craco/craco` users.** If you used craco for custom webpack config,
  port those overrides to `vite.config.ts` plugins manually.

## Rollback

Branched in step 1, so a `git checkout main` reverts cleanly. If you've
already merged and found an issue after deploying, revert the merge. CRA
still builds; it is deprecated, not removed.

## Mushi Mushi compatibility

The Mushi web SDK and React adapter work the same on CRA and Vite. With
Vite, `MushiProvider` can also read `VITE_MUSHI_PROJECT_ID` and
`VITE_MUSHI_API_KEY` by itself when you don't pass `config`.

## References

- [migrate-to-vite codemod](https://github.com/deve-sh/Migrate-to-Vite)
- [Vite docs: env variables](https://vite.dev/guide/env-and-mode)
- [React blog: Sunsetting Create React App](https://react.dev/blog/2025/02/14/sunsetting-create-react-app)
- [Vitest](https://vitest.dev/)
- [`@mushi-mushi/react` SDK reference](/sdks/react)
