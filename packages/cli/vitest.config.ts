import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Tests must never read or write the developer's real OS keychain (the
    // login and init paths store keys there). keychain.test.ts unsets this
    // and serves an in-memory keychain through a createRequire mock.
    env: { MUSHI_NO_KEYCHAIN: '1' },
  },
})
