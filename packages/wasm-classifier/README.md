# @mushi-mushi/wasm-classifier

> **Your AI wrote it. Mushi tells you why it broke.**

An optional junk filter for [Mushi Mushi](https://github.com/kensaurus/mushi-mushi) bug reports. It runs in the browser and stops empty or nonsense reports ("hi", "asdf") before they are sent, so they never reach the server or an LLM.

> **Status: the ONNX mode is experimental.** Model inference is not implemented yet: `createOnnxClassifier()` loads `onnxruntime-web` and your model, then returns the heuristic's verdict for every report (`modelId: 'heuristic-fallback'`) and logs one console warning saying so. Use `createHeuristicClassifier()` in production.

## Quick start

```bash
npm install @mushi-mushi/wasm-classifier
```

```ts
import { Mushi } from '@mushi-mushi/web';
import { createHeuristicClassifier } from '@mushi-mushi/wasm-classifier';

Mushi.init({
  projectId: 'proj_…',
  apiKey: '…',
  preFilter: { wasmClassifier: createHeuristicClassifier() },
});
```

The web SDK never loads this package on its own; pass it through `preFilter.wasmClassifier` as above. Docs: [wasm-classifier reference](https://kensaur.us/mushi-mushi/docs/sdks/wasm-classifier)

It runs in two modes:

1. **Heuristic mode** (default, no dependencies) — a pattern-based score over the description, attached signals, and proactive triggers. Always available.
2. **ONNX mode** — lazy-loads `onnxruntime-web` (optional peer dependency) and a quantized small language model you host on a CDN. Falls back to heuristic mode automatically if the runtime, model, or WebGPU/WASM backend is unavailable. **Model inference is not implemented yet:** this mode still returns heuristic verdicts (see below), so use heuristic mode for now.

## Why

Without it, every report goes to the server for LLM classification. That works, but:

- **Cost** — reports the server is going to dismiss anyway ("hi", "test", "asdf", a single emoji) still cost an LLM call.
- **Privacy** — obvious junk is never transmitted, so it stays out of audit logs and out of the LLM provider's hands.

The classifier runs after the SDK's built-in pattern filter and before the API client. If it returns `block`, the report is not sent. If it returns `pass` or `unsure`, the report is sent and the server does the full classification.

```bash
# Optional, only if you want the ONNX backend:
npm install onnxruntime-web
```

## Calling it yourself

```ts
import { createHeuristicClassifier } from '@mushi-mushi/wasm-classifier';

const classifier = createHeuristicClassifier();

const result = await classifier.classify({
  description: 'When I click checkout the page crashes with a 500',
  hasNetworkErrors: true,
});
// { verdict: 'pass' | 'block' | 'unsure', confidence, reason, modelId: 'heuristic-v1', durationMs }

if (result.verdict === 'block') {
  // Ask the user for more detail instead of sending.
}
```

## Usage — ONNX mode (experimental)

Every verdict below still comes from the heuristic until inference ships.

```ts
import { createOnnxClassifier } from '@mushi-mushi/wasm-classifier';

const classifier = await createOnnxClassifier({
  modelUrl: 'https://cdn.your-app.com/mushi/phi-3-mini-int4.onnx',
  cacheKey: 'phi-3-mini-int4-v1',
  preload: true,
  classifyTimeoutMs: 750,
});

await classifier.ready;

const result = await classifier.classify({
  description: 'something feels off but I can\'t put my finger on it',
});
```

If `onnxruntime-web` is not installed, if the model fetch fails, or if a `classify()` call exceeds `classifyTimeoutMs`, the classifier transparently falls back to the heuristic backend so the widget never breaks.

## Hosting the ONNX model

This package intentionally does **not** bundle the model file. Recommended workflow:

1. Train a small classification head on top of [Phi-3-mini-4k-instruct-onnx](https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-onnx) using your own labelled report data.
2. Quantize to int4 with [onnxruntime quantization tools](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html). Target file size: ≤ 100 MB so it caches in the browser CacheStorage.
3. Host on a CDN with long `Cache-Control` (e.g. `public, max-age=31536000, immutable`) and a versioned URL.
4. Pass the URL as `modelUrl`. Set `cacheKey` so re-visits skip re-downloading.

Until that custom head is in place and the inference step is written, the ONNX backend delegates to the heuristic backend: results carry `modelId: 'heuristic-fallback'` and a reason starting `ONNX inference is not implemented yet; heuristic verdict`, and the first call logs a console warning.

## Verdict semantics

| Verdict | Meaning | Widget action |
|---------|---------|----------------|
| `pass` | High-confidence actionable bug | Submit the report. |
| `block` | High-confidence junk | Do not send the report. |
| `unsure` | Ambiguous | Submit anyway — the server LLM is the source of truth. |

The thresholds default to `blockThreshold = 0.20` and `passThreshold = 0.55`. Change them with `createHeuristicClassifier({ blockThreshold, passThreshold })` (the ONNX classifier takes the same options).

## Privacy & telemetry

This package does not transmit any data. It executes entirely inside the browser and returns a result object to the caller. The caller (typically `@mushi-mushi/web`) decides what to do with it.

## License

MIT.


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 77 edge functions · 530 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
