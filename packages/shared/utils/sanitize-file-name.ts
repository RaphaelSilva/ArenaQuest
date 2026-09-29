/**
 * Converts an arbitrary filename into a safe, lowercase, hyphenated slug for a
 * storage key. Shared by backoffice media, event flyers and student
 * submissions (RFC 0020 §2). Output is pinned by tests: changing it changes
 * every new storage key.
 */
export function sanitizeFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return slug || 'file';
}
