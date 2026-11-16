---
"@mushi-mushi/react-native": patch
---

Reporter history and the offline queue work again on React Native. The SDK passed `@mushi:reporter_token` and `@mushi:queue_aes_key` to `expo-secure-store`, which accepts only letters, digits, `.`, `-` and `_`, so every call threw. As a result:

- each launch made a new, unsaved reporter token, so **Your reports** emptied after a restart;
- a report whose send failed could not be queued and was lost.

The SecureStore keys are now `mushi.reporter_token` and `mushi.queue_aes_key`. A token SecureStore refuses is kept in AsyncStorage. A queue key SecureStore refuses stores the report unencrypted instead of dropping it.
