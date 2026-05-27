import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import { dictPt } from './src/i18n/dict-pt';

// Mock useDict globally to return dictPt when no provider is present
vi.mock('@web/context/dict-context', async (importOriginal) => {
  const original = await importOriginal<typeof import('@web/context/dict-context')>();
  return {
    ...original,
    useDict: () => {
      try {
        return original.useDict();
      } catch {
        return dictPt;
      }
    },
  };
});
