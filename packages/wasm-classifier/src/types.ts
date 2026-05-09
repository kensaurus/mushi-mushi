export type ClassificationVerdict = 'pass' | 'block' | 'unsure';

export interface ClassificationInput {
  description: string;
  category?: string;
  url?: string;
  hasScreenshot?: boolean;
  hasSelectedElement?: boolean;
  hasNetworkErrors?: boolean;
  hasConsoleErrors?: boolean;
  proactiveTrigger?: string;
}

/**
 * Well-known model identifiers. `string` is also valid for custom models.
 * - `'heuristic'` / `'heuristic-fallback'`: keyword-based fallback (no ONNX runtime required).
 * - `'phi-3-mini-onnx-int4'`: quantized Phi-3-mini served from a CDN (requires onnxruntime-web).
 */
export type KnownModelId = 'heuristic' | 'heuristic-fallback' | 'phi-3-mini-onnx-int4';

export interface ClassificationResult {
  verdict: ClassificationVerdict;
  confidence: number;
  reason: string;
  predictedCategory?: string;
  /** @see KnownModelId for well-known values. */
  modelId: KnownModelId | string;
  durationMs: number;
}

export interface WasmClassifier {
  readonly modelId: KnownModelId | string;
  readonly ready: Promise<void>;
  classify(input: ClassificationInput): Promise<ClassificationResult>;
  destroy(): void;
}

export interface ClassifierOptions {
  blockThreshold?: number;
  passThreshold?: number;
  maxLatencyMs?: number;
}
