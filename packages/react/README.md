# @mushi-mushi/react

React bindings for the Mushi Mushi bug reporting SDK.

> **One-command setup:** `npx mushi-mushi` auto-detects React/Next.js and installs this package.
>
> **Other frameworks:** [`@mushi-mushi/vue`](https://npmjs.com/package/@mushi-mushi/vue) · [`@mushi-mushi/svelte`](https://npmjs.com/package/@mushi-mushi/svelte) · [`@mushi-mushi/angular`](https://npmjs.com/package/@mushi-mushi/angular) · [`@mushi-mushi/react-native`](https://npmjs.com/package/@mushi-mushi/react-native) · [`@mushi-mushi/capacitor`](https://npmjs.com/package/@mushi-mushi/capacitor) · [`@mushi-mushi/web`](https://npmjs.com/package/@mushi-mushi/web) (vanilla JS)

## Features

- `<MushiProvider>` — context wrapper that initializes the SDK
- `useMushi()` — access the SDK instance for programmatic control
- `useMushiReady()` — check if SDK has finished initializing
- `useMushiReport()` — convenience hook for triggering reports
- `<MushiErrorBoundary>` — catches React errors and pre-fills reports

## Quick Start

```tsx
import { MushiProvider, useMushi } from '@mushi-mushi/react';

function App() {
  return (
    <MushiProvider config={{ projectId: 'proj_xxx', apiKey: 'your-api-key' }}>
      <YourApp />
    </MushiProvider>
  );
}

function ReportButton() {
  const mushi = useMushi();
  return <button onClick={() => mushi?.open()}>Report Bug</button>;
}
```

## Bundle Size

~819 B brotli (limit: 5 KB). Requires `@mushi-mushi/core` and `@mushi-mushi/web` as dependencies (not bundled inline).

## Peer Dependencies

- `react` ^18.0.0 || ^19.0.0
- `react-dom` ^18.0.0 || ^19.0.0

## License

MIT
