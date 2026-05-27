'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Dictionary } from '@web/i18n/types';

const DictContext = createContext<Dictionary | null>(null);

export function DictProvider({ children, value }: { children: ReactNode; value: Dictionary }) {
  return <DictContext.Provider value={value}>{children}</DictContext.Provider>;
}

export function useDict() {
  const context = useContext(DictContext);
  if (!context) {
    throw new Error('useDict must be used within a DictProvider');
  }
  return context;
}
