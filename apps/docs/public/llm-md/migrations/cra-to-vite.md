# Create React App → Vite

Source: https://kensaur.us/mushi-mushi/docs/migrations/cra-to-vite

---
title: 'Create React App → Vite'
---

# Create React App → Vite

 

`create-react-app` has been unmaintained since 2023 and the React team
removed it from the official "Start a New React Project" page. Vite is the
modern equivalent — faster dev server, native ESM, smaller production
bundles, actively maintained.

There's a community codemod that handles ~90 % of the work:

```bash
npx migrate-to-vite@latest cra
```

This guide walks the rest.

  **Mushi keeps working unchanged** through this migration. The web SDK
  doesn't care which bundler ships your app — only the env-var prefix
  changes (`REACT_APP_*` → `VITE_*`).

## Prerequisites

- A working CRA app (`react-scripts` ≥ 5).
- Node 18+.
- Mushi web SDK or React adapter already installed.

## Migration checklist

The codemod rewrites package.json, the entry HTML, and config files. Branch first so you can diff.</> },
    { id: 'codemod', label: 'Run the codemod', content: {`npx migrate-to-vite@latest cra`} },
    { id: 'review-diff', label: 'Review the diff carefully', content: <>The codemod handles index.html relocation, package.json scripts, and most env-var rewrites. Read every changed file before committing.</> },
    { id: 'env-prefix', label: 'Rename env vars: REACT_APP_* → VITE_*', content: {`# .env.local
- REACT_APP_MUSHI_PROJECT_ID=proj_xxx
- REACT_APP_MUSHI_API_KEY=mushi_pk_xxx
+ VITE_MUSHI_PROJECT_ID=proj_xxx
+ VITE_MUSHI_API_KEY=mushi_pk_xxx

# In code
- process.env.REACT_APP_MUSHI_PROJECT_ID
+ import.meta.env.VITE_MUSHI_PROJECT_ID`} },
    { id: 'public', label: 'Move public assets', content: <>CRA: public/ contents are referenced via %PUBLIC_URL%. Vite: same folder, but reference as /asset.png directly. The codemod handles common patterns — search for %PUBLIC_URL% to catch leftovers.</> },
    { id: 'index-html', label: 'Verify index.html is at the project root', content: <>Vite expects index.html at the root, NOT in public/. Update &lt;script type="module" src="/src/index.tsx"&gt; to point at your actual entry file.</> },
    { id: 'svg', label: 'Update SVG-as-React-component imports', content: {`// CRA
- import { ReactComponent as Logo } from './logo.svg'
// Vite — install vite-plugin-svgr, then:
+ import Logo from './logo.svg?react'`} },
    { id: 'jest', label: 'Decide on testing framework', content: <>CRA used Jest. Vite ships with Vitest, which has a Jest-compatible API. The codemod sets up Vitest by default. If you want to keep Jest, you'll need babel-jest and ts-jest configured manually.</> },
    { id: 'mushi-import', label: 'Re-verify Mushi mounts correctly', content: {`// src/main.tsx

createRoot(document.getElementById('root')!).render(
  
    
  ,
)`} },
    { id: 'remove-cra', label: 'Remove CRA dependencies', content: {`npm uninstall react-scripts
# Also remove any @craco/craco or react-app-rewired hold-overs`} },
    { id: 'tsconfig', label: 'Update tsconfig.json types', content: {`// In src/react-app-env.d.ts (or vite-env.d.ts after the codemod)
- /// 
+ /// `} },
    { id: 'verify', label: 'Smoke-test dev + prod builds', content: {`npm run dev    # Vite dev server on :5173 by default
npm run build  # Production build into dist/
npm run preview`} },
    { id: 'test-report', label: 'Submit a test Mushi report', content: <>Open the dev server, click the floating bug icon (or trigger your custom CTA), submit a report, and confirm it appears in Project → Reports within ~5s.</> },
  ]}
/>

## Common gotchas

- **`process.env`**. Vite doesn't inject `process.env` at build time. The
  codemod rewrites the obvious cases; greps for `process.env.REACT_APP_`
  catch the rest.
- **Absolute imports without aliases**. CRA had implicit absolute imports
  via `jsconfig.json` / `tsconfig.json` `baseUrl`. Vite respects
  `tsconfig.json` paths but you must also configure the `vite-tsconfig-paths`
  plugin (the codemod adds it).
- **Worker imports**. CRA used a webpack-specific `Worker` loader; Vite
  uses native `?worker` URL imports. The codemod won't migrate workers
  for you.
- **`@craco/craco` users.** If you used craco for custom webpack config,
  port those overrides to `vite.config.ts` plugins manually.

## Rollback

Branched in step 1, so a `git checkout main` reverts cleanly. If you've
already merged and discovered an issue post-deploy, revert the merge —
CRA still builds (it's just unmaintained, not broken).

## Mushi compatibility

The Mushi web SDK and React adapter both work identically on CRA and Vite.
The only post-migration change you should observe is faster dev refreshes
(Vite HMR is roughly 10× faster than CRA's webpack dev server) — Mushi
hot-reloads cleanly through both.

## References

- [migrate-to-vite codemod](https://github.com/deve-sh/Migrate-to-Vite)
- [Vite docs — env variables](https://vitejs.dev/guide/env-and-mode)
- [Vitest — drop-in Jest replacement](https://vitest.dev/)
- [`@mushi-mushi/react` SDK reference](/sdks/react)
