---
"@mushi-mushi/mcp": minor
"@mushi-mushi/cli": minor
---

- **Change the bug widget's look from your editor.** The MCP tools `get_widget_settings` and `set_widget_settings` read and change the widget's colour, corner, theme, trigger text and launcher for one app; the write returns what it was, what it is now and which settings changed. Installed SDKs pick the change up at their next start, with no redeploy. Project owners and admins only.
- **`mushi widget show` and `mushi widget set`** do the same from the terminal, for example `mushi widget set --accent '#3b5bdb' --position bottom-left --theme dark --trigger-text 'Report a bug'`. `--accent auto` goes back to matching your site; a bad colour, corner or theme is refused before anything is sent. A value your app's code sets wins over these settings.
