# Task 10 — Backend: aq-mcp server with draft authoring tools (Phase 3)

**Status:** 📝 Open
**Milestone:** [28 — AI Admin Assistant](./milestone.md)
**RFC:** [RFC 0023](../../RFCs/0023-ai-admin-assistant.md)
**Team:** Backend API
**Depends On:** [Task 07](./07-topic-publish-gate.task.md), [Task 09](./09-shared-script-library.task.md)

## Summary

Ships the local MCP server `aq-mcp` (`scripts/mcp/aq-mcp.mjs`, stdio transport, one
`--label`/`-e` per registration) with the **authoring** tools: `list_topics`, `read_topic`,
`topic_comments`, `create_topic_draft`, `update_topic_draft`, `upload_media` and `review_link`.
It logs in with `AQ_ADMIN_EMAIL` / `AQ_ADMIN_PASSWORD` from the environment (a dedicated
`content_creator` account) and talks only to the public API through Task 09's client. No tool can
express a status; create always produces a `draft`; update and upload are refused unless the
stored topic is a `draft`. `upload_media` takes a **local path**, validates type and size against
the shared limits, converts `.mov` through Task 09's converter (reporting a missing `ffmpeg` with
its install command), and runs `presign → PUT → finalize`. Every tool carries MCP annotations
(`readOnlyHint` on reads, `destructiveHint: false` on writes) and every call appends a line to
`.arenaquest/mcp-audit-<label>-<env>.jsonl` without content bodies. `topic_comments` returns
comments only — never notes or submissions. `docs/onboarding.md` gains the install section
(clone, `pnpm install`, `claude mcp add …`). Task 12 adds the ops tools to this server.

## Dependencies

- [Task 07](./07-topic-publish-gate.task.md) — hard dependency: the server-side guarantee that
  the account cannot publish.
- [Task 09](./09-shared-script-library.task.md) — hard dependency: the API client, upload
  lifecycle and converter.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `scripts/mcp/aq-mcp.mjs`, `scripts/mcp/tools/authoring.mjs`, `scripts/mcp/audit.mjs` and
    their `*.test.mjs`.
  - The root `package.json` / lockfile — `@modelcontextprotocol/sdk` as a dev dependency only.
  - `.gitignore` — only if `.arenaquest/` is not already ignored.
  - `docs/onboarding.md` — the `aq-mcp` section; `CLAUDE.md` — one paragraph.
- **API only.** No wrangler, no SQL, no direct R2 access from these tools.
- **Credentials from the environment only**, never argv, never a tool argument, never logged.
  `AQ_API_BASE_URL` keeps the importer's loopback-only rule.
- **Draft-only by construction.** No tool input schema has a status field; the draft check runs
  before any write call (read the topic, then decide).
- **Data policy (RFC §6).** No tool returns private note bodies, submission files, emails beyond
  what a topic payload already carries, password hashes, tokens or secrets.
- **Sequential topic creation** (the importer's rule: `sort_order` derives from a
  non-transactional `MAX`).

## Scope

In:
- The server bootstrap, the seven tools, annotations, audit log, onboarding section, tests with
  the API client stubbed (including the refusals) and one MCP round-trip test over stdio.

Out:
- Ops and backup tools — Task 12.
- Publishing, archiving, moving or deleting topics or media.
- A packaged `npx` entry (milestone Decision 5).

## Acceptance Criteria

- [ ] `claude mcp add aq-test -- node scripts/mcp/aq-mcp.mjs --label budo -e staging` lists
      exactly the seven tools with their annotations.
- [ ] No tool's input schema contains a status property (asserted by a test over the tool list).
- [ ] `create_topic_draft` produces a `draft` topic; `update_topic_draft` and `upload_media` on a
      published topic are refused with a clear message and **no** API write call (stubbed client
      asserts).
- [ ] `upload_media` with a local `.mov` converts and uploads it; the media reaches `ready` on
      staging. An oversized file is refused before presign; a missing `ffmpeg` returns its
      install command.
- [ ] Each call appends one audit line with tool, arguments minus bodies, and outcome.
- [ ] `node --test scripts/mcp/` green; `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `node --test scripts/mcp/`.
2. On a second machine (or a fresh clone), follow the onboarding section, register the server
   against **staging**, and author a draft topic with a local `.mov` and two photos through Claude
   Code; confirm it in the backoffice as a draft with three ready media.
3. Ask the assistant to publish it; confirm no tool can, and the backoffice publish (admin) works.
4. `git diff --stat` confirms only scope-guardrail files changed.
