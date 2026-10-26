---
'@mushi-mushi/wasm-classifier': patch
---

`createOnnxClassifier()` is now marked experimental in its type docs, the README, the package description and the docs site. Model inference is not implemented yet, and it now says so at runtime: one console warning on creation, and every verdict carries `modelId: 'heuristic-fallback'` and a reason starting "ONNX inference is not implemented yet; heuristic verdict", including when the model session loads. Use `createHeuristicClassifier()` for the same verdicts without the download. The docs page also stops showing a `useWasmClassifier` API that does not exist.
