---
'@mushi-mushi/web': patch
'@mushi-mushi/react-native': patch
---

The in-app assistant rejects with an error named `QuotaExhausted` when the AI provider is out of quota (`LLM_UNAVAILABLE`). The message is the server's sentence. Every other server failure still resolves `null`, as before. The web widget catches that rejection and shows a translated line (`locale.assistant.errors.quota`, with `{date}` filled when the provider named a reset) instead of the English server sentence. Call `askAssistant` (React Native) or a custom `onAssistantAsk` inside try/catch.
