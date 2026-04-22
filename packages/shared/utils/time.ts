const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR   = 60 * MS_PER_MINUTE;
const MS_PER_DAY    = 24 * MS_PER_HOUR;
const MS_PER_WEEK   = 7  * MS_PER_DAY;

const TIME_UNITS = {
  ms:      1,
  seconds: MS_PER_SECOND,
  minutes: MS_PER_MINUTE,
  hours:   MS_PER_HOUR,
  days:    MS_PER_DAY,
  weeks:   MS_PER_WEEK,
} as const;

type TimeUnit = keyof typeof TIME_UNITS;

export const toMilliseconds = (value: number, unit: TimeUnit): number =>
  value * TIME_UNITS[unit];