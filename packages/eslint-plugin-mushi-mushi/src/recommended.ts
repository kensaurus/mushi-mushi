// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * Convenience entry: `import recommended from 'eslint-plugin-mushi-mushi/recommended'`
 *
 * Equivalent to `plugin.configs.recommended` from the default export but
 * lets the consumer write a one-liner in their flat config.
 */

import plugin from './index.js'

const config = (plugin.configs as Record<string, unknown>).recommended
export default config
