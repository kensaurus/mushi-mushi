---
"@mushi-mushi/web": minor
---

- **Your code now wins over the console for the widget's look.** If `Mushi.init({ widget: … })` (or a `data-*` attribute on the script tag) sets `position`, `theme`, `triggerText`, `accent`, a banner field or any other widget option, that value is used even when the console sets the same option; the console fills only what your code leaves out (ADR 0068). Before, the console won for position, theme, trigger text and the banner fields. **To let the console decide an option, remove it from your code.**
- **The console can set the widget's brand colour.** A colour saved in the console (or with `mushi widget set --accent`, or the MCP tool `set_widget_settings`) arrives as `widget.accent` with a black or white `widget.accentText` that Mushi checked for contrast; the two always apply together. Auto (no colour) keeps matching your site as before.
