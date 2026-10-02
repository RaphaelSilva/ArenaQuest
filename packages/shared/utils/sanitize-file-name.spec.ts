import { describe, expect, it } from 'vitest';
import { sanitizeFileName } from './sanitize-file-name';

// Golden outputs computed from the implementation as it lived in
// `apps/api/src/controllers/admin-media.controller.ts` before the move
// (RFC 0020 §2). A changed value here changes every new storage key.
const GOLDEN: ReadonlyArray<[string, string]> = [
  // Inputs of the admin-media controller spec.
  ['My Document.pdf', 'my-document.pdf'],
  ['lecture.mp4', 'lecture.mp4'],
  ['huge.pdf', 'huge.pdf'],
  ['limit.pdf', 'limit.pdf'],
  ['big.jpeg', 'big.jpeg'],
  ['huge.mp4', 'huge.mp4'],
  // Phone and backup-shaped names.
  ['IMG_0042.MOV', 'img_0042.mov'],
  ['  --Hello  World--.PNG', 'hello-world-.png'],
  ['Chūdan Jō.mov', 'ch-dan-j-.mov'],
  ['Ro Ryu – Taki.mp4', 'ro-ryu-taki.mp4'],
  ['../../etc/passwd', '..-..-etc-passwd'],
  ['', 'file'],
  ['!!!', 'file'],
];

describe('sanitizeFileName', () => {
  it.each(GOLDEN)('maps %j to %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('caps the slug at 100 characters, even at the cost of the extension', () => {
    expect(sanitizeFileName('a'.repeat(150) + '.pdf')).toBe('a'.repeat(100));
  });

  it('always yields a non-empty slug of safe characters with no slash or double hyphen', () => {
    for (const [input] of GOLDEN) {
      const out = sanitizeFileName(input);
      expect(out).toMatch(/^[a-z0-9._-]{1,100}$/);
      expect(out).not.toContain('--');
      expect(out).not.toContain('/');
    }
  });
});
