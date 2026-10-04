---
'@mushi-mushi/mcp': patch
'@mushi-mushi/cli': patch
---

`add_byok_key` and `mushi keys add --provider` accept `openrouter`: OpenRouter keys are their own BYOK provider instead of an OpenAI key with an openrouter.ai base URL.
