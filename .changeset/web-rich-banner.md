---
"@mushi-mushi/core": minor
"@mushi-mushi/web": minor
---

feat(web,core): rich banner layout — `message`, `label`, and flat `links`

`MushiBannerConfig` gains `message` (body copy on the strip), `label` (pill label before the message, `false` to hide), and `links` (extra flat actions after the bug/feature CTAs, each opening an external URL or the feature-request widget). When `message` is set the banner switches to the rich pill + message + flat-actions layout used by the Mushi admin console's beta banner. `MushiBannerLink` is exported from `@mushi-mushi/core`.
