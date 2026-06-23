---
"@mushi-mushi/web": minor
---

Widget UX unification + theming:

- New `getWidgetPreviewTokens` / `getWidgetThemeVars` exports (with `WidgetThemeVars`) so the console can render an accurate live widget preview from the same theme contract the runtime uses.
- Banner/accent theming driven by the shared `@mushi-mushi/core` tokens, with all operator-configurable strings HTML-escaped (`escapeHtml`) and accent colours passed through the CSS-injection-safe `safeWidgetHex` sanitizer.
- i18n coverage for the More-nav overflow, localized assistant/widget strings (en/es/ja/th), open-shadow hook for testability, and a category-step recorder QA hook.
