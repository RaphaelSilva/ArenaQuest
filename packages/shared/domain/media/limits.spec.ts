import { describe, expect, it } from 'vitest';
import {
  ALLOWED_MEDIA_TYPES,
  IMAGE_MEDIA_TYPES,
  MEDIA_SIZE_LIMIT_BYTES,
  isAllowedMediaType,
  isImageMediaType,
  mediaSizeLimitFor,
} from './limits';

const MB = 1024 * 1024;

describe('media limits table', () => {
  // The literals below are the pre-extraction values from
  // `admin-media.controller.ts`. They are spelled out rather than derived so a
  // changed ceiling fails here instead of reaching the uploader.
  it('keeps the ceiling of every allowed type', () => {
    expect(mediaSizeLimitFor('application/pdf')).toBe(25 * MB);
    expect(mediaSizeLimitFor('video/mp4')).toBe(100 * MB);
    expect(mediaSizeLimitFor('image/jpeg')).toBe(5 * MB);
    expect(mediaSizeLimitFor('image/png')).toBe(5 * MB);
    expect(mediaSizeLimitFor('image/webp')).toBe(5 * MB);
  });

  it('accepts exactly five types, and every one of them has a ceiling', () => {
    expect([...ALLOWED_MEDIA_TYPES]).toEqual([
      'application/pdf',
      'video/mp4',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
    expect(Object.keys(MEDIA_SIZE_LIMIT_BYTES).sort()).toEqual([...ALLOWED_MEDIA_TYPES].sort());
  });

  it('has no ceiling for an unknown type', () => {
    expect(mediaSizeLimitFor('application/zip')).toBeNull();
    expect(mediaSizeLimitFor('video/quicktime')).toBeNull();
    expect(mediaSizeLimitFor('')).toBeNull();
  });

  it('narrows an allowed type and rejects anything else', () => {
    expect(isAllowedMediaType('image/png')).toBe(true);
    expect(isAllowedMediaType('image/gif')).toBe(false);
  });

  it('treats only the images as flyer-eligible', () => {
    for (const type of IMAGE_MEDIA_TYPES) {
      expect(isImageMediaType(type)).toBe(true);
      expect(MEDIA_SIZE_LIMIT_BYTES[type]).toBe(5 * MB);
    }
    expect(isImageMediaType('application/pdf')).toBe(false);
    expect(isImageMediaType('video/mp4')).toBe(false);
  });
});
