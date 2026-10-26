/**
 * Mushi report 75913f3d: ONNX inference is a stub. The ONNX path must say
 * so at runtime and label every verdict as the heuristic's, whether
 * onnxruntime-web loads or not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const INPUT = { description: 'When I click checkout the page crashes with a 500 error and goes blank' };

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetModules();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.doUnmock('onnxruntime-web');
  vi.restoreAllMocks();
});

function expectExperimentalWarning(): void {
  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0][0])).toMatch(/experimental: ONNX inference is not implemented yet/);
}

describe('createOnnxClassifier (experimental)', () => {
  it('says it falls back when onnxruntime-web cannot load', async () => {
    vi.doMock('onnxruntime-web', () => {
      throw new Error('blocked by CSP');
    });
    const { createOnnxClassifier } = await import('./onnx');
    const c = await createOnnxClassifier({ modelUrl: 'https://cdn.example/model.onnx' });
    const r = await c.classify(INPUT);
    expect(r.modelId).toBe('heuristic-fallback');
    expect(r.reason).toMatch(/^ONNX inference is not implemented yet; heuristic verdict \(/);
    expectExperimentalWarning();
  });

  it('says it falls back even when the model session loads', async () => {
    const create = vi.fn().mockResolvedValue({ run: vi.fn(), release: vi.fn() });
    vi.doMock('onnxruntime-web', () => ({ InferenceSession: { create }, Tensor: class {} }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    const { createOnnxClassifier } = await import('./onnx');
    const c = await createOnnxClassifier({ modelUrl: 'https://cdn.example/model.onnx', preload: true });
    await c.ready;
    const r = await c.classify(INPUT);
    expect(create).toHaveBeenCalledTimes(1);
    expect(r.modelId).toBe('heuristic-fallback');
    expect(r.reason).toMatch(/^ONNX inference is not implemented yet; heuristic verdict \(/);
    expect(['pass', 'unsure', 'block']).toContain(r.verdict);
    expectExperimentalWarning();
  });
});
