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

export interface ClassificationResult {
  verdict: ClassificationVerdict;
  confidence: number;
  reason: string;
  predictedCategory?: string;
  modelId: string;
  durationMs: number;
}

export interface WasmClassifier {
  readonly modelId: string;
  readonly ready: Promise<void>;
  classify(input: ClassificationInput): Promise<ClassificationResult>;
  destroy(): void;
}

export interface ClassifierOptions {
  blockThreshold?: number;
  passThreshold?: number;
  maxLatencyMs?: number;
}
