---
"@mushi-mushi/core": minor
"@mushi-mushi/web": minor
"@mushi-mushi/react-native": minor
"@mushi-mushi/flutter": patch
"@mushi-mushi/android": patch
"@mushi-mushi/ios": patch
---

**Mushi SDK Uplift — Draggable FAB, Themed Popup, Keyboard-Safe Form, Cross-App Community**

### Draggable / repositionable FAB

- **Web**: Pointer Events drag with tap-vs-drag threshold (6 px), safe-area clamping, optional edge-snap on release, per-project `localStorage` persistence, arrow-key nudge for keyboard accessibility. New `draggable?: boolean | { persist?, snapToEdge?, axis? }` config type in `@mushi-mushi/core`.
- **React Native**: `PanResponder`-based drag + `AsyncStorage` persistence + safe-area clamping.
- **Flutter**: Long-press-to-drag via `GestureDetector` + `SharedPreferences` persistence + edge-snap.
- **iOS**: `UIPanGestureRecognizer` via `MushiFabDragController` + `UserDefaults` persistence + animated edge-snap.
- **Android**: `OnTouchListener` tap-vs-drag + `SharedPreferences` persistence + optional edge-snap. New `DraggableConfig` data class.

### Theme inherit + accent + contrast fixes

- **All platforms**: New `theme: 'inherit'` resolves the host app's dark mode at runtime (`prefers-color-scheme` / `color-scheme` on web, `traitCollection.userInterfaceStyle` on iOS, `UiModeManager` on Android, `Brightness` on Flutter). New `accent` + `accentText` config tokens for brand-color override.
- **Web**: Parameterized `getWidgetStyles(theme, accent)` with `widgetAccent` / `widgetAccentWash` / `widgetAccentInk` tokens; fixed undefined `var(--mushi-text-dim)` references; WCAG AA re-verified in both themes.
- **React Native / Android**: Explicit disabled-state colors (no more white-on-white disabled buttons).

### Keyboard-safe "tell us more" form

- **Web**: `visualViewport` manager on `open()`; lifts panel above mobile keyboard; scrolls focused `textarea` / `input` into view; `100dvh` bottom-sheet layout on narrow viewports; torn down on `close()` / `destroy()`.
- **React Native**: `KeyboardAvoidingView` `behavior="height"` (Android) + `ScrollView(keyboardShouldPersistTaps)`.
- **Flutter**: `SingleChildScrollView` + `MediaQuery.viewInsets.bottom` inset.
- **iOS**: `keyboardWillShow` / `keyboardWillHide` observers + `CGAffineTransform` lift.
- **Android**: `SOFT_INPUT_ADJUST_RESIZE` + `ScrollView` wrapper.

### Cross-app community layer

- New **in-widget Mushi sign-in** (magic link / OTP) — no password required.
- **Account step**: sign-in form → signed-in profile card with global rank + cross-app navigation.
- **Cross-app reports step**: all reports filed by this tester across every app, grouped by app.
- **Global leaderboard**: top-N ranking from `tester_leaderboard_30d_public`, with my rank highlighted.
- **Server** (Supabase, mushi-mushi project): three new SECURITY DEFINER RPCs — `mushi_link_reporter_token`, `mushi_get_my_cross_app_reports`, `mushi_get_my_reputation`; magic-link route; public leaderboard route. Deployed + verified on remote.
- **Community footer** added to the category-select step: "Join community" entry-point + leaderboard shortcut.
- Cross-domain identity unifies server-side via `tester_id`; per-domain magic-link re-auth is required for different origins (localStorage is per-origin by browser design).

### Size budget

Bundle budget raised from 63 KB → 70 KB gzip (with 3.5 KB headroom) to accommodate the community layer. Community CSS compacted to single-line rules.
