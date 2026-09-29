import { tokenize } from '../search/normalize';

/** Tag slug: the normalised tokens of the name joined with `-`. May be `''`. */
export function slugify(name: string): string {
  return tokenize(name).join('-');
}
