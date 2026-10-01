import type {
  AuthoredSubmissionRecord,
  IEnrollmentRepository,
  MoveRefusal,
  NoteCursorKey,
  IRateLimiter,
  IStorageAdapter,
  ISubmissionRepository,
  ITopicNodeRepository,
  SubmissionRecord,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { ROLES } from '@arenaquest/shared/constants/roles';
import {
  isSubmissionVideoType,
  mediaSizeLimitFor,
  type SubmissionMediaType,
} from '@arenaquest/shared/domain/media/limits';
import {
  SUBMISSION_DESCRIPTION_MAX,
  SUBMISSION_TITLE_MAX,
} from '@arenaquest/shared/domain/submissions/limits';
import { sanitizeMarkdown } from '@arenaquest/shared/utils/sanitize-markdown';
import { sanitizeFileName } from '@arenaquest/shared/utils/sanitize-file-name';
import type { SubmissionConfig, SubmissionConfigResult } from '@api/core/submissions/config';
import type { ControllerResult } from '@api/core/result';

/** Lifetime of the presigned PUT (RFC 0020 §5), in seconds. */
export const SUBMISSION_UPLOAD_URL_TTL_SECONDS = 3600;

/** Lifetime of a signed GET URL on a ready submission (RFC 0020 §2), in seconds. */
export const SUBMISSION_DOWNLOAD_URL_TTL_SECONDS = 3600;

/** Page size of every submission listing (RFC 0020 §10). */
export const SUBMISSIONS_PAGE_SIZE = 20;

/** Most ids one move request may carry (RFC 0020 §6). */
export const SUBMISSION_MOVE_MAX_IDS = 10;

/** Leading bytes read at finalize for the signature check — never the whole object. */
export const SUBMISSION_SIGNATURE_BYTES = 32;

const { READY, REMOVED } = Entities.Config.SubmissionStatus;
const { PRIVATE, SHARED } = Entities.Config.ShareVisibility;

/** The authenticated caller; roles are resolved into an audience here, never taken from the request. */
export interface SubmissionCaller {
  userId: string;
  roles: readonly string[];
}

/** A submission as the API returns it: no storage key, moderation reduced to a flag. */
export type Submission = Entities.Engagement.Submission;

/**
 * A submission as a reader receives it: `isMine` flags the caller's own, and
 * `url` is a signed GET (TTL 1 h) on a ready submission — null otherwise.
 */
export type SubmissionView = Submission & { isMine: boolean; url: string | null };

/** One row of "My demonstrations": the caller's own submission plus its topic. */
export type AuthoredSubmission = Submission & {
  url: string | null;
  topicTitle: string;
  /** False when the topic is no longer readable: read-only except delete and move. */
  topicAccessible: boolean;
};

/**
 * A submission as staff receive it: the reader view plus the provenance staff
 * need as their only audit trail (RFC 0020 §8) — who force-unshared it and
 * when, who removed it.
 */
export type StaffSubmissionView = SubmissionView & {
  moderatedAt: string | null;
  moderatedBy: string | null;
  removedBy: string | null;
  removedByName: string | null;
};

/** One row of the staff per-student list: the staff view plus its topic. */
export type StaffAuthoredSubmission = StaffSubmissionView & { topicTitle: string };

/** One keyset page; the router encodes `nextCursor` into its opaque wire form. */
export interface SubmissionPage<T> {
  data: T[];
  nextCursor: NoteCursorKey | null;
}

/** Scopes of the topic listing; `all` is staff-only (RFC 0020 §10). */
export type TopicListScope = 'mine' | 'class' | 'all';

export interface MoveSubmissionsInput {
  ids: string[];
  targetTopicId: string;
}

export interface MoveSubmissionsResult {
  moved: Submission[];
  refused: MoveRefusal[];
}

export interface PresignSubmissionInput {
  fileName: string;
  contentType: SubmissionMediaType;
  sizeBytes: number;
  title: string;
  description?: string;
  visibility?: Entities.Config.ShareVisibility;
}

export interface PresignSubmissionResult {
  submission: Submission;
  uploadUrl: string;
  /** ISO-8601 instant the presigned PUT stops working. */
  expiresAt: string;
}

export interface EditSubmissionInput {
  title?: string;
  description?: string;
  visibility?: Entities.Config.ShareVisibility;
}

export interface SubmissionSummary {
  limits: {
    perTopicMax: number;
    storagePerStudentBytes: number;
    videoMaxBytes: number;
  };
  sharingEnabled: boolean;
  usage: { topicCount: number; bytes: number };
  /** Shared ready submissions on the topic; 0 when sharing is disabled. */
  classCount: number;
  /** Every ready + removed submission on the topic — staff only. */
  totalCount?: number;
}

type Err = Extract<ControllerResult<never>, { ok: false }>;

const NOT_FOUND: Err = { ok: false, status: 404, error: 'NotFound' };
const FORBIDDEN: Err = { ok: false, status: 403, error: 'Forbidden' };
const CONFIG_INVALID: Err = { ok: false, status: 500, error: 'SUBMISSION_CONFIG_INVALID' };
const SHARING_DISABLED: Err = { ok: false, status: 409, error: 'SUBMISSION_SHARING_DISABLED' };
const MODERATED: Err = { ok: false, status: 409, error: 'SUBMISSION_MODERATED' };
const REMOVED_ERR: Err = { ok: false, status: 409, error: 'SUBMISSION_REMOVED' };
const STORAGE_FAILED: Err = { ok: false, status: 502, error: 'StorageUnavailable' };

/** "Staff" = `admin` or `content_creator`; a `tutor` is a student here (RFC 0020 §7). */
function isStaff(caller: SubmissionCaller): boolean {
  return caller.roles.includes(ROLES.ADMIN) || caller.roles.includes(ROLES.CONTENT_CREATOR);
}

function isAdmin(caller: SubmissionCaller): boolean {
  return caller.roles.includes(ROLES.ADMIN);
}

/** Drops the storage key and the moderation provenance. */
export function toSubmission(record: SubmissionRecord): Submission {
  return {
    id: record.id,
    topicNodeId: record.topicNodeId,
    authorId: record.authorId,
    authorName: record.authorName,
    title: record.title,
    description: record.description,
    originalName: record.originalName,
    contentType: record.contentType,
    sizeBytes: record.sizeBytes,
    status: record.status,
    visibility: record.visibility,
    sharedAt: record.sharedAt,
    moderated: record.moderatedAt !== null,
    removedAt: record.removedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// File signatures (RFC 0020 §5)
// ---------------------------------------------------------------------------

const ascii = (bytes: Uint8Array, offset: number, text: string): boolean =>
  bytes.length >= offset + text.length &&
  [...text].every((ch, i) => bytes[offset + i] === ch.charCodeAt(0));

const prefix = (bytes: Uint8Array, expected: readonly number[]): boolean =>
  bytes.length >= expected.length && expected.every((b, i) => bytes[i] === b);

/**
 * Whether the leading bytes carry the signature of `contentType`: `ftyp` at
 * offset 4 for MP4 / QuickTime, `FF D8 FF` for JPEG, `89 50 4E 47` for PNG,
 * `RIFF….WEBP` for WebP, `%PDF` for PDF. An unknown type never matches.
 */
export function matchesSignature(contentType: string, head: Uint8Array): boolean {
  switch (contentType) {
    case 'video/mp4':
    case 'video/quicktime':
      return ascii(head, 4, 'ftyp');
    case 'image/jpeg':
      return prefix(head, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return prefix(head, [0x89, 0x50, 0x4e, 0x47]);
    case 'image/webp':
      return ascii(head, 0, 'RIFF') && ascii(head, 8, 'WEBP');
    case 'application/pdf':
      return ascii(head, 0, '%PDF');
    default:
      return false;
  }
}

/**
 * Student submissions — the write side and the summary (RFC 0020 §5, §7, §10;
 * M23 Task 03). Every access, quota, configuration and signature decision lives
 * here; the router only parses the request and shapes the response.
 *
 * Topic-scoped calls apply the **catalog's** gate — published, not archived and,
 * for non-staff, in the caller's effective access set — and answer `404` on any
 * miss. A submission of another student is indistinguishable from a missing one.
 */
export class SubmissionsController {
  constructor(
    private readonly submissions: ISubmissionRepository,
    private readonly topics: ITopicNodeRepository,
    private readonly enrollment: IEnrollmentRepository,
    private readonly storage: IStorageAdapter,
    private readonly config: SubmissionConfigResult,
    private readonly rateLimiter: IRateLimiter,
  ) {}

  // -------------------------------------------------------------------------
  // Guards
  // -------------------------------------------------------------------------

  /**
   * The effective config, or `500 SUBMISSION_CONFIG_INVALID`. A present but
   * malformed `SUBMISSIONS_*` var is never replaced by a default; the var name
   * is logged, never returned.
   */
  private effectiveConfig(): { ok: true; config: SubmissionConfig } | Err {
    if (this.config.ok) return { ok: true, config: this.config.config };
    console.error(
      `[submissions] invalid configuration: ${this.config.variable} ${this.config.reason}`,
    );
    return CONFIG_INVALID;
  }

  /** The catalog gate; staff bypass only the effective-access set. */
  private async isTopicReadable(topicId: string, caller: SubmissionCaller): Promise<boolean> {
    const topic = await this.topics.findById(topicId);
    if (!topic || topic.status !== Entities.Config.TopicNodeStatus.PUBLISHED || topic.archived) {
      return false;
    }
    if (isStaff(caller)) return true;
    const effectiveIds = await this.enrollment.getEffectiveAccessTopicIds(caller.userId);
    return effectiveIds.includes(topicId);
  }

  /** A signed GET on a ready submission's object; null for pending or removed rows. */
  private async signedUrl(record: SubmissionRecord): Promise<string | null> {
    if (record.status !== READY || !record.storageKey) return null;
    return this.storage.getPresignedDownloadUrl(record.storageKey, {
      expiresInSeconds: SUBMISSION_DOWNLOAD_URL_TTL_SECONDS,
    });
  }

  private async toView(record: SubmissionRecord, caller: SubmissionCaller): Promise<SubmissionView> {
    return {
      ...toSubmission(record),
      isMine: record.authorId === caller.userId,
      url: await this.signedUrl(record),
    };
  }

  private async toStaffView(record: SubmissionRecord, caller: SubmissionCaller): Promise<StaffSubmissionView> {
    return {
      ...(await this.toView(record, caller)),
      moderatedAt: record.moderatedAt,
      moderatedBy: record.moderatedBy,
      removedBy: record.removedBy,
      removedByName: record.removedByName,
    };
  }

  /**
   * Whether staff see `record` (RFC 0020 §7): every ready or removed
   * submission, plus their own in any status. Pending rows stay the author's.
   */
  private static visibleToStaff(record: SubmissionRecord, caller: SubmissionCaller): boolean {
    if (record.authorId === caller.userId) return true;
    return record.status === READY || record.status === REMOVED;
  }

  /**
   * Whether `caller` may read `record` through the student rules of RFC 0020 §7:
   * the author always (pending and tombstones included, so the UI can resume or
   * dismiss them); anyone else only a shared, ready submission while the label's
   * sharing switch is on — the switch is a read-time filter, no row is rewritten.
   */
  private static visibleTo(record: SubmissionRecord, caller: SubmissionCaller, sharingEnabled: boolean): boolean {
    if (record.authorId === caller.userId) return true;
    return sharingEnabled && record.status === READY && record.visibility === SHARED;
  }

  /**
   * The caller's own submission on `topicId`. Another student's row, a row on a
   * different topic and a missing row are all `404`; staff, who may read any
   * submission, get `403` on someone else's — they have no write route here.
   */
  private async findOwn(
    topicId: string,
    submissionId: string,
    caller: SubmissionCaller,
  ): Promise<{ ok: true; record: SubmissionRecord } | Err> {
    const record = await this.submissions.findById(submissionId);
    if (!record || record.topicNodeId !== topicId) return NOT_FOUND;
    if (record.authorId !== caller.userId) return isStaff(caller) ? FORBIDDEN : NOT_FOUND;
    return { ok: true, record };
  }

  /**
   * Per-user presign budget (30 per hour, `rl:submissions:`). Every presign
   * attempt past the gate counts. Fails open: a KV outage must not take uploads
   * down with it, and the quotas still bound storage.
   */
  private async rateLimited(caller: SubmissionCaller): Promise<Err | null> {
    try {
      const state = await this.rateLimiter.peek(caller.userId);
      if (!state.allowed) {
        return {
          ok: false,
          status: 429,
          error: 'TooManyRequests',
          meta: { retryAfterSeconds: state.retryAfterSeconds ?? 1 },
        };
      }
      await this.rateLimiter.hit(caller.userId);
    } catch (error) {
      console.error('[rate-limit] submissions limiter failed, failing open', error);
    }
    return null;
  }

  /** Sanitised description, or a `400` when it is too long after sanitisation. */
  private cleanDescription(raw: string): { ok: true; value: string } | Err {
    const value = sanitizeMarkdown(raw).trim();
    if (value.length > SUBMISSION_DESCRIPTION_MAX) {
      return {
        ok: false,
        status: 400,
        error: 'SUBMISSION_DESCRIPTION_TOO_LONG',
        meta: { max: SUBMISSION_DESCRIPTION_MAX },
      };
    }
    return { ok: true, value };
  }

  private static cleanTitle(raw: string): { ok: true; value: string } | Err {
    const value = raw.trim();
    if (value.length === 0 || value.length > SUBMISSION_TITLE_MAX) {
      return { ok: false, status: 400, error: 'SUBMISSION_TITLE_INVALID', meta: { max: SUBMISSION_TITLE_MAX } };
    }
    return { ok: true, value };
  }

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------

  /**
   * `POST /topics/{id}/submissions/presign` — gate (404) → rate limit (429) →
   * size (422 FileTooLarge) → sharing switch (409) → quota-guarded insert
   * (409 SUBMISSION_QUOTA) → presigned PUT under a server-built key.
   */
  async presign(
    topicId: string,
    caller: SubmissionCaller,
    input: PresignSubmissionInput,
  ): Promise<ControllerResult<PresignSubmissionResult>> {
    const cfg = this.effectiveConfig();
    if (!cfg.ok) return cfg;
    const { config } = cfg;

    if (!(await this.isTopicReadable(topicId, caller))) return NOT_FOUND;
    // Uploading is a student act (RFC 0020 §7, §10); staff only read and moderate.
    if (isStaff(caller)) return FORBIDDEN;

    const limited = await this.rateLimited(caller);
    if (limited) return limited;

    const maxBytes = isSubmissionVideoType(input.contentType)
      ? config.videoMaxBytes
      : mediaSizeLimitFor(input.contentType);
    if (maxBytes === null) {
      return { ok: false, status: 400, error: 'UnsupportedMediaType' };
    }
    if (input.sizeBytes > maxBytes) {
      return {
        ok: false,
        status: 422,
        error: 'FileTooLarge',
        meta: { detail: `${input.contentType} files must be ≤ ${maxBytes} bytes`, maxBytes },
      };
    }

    const visibility = input.visibility ?? PRIVATE;
    if (visibility === SHARED && !config.sharingEnabled) return SHARING_DISABLED;

    const title = SubmissionsController.cleanTitle(input.title);
    if (!title.ok) return title;
    const description = this.cleanDescription(input.description ?? '');
    if (!description.ok) return description;

    const id = crypto.randomUUID();
    const storageKey = `submissions/${caller.userId}/${id}-${sanitizeFileName(input.fileName)}`;
    const quota = {
      perTopicMax: config.perTopicMax,
      storagePerStudentBytes: config.storagePerStudentBytes,
    };

    const record = await this.submissions.createPending(
      {
        id,
        topicNodeId: topicId,
        authorId: caller.userId,
        title: title.value,
        description: description.value,
        storageKey,
        originalName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        visibility,
      },
      quota,
    );

    if (!record) {
      // The insert refused; read the usage only to explain why.
      const usage = await this.submissions.usage(caller.userId, topicId);
      const meta =
        usage.topicCount >= quota.perTopicMax
          ? { reason: 'count', used: usage.topicCount, limit: quota.perTopicMax }
          : { reason: 'storage', used: usage.bytes, limit: quota.storagePerStudentBytes };
      return { ok: false, status: 409, error: 'SUBMISSION_QUOTA', meta };
    }

    const uploadUrl = await this.storage.getPresignedUploadUrl(storageKey, {
      expiresInSeconds: SUBMISSION_UPLOAD_URL_TTL_SECONDS,
      contentType: input.contentType,
      maxSizeBytes: input.sizeBytes,
    });
    const expiresAt = new Date(Date.now() + SUBMISSION_UPLOAD_URL_TTL_SECONDS * 1000).toISOString();

    return { ok: true, data: { submission: toSubmission(record), uploadUrl, expiresAt } };
  }

  /**
   * `POST /topics/{id}/submissions/{sid}/finalize` — marks the row `ready` only
   * when the stored object exists and its length, type and leading signature
   * match what was declared. On a mismatch the object and the row are deleted
   * (`422 UPLOAD_MISMATCH`). Idempotent on a `ready` row.
   */
  async finalize(
    topicId: string,
    submissionId: string,
    caller: SubmissionCaller,
  ): Promise<ControllerResult<Submission>> {
    const cfg = this.effectiveConfig();
    if (!cfg.ok) return cfg;
    if (!(await this.isTopicReadable(topicId, caller))) return NOT_FOUND;

    const own = await this.findOwn(topicId, submissionId, caller);
    if (!own.ok) return own;
    const { record } = own;

    if (record.status === READY) return { ok: true, data: toSubmission(record) };
    if (record.status === REMOVED || !record.storageKey) return REMOVED_ERR;

    const key = record.storageKey;
    const stored = await this.storage.headObject(key);
    if (!stored) {
      return {
        ok: false,
        status: 422,
        error: 'NotUploaded',
        meta: { detail: 'object not found in storage; complete the upload first' },
      };
    }

    // The presigned PUT signs Content-Type, so a different type cannot be
    // stored through it; an adapter that reports the stored type is checked too.
    const storedType = stored.metadata?.contentType;
    let matches = stored.size === record.sizeBytes && (storedType === undefined || storedType === record.contentType);
    if (matches) {
      const head = await this.storage.readHead(key, SUBMISSION_SIGNATURE_BYTES);
      matches = head !== null && matchesSignature(record.contentType, head);
    }

    if (!matches) {
      try {
        await this.storage.deleteObject(key);
      } catch (error) {
        // Keep the row: it is the only pointer to the object, and the sweep retries.
        console.error('[submissions] failed to delete a mismatched upload', error);
        return STORAGE_FAILED;
      }
      await this.submissions.delete(record.id);
      return {
        ok: false,
        status: 422,
        error: 'UPLOAD_MISMATCH',
        meta: { detail: 'the stored file does not match the declared size or type' },
      };
    }

    const ready = await this.submissions.markReady(record.id);
    return { ok: true, data: toSubmission(ready) };
  }

  /**
   * `PATCH /topics/{id}/submissions/{sid}` — last-write-wins edit of title,
   * description (sanitised Markdown) and visibility. Sharing is refused while
   * the label switch is off or the submission is moderated. On a topic the
   * author can no longer read the edit is refused (`404`, the gate's miss) —
   * delete and move are the only actions left there (RFC 0020 §7).
   */
  async edit(
    topicId: string,
    submissionId: string,
    caller: SubmissionCaller,
    input: EditSubmissionInput,
  ): Promise<ControllerResult<Submission>> {
    const cfg = this.effectiveConfig();
    if (!cfg.ok) return cfg;
    if (!(await this.isTopicReadable(topicId, caller))) return NOT_FOUND;

    const own = await this.findOwn(topicId, submissionId, caller);
    if (!own.ok) return own;
    const { record } = own;
    if (record.status === REMOVED) return REMOVED_ERR;

    const patch: EditSubmissionInput = {};
    if (input.title !== undefined) {
      const title = SubmissionsController.cleanTitle(input.title);
      if (!title.ok) return title;
      patch.title = title.value;
    }
    if (input.description !== undefined) {
      const description = this.cleanDescription(input.description);
      if (!description.ok) return description;
      patch.description = description.value;
    }
    if (input.visibility !== undefined) {
      if (input.visibility === SHARED) {
        if (!cfg.config.sharingEnabled) return SHARING_DISABLED;
        if (record.moderatedAt !== null) return MODERATED;
      }
      patch.visibility = input.visibility;
    }

    if (Object.keys(patch).length === 0) return { ok: true, data: toSubmission(record) };
    const updated = await this.submissions.updateMeta(record.id, patch);
    return { ok: true, data: toSubmission(updated) };
  }

  /**
   * `DELETE /topics/{id}/submissions/{sid}` — the author's hard delete of a
   * pending or ready submission, or the dismissal of a tombstone. Object first,
   * then row: if R2 fails the row stays and the call answers `502`.
   *
   * Deliberately **not** behind the topic gate (as notes' delete): a student who
   * lost access to a topic can still delete what they uploaded there (RFC 0020 §7).
   */
  async remove(
    topicId: string,
    submissionId: string,
    caller: SubmissionCaller,
  ): Promise<ControllerResult<null>> {
    const cfg = this.effectiveConfig();
    if (!cfg.ok) return cfg;

    const own = await this.findOwn(topicId, submissionId, caller);
    if (!own.ok) return own;
    const { record } = own;

    if (record.storageKey) {
      try {
        await this.storage.deleteObject(record.storageKey);
      } catch (error) {
        console.error('[submissions] object delete failed; row kept', error);
        return STORAGE_FAILED;
      }
    }
    await this.submissions.delete(record.id);
    return { ok: true, data: null };
  }

  /**
   * `GET /topics/{id}/submissions?scope=` — newest first, pages of 20.
   * `mine`: the caller's own rows in every status. `class`: the topic's shared
   * ready rows (the caller's own flagged `isMine`), empty while sharing is off.
   * `all` is staff-only: every ready and removed row with its provenance, on any
   * published topic (staff bypass the access set); a non-staff caller gets
   * `403`, the only `403` of the read side. The scope only ever narrows what the
   * access table allows; the cursor is a position inside the scope's fixed WHERE.
   */
  async listForTopic(
    topicId: string,
    caller: SubmissionCaller,
    scope: TopicListScope,
    cursor: NoteCursorKey | null,
  ): Promise<ControllerResult<SubmissionPage<SubmissionView | StaffSubmissionView>>> {
    const cfg = this.effectiveConfig();
    if (!cfg.ok) return cfg;
    const staffScope = scope === 'all';
    if (staffScope && !isStaff(caller)) return FORBIDDEN;
    if (!(await this.isTopicReadable(topicId, caller))) return NOT_FOUND;

    const page = await this.submissions.listByTopic(topicId, {
      viewerId: caller.userId,
      scope,
      sharingEnabled: cfg.config.sharingEnabled,
      page: { cursor, limit: SUBMISSIONS_PAGE_SIZE },
    });

    if (staffScope) {
      const visible = page.data.filter((r) => r.status === READY || r.status === REMOVED);
      const data = await Promise.all(visible.map((r) => this.toStaffView(r, caller)));
      return { ok: true, data: { data, nextCursor: page.nextCursor } };
    }

    // Defence in depth: the repository's WHERE already decides the audience.
    const visible = page.data.filter((r) => SubmissionsController.visibleTo(r, caller, cfg.config.sharingEnabled));
    const data = await Promise.all(visible.map((r) => this.toView(r, caller)));
    return { ok: true, data: { data, nextCursor: page.nextCursor } };
  }

  /**
   * `GET /topics/{id}/submissions/{sid}` — one submission under the §7 rules
   * (direct link, viewer). Anything the caller may not see — another student's
   * private, pending or removed row, a shared one while sharing is off, a row on
   * another topic or an unreadable topic — is `404`, never `403`. Staff read any
   * ready or removed submission, read-only, with its provenance; another
   * student's pending row stays `404` for them too.
   */
  async getOne(
    topicId: string,
    submissionId: string,
    caller: SubmissionCaller,
  ): Promise<ControllerResult<SubmissionView | StaffSubmissionView>> {
    const cfg = this.effectiveConfig();
    if (!cfg.ok) return cfg;
    if (!(await this.isTopicReadable(topicId, caller))) return NOT_FOUND;

    const record = await this.submissions.findById(submissionId);
    if (!record || record.topicNodeId !== topicId) return NOT_FOUND;
    if (isStaff(caller)) {
      if (!SubmissionsController.visibleToStaff(record, caller)) return NOT_FOUND;
      return { ok: true, data: await this.toStaffView(record, caller) };
    }
    if (!SubmissionsController.visibleTo(record, caller, cfg.config.sharingEnabled)) return NOT_FOUND;
    return { ok: true, data: await this.toView(record, caller) };
  }

  /**
   * `GET /me/submissions` — every submission the caller owns, across topics,
   * newest first, with the topic title and `topicAccessible` (the catalog gate's
   * rule). On an inaccessible topic the submission is read-only except delete
   * and move (§7); it keeps its signed URL, since it is the author's own file.
   */
  async listMine(
    caller: SubmissionCaller,
    cursor: NoteCursorKey | null,
  ): Promise<ControllerResult<SubmissionPage<AuthoredSubmission>>> {
    const cfg = this.effectiveConfig();
    if (!cfg.ok) return cfg;

    const page = await this.submissions.listByAuthor(caller.userId, {
      scope: 'self',
      page: { cursor, limit: SUBMISSIONS_PAGE_SIZE },
    });

    const accessible = new Map<string, boolean>();
    if (page.data.length > 0) {
      const staff = isStaff(caller);
      const effectiveIds = staff ? null : new Set(await this.enrollment.getEffectiveAccessTopicIds(caller.userId));
      const topicIds = [...new Set(page.data.map((r) => r.topicNodeId))];
      const topics = await Promise.all(topicIds.map((id) => this.topics.findById(id)));
      topicIds.forEach((id, i) => {
        const topic = topics[i];
        accessible.set(
          id,
          !!topic &&
            topic.status === Entities.Config.TopicNodeStatus.PUBLISHED &&
            !topic.archived &&
            (staff || (effectiveIds?.has(id) ?? false)),
        );
      });
    }

    const data = await Promise.all(
      page.data.map(async (record: AuthoredSubmissionRecord) => ({
        ...toSubmission(record),
        url: await this.signedUrl(record),
        topicTitle: record.topicTitle,
        topicAccessible: accessible.get(record.topicNodeId) ?? false,
      })),
    );
    return { ok: true, data: { data, nextCursor: page.nextCursor } };
  }

  /**
   * `POST /me/submissions/move` — moves up to 10 of the caller's ready
   * submissions to `targetTopicId`, in request order. The target must be
   * readable (`404` otherwise); the source need not be — moving is how a
   * student rescues uploads from a topic they lost. The repository's batched
   * guarded `UPDATE`s decide each item (per-topic count on the target), reset
   * visibility to private and keep moderation; the object is never touched.
   * Staff have no move route (`403`).
   */
  async move(
    caller: SubmissionCaller,
    input: MoveSubmissionsInput,
  ): Promise<ControllerResult<MoveSubmissionsResult>> {
    const cfg = this.effectiveConfig();
    if (!cfg.ok) return cfg;
    if (isStaff(caller)) return FORBIDDEN;
    if (!(await this.isTopicReadable(input.targetTopicId, caller))) return NOT_FOUND;

    const result = await this.submissions.move(
      caller.userId,
      input.ids,
      input.targetTopicId,
      cfg.config.perTopicMax,
    );
    return {
      ok: true,
      data: { moved: result.moved.map(toSubmission), refused: result.refused },
    };
  }

  /**
   * `GET /topics/{id}/submissions/summary` — effective limits, the sharing
   * switch, the caller's usage and the class count; staff also get the total.
   */
  async summary(topicId: string, caller: SubmissionCaller): Promise<ControllerResult<SubmissionSummary>> {
    const cfg = this.effectiveConfig();
    if (!cfg.ok) return cfg;
    const { config } = cfg;
    if (!(await this.isTopicReadable(topicId, caller))) return NOT_FOUND;

    const [usage, counts] = await Promise.all([
      this.submissions.usage(caller.userId, topicId),
      this.submissions.topicSummary(topicId, caller.userId),
    ]);

    const summary: SubmissionSummary = {
      limits: {
        perTopicMax: config.perTopicMax,
        storagePerStudentBytes: config.storagePerStudentBytes,
        videoMaxBytes: config.videoMaxBytes,
      },
      sharingEnabled: config.sharingEnabled,
      usage: { topicCount: usage.topicCount, bytes: usage.bytes },
      classCount: config.sharingEnabled ? counts.class : 0,
    };
    if (isStaff(caller)) summary.totalCount = counts.total;
    return { ok: true, data: summary };
  }

  // -------------------------------------------------------------------------
  // Staff (RFC 0020 §8; M23 Task 05) — mounted under `/v1/admin`, whose
  // umbrella already admits both staff roles. The role checks are repeated
  // here so the rules hold whatever router calls them.
  // -------------------------------------------------------------------------

  /**
   * `GET /admin/users/{userId}/submissions` — every ready or removed
   * submission by one student, across topics, newest first, with the topic
   * title and provenance. Pending rows stay the author's. An unknown user
   * yields an empty page.
   */
  async listByUserForStaff(
    userId: string,
    caller: SubmissionCaller,
    cursor: NoteCursorKey | null,
  ): Promise<ControllerResult<SubmissionPage<StaffAuthoredSubmission>>> {
    const cfg = this.effectiveConfig();
    if (!cfg.ok) return cfg;
    if (!isStaff(caller)) return FORBIDDEN;

    const page = await this.submissions.listByAuthor(userId, {
      scope: 'staff',
      page: { cursor, limit: SUBMISSIONS_PAGE_SIZE },
    });
    const visible = page.data.filter((r) => r.status === READY || r.status === REMOVED);
    const data = await Promise.all(
      visible.map(async (record: AuthoredSubmissionRecord) => ({
        ...(await this.toStaffView(record, caller)),
        topicTitle: record.topicTitle,
      })),
    );
    return { ok: true, data: { data, nextCursor: page.nextCursor } };
  }

  /**
   * `POST /admin/submissions/{id}/unshare` — force-unshare: the submission
   * becomes (or stays) private and flagged with who and when; the author
   * cannot share it again until the flag is cleared. Title, description and
   * file are untouched. Pending rows are invisible to staff (`404`).
   */
  async forceUnshare(
    submissionId: string,
    caller: SubmissionCaller,
  ): Promise<ControllerResult<StaffSubmissionView>> {
    if (!isStaff(caller)) return FORBIDDEN;
    const existing = await this.submissions.findById(submissionId);
    if (!existing || existing.status === Entities.Config.SubmissionStatus.PENDING) return NOT_FOUND;

    const record = await this.submissions.setModeration(submissionId, caller.userId);
    if (!record) return NOT_FOUND;
    return { ok: true, data: await this.toStaffView(record, caller) };
  }

  /**
   * `DELETE /admin/submissions/{id}/moderation` — lifts the flag so the author
   * may share again. It never re-shares on the author's behalf.
   */
  async clearModeration(submissionId: string, caller: SubmissionCaller): Promise<ControllerResult<null>> {
    if (!isStaff(caller)) return FORBIDDEN;
    const existing = await this.submissions.findById(submissionId);
    if (!existing || existing.status === Entities.Config.SubmissionStatus.PENDING) return NOT_FOUND;

    const record = await this.submissions.setModeration(submissionId, null);
    if (!record) return NOT_FOUND;
    return { ok: true, data: null };
  }

  /**
   * `DELETE /admin/submissions/{id}` — `admin` only (a content creator gets
   * `403`). Object first, then the tombstone: status `removed`, removal stamp
   * and author, key nulled, description cleared, private — the author keeps a
   * "Removed by the staff" card and the quota is freed. If the object delete
   * fails nothing changes and the call answers `502`. Idempotent on a
   * tombstone; a pending row is the author's and answers `404`.
   */
  async removeByStaff(submissionId: string, caller: SubmissionCaller): Promise<ControllerResult<null>> {
    if (!isAdmin(caller)) return FORBIDDEN;
    const record = await this.submissions.findById(submissionId);
    if (!record || record.status === Entities.Config.SubmissionStatus.PENDING) return NOT_FOUND;
    if (record.status === REMOVED) return { ok: true, data: null };

    if (record.storageKey) {
      try {
        await this.storage.deleteObject(record.storageKey);
      } catch (error) {
        console.error('[submissions] staff removal: object delete failed; row unchanged', error);
        return STORAGE_FAILED;
      }
    }
    await this.submissions.markRemoved(record.id, caller.userId);
    return { ok: true, data: null };
  }
}
