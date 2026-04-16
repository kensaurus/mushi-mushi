import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Mushi } from '@mushi-mushi/web';

export interface MushiErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface MushiErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class MushiErrorBoundary extends Component<
  MushiErrorBoundaryProps,
  MushiErrorBoundaryState
> {
  constructor(props: MushiErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): MushiErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const sdk = Mushi.getInstance();
    if (sdk) {
      sdk.setMetadata('errorBoundary', {
        error: error.message,
        stack: error.stack?.slice(0, 2000),
        componentStack: errorInfo.componentStack?.slice(0, 2000),
      });
    }

    this.props.onError?.(error, errorInfo);
  }

  private reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const { fallback } = this.props;
      if (typeof fallback === 'function') {
        return fallback(this.state.error!, this.reset);
      }
      return fallback ?? null;
    }

    return this.props.children;
  }
}
