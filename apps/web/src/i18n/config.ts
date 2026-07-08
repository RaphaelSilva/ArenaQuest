export type Language = 'en' | 'pt';

export const DEFAULT_LANGUAGE: Language = 'pt';

const VALID_LANGUAGES: readonly Language[] = ['en', 'pt'];

let warningShown = false;

export function getLanguageFromEnv(): Language {
  const envValue = process.env.NEXT_PUBLIC_LANGUAGE;

  if (envValue && VALID_LANGUAGES.includes(envValue as Language)) {
    return envValue as Language;
  }

  if (!warningShown) {
    console.warn(
      '[i18n] NEXT_PUBLIC_LANGUAGE is invalid or missing, falling back to PT.'
    );
    warningShown = true;
  }

  return DEFAULT_LANGUAGE;
}
