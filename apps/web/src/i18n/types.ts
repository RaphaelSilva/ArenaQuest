import type { dictPt } from './dict-pt';

type Broaden<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
  ? { readonly [K in keyof T]: Broaden<T[K]> }
  : string;

export type Dictionary = Broaden<typeof dictPt>;
