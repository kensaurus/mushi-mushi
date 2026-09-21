---
'mushi-mushi': patch
'@mushi-mushi/cli': patch
'@mushi-mushi/mcp': patch
'@mushi-mushi/core': patch
'@mushi-mushi/web': patch
'@mushi-mushi/react': patch
'@mushi-mushi/react-native': patch
'@mushi-mushi/node': patch
---

npm metadata. Each entry package's description is now a short role followed by one shared pitch — "The bug mediator for AI-built apps: plain-English diagnosis + a ready fix, in your editor." — so the `mushi-mushi` card no longer stops mid-word at npm's 255-character cut. The author link points at the maintainer's GitHub account (the Bluesky handle it used to name was never registered), the Node floor is `>=20.19.0` everywhere to match `@mushi-mushi/core`, and the `sentry-alternative` keyword is gone (Mushi runs alongside Sentry). `@mushi-mushi/react-native` no longer packs its 60 KB CHANGELOG.
