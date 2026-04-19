# @mushi-mushi/core

Core types, API client, and utilities for the Mushi Mushi SDK.

> **You almost certainly don't need to install this directly.** Run `npx mushi-mushi` and the wizard will pick the right framework SDK ([`@mushi-mushi/react`](https://npmjs.com/package/@mushi-mushi/react), [`@mushi-mushi/vue`](https://npmjs.com/package/@mushi-mushi/vue), [`@mushi-mushi/svelte`](https://npmjs.com/package/@mushi-mushi/svelte), [`@mushi-mushi/angular`](https://npmjs.com/package/@mushi-mushi/angular), [`@mushi-mushi/react-native`](https://npmjs.com/package/@mushi-mushi/react-native), [`@mushi-mushi/capacitor`](https://npmjs.com/package/@mushi-mushi/capacitor), or [`@mushi-mushi/web`](https://npmjs.com/package/@mushi-mushi/web)) which depends on this package.

## What's Inside

- **Types**: `MushiConfig`, `MushiReport`, `MushiEnvironment`, and all shared interfaces
- **API Client**: Fetch-based HTTP client with retry and exponential backoff
- **Pre-Filter**: On-device Stage 0 spam/gibberish filter (runs client-side, zero server cost)
- **Offline Queue**: IndexedDB-backed queue with auto-sync on reconnect
- **Environment Capture**: Browser/device snapshot (viewport, user agent, connection info)
- **Reporter Token**: Anonymous persistent identity for report attribution
- **Session ID**: Tab-scoped session correlation
- **Rate Limiter**: Token bucket self-throttle to prevent API flooding

## Usage

```typescript
import { createApiClient, createPreFilter, captureEnvironment, createRateLimiter } from '@mushi-mushi/core';
```

This package is used internally by `@mushi-mushi/web` and `@mushi-mushi/react`. Most consumers should use those packages instead.

## Bundle Size

~3.15 KB brotli (limit: 15 KB)

## License

MIT
