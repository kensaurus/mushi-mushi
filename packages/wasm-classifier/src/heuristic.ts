import type {
  ClassificationInput,
  ClassificationResult,
  ClassifierOptions,
  WasmClassifier,
} from './types';

const STRONG_BUG_SIGNALS = [
  /\berror\b/i,
  /\bcrash(ed|es|ing)?\b/i,
  /\bbroken?\b/i,
  /\bdoesn'?t work\b/i,
  /\bnot working\b/i,
  /\bcan'?t (?:click|see|use|find|submit|login|log in)\b/i,
  /\bfreeze[sd]?\b/i,
  /\bhang(?:s|ing)?\b/i,
  /\bblank (?:page|screen)\b/i,
  /\b404\b/,
  /\b500\b/,
  /\bundefined\b/i,
  /\bNaN\b/,
  /\boverlap(?:s|ping)?\b/i,
  /\bmisaligned\b/i,
  /\bcut off\b/i,
  /\boff[- ]screen\b/i,
];

const WEAK_BUG_SIGNALS = [
  /\bslow\b/i,
  /\blag(?:gy|s|ging)?\b/i,
  /\bweird\b/i,
  /\bstrange\b/i,
  /\bconfus(?:ed|ing)\b/i,
  /\bfrustrat(?:ing|ed)\b/i,
  /\bwhy (?:does|is|can'?t|won'?t)\b/i,
];

const JUNK_SIGNALS = [
  /^[a-z]{1,3}$/i,
  /^test+$/i,
  /^hi+$/i,
  /^hello+$/i,
  /^[\W_]+$/,
  /^([a-z])\1{4,}$/i,
];

const SPAM_URL = /https?:\/\/[^\s]+/i;

export interface HeuristicClassifierOptions extends ClassifierOptions {
  weights?: Partial<{
    strongSignal: number;
    weakSignal: number;
    junk: number;
    screenshot: number;
    element: number;
    networkError: number;
    consoleError: number;
    proactiveTrigger: number;
    spamUrl: number;
    veryShort: number;
    veryLong: number;
  }>;
}

const DEFAULT_WEIGHTS = {
  strongSignal: 0.35,
  weakSignal: 0.15,
  junk: -0.6,
  screenshot: 0.1,
  element: 0.1,
  networkError: 0.2,
  consoleError: 0.2,
  proactiveTrigger: 0.25,
  spamUrl: -0.3,
  veryShort: -0.4,
  veryLong: -0.05,
};

export function createHeuristicClassifier(
  options: HeuristicClassifierOptions = {},
): WasmClassifier {
  const blockThreshold = options.blockThreshold ?? 0.2;
  const passThreshold = options.passThreshold ?? 0.55;
  const w = { ...DEFAULT_WEIGHTS, ...options.weights };
  const ready = Promise.resolve();

  function classifyImpl(input: ClassificationInput): ClassificationResult {
    const start = perfNow();
    const text = input.description.trim();
    const length = text.length;

    if (length < 5) {
      return {
        verdict: 'block',
        confidence: 0.95,
        reason: 'Description too short to be meaningful (<5 chars)',
        modelId: 'heuristic-v1',
        durationMs: perfNow() - start,
      };
    }

    if (JUNK_SIGNALS.some((p) => p.test(text))) {
      return {
        verdict: 'block',
        confidence: 0.9,
        reason: 'Matches obvious-junk pattern',
        modelId: 'heuristic-v1',
        durationMs: perfNow() - start,
      };
    }

    let score = 0.4;

    for (const p of STRONG_BUG_SIGNALS) if (p.test(text)) score += w.strongSignal;
    for (const p of WEAK_BUG_SIGNALS) if (p.test(text)) score += w.weakSignal;

    if (input.hasScreenshot) score += w.screenshot;
    if (input.hasSelectedElement) score += w.element;
    if (input.hasNetworkErrors) score += w.networkError;
    if (input.hasConsoleErrors) score += w.consoleError;
    if (input.proactiveTrigger) score += w.proactiveTrigger;
    if (SPAM_URL.test(text)) score += w.spamUrl;
    if (length < 20) score += w.veryShort;
    if (length > 1500) score += w.veryLong;

    const confidence = clamp(score, 0, 1);

    let verdict: ClassificationResult['verdict'];
    let reason: string;

    if (confidence < blockThreshold) {
      verdict = 'block';
      reason = 'Low signal: heuristics suggest non-actionable report';
    } else if (confidence >= passThreshold) {
      verdict = 'pass';
      reason = 'Strong bug signal detected';
    } else {
      verdict = 'unsure';
      reason = 'Ambiguous signal — defer to server LLM';
    }

    return {
      verdict,
      confidence,
      reason,
      modelId: 'heuristic-v1',
      durationMs: perfNow() - start,
    };
  }

  return {
    modelId: 'heuristic-v1',
    ready,
    async classify(input) {
      return classifyImpl(input);
    },
    destroy() {},
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function perfNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
