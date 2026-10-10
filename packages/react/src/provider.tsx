import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { MushiInitConfig, MushiSDKInstance } from '@mushi-mushi/core';
import { createLogger } from '@mushi-mushi/core';
import { Mushi } from '@mushi-mushi/web';

const log = createLogger({ scope: 'mushi:react' });

interface MushiContextValue {
  sdk: MushiSDKInstance | null;
  isReady: boolean;
}

const MushiContext = createContext<MushiContextValue>({
  sdk: null,
  isReady: false,
});

export interface MushiProviderProps {
  /** Credentials may be omitted when NEXT_PUBLIC_MUSHI_* / VITE_MUSHI_* env vars supply them. */
  config?: MushiInitConfig;
  children: ReactNode;
}

export function MushiProvider({ config = {}, children }: MushiProviderProps) {
  const [isReady, setIsReady] = useState(false);
  const sdkRef = useRef<MushiSDKInstance | null>(null);

  useEffect(() => {
    if (sdkRef.current) return;

    try {
      sdkRef.current = Mushi.init(config);
      setIsReady(true);
    } catch (error) {
      log.error('Failed to initialize', { err: String(error) });
    }

    return () => {
      sdkRef.current?.destroy();
      sdkRef.current = null;
      setIsReady(false);
    };
  }, [config.projectId]);

  return (
    <MushiContext.Provider value={{ sdk: sdkRef.current, isReady }}>
      {children}
    </MushiContext.Provider>
  );
}

export function useMushiContext(): MushiContextValue {
  return useContext(MushiContext);
}
