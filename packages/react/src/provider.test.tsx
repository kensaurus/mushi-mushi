import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MushiProvider } from './provider';
import { useMushi, useMushiReady } from './hooks';

vi.mock('@mushi-mushi/web', () => {
  const mockSdk = {
    report: vi.fn(),
    on: vi.fn(() => () => {}),
    setUser: vi.fn(),
    setMetadata: vi.fn(),
    isOpen: vi.fn(() => false),
    open: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
  };

  return {
    Mushi: {
      init: vi.fn(() => mockSdk),
      getInstance: vi.fn(() => mockSdk),
      destroy: vi.fn(),
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function TestConsumer() {
  const sdk = useMushi();
  const ready = useMushiReady();
  return (
    <div>
      <span data-testid="ready">{String(ready)}</span>
      <span data-testid="has-sdk">{String(sdk !== null)}</span>
    </div>
  );
}

describe('MushiProvider', () => {
  const testConfig = {
    projectId: 'proj_test',
    apiKey: 'mushi_test_key',
  };

  it('renders children', () => {
    render(
      <MushiProvider config={testConfig}>
        <div data-testid="child">Hello</div>
      </MushiProvider>,
    );
    expect(screen.getByTestId('child')).toBeDefined();
  });

  it('provides SDK instance to consumers', () => {
    render(
      <MushiProvider config={testConfig}>
        <TestConsumer />
      </MushiProvider>,
    );
    expect(screen.getByTestId('has-sdk').textContent).toBe('true');
  });

  it('sets isReady to true after init', () => {
    render(
      <MushiProvider config={testConfig}>
        <TestConsumer />
      </MushiProvider>,
    );
    expect(screen.getByTestId('ready').textContent).toBe('true');
  });
});
