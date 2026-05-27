import type { dictPt } from './dict-pt';

type Broaden<T> = T extends (...args: unknown[]) => unknown
  ? T
  : T extends object
  ? { readonly [K in keyof T]: Broaden<T[K]> }
  : string;

export type Dictionary = Broaden<typeof dictPt>;
