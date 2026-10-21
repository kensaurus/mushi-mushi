---
"@mushi-mushi/mcp": patch
"@mushi-mushi/cli": patch
---

AI keys can now be used by all your apps: a key added in the console defaults to "All my apps" and serves every app in every organization you own, after each app's own key and its organization's key. `list_byok_keys` and `mushi keys list` show each key's scope (project, organization or universal). `add_byok_key` and `mushi keys add` still add a key to one app; organization and all-apps keys are added in the console.
