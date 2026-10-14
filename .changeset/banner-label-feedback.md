---
"@mushi-mushi/core": patch
"@mushi-mushi/web": patch
---

The banner pill now reads "Feedback" by default, not "Beta" (`MUSHI_COPY.bannerLabel`, and the web banner's rich layout).
Apple rejected an app under guideline 2.2 partly because of a "Beta" pill in a production build: beta testing belongs in TestFlight.
Pass `bannerConfig.label` to set your own text, or `label: false` to hide the pill. React Native's `MushiBanner` reads the same default from core.
