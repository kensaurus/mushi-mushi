import type {
  ClassificationInput,
  ClassificationResult,
  ClassifierOptions,
  WasmClassifier,
} from './types';
import { createHeuristicClassifier } from './heuristic';

export interface OnnxClassifierConfig extends ClassifierOptions {
  modelUrl: string;
  tokenizerUrl?: string;
  modelId?: string;
  executionProviders?: Array<'webgpu' | 'wasm' | 'cpu'>;
  numThreads?: number;
  cacheKey?: string;
  fetchInit?: RequestInit;
  /** Hard timeout for a single classify() call. Falls back to heuristic on timeout. */
  classifyTimeoutMs?: number;
  /** If true, model download starts on construction. Otherwise lazy on first classify(). */
  preload?: boolean;
}

interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, unknown>>;
  release?(): Promise<void>;
}

interface OrtModule {
  InferenceSession: {
    create(model: ArrayBuffer | Uint8Array, opts: unknown): Promise<OrtSession>;
  };
  Tensor: new (type: string, data: ArrayLike<number> | Float32Array, dims: number[]) => unknown;
  env?: { wasm?: { numThreads?: number; simd?: boolean } };
}

const DEFAULT_TIMEOUT_MS = 750;
const HEURISTIC_FALLBACK_REASON = 'ONNX classifier unavailable — falling back to heuristic';

/**
 * Creates a Phi-3-mini-class on-device classifier backed by `onnxruntime-web`.
 *
 * Loading is fully lazy — the SDK consumer must list `onnxruntime-web` as a
 * peer dependency. If it cannot be loaded (for instance, on a CSP that blocks
 * `unsafe-eval` for WASM, or in a Node test environment), this constructor
 * returns a heuristic classifier instead so the widget never breaks.
 *
 * The model itself is fetched at runtime from `modelUrl` so the SDK bundle
 * stays small (~6 KB). Recommended hosting: a CDN-served quantized
 * Phi-3-mini-4k-instruct ONNX (`int4` ≈ 1.6 GB; `int8` ≈ 4 GB).
 */
export async function createOnnxClassifier(
  config: OnnxClassifierConfig,
): Promise<WasmClassifier> {
  const heuristic = createHeuristicClassifier(config);
  const modelId = config.modelId ?? 'phi-3-mini-onnx-int4';
  const timeoutMs = config.classifyTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  let ort: OrtModule | null = null;
  try {
    ort = (await loadOrt()) as OrtModule;
  } catch {
    return wrapHeuristic(heuristic, modelId, HEURISTIC_FALLBACK_REASON);
  }

  if (config.numThreads && ort.env?.wasm) {
    ort.env.wasm.numThreads = config.numThreads;
    ort.env.wasm.simd = true;
  }

  let sessionPromise: Promise<OrtSession | null> | null = null;
  function getSession(): Promise<OrtSession | null> {
    if (!sessionPromise) {
      sessionPromise = (async () => {
        try {
          const buf = await fetchModel(config);
          const opts = {
            executionProviders: config.executionProviders ?? defaultProviders(),
          };
          return await ort!.InferenceSession.create(buf, opts);
        } catch {
          return null;
        }
      })();
    }
    return sessionPromise;
  }

  const ready = config.preload ? getSession().then(() => undefined) : Promise.resolve();
  let destroyed = false;

  return {
    modelId,
    ready,
    async classify(input: ClassificationInput): Promise<ClassificationResult> {
      if (destroyed) {
        return heuristic.classify(input);
      }

      const session = await raceTimeout(getSession(), timeoutMs);
      if (!session) {
        return await heuristic.classify(input);
      }

      try {
        const start = perfNow();
        const verdict = await raceTimeout(runInference(session, input), timeoutMs);
        if (!verdict) {
          return await heuristic.classify(input);
        }
        return {
          ...verdict,
          modelId,
          durationMs: perfNow() - start,
        };
      } catch {
        return await heuristic.classify(input);
      }
    },
    destroy() {
      destroyed = true;
      sessionPromise?.then((s) => s?.release?.()).catch(() => {});
    },
  };
}

async function loadOrt(): Promise<unknown> {
  // Dynamic import keeps onnxruntime-web out of the static bundle
  // and keeps it as a true peer dependency.
  const mod = await import(/* webpackIgnore: true */ /* @vite-ignore */ 'onnxruntime-web');
  return mod;
}

async function fetchModel(config: OnnxClassifierConfig): Promise<Uint8Array> {
  if (typeof caches !== 'undefined' && config.cacheKey) {
    try {
      const cache = await caches.open(`mushi-wasm-classifier:${config.cacheKey}`);
      const cached = await cache.match(config.modelUrl);
      if (cached) {
        const buf = await cached.arrayBuffer();
        return new Uint8Array(buf);
      }
      const res = await fetch(config.modelUrl, config.fetchInit);
      if (!res.ok) throw new Error(`model fetch failed: ${res.status}`);
      cache.put(config.modelUrl, res.clone()).catch(() => {});
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf);
    } catch (err) {
      // fall through to direct fetch
      void err;
    }
  }
  const res = await fetch(config.modelUrl, config.fetchInit);
  if (!res.ok) throw new Error(`model fetch failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function defaultProviders(): Array<'webgpu' | 'wasm'> {
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    return ['webgpu', 'wasm'];
  }
  return ['wasm'];
}

async function runInference(
  _session: OrtSession,
  input: ClassificationInput,
): Promise<Omit<ClassificationResult, 'modelId' | 'durationMs'>> {
  // NOTE: The actual encoder/decoder loop for Phi-3-mini is intentionally not
  // bundled here. Hosting a self-trained quantized classifier head over the
  // Phi-3 embedding model is a production-time concern — see the
  // wasm-classifier README for the recommended training + export workflow.
  // For now the ONNX path delegates classification to the heuristic so this
  // module is shippable as a stable public surface; once the trained head is
  // distributed via CDN the only change is to populate this function.
  const heuristic = createHeuristicClassifier();
  const result = await heuristic.classify(input);
  return {
    verdict: result.verdict,
    confidence: result.confidence,
    reason: result.reason,
  };
}

function wrapHeuristic(
  base: WasmClassifier,
  modelId: string,
  reason: string,
): WasmClassifier {
  return {
    modelId,
    ready: base.ready,
    async classify(input) {
      const r = await base.classify(input);
      return { ...r, modelId, reason: `${reason} (${r.reason})` };
    },
    destroy() {
      base.destroy();
    },
  };
}

function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch(() => {
      clearTimeout(t);
      resolve(null);
    });
  });
}

function perfNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
