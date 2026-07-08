/**
 * FILE: apps/admin/src/components/ui.tsx
 * PURPOSE: Barrel for the admin design-system primitives. The implementations
 *          live in ./ui/*; this file only re-exports them so the ~93 existing
 *          `from '.../components/ui'` import sites keep working unchanged.
 */
export * from './ui/layout';
export * from './ui/chrome';
export * from './ui/fields';
export * from './ui/metrics';
export * from './ui/page-help';
export * from './ui/forms';
export * from './ui/misc';
export * from './ui/chat';
export * from './ui/prose';
export * from './ui/job-status-pill';
