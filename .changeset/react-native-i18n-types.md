---
"@mushi-mushi/react-native": patch
---

# v0.20.1 — Post-release SDK reliability fixes

- **React Native types resolve after publish**: removed the `web-i18n.d.ts` ambient shim that re-exported `MushiLocale` from a monorepo-relative source path (`../../web/src/i18n/types`) that does not exist in a published install. `@mushi-mushi/web` already ships proper `./i18n` types via its `exports` map, which `moduleResolution: "bundler"`/`nodenext` resolves directly.
