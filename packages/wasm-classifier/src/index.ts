// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
export type {
  ClassificationInput,
  ClassificationResult,
  ClassificationVerdict,
  ClassifierOptions,
  WasmClassifier,
} from './types';

export { createHeuristicClassifier, type HeuristicClassifierOptions } from './heuristic';
export { createOnnxClassifier, type OnnxClassifierConfig } from './onnx';
