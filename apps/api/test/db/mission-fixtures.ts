import { env } from 'cloudflare:test';

/**
 * Raw-INSERT fixtures shared by the mission specs (RFC 0022). Not a spec: the
 * workers project only picks up `*.spec.ts`. Every helper returns the new row id.
 */

export async function insertUser(): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB
    .prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .bind(id, 'User', `${id}@test.local`, 'hash')
    .run();
  return id;
}

export async function insertTopic(): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO topic_nodes (id, title) VALUES (?, 'Topic')").bind(id).run();
  return id;
}

/** An event starting at `startsAt` (any form `datetime()` parses). */
export async function insertEvent(startsAt: string, createdBy: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB
    .prepare(
      `INSERT INTO events (id, slug, title, starts_at, status, created_by)
       VALUES (?, ?, 'Seminar', ?, 'published', ?)`,
    )
    .bind(id, `seminar-${id}`, startsAt, createdBy)
    .run();
  return id;
}

export async function insertMission(
  opts: {
    startAt?: string;
    endAt?: string;
    predicateKind?: string;
    active?: boolean;
    mode?: 'parallel' | 'sequential';
    enrollmentMode?: 'auto' | 'open' | 'assigned';
  } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB
    .prepare(
      `INSERT INTO missions (id, title, start_at, end_at, predicate_kind, active, mode, enrollment_mode)
       VALUES (?, 'Mission', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      opts.startAt ?? '2026-05-01T10:00:00.000Z',
      opts.endAt ?? '2026-05-31T23:59:59.000Z',
      opts.predicateKind ?? 'requirements',
      opts.active === false ? 0 : 1,
      opts.mode ?? 'parallel',
      opts.enrollmentMode ?? 'auto',
    )
    .run();
  return id;
}

export async function insertRequirement(
  missionId: string,
  position: number,
  kind: string,
  opts: { topicId?: string | null; eventId?: string | null; params?: unknown } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB
    .prepare(
      `INSERT INTO mission_requirements (id, mission_id, position, kind, title, topic_node_id, event_id, params)
       VALUES (?, ?, ?, ?, 'Step', ?, ?, ?)`,
    )
    .bind(id, missionId, position, kind, opts.topicId ?? null, opts.eventId ?? null, JSON.stringify(opts.params ?? {}))
    .run();
  return id;
}

export async function enroll(
  missionId: string,
  userId: string,
  opts: { countsFrom?: string; source?: 'auto' | 'self' | 'admin'; leftAt?: string | null } = {},
): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO mission_enrollments (mission_id, user_id, source, counts_from, left_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(missionId, userId, opts.source ?? 'auto', opts.countsFrom ?? '2026-05-01T10:00:00.000Z', opts.leftAt ?? null)
    .run();
}

export async function insertSubmission(
  topicId: string,
  authorId: string,
  createdAt: string,
  opts: { status?: string; description?: string; visibility?: string; moderatedAt?: string | null } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB
    .prepare(
      `INSERT INTO topic_submissions
         (id, topic_node_id, author_id, title, description, storage_key, original_name, content_type,
          size_bytes, status, visibility, moderated_at, created_at)
       VALUES (?, ?, ?, 'Demo', ?, ?, 'demo.mp4', 'video/mp4', 1, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      topicId,
      authorId,
      opts.description ?? 'A description',
      `submissions/${authorId}/${id}`,
      opts.status ?? 'ready',
      opts.visibility ?? 'private',
      opts.moderatedAt ?? null,
      createdAt,
    )
    .run();
  return id;
}

export async function insertCharge(
  eventId: string,
  userId: string,
  status: 'open' | 'paid' | 'void',
  issuedBy: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB
    .prepare(
      `INSERT INTO event_charges
         (id, event_id, user_id, description, amount_minor, currency, due_date, grace_days, status, issued_by)
       VALUES (?, ?, ?, 'Seminar', 8000, 'BRL', '2026-05-10', 5, ?, ?)`,
    )
    .bind(id, eventId, userId, status, issuedBy)
    .run();
  return id;
}

export async function insertMedia(
  topicId: string,
  uploadedBy: string,
  opts: { type?: string; status?: string } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB
    .prepare(
      `INSERT INTO media (id, topic_node_id, uploaded_by, storage_key, original_name, type, status)
       VALUES (?, ?, ?, ?, 'clip.mp4', ?, ?)`,
    )
    .bind(id, topicId, uploadedBy, `topics/${topicId}/${id}`, opts.type ?? 'video/mp4', opts.status ?? 'ready')
    .run();
  return id;
}

export async function insertEvidence(
  requirementId: string,
  userId: string,
  refId: string,
  occurredAt: string,
): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO mission_evidence (requirement_id, user_id, ref_id, occurred_at, source)
       VALUES (?, ?, ?, ?, 'hook')`,
    )
    .bind(requirementId, userId, refId, occurredAt)
    .run();
}
