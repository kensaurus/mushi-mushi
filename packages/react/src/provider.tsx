import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { MushiConfig, MushiSDKInstance } from '@mushi/core';
import { createLogger } from '@mushi/core';
import { Mushi } from '@mushi/web';

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
  config: MushiConfig;
  children: ReactNode;
}

export function MushiProvider({ config, children }: MushiProviderProps) {
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
