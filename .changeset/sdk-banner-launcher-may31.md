---
"@mushi-mushi/core": minor
"@mushi-mushi/web": minor
---

Add `trigger: 'banner'` — a slim, full-width header strip launcher that replaces the floating action button as the recommended default.

**@mushi-mushi/core**

- New `trigger: 'banner'` value on `MushiWidgetConfig` — renders a full-width strip pinned to the top (or bottom) of the viewport instead of a floating action button.
- New `MushiBannerConfig` interface exported for configuring the banner: `variant` (`'neon' | 'brand' | 'subtle'`), `position` (`'top' | 'bottom'`), `bugCta`, `featureCta`, `featureCtaLabel`, `zIndex`.
- New `bannerConfig?: MushiBannerConfig` field on `MushiWidgetConfig`.

**@mushi-mushi/web**

- Banner launcher renders inside the widget's Shadow DOM as a `position: fixed` strip — no layout impact on the host page.
- Three variants: `neon` (electric lime, high-contrast dev/beta feel), `brand` (vermillion, editorial app-quality feel), `subtle` (hairline muted strip, least disruptive).
- Per-session dismiss via ✕ button; re-appears on next page load.
- "🐛 Report a bug" and optional "✨ Request feature" buttons open the report panel directly.
- Runtime config from the Mushi console (`launcher`, `bannerVariant`, `bannerPosition`, `bannerBugCta`, `bannerFeatureCta`) is applied automatically — no SDK re-init required.
- Console configurator: live preview + banner style/position/label controls in `SdkInstallCard`.
- Database: new `sdk_widget_launcher`, `sdk_banner_variant`, `sdk_banner_position`, `sdk_banner_bug_cta`, `sdk_banner_feature_cta` columns in `project_settings`.
