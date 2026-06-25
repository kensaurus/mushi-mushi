---
"@mushi-mushi/inventory-schema": patch
"@mushi-mushi/inventory-auth-runner": patch
"eslint-plugin-mushi-mushi": patch
"@mushi-mushi/plugin-cursor-cloud": patch
---

Publish these packages with npm provenance attestations. They were the last four published packages still missing `publishConfig.provenance: true`, so their tarballs shipped without the Sigstore build-provenance signature every other `@mushi-mushi/*` package carries. Adding it brings them in line with the rest of the workspace and lets consumers verify them via `npm audit signatures`. No runtime or API changes.
