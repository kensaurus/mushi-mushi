# @mushi/react

React bindings for the Mushi Mushi bug reporting SDK.

## Features

- `<MushiProvider>` — context wrapper that initializes the SDK
- `useMushi()` — access the SDK instance for programmatic control
- `useMushiReady()` — check if SDK has finished initializing
- `useMushiReport()` — convenience hook for triggering reports
- `<MushiErrorBoundary>` — catches React errors and pre-fills reports

## Quick Start

```tsx
import { MushiProvider, useMushi } from '@mushi/react';

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

~819 B brotli (limit: 5 KB). Requires `@mushi/core` and `@mushi/web` as dependencies (not bundled inline).

## Peer Dependencies

- `react` ^18.0.0 || ^19.0.0
- `react-dom` ^18.0.0 || ^19.0.0

## License

MIT
