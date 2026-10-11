import type { Dictionary } from '@web/i18n/types';

type MissionsDict = Dictionary['missions'];

/**
 * The calendar day of an API timestamp as a short dictionary-driven date
 * ("Oct 31" / "31 de out"), or `null` when the value is not a date.
 * Locale-agnostic on purpose: the i18n spec defers `Intl` formatting, so the
 * month name comes from the dictionary and the day from the `YYYY-MM-DD` prefix.
 */
export function formatMissionDate(value: string | null | undefined, d: MissionsDict): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const month = d.months[Number(match[2]) - 1];
  const day = Number(match[3]);
  if (!month || day < 1 || day > 31) return null;
  return d.window.date(month, day);
}
