# Task 01 — Backend: Shared text normaliser and tag slugify (Phase 0)

**Status:** 📝 Open
**Milestone:** [24 — Catalog search by tags](./milestone.md)
**RFC:** [RFC 0017](../../RFCs/0017-catalog-search-by-tags.md)
**Team:** Backend API

## Summary

Introduces the one text normaliser that both catalog search and tag slugs rely on, so a
tag named `Chūdan` and a query typed `chudan` can never disagree (RFC 0017 Design §1,
milestone Objective 2). `packages/shared` gains two pure, dependency-free modules:
`domain/search` exposes `normalizeText` (fold diacritics, map Unicode dashes to `-`,
lowercase, squeeze whitespace, trim) and `tokenize` (split the normalised text on
whitespace and `- _ / . , ; :`, drop empty tokens); `domain/tags` exposes `slugify`,
defined as the tokens joined with `-` — so `slugify('Chūdan Tsuki')` is `chudan-tsuki` and
an all-punctuation name yields the empty string. The expected input/output pairs are kept
in a JSON fixture next to `slugify`, read by its spec and — in Task 06 — by the importer's
`node --test` suite, which cannot import TypeScript and therefore carries its own copy.
Task 02 slugifies tag names on write with it; Task 03 builds the catalog matcher on it.

## Dependencies

- None — independent.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `packages/shared/domain/search/{normalize.ts,index.ts,normalize.spec.ts}` (new).
  - `packages/shared/domain/tags/{slugify.ts,index.ts,slugify.spec.ts,slugify.fixtures.json}` (new).
  - The package's existing re-export point for `domain/*` modules, **only** if the
    `media` / `contact` modules are re-exported there too (follow their precedent).
- **Pure and portable.** No runtime dependency, no DOM or Workers API, no I/O: the same
  functions run in the Worker, in the browser bundle and in Vitest. Unicode handling uses
  only built-in `String.prototype.normalize` and Unicode property escapes.
- **Deterministic.** Both NFC and NFD spellings of the same text produce the same output;
  the functions never throw on any string input (empty string included).
- **No entity change.** `Entities.Content.Tag` and `TopicNode` are untouched.

## Scope

In:
- `normalizeText` and `tokenize` with the behaviour above.
- `slugify` built on `tokenize`.
- A JSON fixture of `{ input, slug }` pairs covering: `Chūdan`, `Jō`, an en-dash name
  (`Ro Ryu – Taki`), double spaces, NFC vs NFD input of the same word, mixed case, a
  name with `/` and `_`, and an all-punctuation name mapping to `""`.
- Vitest specs for all three functions, the slug cases driven by the fixture.

Out:
- Using the functions anywhere (API, web, importer) — Tasks 02, 03 and 06.
- Any change to `apps/api` or `apps/web`.

## Acceptance Criteria

- [ ] `normalizeText('  Chūdan   TSUKI ')` returns `chudan tsuki`; the NFD spelling of
      `Chūdan` normalises identically to the NFC one.
- [ ] `normalizeText('Ro Ryu – Taki')` returns `ro ryu - taki`.
- [ ] `tokenize('Kata  básica/2')` returns `['kata', 'basica', '2']`; `tokenize('')`
      returns `[]`.
- [ ] Every row of `slugify.fixtures.json` passes in `slugify.spec.ts`; `slugify('!!!')`
      is `""`.
- [ ] No new entry in `packages/shared/package.json` `dependencies`.
- [ ] Changed files lint clean; `pnpm --filter @arenaquest/shared test` and `make test-api`
      are green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `pnpm --filter @arenaquest/shared test` — the new specs pass.
2. `make lint` — clean.
3. `make test-api` — still green (nothing consumes the modules yet).
4. `git diff --stat` confirms only scope-guardrail files changed.
