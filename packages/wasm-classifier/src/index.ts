export type {
  ClassificationInput,
  ClassificationResult,
  ClassificationVerdict,
  ClassifierOptions,
  WasmClassifier,
} from './types';

export { createHeuristicClassifier, type HeuristicClassifierOptions } from './heuristic';
export { createOnnxClassifier, type OnnxClassifierConfig } from './onnx';
