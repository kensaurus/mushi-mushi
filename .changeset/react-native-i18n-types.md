---
"@mushi-mushi/react-native": patch
---

fix(react-native): remove the `web-i18n.d.ts` ambient module shim that re-exported `MushiLocale` from a monorepo-relative source path (`../../web/src/i18n/types`). That path does not exist once the package is published, breaking type resolution for consumers. `@mushi-mushi/web` already ships proper `./i18n` types via its `exports` map, which `moduleResolution: "bundler"`/`nodenext` resolves directly.
