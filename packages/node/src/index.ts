// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
export { MushiNodeClient } from './client'
export type { NodeClientOptions, NodeReportPayload } from './client'
export { attachUnhandledHook } from './unhandled'
export type { UnhandledHookOptions } from './unhandled'
export { parseTraceContext } from './trace'
export type { TraceContext } from './trace'
export { createOtelSpanProcessor } from './otel'
export { mushiTraceMiddleware, emitMushiSpan } from './middleware'
export type { TraceMiddlewareOptions } from './middleware'
export { mushiExpressErrorHandler } from './express'
export type { ExpressMiddlewareOptions } from './express'

// Linear integration — programmatic connect/disconnect for CI and server-side scripts.
export { connectLinearApiKey, getLinearConnectionStatus, disconnectLinear } from './linear'
export type { LinearConnectorOptions, LinearConnectionStatus } from './linear'

// Reward webhook receiver (Workstream D3) — turnkey host-side "grant role /
// grant membership" trigger driven by Mushi reward events.
export {
  createMushiRewardsHandler,
  verifyRewardSignature,
  parseRewardEvent,
} from './rewards'
export type {
  MushiRewardEventName,
  MushiRewardEvent,
  MushiTierChangedEvent,
  MushiPointsAwardedEvent,
  MushiRewardsHandlerOptions,
  MushiRewardsHandler,
} from './rewards'
