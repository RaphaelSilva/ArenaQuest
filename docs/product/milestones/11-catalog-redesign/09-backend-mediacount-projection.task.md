# Task 09 — Backend: additive `mediaCount` projection on `TopicNode` (Phase 3)

**Status:** ✅ Done
**Milestone:** [11 — Catalog redesign](./milestone.md)
**RFC:** [0004 — Catalog page redesign, Phase 3](../../RFCs/0004-catalog-redesign.md)

## Summary

Extend the `TopicNode` projection with an additive `mediaCount` field (`{ video, audio, pdf, total }`) so the participant catalog can render the MediaMix pills on `SubtopicCard` without an extra round-trip. The field is populated in both the flat `GET /topics` list and the `GET /topics/:id` detail (including every entry of `children`), backed by a single aggregate query over the `media` table. **No new route** and **no breaking change** — clients that ignore the field continue to work.

## Dependencies

- Task 01 (route topology + helpers landed; no UI dependency here, but the milestone ordering benefits from Phase 1 being done first).

Independent of Tasks 03 – 08; can land in parallel with Phase 2.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `packages/shared/types/entities.ts` — extend `Entities.Content.TopicNode` with the `mediaCount` field.
  - `apps/api/src/adapters/db/D1TopicNodeRepository.ts` (and any helper it imports exclusively) — populate the new field in the queries that feed `GET /topics` and `GET /topics/:id`.
  - `apps/api/test/**` — new Vitest case covering: zero media on a topic, mixed kinds (video + audio + pdf), and a delete that re-counts correctly.
- **Cloud-agnostic.** The aggregation lives in the `D1TopicNodeRepository` adapter. The `ITopicNodeRepository` port and any controller code remain free of D1-specific imports. If a method signature on the port needs to change to surface the new field, change it through the port type and re-implement in every adapter (today: D1 only); do not break the port abstraction.
- **No new route.** The field is exposed only as part of the existing `TopicNode` projection.
- **Computation strategy.** On read, derive `mediaCount` per topic from `SELECT topic_id, kind, COUNT(*) FROM media GROUP BY topic_id, kind` (or the adapter-internal equivalent). Join into the existing list / detail payloads; do not introduce a materialised view or a cache layer in this task. RFC 0004 explicitly accepts "compute on read".
- **Zero is legitimate.** A topic with no media returns `{ video: 0, audio: 0, pdf: 0, total: 0 }`, not `null` or `undefined`.
- **Backwards-compatible.** Existing serialised payloads keep every field they already had; only the new field is added. No frontend that ignores the field breaks.
- **`total` is consistent.** `total === video + audio + pdf` always; the adapter must compute one of them and derive the others, never let them drift.

## Scope

In:
- Add the `mediaCount` field shape to `Entities.Content.TopicNode` in `packages/shared/types/entities.ts`.
- Populate the field in `D1TopicNodeRepository` for both the flat list and the detail (including each `children` entry).
- Add a Vitest case under `apps/api/test/**` exercising zero-media, mixed-kinds, and a delete + re-count scenario.
- Update any existing test fixture or factory in the API test suite that builds `TopicNode` to include the new field (with sensible defaults).

Out:
- Frontend consumption (Tasks 11 — wires the pills on `SubtopicCard`).
- New endpoints for media, comments, likes, or replies.
- Materialised views, caching, or denormalised counters.
- Authoring tooling for media (already exists in `/admin/topics`).

## Acceptance Criteria

- [x] `Entities.Content.TopicNode` includes `mediaCount: { video: number; audio: number; pdf: number; total: number }`.
- [x] `GET /topics` returns the new field for every node in the flat list.
- [x] `GET /topics/:id` returns the new field for both the parent topic and every entry of `children`.
- [x] A topic with no media returns all-zero `mediaCount` (legitimate value, not an error).
- [x] `total === video + audio + pdf` for every returned topic.
- [x] The new Vitest case covers zero media, mixed kinds, and delete + re-count; it passes under `make test-api`.
- [x] The change is additive — no `TopicNode` field is removed, renamed, or reshaped.
- [x] No D1-specific import leaks into `ITopicNodeRepository` or any controller / route file.
- [x] `make lint`, `make test-api`, and `make test-web` pass green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. Run `make test-api` and confirm the new case passes alongside the existing suite.
2. Locally: `make dev-api`, seed a few topics with various media kinds, and `curl` both `GET /topics` and `GET /topics/:id`. Confirm the new field is present and the sums add up.
3. Delete a media item via the existing media route and re-hit `GET /topics/:id`; confirm the count drops correctly.
4. `make dev-web` (with the API running) and load `/catalog/<id>`; confirm the page still renders. The MediaMix pills will appear only after Task 11; this task only verifies the field is present in the payload.
5. `git diff --stat` confirms only the files listed in the scope guardrail are touched.
