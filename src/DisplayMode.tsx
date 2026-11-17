import { createContext, useContext, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { finishAnimations } from './motion-primitives';

export type DisplayMode = 'normal' | 'performance';
const PerformanceMode = createContext(false);

export function DisplayModeProvider({ mode, children }: { mode: DisplayMode; children: ReactNode }) {
  useLayoutEffect(() => {
    document.documentElement.dataset.displayMode = mode;
    if (mode === 'performance') finishAnimations();
    return () => { delete document.documentElement.dataset.displayMode; };
  }, [mode]);
  return <PerformanceMode.Provider value={mode === 'performance'}>{children}</PerformanceMode.Provider>;
}

export const usePerformanceMode = () => useContext(PerformanceMode);
