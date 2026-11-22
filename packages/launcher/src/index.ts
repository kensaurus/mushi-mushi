// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 kensaurus LLC — Mushi Mushi
/**
 * FILE: packages/launcher/src/index.ts
 * PURPOSE: `import { Mushi } from 'mushi-mushi'` — the browser SDK
 *          (@mushi-mushi/web). The bin lives in bin.ts so importing the package
 *          never starts the wizard. Re-exported, not bundled: an app that also
 *          has @mushi-mushi/web keeps one SDK instance (ADR 0060).
 */
export * from '@mushi-mushi/web'
