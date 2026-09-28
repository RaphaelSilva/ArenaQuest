/**
 * Note limits — the ceiling on a student's topic note body (RFC 0016 section 2).
 *
 * Pure: no I/O, no environment read, no framework import, no provider type. The
 * constant is callable from the Worker, from the web build and from a plain Node
 * script alike.
 *
 * It lives here, rather than beside the API validator, for the reason
 * `domain/media/limits.ts` does: two readers need the same number. The API's
 * write schema rejects a body over the ceiling, and the web editor's character
 * counter shows how close the student is to it. Two literals would drift.
 */

/**
 * Maximum length of a note body, in characters, **counted after sanitisation
 * and trimming** — the length that is actually stored, not the length typed.
 *
 * The lower bound is 1: an empty body is rejected (deleting a note is an
 * explicit action, not a save of nothing).
 */
export const NOTE_BODY_MAX = 20_000;
