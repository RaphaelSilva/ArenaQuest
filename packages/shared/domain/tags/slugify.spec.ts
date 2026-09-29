import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { slugify } from './slugify';

const fixtures: { input: string; slug: string }[] = JSON.parse(
  readFileSync(join(__dirname, 'slugify.fixtures.json'), 'utf8'),
);

describe('slugify', () => {
  it.each(fixtures)('slugifies $input -> "$slug"', ({ input, slug }) => {
    expect(slugify(input)).toBe(slug);
  });

  it('yields an empty string for an all-punctuation name', () => {
    expect(slugify('!!!')).toBe('');
  });
});
