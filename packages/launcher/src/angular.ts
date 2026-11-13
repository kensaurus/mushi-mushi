// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 kensaurus LLC — Mushi Mushi
/**
 * FILE: packages/launcher/src/angular.ts
 * PURPOSE: `mushi-mushi/angular`. The @mushi-mushi/angular adapter is a devDependency
 *          and is bundled into this entry at build time (tsup noExternal), so
 *          installing mushi-mushi never pulls the adapter's required framework
 *          peer. @mushi-mushi/web, @mushi-mushi/core and the framework stay
 *          external, so the app shares one SDK instance.
 */
export * from '@mushi-mushi/angular'
