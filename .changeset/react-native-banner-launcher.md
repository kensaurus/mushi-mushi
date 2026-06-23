---
"@mushi-mushi/react-native": minor
---

Add the `MushiBanner` lime neon banner launcher to the React Native SDK, mirroring the web widget's banner entry point:

- New `MushiBanner` component with `MushiBannerProps` and the `MUSHI_BANNER_DEFAULT_HEIGHT` constant.
- New `'banner'` value for `widget.trigger` so hosts can render the banner as the passive entry point.
- Reporter-status surface (`reporter-status.ts`) for the My Reports affordance.

All additions are Hermes-safe (no Node built-ins / browser globals).
