---
"@mushi-mushi/web": patch
---

fix(widget): replace generic indigo beta-strip with brand vermillion palette

The beta-mode strip, beta-tag, and beta-success-footer inside the report panel
were using raw `rgba(99, 102, 241)` (generic SaaS indigo/purple) — the single
most recognisable AI-template colour. All three surfaces now use the widget's
own `widgetAccent` / `widgetAccentWash` / `widgetAccentInk` tokens so the beta
panel reads as a Mushi-native surface rather than a plug-in from a different
product. The BETA pill is promoted to a solid vermillion stamp (matching the
header mark and submit button) rather than a tinted amber chip.
