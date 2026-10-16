---
"@mushi-mushi/cli": patch
---

The CLI now really stores and reads your API key in the OS keychain (macOS Keychain, Windows Credential Manager, libsecret). It loaded the keychain module with a bare `require`, which does not exist in the CLI's ES module build, so the keychain was silently skipped and keys lived only in the config file.

With the keychain on, `mushi keys rotate` and `mushi config apiKey <key>` now update the keychain entry as well as the file, so a rotated (and revoked) key can no longer win over the new one. `MUSHI_NO_KEYCHAIN=1` now turns off every keychain read and write, not just the status check. Your next `mushi login` copies the key into the keychain; the file copy stays as a fallback.
