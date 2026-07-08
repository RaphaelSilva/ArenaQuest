'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Dictionary } from '@web/i18n/types';
import { getLanguageFromEnv } from '@web/i18n/config';
import { dictPt } from '@web/i18n/dict-pt';
import { dictEn } from '@web/i18n/dict-en';

const DictContext = createContext<Dictionary | null>(null);

export function DictProvider({ children, value }: { children: ReactNode; value?: Dictionary }) {
  const resolvedValue = value ?? (getLanguageFromEnv() === 'en' ? dictEn : dictPt);
  return <DictContext.Provider value={resolvedValue}>{children}</DictContext.Provider>;
}

export function useDict() {
  const context = useContext(DictContext);
  if (!context) {
    throw new Error('useDict must be used within a DictProvider');
  }
  return context;
}
