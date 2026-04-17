# @mushi-mushi/wasm-classifier

> On-device pre-classification for Mushi Mushi reports — filter obvious junk before the report ever leaves the browser.

This is the V5.3 §2.12 lead-spec implementation of the **WASM On-Device Pre-Classification** layer. It runs in two modes:

1. **Heuristic mode** (default, zero deps, ~1 KB gz) — pattern-based score over the description, attached signals, and proactive triggers. Always available.
2. **ONNX mode** — lazy-loads `onnxruntime-web` (peer dep) and a quantized small language model (typically Phi-3-mini int4) hosted on a CDN. Falls back to heuristic mode automatically if the runtime, model, or WebGPU/WASM backend is unavailable.

## Why

The V5 architecture ships every report to the server for two-stage LLM classification. That works, but:

- **Cost** — even at $0.002/report, a busy app with 100K reports/month is $200/month of LLM spend on reports the server is going to dismiss anyway ("hi", "test", "asdf", a single emoji).
- **Privacy** — reports flagged as obvious junk shouldn't be transmitted. Filtering them on-device keeps them out of audit logs and out of the LLM provider's hands.
- **Latency** — a sub-50 ms verdict in the widget lets us tell the user "we need a bit more detail" before they hit submit, which is a much better UX than a silent 200-ms server roundtrip.

The wasm-classifier sits between the widget's `Submit` button and the API client. If it returns `block`, the widget asks the user to elaborate. If it returns `pass`, the report is sent. If it returns `unsure`, the report is sent and the server LLM does the work.

## Install

```bash
npm install @mushi-mushi/wasm-classifier
# Optional, only if you want the ONNX backend:
npm install onnxruntime-web
```

## Usage — heuristic mode (zero deps)

```ts
import { createHeuristicClassifier } from '@mushi-mushi/wasm-classifier';

const classifier = createHeuristicClassifier();

const result = await classifier.classify({
  description: 'When I click checkout the page crashes with a 500',
  hasNetworkErrors: true,
});

if (result.verdict === 'block') {
  // Tell the user to elaborate — do NOT submit.
} else {
  await api.submitReport(report);
}
```

## Usage — ONNX mode

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

## Wiring into the widget

The browser SDK (`@mushi-mushi/web`) accepts a classifier in `config.preFilter.wasmClassifier`. When set, it is consulted **before** the existing pattern-based pre-filter:

```ts
import { Mushi } from '@mushi-mushi/web';
import { createHeuristicClassifier } from '@mushi-mushi/wasm-classifier';

Mushi.init({
  projectId: 'proj_…',
  apiKey: '…',
  preFilter: {
    wasmClassifier: createHeuristicClassifier(),
  },
});
```

## Hosting the ONNX model

This package intentionally does **not** bundle the model file. Recommended workflow:

1. Train a small classification head on top of [Phi-3-mini-4k-instruct-onnx](https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-onnx) using your own labelled report data (the LLM-as-Judge corpus from V5 §2.7 is a great starting set).
2. Quantize to int4 with [onnxruntime quantization tools](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html). Target file size: ≤ 100 MB so it caches in the browser CacheStorage.
3. Host on a CDN with long `Cache-Control` (e.g. `public, max-age=31536000, immutable`) and a versioned URL.
4. Pass the URL as `modelUrl`. Set `cacheKey` so re-visits skip re-downloading.

Until that custom head is in place, the ONNX backend delegates to the heuristic backend and reports `modelId: 'phi-3-mini-onnx-int4'` with the heuristic reason annotated.

## Verdict semantics

| Verdict | Meaning | Widget action |
|---------|---------|----------------|
| `pass` | High-confidence actionable bug | Submit the report. |
| `block` | High-confidence junk | Refuse submission, ask for more detail. |
| `unsure` | Ambiguous | Submit anyway — the server LLM is the source of truth. |

The thresholds default to `blockThreshold = 0.20` and `passThreshold = 0.55`. Both are tunable per project.

## Privacy & telemetry

This package does not transmit any data. It executes entirely inside the browser and returns a result object to the caller. The caller (typically `@mushi-mushi/web`) decides what to do with it.

## License

MIT.
