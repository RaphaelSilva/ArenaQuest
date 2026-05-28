import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { DictProvider } from '../../context/dict-context';
import { dictPt } from '../dict-pt';
import { dictEn } from '../dict-en';

describe('i18n plumbing', () => {
  const originalEnv = process.env.NEXT_PUBLIC_LANGUAGE;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let warnSpy: any;

  beforeEach(() => {
    vi.resetModules();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_LANGUAGE = originalEnv;
    warnSpy.mockRestore();
  });

  describe('getLanguageFromEnv', () => {
    it('returns en when env variable is en', async () => {
      process.env.NEXT_PUBLIC_LANGUAGE = 'en';
      const { getLanguageFromEnv } = await import('../config');
      const lang = getLanguageFromEnv();
      expect(lang).toBe('en');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('returns pt when env variable is pt', async () => {
      process.env.NEXT_PUBLIC_LANGUAGE = 'pt';
      const { getLanguageFromEnv } = await import('../config');
      const lang = getLanguageFromEnv();
      expect(lang).toBe('pt');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('falls back to pt and warns when env variable is invalid', async () => {
      process.env.NEXT_PUBLIC_LANGUAGE = 'invalid';
      const { getLanguageFromEnv } = await import('../config');
      const lang = getLanguageFromEnv();
      expect(lang).toBe('pt');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('NEXT_PUBLIC_LANGUAGE is invalid or missing')
      );
    });

    it('falls back to pt and warns when env variable is missing', async () => {
      delete process.env.NEXT_PUBLIC_LANGUAGE;
      const { getLanguageFromEnv } = await import('../config');
      const lang = getLanguageFromEnv();
      expect(lang).toBe('pt');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('NEXT_PUBLIC_LANGUAGE is invalid or missing')
      );
    });
  });

  describe('DictProvider and useDict', () => {
    it('renders provider with default PT dictionary successfully', async () => {
      const { useDict } = await import('../../context/dict-context');
      function TestComponent() {
        const dict = useDict();
        return <div>{dict.common.confirm}</div>;
      }
      render(
        <DictProvider>
          <TestComponent />
        </DictProvider>
      );
      expect(screen.getByText(dictPt.common.confirm)).toBeInTheDocument();
    });

    it('renders provider with explicitly supplied EN dictionary', async () => {
      const { useDict } = await import('../../context/dict-context');
      function TestComponent() {
        const dict = useDict();
        return <div>{dict.common.confirm}</div>;
      }
      render(
        <DictProvider value={dictEn}>
          <TestComponent />
        </DictProvider>
      );
      expect(screen.getByText(dictEn.common.confirm)).toBeInTheDocument();
    });

    it('throws error when useDict is used outside of provider', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { useDict: originalUseDict } = await vi.importActual<any>('../../context/dict-context');
      function TestComponentOriginal() {
        const dict = originalUseDict();
        return <div>{dict.common.confirm}</div>;
      }
      
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      expect(() => render(<TestComponentOriginal />)).toThrow(
        'useDict must be used within a DictProvider'
      );
      
      consoleErrorSpy.mockRestore();
    });
  });
});
