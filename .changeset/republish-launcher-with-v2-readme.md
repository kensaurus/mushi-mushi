---
'mushi-mushi': patch
---

Re-publish to refresh the npm landing page with the v2-era README and
description updates.

The previous publish (`0.6.3`, 2026-04-29) shipped before the v2
"bidirectional inventory + agentic-failure gates" changes landed and
before the README enhancement pass that documents v2 capabilities,
the bundled glot.it integration, and the updated supported-frameworks
matrix. Local `0.6.3` and the registry tarball drifted apart even
though the version numbers matched.

This patch is a no-op runtime change — same `dist/` artefacts — but
bumps the version so `npm publish` ships the current README + package
description tarball-side. End users hitting npmjs.com/package/mushi-mushi
will now see the v2 positioning and the up-to-date framework list.
