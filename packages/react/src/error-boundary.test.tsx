import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MushiErrorBoundary } from './error-boundary';

vi.mock('@mushi-mushi/web', () => ({
  Mushi: {
    getInstance: vi.fn(() => ({
      setMetadata: vi.fn(),
    })),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function ThrowingComponent({ error }: { error: Error }) {
  throw error;
}

function GoodComponent() {
  return <div data-testid="good">Working</div>;
}

describe('MushiErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <MushiErrorBoundary>
        <GoodComponent />
      </MushiErrorBoundary>,
    );
    expect(screen.getByTestId('good')).toBeDefined();
  });

  it('renders fallback ReactNode when error occurs', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <MushiErrorBoundary fallback={<div data-testid="fallback">Error occurred</div>}>
        <ThrowingComponent error={new Error('test crash')} />
      </MushiErrorBoundary>,
    );

    expect(screen.getByTestId('fallback')).toBeDefined();
    spy.mockRestore();
  });

  it('calls onError callback when error occurs', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();

    render(
      <MushiErrorBoundary onError={onError} fallback={<div>Error</div>}>
        <ThrowingComponent error={new Error('callback test')} />
      </MushiErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe('callback test');
    spy.mockRestore();
  });

  it('renders fallback function with error and reset', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <MushiErrorBoundary
        fallback={(error, _reset) => (
          <div data-testid="fn-fallback">{error.message}</div>
        )}
      >
        <ThrowingComponent error={new Error('fn test')} />
      </MushiErrorBoundary>,
    );

    expect(screen.getByTestId('fn-fallback').textContent).toBe('fn test');
    spy.mockRestore();
  });
});
